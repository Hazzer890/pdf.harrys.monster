# pdf.harrys.monster — design

Date: 2026-08-05
Status: approved

## Goal

Port [annas-pdf-tool](https://github.com/goanna247/annas-pdf-tool) from a PySide6 desktop app to a static web page, styled with the harrys.monster design system, hosted at `pdf.harrys.monster`.

The source is one 1,201-line `main.py` holding ten tools backed by PyMuPDF, pypdf and Pillow. All PDF work moves into the browser. No server, no build step, no upload.

## Scope

Nine tools ship. Export Image (click an embedded image region to extract it) is dropped: it needs pdf.js operator-list introspection and serves the narrowest use of the ten.

Compress changes behaviour rather than porting. PyMuPDF compresses losslessly through garbage collection and stream deflate, which has no browser equivalent. The web version rasterises each page to JPEG, which shrinks scanned documents well and turns selectable text into pixels. The UI says so plainly.

Sign gains capability. The desktop version uploads an image, stamps it bottom-right at a fixed offset, and shows a preview that does not match the output. The web version lets you draw a signature or upload one, then drag and resize it on the rendered page, and puts it where you dropped it.

## Architecture

```
pdf.harrys.monster/
├── index.html           # shell + nine tool panels
├── css/
│   ├── reset.css        # copied from harrys.monster
│   ├── variables.css    # copied — design tokens
│   ├── layout.css       # copied
│   ├── components.css   # copied
│   ├── responsive.css   # copied
│   └── app.css          # new — dropzone, thumb grid, toolbar, sign canvas
├── js/
│   ├── background.js    # copied — flow-field canvas
│   ├── pdf-ops.js       # new — pure PDF operations, no DOM
│   ├── ui.js            # new — shared widgets
│   └── app.js           # new — tool switching, nine panels
├── vendor/
│   ├── cantoo-pdf-lib.min.js
│   ├── pdf.mjs
│   ├── pdf.worker.mjs
│   └── jszip.min.js
├── test/pdf-ops.test.mjs
├── _headers             # Cloudflare Pages CSP
└── README.md
```

### Module boundaries

**`pdf-ops.js`** touches no DOM. Each function takes bytes plus options and returns bytes:

```js
mergePdfs(arrayBuffers) -> Uint8Array
splitPdf(buf, cutPoints) -> [{name, bytes}]
rotatePdf(buf, {angle, startPage, endPage}) -> Uint8Array
reorderPdf(buf, order) -> Uint8Array
resizeToA4(buf) -> Uint8Array
imagesToPdf([{bytes, type, width, height}]) -> Uint8Array
stampSignature(buf, {pageIndex, pngBytes, x, y, width, height}) -> Uint8Array
rebuildFromImages([jpegBytes], sizes) -> Uint8Array   // compress output
```

Eight functions cover nine tools. PDF → PNG/JPG writes no PDF, so it renders through pdf.js in `app.js` and needs nothing here.

Page-index arithmetic lives here. That arithmetic is what silently corrupts output when wrong, so this is the file with tests.

**`ui.js`** holds the widgets every tool repeats: the dropzone, the lazy thumbnail grid, the page-range picker, and the download/zip helper. Extracted because nine tools use them, not on speculation.

**`app.js`** wires each tool panel to `pdf-ops` and handles tool switching.

### Libraries

Vendored and pinned, not loaded from a CDN. The page then works offline and depends on nothing at runtime.

- **`@cantoo/pdf-lib` 2.8.1** for writing PDFs. The original `pdf-lib` last shipped in November 2021; this fork keeps the same API and is maintained. If it misbehaves, `pdf-lib` 1.17.1 is a drop-in fallback.
- **`pdfjs-dist` 6.2.108** for rendering, plus its worker.
- **`jszip` 3.10.1** for multi-file output.

## Tools

| Tool | Implementation | Parity notes |
|---|---|---|
| Merge | `copyPages` | Reorderable file list |
| Photo → PDF | `embedJpg` / `embedPng` | Alpha composited onto white via canvas, matching Pillow's behaviour. One page per image at image dimensions |
| Split | pdf.js thumbnails + `copyPages` | Cut-points sit between pages. Output zipped, named `{base}_part_{n}_pages_{a}-{b}.pdf` as in the original |
| Compress | pdf.js render → JPEG → new PDF | Quality slider, before/after byte counts, warning that text stops being selectable |
| PDF → PNG/JPG | pdf.js canvas | Scale 100–300%, default 150%; JPEG quality 95. Output zipped |
| Sign | pdf.js preview + `drawImage` | Draw or upload, drag and resize, stamped where shown |
| Rotate | `setRotation(degrees(current + angle))` | Relative rotation, matching pypdf's `page.rotate()`. Start and end page inputs |
| Reorder | Thumbnail grid + `copyPages` | Drag to reorder, with ◀ ▶ buttons so keyboard users can too |
| Resize → A4 | `embedPage` scaled to fit | 595.276 × 841.890 pt, centred, aspect preserved, `_a4` suffix, batch zipped |

### Sign coordinates

Three transforms compose here, and getting them wrong is the most likely bug in the build:

1. Canvas coordinates run y-down from the top left; PDF user space runs y-up from the bottom left.
2. The preview canvas is scaled against page dimensions in points.
3. Pages carry their own `/Rotate` value, which shifts where a stamp lands.

The overlay position converts to PDF space as `pdfY = pageHeight - (canvasY + h) / scale`, then applies the inverse of the page rotation. Verified by stamping a marker at each of the four corners of a rotated page and confirming placement.

## Interaction

One dropzone at the top of the page. Files dropped there stay loaded while you switch tools. Single-document tools read the first file; Merge, Photo → PDF and Resize read the whole list. One shared dropzone is less code than nine and fewer clicks than nine separate uploads.

The layout mirrors the desktop app: tool list on the left, active tool filling the panel. Below 768px the sidebar becomes a horizontally scrolling row of chips.

Thumbnails render through an `IntersectionObserver` behind a concurrency cap of four. Rendering 200 pages eagerly freezes the tab, so this belongs in the design rather than in a later fix.

## Visual design

The css/ directory is copied from harrys.monster unchanged, so the two sites stay in step. `app.css` adds only what the tools need.

Inherited: Space Grotesk and JetBrains Mono, `--accent: #3b5bdb`, glass panels at `--radius: 22px`, the flow-field canvas background, and the `h.m` monogram favicon.

The footer carries the privacy line: everything runs in your browser, no file leaves your device.

## Failure handling

Errors appear inline in the active panel. No `alert()`.

- **Encrypted PDFs**: pdf-lib throws on load. Caught and reported as password protection rather than as a parse failure.
- **Corrupt or non-PDF input**: caught per file. In batch tools one bad file reports itself and the others still process, matching the desktop A4 tool's error collection.
- **Files above 50 MB**: warned before processing, since rasterising large documents can exhaust tab memory.
- **Invalid page ranges**: start beyond end, or beyond page count, rejected before any work starts.

## Testing

`node --test test/pdf-ops.test.mjs`, no framework. It builds a small multi-page PDF in memory and asserts on the operations where off-by-one errors hide:

- `splitPdf` at cut points [0, 2] of a 5-page document yields parts of 1, 2 and 2 pages
- `reorderPdf` with [2,0,1] permutes rather than copying in order
- `rotatePdf` composes with existing rotation and touches only the given range
- `resizeToA4` produces 595 × 842 pt regardless of input size
- `mergePdfs` totals the input page counts

Rendering, drag behaviour and signature placement get checked by hand in a browser. The arithmetic gets checked automatically.

## Deployment

New GitHub repository, connected to Cloudflare Pages. No build command; output directory `/`.

`harrys.monster` already runs on Cloudflare nameservers (`mariah`/`plato.ns.cloudflare.com`) and proxies through Cloudflare. Adding `pdf.harrys.monster` as a custom domain in the Pages project creates the DNS record without manual entry.

`_headers` sets a content security policy. Everything is self-hosted apart from Google Fonts, which the policy allows so the styling matches the main site. Self-hosting the two families later removes the last external request.

## Out of scope

- Export Image, the tenth desktop tool
- OCR, form filling, annotation, redaction, cryptographic signing
- Any server component, account or storage
- Self-hosted fonts, noted above as a follow-up
