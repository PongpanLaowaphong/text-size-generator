'use strict';

const TARGET_CHUNK_BYTES = 4 * 1024 * 1024; // 4 MB per chunk
const PREVIEW_CHARS = 300;
const PREVIEW_SLICE_BYTES = 1200; // Enough for >= 300 4-byte UTF-8 chars
const PAD_BYTE = 0x2e; // ASCII '.' (1 byte, valid UTF-8)

const LOREM_PARAGRAPHS = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
  'Curabitur pretium tincidunt lacus. Nulla gravida orci a odio. Nullam varius, turpis et commodo pharetra, est eros bibendum elit, nec luctus magna felis sollicitudin mauris. Integer in mauris eu nibh euismod gravida. Duis ac tellus et risus vulputate vehicula. Donec lobortis risus a elit. Etiam tempor. Ut ullamcorper, ligula eu tempor congue, eros est euismod turpis, id tincidunt sapien risus a quam.',
  'Maecenas fermentum consequat mi. Donec fermentum. Pellentesque malesuada nulla a mi. Duis sapien sem, aliquet nec, commodo eget, consequat quis, neque. Aliquam faucibus, elit ut dictum aliquet, felis nisl adipiscing sapien, sed malesuada diam lacus eget erat. Cras mollis scelerisque nunc. Nullam arcu. Aliquam consequat. Curabitur augue lorem, dapibus quis, laoreet et, pretium ac, nisi.',
  'Aenean magna nisl, mollis quis, molestie eu, feugiat in, orci. In hac habitasse platea dictumst. Fusce convallis, mauris imperdiet gravida bibendum, nisl turpis suscipit mauris, sed placerat ipsum urna sed risus. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Proin sodales pulvinar tempor. Cum sociis natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus.',
  'Nam fermentum, nulla luctus pharetra vulputate, felis tellus mollis orci, sed rhoncus pronin sapien nunc accuan eget. Quisque volutpat condimentum velit. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Nam nec ante. Sed lacinia, urna non tincidunt mattis, tortor neque adipiscing diam, a cursus ipsum ante quis turpis. Nulla facilisi. Ut fringilla.'
];

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Slices a valid UTF-8 Uint8Array to exactly `targetLen` bytes without
 * splitting any multi-byte UTF-8 character. If a multi-byte character would
 * be split at the boundary, the remaining 1-3 bytes are padded with ASCII '.'.
 *
 * @param {Uint8Array} bytes - Valid UTF-8 byte array
 * @param {number} targetLen - Exact number of bytes required (0 <= targetLen < bytes.length)
 * @returns {Uint8Array}
 */
function sliceUtf8Exact(bytes, targetLen) {
  if (targetLen <= 0) {
    return new Uint8Array(0);
  }

  let cut = targetLen;
  // If the byte at `targetLen` is a UTF-8 continuation byte (10xxxxxx),
  // then a multi-byte character started before `targetLen` and is split.
  if (targetLen < bytes.length && (bytes[targetLen] & 0xc0) === 0x80) {
    cut = targetLen - 1;
    while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) {
      cut--;
    }
  }

  const out = new Uint8Array(targetLen);
  if (cut > 0) {
    out.set(bytes.subarray(0, cut), 0);
  }
  if (cut < targetLen) {
    out.fill(PAD_BYTE, cut, targetLen);
  }
  return out;
}

/**
 * Returns expected byte length of a UTF-8 character given its leading byte.
 * @param {number} leadByte
 * @returns {number}
 */
function utf8CharLength(leadByte) {
  if ((leadByte & 0x80) === 0x00) return 1;
  if ((leadByte & 0xe0) === 0xc0) return 2;
  if ((leadByte & 0xf0) === 0xe0) return 3;
  if ((leadByte & 0xf8) === 0xf0) return 4;
  return 1;
}

/**
 * Trims any incomplete trailing UTF-8 character from a head slice before decoding.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
function trimIncompleteTrailingUtf8(bytes) {
  if (bytes.length === 0) return bytes;
  let i = bytes.length - 1;
  while (i > 0 && (bytes[i] & 0xc0) === 0x80) {
    i--;
  }
  const expected = utf8CharLength(bytes[i]);
  if (i + expected > bytes.length) {
    return bytes.subarray(0, i);
  }
  return bytes;
}

/**
 * Skips any leading UTF-8 continuation bytes from a tail slice before decoding.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
function trimLeadingContinuationUtf8(bytes) {
  let start = 0;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) {
    start++;
  }
  return bytes.subarray(start);
}

/**
 * Builds a repeating chunk buffer of size <= TARGET_CHUNK_BYTES (or seedBytes
 * directly if seedBytes is already >= TARGET_CHUNK_BYTES) using exponential doubling.
 * @param {Uint8Array} seedBytes
 * @returns {Uint8Array}
 */
function buildChunkBuffer(seedBytes) {
  if (seedBytes.length >= TARGET_CHUNK_BYTES) {
    return seedBytes;
  }
  const repeats = Math.floor(TARGET_CHUNK_BYTES / seedBytes.length);
  const totalLen = repeats * seedBytes.length;
  const buf = new Uint8Array(totalLen);
  buf.set(seedBytes, 0);

  let filled = seedBytes.length;
  while (filled < totalLen) {
    const copyLen = Math.min(filled, totalLen - filled);
    buf.set(buf.subarray(0, copyLen), filled);
    filled += copyLen;
  }
  return buf;
}

/**
 * Generates a safe, fast preview (head and tail) from a Blob of any size.
 * @param {Blob} blob
 */
async function extractPreview(blob) {
  if (blob.size <= PREVIEW_SLICE_BYTES) {
    const fullText = await blob.text();
    if (fullText.length <= PREVIEW_CHARS * 2 + 40) {
      return {
        previewHead: fullText,
        previewTail: '',
        isTruncated: false
      };
    }
    return {
      previewHead: fullText.slice(0, PREVIEW_CHARS),
      previewTail: fullText.slice(-PREVIEW_CHARS),
      isTruncated: true
    };
  }

  const headRaw = new Uint8Array(await blob.slice(0, PREVIEW_SLICE_BYTES).arrayBuffer());
  const tailRaw = new Uint8Array(
    await blob.slice(blob.size - PREVIEW_SLICE_BYTES, blob.size).arrayBuffer()
  );

  const headStr = decoder.decode(trimIncompleteTrailingUtf8(headRaw));
  const tailStr = decoder.decode(trimLeadingContinuationUtf8(tailRaw));

  return {
    previewHead: headStr.slice(0, PREVIEW_CHARS),
    previewTail: tailStr.slice(-PREVIEW_CHARS),
    isTruncated: true
  };
}

/**
 * Core byte-exact generation handler.
 */
async function generateText(config) {
  const startTime = performance.now();

  const {
    targetBytes,
    sizeDisplay,
    unit,
    mode,
    customText,
    separator,
    lineEnding,
    includeHeaderFooter
  } = config;

  if (!Number.isInteger(targetBytes) || targetBytes < 0) {
    throw new Error('Target byte size must be a non-negative integer.');
  }

  const eol = lineEnding === 'CRLF' ? '\r\n' : '\n';

  const headerStr = includeHeaderFooter
    ? `======== Text Size Generator =========${eol}${eol}`
    : '';
  const footerStr = includeHeaderFooter
    ? `${eol}${eol}======== Text : ${sizeDisplay} ${unit} Generate Complete ======`
    : '';

  const headerBytes = encoder.encode(headerStr);
  const footerBytes = encoder.encode(footerStr);
  const minBytes = headerBytes.length + footerBytes.length;

  if (targetBytes < minBytes) {
    throw new Error(
      `Target size (${targetBytes.toLocaleString()} bytes) is smaller than the minimum required for Header + Footer (${minBytes.toLocaleString()} bytes).`
    );
  }

  const bodyBytesNeeded = targetBytes - minBytes;

  let seedStr;
  if (mode === 'custom') {
    const normalized = String(customText || '').replace(/\r\n|\r|\n/g, eol);
    if (normalized.length === 0 && bodyBytesNeeded > 0) {
      throw new Error('Custom text cannot be empty.');
    }
    let sep = '';
    if (separator === 'space') sep = ' ';
    else if (separator === 'newline') sep = eol;
    seedStr = normalized + sep;
  } else {
    seedStr = LOREM_PARAGRAPHS.join(eol + eol) + eol + eol;
  }

  const seedBytes = encoder.encode(seedStr);
  if (bodyBytesNeeded > 0 && seedBytes.length === 0) {
    throw new Error('Text seed cannot be empty.');
  }

  const parts = [];
  if (headerBytes.length > 0) {
    parts.push(headerBytes);
  }

  let bodyWritten = 0;

  if (bodyBytesNeeded > 0) {
    const chunkBuf = buildChunkBuffer(seedBytes);
    const chunkLen = chunkBuf.length;

    let remaining = bodyBytesNeeded;
    let lastProgressTime = startTime;

    // Emit initial progress for large generations
    if (bodyBytesNeeded >= chunkLen) {
      self.postMessage({
        type: 'progress',
        percent: 0,
        writtenBytes: headerBytes.length,
        targetBytes,
        elapsedMs: 0
      });
    }

    // Fill full chunks wrapped as Blobs to keep JS heap usage minimal
    while (remaining >= chunkLen) {
      parts.push(new Blob([chunkBuf]));
      remaining -= chunkLen;
      bodyWritten += chunkLen;

      const now = performance.now();
      if (now - lastProgressTime >= 60 || remaining < chunkLen) {
        lastProgressTime = now;
        const writtenTotal = headerBytes.length + bodyWritten;
        const percent = Math.min(99, Math.floor((writtenTotal / targetBytes) * 100));
        self.postMessage({
          type: 'progress',
          percent,
          writtenBytes: writtenTotal,
          targetBytes,
          elapsedMs: now - startTime
        });
      }
    }

    // Fill remaining bytes (< chunkLen) with exact UTF-8 safe tail
    if (remaining > 0) {
      const remBuf = new Uint8Array(remaining);
      const fullSeeds = Math.floor(remaining / seedBytes.length);
      const tailLen = remaining % seedBytes.length;

      let offset = 0;
      if (fullSeeds > 0) {
        remBuf.set(seedBytes, 0);
        let filled = seedBytes.length;
        const fullSeedsBytes = fullSeeds * seedBytes.length;
        while (filled < fullSeedsBytes) {
          const copyLen = Math.min(filled, fullSeedsBytes - filled);
          remBuf.set(remBuf.subarray(0, copyLen), filled);
          filled += copyLen;
        }
        offset = fullSeedsBytes;
      }

      if (tailLen > 0) {
        const safeTail = sliceUtf8Exact(seedBytes, tailLen);
        remBuf.set(safeTail, offset);
      }

      parts.push(remBuf);
      bodyWritten += remaining;
    }
  }

  if (footerBytes.length > 0) {
    parts.push(footerBytes);
  }

  const finalBlob = new Blob(parts, { type: 'text/plain;charset=utf-8' });

  if (finalBlob.size !== targetBytes) {
    throw new Error(
      `Internal byte count mismatch: expected ${targetBytes} bytes, generated ${finalBlob.size} bytes.`
    );
  }

  const preview = await extractPreview(finalBlob);
  const elapsedMs = performance.now() - startTime;

  self.postMessage({
    type: 'done',
    blob: finalBlob,
    totalBytes: finalBlob.size,
    targetBytes,
    headerBytes: headerBytes.length,
    bodyBytes: bodyWritten,
    footerBytes: footerBytes.length,
    previewHead: preview.previewHead,
    previewTail: preview.previewTail,
    isTruncated: preview.isTruncated,
    elapsedMs
  });
}

self.onmessage = async function (event) {
  const data = event.data;
  if (!data || data.type !== 'generate') return;

  try {
    await generateText(data);
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err && err.message ? err.message : 'An unexpected error occurred during generation.'
    });
  }
};

