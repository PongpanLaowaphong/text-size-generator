'use strict';

(() => {
  const CLIPBOARD_LIMIT_BYTES = 25 * 1024 * 1024; // 25 MB safety guard
  const LARGE_FILE_TIP_BYTES = 50 * 1024 * 1024;  // 50 MB popup warning threshold
  const encoder = new TextEncoder();

  // Application state
  const state = {
    mode: 'lorem',             // 'lorem' | 'custom'
    separator: 'none',         // 'none' | 'space' | 'newline'
    sizeBase: 'binary',        // 'binary' (1024) | 'decimal' (1000)
    lineEnding: 'LF',          // 'LF' | 'CRLF'
    includeHeaderFooter: true,
    isTabMode: false,
    isGenerating: false
  };

  let activeWorker = null;
  let elapsedTimerId = null;
  let generationStartTime = 0;
  let currentBlob = null;
  let currentDownloadUrl = null;
  let currentMeta = null;
  let copyResetTimeout = null;

  // DOM elements
  const els = {
    openTabBtn: document.getElementById('openTabBtn'),
    tabModeBadge: document.getElementById('tabModeBadge'),
    sizeInput: document.getElementById('sizeInput'),
    unitSelect: document.getElementById('unitSelect'),
    targetBytesLive: document.getElementById('targetBytesLive'),
    presetBtns: Array.from(document.querySelectorAll('.preset-btn')),
    modeBtns: Array.from(document.querySelectorAll('[data-mode]')),
    customTextPanel: document.getElementById('customTextPanel'),
    customTextInput: document.getElementById('customTextInput'),
    sepBtns: Array.from(document.querySelectorAll('[data-sep]')),
    baseBtns: Array.from(document.querySelectorAll('[data-base]')),
    eolBtns: Array.from(document.querySelectorAll('[data-eol]')),
    headerFooterToggle: document.getElementById('headerFooterToggle'),
    advancedSummaryHint: document.getElementById('advancedSummaryHint'),
    exactBadge: document.getElementById('exactBadge'),
    headerBytesVal: document.getElementById('headerBytesVal'),
    bodyBytesVal: document.getElementById('bodyBytesVal'),
    footerBytesVal: document.getElementById('footerBytesVal'),
    totalBytesVal: document.getElementById('totalBytesVal'),
    validationError: document.getElementById('validationError'),
    largeFileTip: document.getElementById('largeFileTip'),
    generateBtn: document.getElementById('generateBtn'),
    progressPanel: document.getElementById('progressPanel'),
    progressLabel: document.getElementById('progressLabel'),
    progressElapsed: document.getElementById('progressElapsed'),
    progressFill: document.getElementById('progressFill'),
    cancelBtn: document.getElementById('cancelBtn'),
    resultSection: document.getElementById('resultSection'),
    previewMeta: document.getElementById('previewMeta'),
    genTimeMeta: document.getElementById('genTimeMeta'),
    previewHead: document.getElementById('previewHead'),
    previewDivider: document.getElementById('previewDivider'),
    previewOmittedLabel: document.getElementById('previewOmittedLabel'),
    previewTail: document.getElementById('previewTail'),
    copyBtn: document.getElementById('copyBtn'),
    copyBtnLabel: document.getElementById('copyBtnLabel'),
    downloadBtn: document.getElementById('downloadBtn'),
    clipboardGuardNote: document.getElementById('clipboardGuardNote')
  };

  function formatBytes(n) {
    return `${n.toLocaleString('en-US')} B`;
  }

  function formatElapsed(ms) {
    return `${(ms / 1000).toFixed(2)}s`;
  }

  function getMultiplier(unit, sizeBase) {
    const base = sizeBase === 'binary' ? 1024 : 1000;
    switch (unit) {
      case 'Bytes': return 1;
      case 'KB': return base;
      case 'MB': return base * base;
      case 'GB': return base * base * base;
      default: return 1;
    }
  }

  /**
   * Computes exact target bytes, header/footer/body breakdown, and validation error (if any).
   */
  function computePlan() {
    const rawSize = els.sizeInput.value.trim();
    const unit = els.unitSelect.value;
    const eol = state.lineEnding === 'CRLF' ? '\r\n' : '\n';

    const sizeDisplay = rawSize || '0';
    const headerStr = state.includeHeaderFooter
      ? `======== Text Size Generator =========${eol}${eol}`
      : '';
    const footerStr = state.includeHeaderFooter
      ? `${eol}${eol}======== Text : ${sizeDisplay} ${unit} Generate Complete ======`
      : '';

    const headerBytes = encoder.encode(headerStr).length;
    const footerBytes = encoder.encode(footerStr).length;
    const minBytes = headerBytes + footerBytes;

    if (!rawSize || !/^\d+(\.\d+)?$/.test(rawSize)) {
      return {
        valid: false,
        error: 'Enter a valid non-negative number for target size.',
        targetBytes: 0,
        headerBytes,
        bodyBytes: 0,
        footerBytes,
        sizeDisplay,
        unit
      };
    }

    const numericSize = Number(rawSize);
    if (!Number.isFinite(numericSize) || numericSize < 0) {
      return {
        valid: false,
        error: 'Target size must be a finite non-negative number.',
        targetBytes: 0,
        headerBytes,
        bodyBytes: 0,
        footerBytes,
        sizeDisplay,
        unit
      };
    }

    if (unit === 'Bytes' && !Number.isInteger(numericSize)) {
      return {
        valid: false,
        error: 'When unit is Bytes, enter a whole number.',
        targetBytes: 0,
        headerBytes,
        bodyBytes: 0,
        footerBytes,
        sizeDisplay,
        unit
      };
    }

    const multiplier = getMultiplier(unit, state.sizeBase);
    const targetBytes = Math.round(numericSize * multiplier);

    if (!Number.isSafeInteger(targetBytes)) {
      return {
        valid: false,
        error: 'Target size is too large to represent safely.',
        targetBytes: 0,
        headerBytes,
        bodyBytes: 0,
        footerBytes,
        sizeDisplay,
        unit
      };
    }

    if (targetBytes < minBytes) {
      return {
        valid: false,
        error: `Target size (${targetBytes.toLocaleString('en-US')} bytes) is below the minimum required for Header + Footer (${minBytes.toLocaleString('en-US')} bytes). Increase the size or disable Header & Footer.`,
        targetBytes,
        headerBytes,
        bodyBytes: 0,
        footerBytes,
        sizeDisplay,
        unit
      };
    }

    const bodyBytes = targetBytes - minBytes;

    if (state.mode === 'custom' && bodyBytes > 0 && els.customTextInput.value.length === 0) {
      return {
        valid: false,
        error: 'Custom seed text cannot be empty in Custom Text mode.',
        targetBytes,
        headerBytes,
        bodyBytes,
        footerBytes,
        sizeDisplay,
        unit
      };
    }

    return {
      valid: true,
      error: null,
      targetBytes,
      headerBytes,
      bodyBytes,
      footerBytes,
      sizeDisplay,
      unit
    };
  }

  function updatePresetHighlight() {
    const rawSize = els.sizeInput.value.trim();
    const unit = els.unitSelect.value;
    els.presetBtns.forEach((btn) => {
      const match = btn.dataset.size === rawSize && btn.dataset.unit === unit;
      btn.classList.toggle('active', match);
    });
  }

  function updateAdvancedSummaryHint() {
    const baseLabel = state.sizeBase === 'binary' ? 'Binary (1024)' : 'Decimal (1000)';
    const hfLabel = state.includeHeaderFooter ? 'Header/Footer ON' : 'Header/Footer OFF';
    els.advancedSummaryHint.textContent = `${baseLabel} · ${state.lineEnding} · ${hfLabel}`;
  }

  function refreshUI(clearVerifiedBadge = true) {
    if (clearVerifiedBadge) {
      els.exactBadge.classList.add('hidden');
    }

    updatePresetHighlight();
    updateAdvancedSummaryHint();

    const plan = computePlan();

    if (plan.targetBytes > 0 || (plan.valid && plan.targetBytes === 0)) {
      els.targetBytesLive.textContent = `Target: ${plan.targetBytes.toLocaleString('en-US')} bytes`;
    } else {
      els.targetBytesLive.textContent = 'Target: —';
    }

    els.headerBytesVal.textContent = formatBytes(plan.headerBytes);
    els.bodyBytesVal.textContent = plan.valid ? formatBytes(plan.bodyBytes) : '—';
    els.footerBytesVal.textContent = formatBytes(plan.footerBytes);
    els.totalBytesVal.textContent = plan.valid ? formatBytes(plan.targetBytes) : '—';

    if (plan.error) {
      els.validationError.textContent = plan.error;
      els.validationError.classList.remove('hidden');
    } else {
      els.validationError.textContent = '';
      els.validationError.classList.add('hidden');
    }

    const showLargeTip = !state.isTabMode && plan.valid && plan.targetBytes >= LARGE_FILE_TIP_BYTES;
    els.largeFileTip.classList.toggle('hidden', !showLargeTip);

    els.generateBtn.disabled = !plan.valid || state.isGenerating;
  }

  function cleanupDownloadUrl() {
    if (currentDownloadUrl) {
      URL.revokeObjectURL(currentDownloadUrl);
      currentDownloadUrl = null;
    }
  }

  function stopWorkerAndTimer() {
    if (activeWorker) {
      activeWorker.terminate();
      activeWorker = null;
    }
    if (elapsedTimerId !== null) {
      clearInterval(elapsedTimerId);
      elapsedTimerId = null;
    }
  }

  function setGeneratingState(isGenerating) {
    state.isGenerating = isGenerating;
    els.progressPanel.classList.toggle('hidden', !isGenerating);
    els.generateBtn.classList.toggle('hidden', isGenerating);

    if (isGenerating) {
      els.progressFill.style.width = '0%';
      els.progressLabel.textContent = 'Generating… 0%';
      els.progressElapsed.textContent = '0.00s';
    } else {
      refreshUI(false);
    }
  }

  function startGeneration() {
    const plan = computePlan();
    if (!plan.valid || state.isGenerating) return;

    stopWorkerAndTimer();
    cleanupDownloadUrl();
    currentBlob = null;
    currentMeta = null;

    els.exactBadge.classList.add('hidden');
    els.resultSection.classList.add('hidden');
    setGeneratingState(true);

    generationStartTime = performance.now();
    elapsedTimerId = setInterval(() => {
      const elapsed = performance.now() - generationStartTime;
      els.progressElapsed.textContent = formatElapsed(elapsed);
    }, 100);

    activeWorker = new Worker('worker.js');

    activeWorker.onmessage = (event) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === 'progress') {
        els.progressFill.style.width = `${msg.percent}%`;
        els.progressLabel.textContent = `Generating… ${msg.percent}%`;
        els.progressElapsed.textContent = formatElapsed(msg.elapsedMs);
        return;
      }

      if (msg.type === 'error') {
        stopWorkerAndTimer();
        setGeneratingState(false);
        els.validationError.textContent = msg.message || 'Generation failed.';
        els.validationError.classList.remove('hidden');
        return;
      }

      if (msg.type === 'done') {
        stopWorkerAndTimer();
        els.progressFill.style.width = '100%';
        els.progressLabel.textContent = 'Complete 100%';
        els.progressElapsed.textContent = formatElapsed(msg.elapsedMs);

        currentBlob = msg.blob;
        currentMeta = {
          sizeDisplay: plan.sizeDisplay,
          unit: plan.unit,
          targetBytes: msg.targetBytes
        };

        setGeneratingState(false);
        renderResult(msg);
      }
    };

    activeWorker.onerror = (err) => {
      stopWorkerAndTimer();
      setGeneratingState(false);
      els.validationError.textContent = err.message || 'Worker encountered an unexpected error.';
      els.validationError.classList.remove('hidden');
    };

    activeWorker.postMessage({
      type: 'generate',
      targetBytes: plan.targetBytes,
      sizeDisplay: plan.sizeDisplay,
      unit: plan.unit,
      mode: state.mode,
      customText: els.customTextInput.value,
      separator: state.separator,
      lineEnding: state.lineEnding,
      includeHeaderFooter: state.includeHeaderFooter
    });
  }

  function renderResult(msg) {
    const isExact = currentBlob && currentBlob.size === msg.targetBytes;

    els.headerBytesVal.textContent = formatBytes(msg.headerBytes);
    els.bodyBytesVal.textContent = formatBytes(msg.bodyBytes);
    els.footerBytesVal.textContent = formatBytes(msg.footerBytes);
    els.totalBytesVal.textContent = formatBytes(msg.totalBytes);

    if (isExact) {
      els.exactBadge.textContent = 'Exact Match ✓';
      els.exactBadge.classList.remove('hidden');
    } else {
      els.exactBadge.classList.add('hidden');
    }

    els.genTimeMeta.textContent = `Generated in ${formatElapsed(msg.elapsedMs)}`;
    els.previewHead.textContent = msg.previewHead;

    if (msg.isTruncated) {
      const shownBytes = encoder.encode(msg.previewHead).length + encoder.encode(msg.previewTail).length;
      const omittedBytes = Math.max(0, msg.totalBytes - shownBytes);
      els.previewMeta.textContent = 'First & last 300 chars';
      els.previewOmittedLabel.textContent =
        omittedBytes > 0
          ? `… ${omittedBytes.toLocaleString('en-US')} bytes omitted …`
          : '… middle content truncated …';
      els.previewDivider.classList.remove('hidden');
      els.previewTail.textContent = msg.previewTail;
      els.previewTail.classList.remove('hidden');
    } else {
      els.previewMeta.textContent = 'Full output';
      els.previewDivider.classList.add('hidden');
      els.previewTail.textContent = '';
      els.previewTail.classList.add('hidden');
    }

    // Smart Clipboard Guard (25 MB limit)
    resetCopyButtonVisual();
    const exceedsClipboard = currentBlob.size > CLIPBOARD_LIMIT_BYTES;
    els.copyBtn.disabled = exceedsClipboard;
    els.clipboardGuardNote.classList.toggle('hidden', !exceedsClipboard);

    els.resultSection.classList.remove('hidden');
  }

  function resetCopyButtonVisual() {
    if (copyResetTimeout) {
      clearTimeout(copyResetTimeout);
      copyResetTimeout = null;
    }
    els.copyBtn.classList.remove('copied');
    els.copyBtnLabel.textContent = 'Copy to Clipboard';
  }

  async function handleCopy() {
    if (!currentBlob || currentBlob.size > CLIPBOARD_LIMIT_BYTES) return;

    try {
      els.copyBtn.disabled = true;
      els.copyBtnLabel.textContent = 'Copying…';

      const text = await currentBlob.text();
      await navigator.clipboard.writeText(text);

      els.copyBtn.disabled = false;
      els.copyBtn.classList.add('copied');
      els.copyBtnLabel.textContent = 'Copied! ✓';

      if (copyResetTimeout) clearTimeout(copyResetTimeout);
      copyResetTimeout = setTimeout(() => {
        resetCopyButtonVisual();
      }, 2000);
    } catch (err) {
      els.copyBtn.disabled = false;
      resetCopyButtonVisual();
      els.validationError.textContent =
        'Failed to copy to clipboard. Try downloading the .txt file instead.';
      els.validationError.classList.remove('hidden');
    }
  }

  function handleDownload() {
    if (!currentBlob || !currentMeta) return;

    cleanupDownloadUrl();
    currentDownloadUrl = URL.createObjectURL(currentBlob);

    const safeSize = currentMeta.sizeDisplay.replace(/[^0-9.]/g, '') || '0';
    const filename = `text-size-${safeSize}${currentMeta.unit}-exact.txt`;

    const link = document.createElement('a');
    link.href = currentDownloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function handleOpenInTab() {
    const tabUrl =
      typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
        ? chrome.runtime.getURL('popup.html?mode=tab')
        : 'popup.html?mode=tab';

    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: tabUrl });
    } else {
      window.open(tabUrl, '_blank', 'noopener');
    }
  }

  function initEvents() {
    els.openTabBtn.addEventListener('click', handleOpenInTab);

    els.sizeInput.addEventListener('input', () => refreshUI(true));
    els.unitSelect.addEventListener('change', () => refreshUI(true));
    els.customTextInput.addEventListener('input', () => refreshUI(true));

    // Enter key submits generation
    [els.sizeInput, els.customTextInput].forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          startGeneration();
        }
      });
    });

    // Quick Presets
    els.presetBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        els.sizeInput.value = btn.dataset.size;
        els.unitSelect.value = btn.dataset.unit;
        refreshUI(true);
      });
    });

    // Text Mode Selector
    els.modeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        state.mode = btn.dataset.mode;
        els.modeBtns.forEach((b) => {
          const active = b.dataset.mode === state.mode;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', String(active));
        });
        els.customTextPanel.classList.toggle('hidden', state.mode !== 'custom');
        refreshUI(true);
      });
    });

    // Separator Selector
    els.sepBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        state.separator = btn.dataset.sep;
        els.sepBtns.forEach((b) => b.classList.toggle('active', b.dataset.sep === state.separator));
        refreshUI(true);
      });
    });

    // Size Base Selector
    els.baseBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        state.sizeBase = btn.dataset.base;
        els.baseBtns.forEach((b) => b.classList.toggle('active', b.dataset.base === state.sizeBase));
        refreshUI(true);
      });
    });

    // Line Ending Selector
    els.eolBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        state.lineEnding = btn.dataset.eol;
        els.eolBtns.forEach((b) => b.classList.toggle('active', b.dataset.eol === state.lineEnding));
        refreshUI(true);
      });
    });

    // Header/Footer Toggle
    els.headerFooterToggle.addEventListener('change', () => {
      state.includeHeaderFooter = els.headerFooterToggle.checked;
      refreshUI(true);
    });

    // Generate / Cancel
    els.generateBtn.addEventListener('click', startGeneration);
    els.cancelBtn.addEventListener('click', () => {
      stopWorkerAndTimer();
      setGeneratingState(false);
    });

    // Copy / Download
    els.copyBtn.addEventListener('click', handleCopy);
    els.downloadBtn.addEventListener('click', handleDownload);

    // Cleanup on unload
    window.addEventListener('unload', () => {
      stopWorkerAndTimer();
      cleanupDownloadUrl();
    });
  }

  function init() {
    const params = new URLSearchParams(window.location.search);
    state.isTabMode = params.get('mode') === 'tab';

    if (state.isTabMode) {
      document.body.classList.add('tab-mode');
      els.openTabBtn.classList.add('hidden');
      els.tabModeBadge.classList.remove('hidden');
    }

    initEvents();
    refreshUI(true);
  }

  init();
})();

