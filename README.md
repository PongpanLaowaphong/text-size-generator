# Text Size Generator (Chrome Extension)

A production-ready Chrome Extension (Manifest V3) that generates **byte-exact** Lorem Ipsum or custom repeating text matching any target size — from exact **Bytes** up to **1 GB+** — with instant **Copy to Clipboard** and **Download `.txt`** support.

Built with vanilla HTML5, CSS3, and modern JavaScript (zero external build dependencies), powered by a non-blocking **Web Worker** and memory-safe UTF-8 `Uint8Array` / `Blob` chunking.

---

## Key Features

- **0-Byte Tolerance Accuracy:** Guarantees `blob.size === targetBytes` across all units (`Bytes`, `KB`, `MB`, `GB`), both **Binary (1024)** and **Decimal (1000)** standards, and both **LF (`\n`)** and **CRLF (`\r\n`)** line endings.
- **Header & Footer Byte Inclusion:** Automatically calculates exact UTF-8 byte lengths of the header, footer, and blank separator lines using `TextEncoder` so the total file size matches your target down to the single byte.
- **Lorem Ipsum & Custom Text Modes:** Generate classic Lorem Ipsum paragraphs or repeat any custom UTF-8 seed text (including multi-byte scripts like Thai or emojis) with optional `None`, `Space`, or `Newline` separators.
- **Safe UTF-8 Boundary Truncation:** Multi-byte UTF-8 characters are never split or corrupted at the end of the body; any remaining 1–3 bytes that cannot fit a multi-byte character are cleanly padded with ASCII `.`.
- **Non-Blocking 1 GB+ Generation:** Runs asynchronously inside a Web Worker (`worker.js`) using 4 MB `Uint8Array` / `Blob` chunks — avoiding V8 string length limits and keeping the UI responsive with live progress, elapsed time, and instant **Cancel**.
- **Instant Copy & Download `.txt`:** Copy outputs up to **25 MB** directly to the clipboard with one click, or download any size (up to 1 GB+) as a `.txt` file.
- **Popup + Full-Tab Mode:** Use directly from the Chrome toolbar popup (`420px`), or click **Open in Tab** to run very large generations without interruption.

---

## Output Format Example

By default (with **Include Header & Footer** enabled), generated text follows this exact structure:

```text
======== Text Size Generator =========

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua...

======== Text : 10 MB Generate Complete ======
```

The byte budget is broken down live in the UI:

```text
Header bytes + Body bytes + Footer bytes = Total Exact Bytes
```

When **Include Header & Footer** is toggled **OFF** in **Advanced Settings**, the entire target byte count is filled with body text only.

---

## Installation Guide (Local / Developer Mode)

Because this extension uses zero build tools, you can load it directly into Google Chrome:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/text-size-generator.git
   cd text-size-generator
   ```
2. Open Google Chrome and navigate to:
   ```text
   chrome://extensions
   ```
3. Toggle **Developer mode** **ON** (top-right corner).
4. Click **Load unpacked** (top-left corner).
5. Select the `text-size-generator` project folder containing `manifest.json`.
6. Pin **Text Size Generator** from the Chrome Extensions toolbar icon for one-click access.

---

## Usage Guide

### 1. Choose a Target Size
- Enter any numeric size (decimals like `1.5 MB` are supported) and choose a unit: `Bytes`, `KB`, `MB`, or `GB`.
- Or click one of the **Quick Presets**: `10 KB`, `100 KB`, `1 MB`, `10 MB`, `100 MB`, `1 GB`.
- Watch the live **Target** byte count and **Byte Breakdown** update in real time.

### 2. Choose Text Mode
- **Lorem Ipsum (default):** Fills the body with repeating standard Lorem Ipsum paragraphs.
- **Custom Text:** Enter any seed text (e.g., `Helloworld`, `สวัสดี`, `🚀`) and choose a repeat separator (`None`, `Space`, or `Newline`).

### 3. Advanced Settings
Expand **Advanced Settings** to configure:
- **Size Standard:**
  - **Binary (1024)** *(default)* — `1 KB = 1,024 bytes`, `1 MB = 1,048,576 bytes`, `1 GB = 1,073,741,824 bytes`.
  - **Decimal (1000)** — `1 KB = 1,000 bytes`, `1 MB = 1,000,000 bytes`, `1 GB = 1,000,000,000 bytes`.
- **Line Ending:**
  - **LF (`\n`, 1 byte)** *(default)* — Standard for macOS and Linux.
  - **CRLF (`\r\n`, 2 bytes)** — Standard for Windows.
- **Include Header & Footer:** Toggle **ON** *(default)* or **OFF**.

### 4. Copy to Clipboard vs. Download `.txt`
- **Copy to Clipboard:** Available for outputs up to **25 MB** to prevent OS clipboard stalls or browser freezes. Clicking copies the exact text and displays `Copied! ✓`.
- **Download `.txt`:** Available for all sizes (including **100 MB – 1 GB+**) and saves the exact `Blob` with a descriptive filename such as `text-size-10MB-exact.txt`.

> **Tip for Large Files (100 MB – 1 GB+):** Click **Open in Tab** in the top-right corner of the popup before generating very large files. Chrome automatically closes extension popups when you click outside them, whereas Full Tab Mode keeps generation running uninterrupted.

---

## How to Verify Exact File Size

After downloading a generated `.txt` file, you can independently verify its exact byte count from the command line:

### macOS / Linux
```bash
wc -c text-size-10MB-exact.txt
ls -l text-size-10MB-exact.txt
```

### Windows (PowerShell)
```powershell
(Get-Item text-size-10MB-exact.txt).Length
```

For example, a **10 MB (Binary 1024)** file will report exactly `10485760` bytes, and a **10 MB (Decimal 1000)** file will report exactly `10000000` bytes.

---

## Project Structure

```text
text-size-generator/
├── manifest.json     # Chrome Extension Manifest V3 configuration
├── popup.html        # Main UI (supports both 420px popup and full-tab mode)
├── styles.css        # Modern dark-mode responsive styles
├── popup.js          # UI state, live validation, Web Worker control, Copy/Download
├── worker.js         # Chunked UTF-8 byte-exact text generator Web Worker
├── icons/
│   ├── icon16.png    # 16x16 toolbar icon
│   ├── icon48.png    # 48x48 extensions page icon
│   └── icon128.png   # 128x128 Chrome Web Store / install icon
├── LICENSE           # MIT License
└── README.md         # Documentation
```

---

## License

This project is licensed under the [MIT License](LICENSE).

