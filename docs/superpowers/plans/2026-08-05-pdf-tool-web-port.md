# pdf.harrys.monster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a static, client-side web port of annas-pdf-tool at `pdf.harrys.monster`, carrying nine of its ten tools and the harrys.monster visual identity.

**Architecture:** Plain ES modules, no build step, no server. `js/pdf-ops.js` holds pure byte-in/byte-out PDF functions with no DOM access and carries the Node test suite. `js/ui.js` holds widgets shared across tools. `js/app.js` wires nine tool panels. Libraries are vendored and loaded through dynamic `import()` on first use, so opening the page costs nothing until a tool needs an engine.

**Tech Stack:** `@cantoo/pdf-lib` 2.8.1 (ESM), `pdfjs-dist` 6.2.108 (ESM + worker), `jszip` 3.10.1, `node --test`, Cloudflare Pages.

**Spec:** `docs/superpowers/specs/2026-08-05-pdf-tool-web-port-design.md`

## Global Constraints

- No build step, no bundler, no framework. Browsers load the source files directly.
- No network requests at runtime except Google Fonts. All libraries vendored under `vendor/`.
- `js/pdf-ops.js` must never touch `document`, `window`, or `canvas`. It runs unchanged in Node, which is what makes it testable.
- Libraries load via dynamic `import()` inside the function that needs them, never as top-level imports in `app.js`.
- Pixel dimensions in points: A4 is `595.276 × 841.890`.
- Split output filenames must match the desktop original: `{base}_part_{n}_pages_{a}-{b}.pdf`, 1-indexed inclusive.
- Rotation is relative, matching pypdf's `page.rotate()`: add to existing rotation, mod 360.
- Errors render inline in the active panel. No `alert()`.
- Copy is sentence case. Australian spelling ("colour", "centred").
- Every commit message uses conventional-commit prefixes (`feat:`, `test:`, `fix:`, `chore:`).

## File Structure

| File | Responsibility |
|---|---|
| `index.html` | Shell: header, sidebar tool list, nine `<section>` panels, footer |
| `css/*.css` | Five files copied verbatim from harrys.monster |
| `css/app.css` | Dropzone, thumbnail grid, toolbar, sign canvas, sidebar |
| `js/background.js` | Copied verbatim: flow-field canvas |
| `js/pdf-ops.js` | Pure PDF operations. No DOM. Tested |
| `js/ui.js` | Shared widgets: file state, dropzone, thumbnail grid, download/zip |
| `js/app.js` | Tool switching and the nine panel controllers |
| `vendor/` | `pdf-lib.esm.min.js`, `pdf.min.mjs`, `pdf.worker.min.mjs`, `jszip.min.js` |
| `test/pdf-ops.test.mjs` | Node test suite |
| `_headers` | Cloudflare Pages CSP |
| `package.json` | `{"type": "module"}` plus the test script. No dependencies |

---

### Task 1: Scaffold, branding shell, deploy config

**Files:**
- Create: `index.html`, `css/app.css`, `package.json`, `_headers`, `README.md`, `.gitignore`
- Create: `vendor/pdf-lib.esm.min.js`, `vendor/pdf.min.mjs`, `vendor/pdf.worker.min.mjs`, `vendor/jszip.min.js`
- Copy: `css/{reset,variables,layout,components,responsive}.css`, `js/background.js` from `/home/harry/Downloads/harrys.monster`

**Interfaces:**
- Consumes: nothing
- Produces: DOM contract used by every later task. Each tool panel is `<section class="panel" id="panel-{id}" hidden>`, where `{id}` is one of `merge`, `images`, `split`, `compress`, `convert`, `sign`, `rotate`, `reorder`, `a4`. Sidebar buttons are `<button class="tool-btn" data-tool="{id}">`. Shared dropzone is `#dropzone`, its file input `#file-input`, the file list `#file-list`.

- [ ] **Step 1: Vendor the libraries**

```bash
mkdir -p vendor css js test docs
cd /tmp && npm pack @cantoo/pdf-lib@2.8.1 pdfjs-dist@6.2.108 jszip@3.10.1
mkdir -p /tmp/vend && for f in cantoo-pdf-lib-2.8.1.tgz pdfjs-dist-6.2.108.tgz jszip-3.10.1.tgz; do tar xzf /tmp/$f -C /tmp/vend; mv /tmp/vend/package /tmp/vend/${f%%-[0-9]*}; done
cd -
cp /tmp/vend/cantoo-pdf-lib/dist/pdf-lib.esm.min.js vendor/
cp /tmp/vend/pdfjs-dist/build/pdf.min.mjs vendor/
cp /tmp/vend/pdfjs-dist/build/pdf.worker.min.mjs vendor/
cp /tmp/vend/jszip/dist/jszip.min.js vendor/
ls -la vendor/
```

Expected: four files, roughly 658K / 444K / 1232K / 95K.

- [ ] **Step 2: Copy the design system unchanged**

```bash
SITE=/home/harry/Downloads/harrys.monster
cp $SITE/css/{reset,variables,layout,components,responsive}.css css/
cp $SITE/js/background.js js/
```

Do not edit these files. Keeping them byte-identical is what lets the two sites stay in step.

- [ ] **Step 3: Write `package.json`**

```json
{
  "name": "pdf-harrys-monster",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 4: Write `index.html`**

Head block copies the pattern from `harrys.monster/wares.html`: same fonts, same five stylesheets, same `h.m` favicon, `theme-color` `#f5f7fc`. Then:

```html
<body>
  <canvas id="field" aria-hidden="true"></canvas>
  <div class="backdrop" aria-hidden="true">
    <span class="blob blob--indigo"></span>
    <span class="blob blob--cyan"></span>
    <span class="blob blob--magenta"></span>
    <span class="grain"></span>
  </div>

  <header class="header">
    <nav class="nav" aria-label="Primary">
      <a href="https://harrys.monster" class="nav-logo">Harry Cassidy</a>
      <span class="nav-title">PDF tools</span>
    </nav>
  </header>

  <main class="app container">
    <div class="dropzone glass" id="dropzone">
      <input type="file" id="file-input" multiple accept="application/pdf,image/*" hidden>
      <p>Drop files here, or <button type="button" class="btn btn-ghost" id="browse">browse</button></p>
      <ul class="file-list" id="file-list" aria-live="polite"></ul>
    </div>

    <div class="app-body">
      <nav class="tool-nav" aria-label="Tools">
        <button class="tool-btn" data-tool="merge">Merge PDFs</button>
        <button class="tool-btn" data-tool="images">Photo to PDF</button>
        <button class="tool-btn" data-tool="split">Split PDF</button>
        <button class="tool-btn" data-tool="compress">Compress PDF</button>
        <button class="tool-btn" data-tool="convert">PDF to PNG/JPG</button>
        <button class="tool-btn" data-tool="sign">Sign PDF</button>
        <button class="tool-btn" data-tool="rotate">Rotate PDF</button>
        <button class="tool-btn" data-tool="reorder">Change page order</button>
        <button class="tool-btn" data-tool="a4">Resize to A4</button>
      </nav>

      <div class="tool-panels" id="panels">
        <!-- One per tool, filled by later tasks -->
        <section class="panel glass" id="panel-merge" hidden>
          <h2>Merge PDFs</h2>
          <p class="panel-sub">Add multiple PDFs, reorder them, and export a single combined file.</p>
          <div class="panel-body"></div>
          <p class="panel-error" role="alert" hidden></p>
        </section>
        <!-- Repeat the same shape for images, split, compress, convert,
             sign, rotate, reorder, a4, with the title and subtitle taken
             from the desktop app's PageSection headings. -->
      </div>
    </div>
  </main>

  <footer class="footer">
    <div class="container">
      <p>Everything runs in your browser. No file leaves your device.</p>
      <p>Harry Cassidy &copy; <span id="year">2026</span> ·
         <a href="https://harrys.monster">harrys.monster</a></p>
    </div>
  </footer>

  <script src="js/background.js" defer></script>
  <script type="module" src="js/app.js"></script>
</body>
```

Subtitles come from the desktop `PageSection` calls, so the copy matches: Merge "Add multiple PDFs, reorder them, and export a single combined file.", Photo to PDF "Convert one or more images into a PDF document.", Split "Page thumbnails with cut points placed between pages.", Compress "Rebuild the PDF at a lower image quality to reduce file size.", Convert "Render each page and export to PNG or JPG images.", Sign "Draw or upload a signature, then place it on the page. This is a visual stamp, not a cryptographic signature.", Rotate "Rotate all pages or a selected page range by 90, 180, or 270 degrees.", Reorder "Preview pages, move them, and save a reordered PDF.", A4 "Convert every page to A4 (595 × 842 pt), scaled to fit while keeping aspect ratio."

- [ ] **Step 5: Write `css/app.css`**

Use only tokens from `variables.css`. No new colours.

```css
.app { padding-block: clamp(24px, 5vw, 56px); }
.nav-title { font-family: var(--font-mono); color: var(--ink-mute); font-size: .9rem; }

.dropzone {
  border: 2px dashed var(--glass-brd);
  border-radius: var(--radius);
  padding: clamp(20px, 4vw, 36px);
  text-align: center;
  transition: border-color .2s var(--ease), background .2s var(--ease);
}
.dropzone.is-over { border-color: var(--accent); background: var(--surface-2); }

.file-list { list-style: none; margin: 1rem 0 0; padding: 0; display: grid; gap: .4rem; }
.file-list li {
  display: flex; align-items: center; gap: .6rem;
  font-family: var(--font-mono); font-size: .82rem;
  background: var(--surface-1); border-radius: 10px; padding: .45rem .7rem;
}
.file-list button { margin-left: auto; }

.app-body { display: grid; grid-template-columns: 240px 1fr; gap: 1.5rem; margin-top: 1.5rem; }

.tool-nav { display: flex; flex-direction: column; gap: .35rem; }
.tool-btn {
  text-align: left; padding: .7rem .9rem; border-radius: 14px;
  border: 1px solid transparent; background: transparent;
  color: var(--ink-soft); cursor: pointer; font: inherit;
}
.tool-btn:hover { background: var(--surface-2); }
.tool-btn[aria-current="true"] {
  background: var(--glass-fill-strong); border-color: var(--glass-brd);
  color: var(--ink); font-weight: 600;
}

.panel { padding: clamp(18px, 3vw, 28px); }
.panel-sub { color: var(--ink-mute); margin-bottom: 1.2rem; }
.panel-error { color: var(--danger); margin-top: 1rem; font-size: .9rem; }
.panel-toolbar { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; margin-bottom: 1rem; }

.thumb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 1rem; }
.thumb {
  background: var(--glass-fill-strong); border: 1px solid var(--glass-brd);
  border-radius: 14px; padding: .6rem; text-align: center;
}
.thumb canvas, .thumb .thumb-ph {
  width: 100%; height: auto; aspect-ratio: 1 / 1.414;
  background: var(--surface-2); border-radius: 8px; display: block;
}
.thumb-label { font-family: var(--font-mono); font-size: .75rem; color: var(--ink-mute); margin-top: .4rem; }
.thumb-actions { display: flex; justify-content: center; gap: .3rem; margin-top: .4rem; }
.thumb.is-dragging { opacity: .4; }
.thumb.cut-after { box-shadow: 4px 0 0 var(--accent); }

.sign-stage { position: relative; display: inline-block; touch-action: none; }
.sign-overlay {
  position: absolute; cursor: move; outline: 2px solid var(--accent);
  background: rgba(59, 91, 219, .06);
}
.sign-handle {
  position: absolute; right: -7px; bottom: -7px; width: 14px; height: 14px;
  background: var(--accent); border-radius: 50%; cursor: nwse-resize;
}
.sign-pad { border: 1px solid var(--glass-brd); border-radius: 12px; background: #fff; touch-action: none; }

.busy { opacity: .6; pointer-events: none; }

@media (max-width: 768px) {
  .app-body { grid-template-columns: 1fr; }
  .tool-nav { flex-direction: row; overflow-x: auto; padding-bottom: .4rem; }
  .tool-btn { white-space: nowrap; }
}
```

- [ ] **Step 6: Write `_headers`**

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Content-Security-Policy: default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'
```

`worker-src blob:` is required: pdf.js instantiates its worker from a blob URL.

- [ ] **Step 7: Write `README.md`**

Cover what it is, that it runs entirely client-side, `npm test` to run the suite, `python3 -m http.server` to serve locally (ES modules will not load over `file://`), and the Cloudflare Pages settings: no build command, output directory `/`.

- [ ] **Step 8: Verify the shell loads**

```bash
python3 -m http.server 8000 &
sleep 1 && curl -sf localhost:8000/index.html >/dev/null && echo "SERVED OK"
curl -sf localhost:8000/vendor/pdf-lib.esm.min.js >/dev/null && echo "VENDOR OK"
```

Then open `http://localhost:8000` and confirm: fonts render as Space Grotesk, the flow-field canvas animates behind the content, the sidebar lists nine tools, and the console is free of errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: scaffold pdf.harrys.monster shell, branding and vendored libraries"
```

---

### Task 2: `pdf-ops.js` core operations, test-first

**Files:**
- Create: `js/pdf-ops.js`
- Test: `test/pdf-ops.test.mjs`

**Interfaces:**
- Consumes: `vendor/pdf-lib.esm.min.js`
- Produces:
  - `loadPdf(bytes) -> Promise<PDFDocument>` — throws friendly `Error` on encrypted or corrupt input
  - `splitRanges(pageCount, cutPoints) -> [[start, end], ...]` — pure, half-open, 0-indexed
  - `mergePdfs(buffers) -> Promise<Uint8Array>`
  - `splitPdf(buf, cutPoints, baseName) -> Promise<[{name, bytes}]>`
  - `rotatePdf(buf, {angle, startPage, endPage}) -> Promise<Uint8Array>` — 1-indexed inclusive pages
  - `reorderPdf(buf, order) -> Promise<Uint8Array>` — `order` is a full 0-indexed permutation
  - `resizeToA4(buf) -> Promise<Uint8Array>`
  - `imagesToPdf([{bytes, type}]) -> Promise<Uint8Array>` — `type` is `'png'` or `'jpg'`
  - `signaturePlacement({rect, pageRotation}) -> {x, y, width, height, rotate}` — pure
  - `stampSignature(buf, {pageIndex, pngBytes, rect}) -> Promise<Uint8Array>`
  - `rebuildFromImages([{jpegBytes, width, height}]) -> Promise<Uint8Array>`
  - `A4 = [595.276, 841.890]`

- [ ] **Step 1: Write the failing tests**

Create `test/pdf-ops.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, degrees } from '../vendor/pdf-lib.esm.min.js';
import {
  loadPdf, splitRanges, mergePdfs, splitPdf, rotatePdf, reorderPdf,
  resizeToA4, signaturePlacement, A4,
} from '../js/pdf-ops.js';

async function makePdf(pageCount, size = [400, 600]) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage(size);
  return doc.save();
}

test('splitRanges cuts after the given 0-indexed pages', () => {
  assert.deepEqual(splitRanges(5, [0, 2]), [[0, 1], [1, 3], [3, 5]]);
});

test('splitRanges with no cuts returns one whole range', () => {
  assert.deepEqual(splitRanges(4, []), [[0, 4]]);
});

test('splitRanges ignores duplicates and out-of-bounds cuts', () => {
  assert.deepEqual(splitRanges(3, [1, 1, 2, 99, -1]), [[0, 2], [2, 3]]);
});

test('splitPdf produces parts of the right sizes and names', async () => {
  const parts = await splitPdf(await makePdf(5), [0, 2], 'doc');
  assert.equal(parts.length, 3);
  const counts = [];
  for (const p of parts) counts.push((await PDFDocument.load(p.bytes)).getPageCount());
  assert.deepEqual(counts, [1, 2, 2]);
  assert.equal(parts[0].name, 'doc_part_1_pages_1-1.pdf');
  assert.equal(parts[1].name, 'doc_part_2_pages_2-3.pdf');
  assert.equal(parts[2].name, 'doc_part_3_pages_4-5.pdf');
});

test('mergePdfs totals the input page counts', async () => {
  const out = await mergePdfs([await makePdf(2), await makePdf(3)]);
  assert.equal((await PDFDocument.load(out)).getPageCount(), 5);
});

test('reorderPdf permutes rather than copying in order', async () => {
  // Pages get distinct widths so the permutation is observable.
  const doc = await PDFDocument.create();
  [100, 200, 300].forEach(w => doc.addPage([w, 500]));
  const out = await reorderPdf(await doc.save(), [2, 0, 1]);
  const widths = (await PDFDocument.load(out)).getPages().map(p => Math.round(p.getWidth()));
  assert.deepEqual(widths, [300, 100, 200]);
});

test('reorderPdf rejects an incomplete permutation', async () => {
  const bytes = await makePdf(3);
  await assert.rejects(() => reorderPdf(bytes, [0, 1]));
});

test('rotatePdf composes with existing rotation and respects the range', async () => {
  const doc = await PDFDocument.create();
  [0, 1, 2].forEach(() => doc.addPage([400, 600]));
  doc.getPage(1).setRotation(degrees(90));
  const out = await rotatePdf(await doc.save(), { angle: 90, startPage: 2, endPage: 3 });
  const angles = (await PDFDocument.load(out)).getPages().map(p => p.getRotation().angle);
  assert.deepEqual(angles, [0, 180, 90]);
});

test('rotatePdf wraps past 360', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 600]);
  doc.getPage(0).setRotation(degrees(270));
  const out = await rotatePdf(await doc.save(), { angle: 180, startPage: 1, endPage: 1 });
  assert.equal((await PDFDocument.load(out)).getPage(0).getRotation().angle, 90);
});

test('rotatePdf rejects an invalid range', async () => {
  const bytes = await makePdf(3);
  await assert.rejects(() => rotatePdf(bytes, { angle: 90, startPage: 3, endPage: 1 }));
  await assert.rejects(() => rotatePdf(bytes, { angle: 90, startPage: 1, endPage: 9 }));
});

test('resizeToA4 produces A4 pages from any input size', async () => {
  const doc = await PDFDocument.create();
  // Pages need a content stream to be embeddable, so draw something.
  for (const size of [[200, 200], [1200, 400]]) {
    doc.addPage(size).drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
  }
  const out = await resizeToA4(await doc.save());
  for (const page of (await PDFDocument.load(out)).getPages()) {
    assert.equal(Math.round(page.getWidth()), Math.round(A4[0]));
    assert.equal(Math.round(page.getHeight()), Math.round(A4[1]));
  }
});

test('resizeToA4 keeps a contentless page as a blank A4 page', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);                                    // no content stream
  doc.addPage([300, 300]).drawRectangle({ x: 5, y: 5, width: 20, height: 20 });
  const out = await resizeToA4(await doc.save());
  const pages = (await PDFDocument.load(out)).getPages();
  assert.equal(pages.length, 2);
  assert.equal(Math.round(pages[0].getWidth()), Math.round(A4[0]));
});

test('signaturePlacement passes an unrotated page straight through', () => {
  const r = signaturePlacement({ rect: { x: 10, y: 20, w: 100, h: 50 }, pageRotation: 0 });
  assert.deepEqual(r, { x: 10, y: 20, width: 100, height: 50, rotate: 0 });
});

test('signaturePlacement offsets the origin for each page rotation', () => {
  const rect = { x: 10, y: 20, w: 100, h: 50 };
  assert.deepEqual(signaturePlacement({ rect, pageRotation: 90 }),
    { x: 110, y: 20, width: 50, height: 100, rotate: 90 });
  assert.deepEqual(signaturePlacement({ rect, pageRotation: 180 }),
    { x: 110, y: 70, width: 100, height: 50, rotate: 180 });
  assert.deepEqual(signaturePlacement({ rect, pageRotation: 270 }),
    { x: 10, y: 70, width: 50, height: 100, rotate: 270 });
});

test('signaturePlacement normalises negative and oversized rotations', () => {
  const rect = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(signaturePlacement({ rect, pageRotation: -90 }).rotate, 270);
  assert.equal(signaturePlacement({ rect, pageRotation: 450 }).rotate, 90);
});

test('loadPdf reports unreadable input in plain language', async () => {
  await assert.rejects(() => loadPdf(new Uint8Array([1, 2, 3])), /corrupt|read/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '../js/pdf-ops.js'`.

- [ ] **Step 3: Write `js/pdf-ops.js`**

The rotation cases come from rotating a `w × h` image counter-clockwise about its own bottom-left corner and solving for the origin that lands the result in the target rect. At 90° the image occupies `x ∈ [ox - h, ox]`, so `ox = x + w`.

```js
import { PDFDocument, degrees } from '../vendor/pdf-lib.esm.min.js';

export const A4 = [595.276, 841.890];

export async function loadPdf(bytes) {
  try {
    return await PDFDocument.load(bytes);
  } catch (err) {
    const msg = String(err && err.message);
    if (msg.includes('is encrypted')) {
      throw new Error('This PDF is password-protected. Remove the password and try again.');
    }
    throw new Error('Could not read this PDF. The file may be corrupt.');
  }
}

/** Cut points are 0-indexed pages to cut *after*. Returns half-open ranges. */
export function splitRanges(pageCount, cutPoints) {
  const cuts = [...new Set(cutPoints)]
    .filter(c => Number.isInteger(c) && c >= 0 && c < pageCount - 1)
    .sort((a, b) => a - b);
  const ranges = [];
  let start = 0;
  for (const cut of cuts) {
    ranges.push([start, cut + 1]);
    start = cut + 1;
  }
  ranges.push([start, pageCount]);
  return ranges;
}

async function copyInto(target, source, indices) {
  const pages = await target.copyPages(source, indices);
  pages.forEach(p => target.addPage(p));
}

export async function mergePdfs(buffers) {
  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const doc = await loadPdf(buf);
    await copyInto(out, doc, doc.getPageIndices());
  }
  return out.save();
}

export async function splitPdf(buf, cutPoints, baseName = 'document') {
  const doc = await loadPdf(buf);
  const ranges = splitRanges(doc.getPageCount(), cutPoints);
  const parts = [];
  for (let i = 0; i < ranges.length; i++) {
    const [a, b] = ranges[i];
    const out = await PDFDocument.create();
    await copyInto(out, doc, Array.from({ length: b - a }, (_, k) => a + k));
    parts.push({
      name: `${baseName}_part_${i + 1}_pages_${a + 1}-${b}.pdf`,
      bytes: await out.save(),
    });
  }
  return parts;
}

export async function rotatePdf(buf, { angle, startPage, endPage }) {
  const doc = await loadPdf(buf);
  const count = doc.getPageCount();
  if (!(startPage >= 1 && endPage <= count && startPage <= endPage)) {
    throw new Error(`Page range must be between 1 and ${count}, with the start before the end.`);
  }
  for (let i = startPage - 1; i <= endPage - 1; i++) {
    const page = doc.getPage(i);
    page.setRotation(degrees((page.getRotation().angle + angle) % 360));
  }
  return doc.save();
}

export async function reorderPdf(buf, order) {
  const doc = await loadPdf(buf);
  const count = doc.getPageCount();
  const valid = order.length === count
    && new Set(order).size === count
    && order.every(i => Number.isInteger(i) && i >= 0 && i < count);
  if (!valid) throw new Error('Page order is invalid.');
  const out = await PDFDocument.create();
  await copyInto(out, doc, order);
  return out.save();
}

export async function resizeToA4(buf) {
  const doc = await loadPdf(buf);
  const out = await PDFDocument.create();
  for (const index of doc.getPageIndices()) {
    const page = out.addPage([...A4]);
    // embedPdf defers the real work to save(), so a page with no content
    // stream must be detected here rather than caught. A blank page in the
    // source becomes a blank A4 page instead of failing the whole document.
    if (!doc.getPage(index).node.Contents()) continue;
    const [emb] = await out.embedPdf(doc, [index]);
    const scale = Math.min(A4[0] / emb.width, A4[1] / emb.height);
    const w = emb.width * scale;
    const h = emb.height * scale;
    page.drawPage(emb, { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2, width: w, height: h });
  }
  return out.save();
}

export async function imagesToPdf(images) {
  const out = await PDFDocument.create();
  for (const img of images) {
    const emb = img.type === 'png'
      ? await out.embedPng(img.bytes)
      : await out.embedJpg(img.bytes);
    const page = out.addPage([emb.width, emb.height]);
    page.drawImage(emb, { x: 0, y: 0, width: emb.width, height: emb.height });
  }
  return out.save();
}

export async function rebuildFromImages(pages) {
  const out = await PDFDocument.create();
  for (const { jpegBytes, width, height } of pages) {
    const emb = await out.embedJpg(jpegBytes);
    const page = out.addPage([width, height]);
    page.drawImage(emb, { x: 0, y: 0, width, height });
  }
  return out.save();
}

/**
 * Map an axis-aligned rect in PDF user space to pdf-lib drawImage arguments,
 * compensating for the page's own /Rotate value.
 */
export function signaturePlacement({ rect, pageRotation }) {
  const r = (((pageRotation | 0) % 360) + 360) % 360;
  const { x, y, w, h } = rect;
  switch (r) {
    case 90:  return { x: x + w, y,         width: h, height: w, rotate: 90 };
    case 180: return { x: x + w, y: y + h,  width: w, height: h, rotate: 180 };
    case 270: return { x,        y: y + h,  width: h, height: w, rotate: 270 };
    default:  return { x,        y,         width: w, height: h, rotate: 0 };
  }
}

export async function stampSignature(buf, { pageIndex, pngBytes, rect }) {
  const doc = await loadPdf(buf);
  const page = doc.getPage(pageIndex);
  const img = await doc.embedPng(pngBytes);
  const p = signaturePlacement({ rect, pageRotation: page.getRotation().angle });
  page.drawImage(img, {
    x: p.x, y: p.y, width: p.width, height: p.height, rotate: degrees(p.rotate),
  });
  return doc.save();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 16 tests.

Use `node --test` with no path argument. Node 24 fails to resolve a bare directory (`node --test test/` throws `MODULE_NOT_FOUND`); default discovery finds `test/*.test.mjs` on its own.

- [ ] **Step 5: Commit**

```bash
git add js/pdf-ops.js test/pdf-ops.test.mjs package.json
git commit -m "feat: add pure PDF operations with node test coverage"
```

---

### Task 3: Shared state, dropzone and download helpers

**Files:**
- Create: `js/ui.js`
- Create: `js/app.js`

**Interfaces:**
- Consumes: DOM contract from Task 1
- Produces:
  - `state.files -> File[]`, `state.onChange(fn)`, `state.pdfs()`, `state.images()`
  - `initDropzone()`
  - `downloadBlob(blob, filename)`
  - `downloadZip([{name, bytes}], zipName) -> Promise<void>`
  - `showError(panelId, message)`, `clearError(panelId)`
  - `busy(panelEl, promise) -> Promise` — disables the panel while work runs
  - `bytesToSize(n) -> string`
  - `registerTool(id, {onFiles})` — called by each tool controller in later tasks
  - `baseName(file) -> string` — filename without extension

- [ ] **Step 1: Write `js/ui.js`**

```js
const MAX_WARN = 50 * 1024 * 1024;

export const state = {
  files: [],
  _subs: [],
  onChange(fn) { this._subs.push(fn); },
  set(files) {
    this.files = files;
    this._subs.forEach(fn => fn(this.files));
  },
  pdfs() { return this.files.filter(f => /\.pdf$/i.test(f.name)); },
  images() { return this.files.filter(f => /\.(png|jpe?g|bmp|tiff?|webp)$/i.test(f.name)); },
};

export function baseName(file) {
  return String(file.name).replace(/\.[^.]+$/, '');
}

export function bytesToSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initDropzone() {
  const zone = document.getElementById('dropzone');
  const input = document.getElementById('file-input');
  const list = document.getElementById('file-list');

  document.getElementById('browse').addEventListener('click', () => input.click());
  input.addEventListener('change', () => add([...input.files]));

  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); zone.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault();
    if (ev === 'dragleave' && zone.contains(e.relatedTarget)) return;
    zone.classList.remove('is-over');
  }));
  zone.addEventListener('drop', e => add([...e.dataTransfer.files]));

  function add(files) {
    state.set([...state.files, ...files]);
  }

  state.onChange(files => {
    list.innerHTML = '';
    files.forEach((f, i) => {
      const li = document.createElement('li');
      const warn = f.size > MAX_WARN ? ' · large file, this may be slow' : '';
      li.textContent = `${f.name} · ${bytesToSize(f.size)}${warn}`;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'btn btn-ghost';
      rm.textContent = 'Remove';
      rm.setAttribute('aria-label', `Remove ${f.name}`);
      rm.addEventListener('click', () => {
        state.set(state.files.filter((_, j) => j !== i));
      });
      li.append(rm);
      list.append(li);
    });
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadZip(entries, zipName) {
  await import('../vendor/jszip.min.js');
  const zip = new window.JSZip();
  entries.forEach(e => zip.file(e.name, e.bytes));
  downloadBlob(await zip.generateAsync({ type: 'blob' }), zipName);
}

export function showError(panelId, message) {
  const el = document.querySelector(`#panel-${panelId} .panel-error`);
  el.textContent = message;
  el.hidden = false;
}

export function clearError(panelId) {
  const el = document.querySelector(`#panel-${panelId} .panel-error`);
  el.hidden = true;
  el.textContent = '';
}

export async function busy(panelEl, promise) {
  panelEl.classList.add('busy');
  try { return await promise; }
  finally { panelEl.classList.remove('busy'); }
}
```

`jszip.min.js` is a UMD bundle, so importing it for side effects and reading `window.JSZip` is correct; it has no ES export.

- [ ] **Step 2: Write `js/app.js` with tool switching only**

```js
import { initDropzone, state } from './ui.js';

const tools = new Map();

export function registerTool(id, handlers) {
  tools.set(id, handlers);
}

function select(id) {
  document.querySelectorAll('.tool-btn').forEach(b => {
    b.setAttribute('aria-current', String(b.dataset.tool === id));
  });
  document.querySelectorAll('.panel').forEach(p => {
    p.hidden = p.id !== `panel-${id}`;
  });
  location.hash = id;
  const t = tools.get(id);
  if (t && t.onFiles) t.onFiles(state.files);
}

function init() {
  document.getElementById('year').textContent = new Date().getFullYear();
  initDropzone();

  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => select(btn.dataset.tool));
  });

  state.onChange(files => {
    const active = document.querySelector('.tool-btn[aria-current="true"]');
    if (!active) return;
    const t = tools.get(active.dataset.tool);
    if (t && t.onFiles) t.onFiles(files);
  });

  const initial = location.hash.slice(1);
  select(tools.has(initial) || document.getElementById(`panel-${initial}`) ? initial : 'merge');
}

document.addEventListener('DOMContentLoaded', init);
```

Later tasks import `registerTool` and call it. `app.js` never imports a PDF library.

- [ ] **Step 3: Verify by hand**

Serve the page. Confirm: clicking a sidebar item swaps the visible panel and updates the URL hash; reloading on `#split` opens Split; dropping a file lists it with its size; Remove deletes it; a file over 50 MB shows the slow-file note.

- [ ] **Step 4: Commit**

```bash
git add js/ui.js js/app.js
git commit -m "feat: add shared file state, dropzone and tool switching"
```

---

### Task 4: Lazy thumbnail grid

**Files:**
- Modify: `js/ui.js` (append)

**Interfaces:**
- Consumes: `vendor/pdf.min.mjs`
- Produces:
  - `getPdfjs() -> Promise<pdfjsLib>` — loads once, sets the worker source, memoised
  - `renderGrid(container, file, {onThumb}) -> Promise<{pdf, count}>` — builds placeholders immediately, renders visible ones lazily, calls `onThumb(el, index)` per card so tools can attach their own controls
  - `renderPageToCanvas(pdf, pageNumber, scale) -> Promise<HTMLCanvasElement>`

- [ ] **Step 1: Append to `js/ui.js`**

```js
let pdfjsPromise = null;

export function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdf.min.mjs').then(lib => {
      lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

export async function loadPdfjsDoc(file) {
  const lib = await getPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    return await lib.getDocument({ data }).promise;
  } catch (err) {
    if (err && err.name === 'PasswordException') {
      throw new Error('This PDF is password-protected. Remove the password and try again.');
    }
    throw new Error('Could not read this PDF. The file may be corrupt.');
  }
}

export async function renderPageToCanvas(pdf, pageNumber, scale) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return { canvas, viewport, page };
}

/** Renders at most CONCURRENCY pages at a time, and only once visible. */
const CONCURRENCY = 4;

export async function renderGrid(container, file, { onThumb } = {}) {
  const pdf = await loadPdfjsDoc(file);
  container.innerHTML = '';
  container.className = 'thumb-grid';

  const queue = [];
  let running = 0;

  const pump = () => {
    while (running < CONCURRENCY && queue.length) {
      const job = queue.shift();
      running++;
      job().finally(() => { running--; pump(); });
    }
  };

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const el = entry.target;
      queue.push(async () => {
        const { canvas } = await renderPageToCanvas(pdf, Number(el.dataset.page), 0.4);
        const ph = el.querySelector('.thumb-ph');
        if (ph) ph.replaceWith(canvas);
      });
      pump();
    }
  }, { root: null, rootMargin: '200px' });

  for (let i = 1; i <= pdf.numPages; i++) {
    const card = document.createElement('div');
    card.className = 'thumb';
    card.dataset.page = String(i);
    card.dataset.index = String(i - 1);
    card.innerHTML = `<div class="thumb-ph"></div><div class="thumb-label">Page ${i}</div>`;
    if (onThumb) onThumb(card, i - 1);
    container.append(card);
    observer.observe(card);
  }

  return { pdf, count: pdf.numPages };
}
```

- [ ] **Step 2: Verify by hand**

Temporarily wire the Split panel to call `renderGrid`. Load a PDF of 100+ pages (`/home/harry/Downloads/guide-to-github.html` is not a PDF; use any large file from `~/Downloads`). Confirm: placeholders appear at once, canvases fill in as you scroll, the tab stays responsive, and no more than four renders run concurrently. Remove the temporary wiring afterwards.

- [ ] **Step 3: Commit**

```bash
git add js/ui.js
git commit -m "feat: add lazily rendered pdf.js thumbnail grid"
```

---

### Task 5: Merge and Rotate panels

**Files:**
- Create: `js/tools/merge.js`, `js/tools/rotate.js`
- Modify: `js/app.js` (import both)

**Interfaces:**
- Consumes: `registerTool` from `app.js`; `mergePdfs`, `rotatePdf` from `pdf-ops.js`; `state`, `downloadBlob`, `showError`, `clearError`, `busy`, `baseName` from `ui.js`
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Write `js/tools/merge.js`**

```js
import { registerTool } from '../app.js';
import { state, downloadBlob, showError, clearError, busy } from '../ui.js';

const ID = 'merge';

export function init() {
  const panel = document.getElementById(`panel-${ID}`);
  const body = panel.querySelector('.panel-body');
  body.innerHTML = `
    <div class="panel-toolbar">
      <button type="button" class="btn btn-primary" id="merge-go">Merge and download</button>
    </div>
    <ol class="file-list" id="merge-order"></ol>`;

  const listEl = body.querySelector('#merge-order');
  let order = [];

  function render() {
    listEl.innerHTML = '';
    order.forEach((file, i) => {
      const li = document.createElement('li');
      li.textContent = file.name;
      const up = document.createElement('button');
      up.type = 'button'; up.className = 'btn btn-ghost'; up.textContent = '↑';
      up.setAttribute('aria-label', `Move ${file.name} up`);
      up.disabled = i === 0;
      up.addEventListener('click', () => { swap(i, i - 1); });
      const down = document.createElement('button');
      down.type = 'button'; down.className = 'btn btn-ghost'; down.textContent = '↓';
      down.setAttribute('aria-label', `Move ${file.name} down`);
      down.disabled = i === order.length - 1;
      down.addEventListener('click', () => { swap(i, i + 1); });
      li.append(up, down);
      listEl.append(li);
    });
  }

  function swap(a, b) {
    [order[a], order[b]] = [order[b], order[a]];
    render();
  }

  body.querySelector('#merge-go').addEventListener('click', async () => {
    clearError(ID);
    if (order.length < 2) return showError(ID, 'Add at least two PDFs first.');
    try {
      const { mergePdfs } = await import('../pdf-ops.js');
      const buffers = [];
      for (const f of order) buffers.push(new Uint8Array(await f.arrayBuffer()));
      const bytes = await busy(panel, mergePdfs(buffers));
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'merged.pdf');
    } catch (err) {
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    onFiles() { order = state.pdfs(); render(); },
  });
}
```

- [ ] **Step 2: Write `js/tools/rotate.js`**

```js
import { registerTool } from '../app.js';
import { state, loadPdfjsDoc, downloadBlob, showError, clearError, busy, baseName } from '../ui.js';

const ID = 'rotate';

export function init() {
  const panel = document.getElementById(`panel-${ID}`);
  const body = panel.querySelector('.panel-body');
  body.innerHTML = `
    <div class="panel-toolbar">
      <label>Angle <select id="rot-angle">
        <option value="90">90°</option><option value="180">180°</option><option value="270">270°</option>
      </select></label>
      <label>Start page <input type="number" id="rot-start" min="1" value="1"></label>
      <label>End page <input type="number" id="rot-end" min="1" value="1"></label>
      <button type="button" class="btn btn-primary" id="rot-go">Rotate and download</button>
    </div>
    <p class="panel-sub" id="rot-status">No PDF loaded.</p>`;

  const startEl = body.querySelector('#rot-start');
  const endEl = body.querySelector('#rot-end');
  const status = body.querySelector('#rot-status');
  let file = null;

  body.querySelector('#rot-go').addEventListener('click', async () => {
    clearError(ID);
    if (!file) return showError(ID, 'Add a PDF first.');
    try {
      const { rotatePdf } = await import('../pdf-ops.js');
      const bytes = await busy(panel, rotatePdf(new Uint8Array(await file.arrayBuffer()), {
        angle: Number(body.querySelector('#rot-angle').value),
        startPage: Number(startEl.value),
        endPage: Number(endEl.value),
      }));
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${baseName(file)}_rotated.pdf`);
    } catch (err) {
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    async onFiles() {
      file = state.pdfs()[0] || null;
      if (!file) { status.textContent = 'No PDF loaded.'; return; }
      try {
        const pdf = await loadPdfjsDoc(file);
        startEl.max = endEl.max = pdf.numPages;
        startEl.value = 1; endEl.value = pdf.numPages;
        status.textContent = `Loaded: ${file.name} · ${pdf.numPages} pages`;
      } catch (err) {
        showError(ID, err.message);
      }
    },
  });
}
```

- [ ] **Step 3: Wire both into `js/app.js`**

Add above `document.addEventListener('DOMContentLoaded', init)`:

```js
import { init as initMerge } from './tools/merge.js';
import { init as initRotate } from './tools/rotate.js';
```

and inside `init()`, before reading `location.hash`:

```js
initMerge();
initRotate();
```

- [ ] **Step 4: Verify by hand**

Merge two PDFs from `~/Downloads`, confirm the output opens and has the summed page count, and that the arrows change the order of the result. Rotate pages 2–3 of a PDF by 90° and confirm only those pages turned.

- [ ] **Step 5: Commit**

```bash
git add js/tools/merge.js js/tools/rotate.js js/app.js
git commit -m "feat: add merge and rotate tools"
```

---

### Task 6: Reorder and Split panels

**Files:**
- Create: `js/tools/reorder.js`, `js/tools/split.js`
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `renderGrid` from `ui.js`; `reorderPdf`, `splitPdf` from `pdf-ops.js`
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Write `js/tools/reorder.js`**

Drag handles reordering, and the two arrow buttons on each card do the same thing for keyboard and screen-reader users. Both paths mutate one `order` array and re-render.

```js
import { registerTool } from '../app.js';
import { state, renderGrid, downloadBlob, showError, clearError, busy, baseName } from '../ui.js';

const ID = 'reorder';

export function init() {
  const panel = document.getElementById(`panel-${ID}`);
  const body = panel.querySelector('.panel-body');
  body.innerHTML = `
    <div class="panel-toolbar">
      <button type="button" class="btn btn-primary" id="reorder-go">Save reordered PDF</button>
    </div>
    <div id="reorder-grid"></div>`;

  const grid = body.querySelector('#reorder-grid');
  let file = null;
  let order = [];
  let dragFrom = null;

  function move(from, to) {
    if (to < 0 || to >= order.length) return;
    const [item] = order.splice(from, 1);
    order.splice(to, 0, item);
    paint();
  }

  function paint() {
    const cards = [...grid.children];
    const byIndex = new Map(cards.map(c => [Number(c.dataset.index), c]));
    order.forEach((pageIdx, pos) => {
      const card = byIndex.get(pageIdx);
      card.style.order = String(pos);
      card.querySelector('.thumb-label').textContent = `Position ${pos + 1} · page ${pageIdx + 1}`;
    });
  }

  function decorate(card, index) {
    card.draggable = true;
    card.addEventListener('dragstart', () => {
      dragFrom = order.indexOf(index);
      card.classList.add('is-dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
    card.addEventListener('dragover', e => e.preventDefault());
    card.addEventListener('drop', e => {
      e.preventDefault();
      if (dragFrom !== null) move(dragFrom, order.indexOf(index));
      dragFrom = null;
    });

    const actions = document.createElement('div');
    actions.className = 'thumb-actions';
    const left = document.createElement('button');
    left.type = 'button'; left.className = 'btn btn-ghost'; left.textContent = '◀';
    left.setAttribute('aria-label', `Move page ${index + 1} earlier`);
    left.addEventListener('click', () => move(order.indexOf(index), order.indexOf(index) - 1));
    const right = document.createElement('button');
    right.type = 'button'; right.className = 'btn btn-ghost'; right.textContent = '▶';
    right.setAttribute('aria-label', `Move page ${index + 1} later`);
    right.addEventListener('click', () => move(order.indexOf(index), order.indexOf(index) + 1));
    actions.append(left, right);
    card.append(actions);
  }

  body.querySelector('#reorder-go').addEventListener('click', async () => {
    clearError(ID);
    if (!file) return showError(ID, 'Add a PDF first.');
    try {
      const { reorderPdf } = await import('../pdf-ops.js');
      const bytes = await busy(panel, reorderPdf(new Uint8Array(await file.arrayBuffer()), order));
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${baseName(file)}_reordered.pdf`);
    } catch (err) {
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    async onFiles() {
      clearError(ID);
      file = state.pdfs()[0] || null;
      grid.innerHTML = '';
      if (!file) return;
      try {
        const { count } = await renderGrid(grid, file, { onThumb: decorate });
        grid.style.display = 'grid';
        order = Array.from({ length: count }, (_, i) => i);
        paint();
      } catch (err) {
        showError(ID, err.message);
      }
    },
  });
}
```

- [ ] **Step 2: Write `js/tools/split.js`**

Cut points sit *after* a page, matching the desktop tool. The last page gets no toggle.

```js
import { registerTool } from '../app.js';
import { state, renderGrid, loadPdfjsDoc, downloadZip, showError, clearError, busy, baseName } from '../ui.js';

const ID = 'split';

export function init() {
  const panel = document.getElementById(`panel-${ID}`);
  const body = panel.querySelector('.panel-body');
  body.innerHTML = `
    <div class="panel-toolbar">
      <button type="button" class="btn btn-ghost" id="split-all">Cut after every page</button>
      <button type="button" class="btn btn-ghost" id="split-clear">Clear cuts</button>
      <button type="button" class="btn btn-primary" id="split-go">Split and download zip</button>
      <span id="split-status"></span>
    </div>
    <div id="split-grid"></div>`;

  const grid = body.querySelector('#split-grid');
  const status = body.querySelector('#split-status');
  let file = null;
  let count = 0;
  const cuts = new Set();

  function refresh() {
    [...grid.children].forEach(card => {
      const i = Number(card.dataset.index);
      card.classList.toggle('cut-after', cuts.has(i));
      const btn = card.querySelector('.cut-btn');
      if (btn) {
        btn.textContent = cuts.has(i) ? '✂ Cut here' : 'Cut after';
        btn.setAttribute('aria-pressed', String(cuts.has(i)));
      }
    });
    status.textContent = `${cuts.size + 1} file${cuts.size ? 's' : ''} will be created`;
  }

  function decorate(card, index) {
    if (index >= count - 1) return;
    const actions = document.createElement('div');
    actions.className = 'thumb-actions';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn btn-ghost cut-btn';
    btn.setAttribute('aria-label', `Cut after page ${index + 1}`);
    btn.addEventListener('click', () => {
      cuts.has(index) ? cuts.delete(index) : cuts.add(index);
      refresh();
    });
    actions.append(btn);
    card.append(actions);
  }

  body.querySelector('#split-all').addEventListener('click', () => {
    for (let i = 0; i < count - 1; i++) cuts.add(i);
    refresh();
  });
  body.querySelector('#split-clear').addEventListener('click', () => { cuts.clear(); refresh(); });

  body.querySelector('#split-go').addEventListener('click', async () => {
    clearError(ID);
    if (!file) return showError(ID, 'Add a PDF first.');
    try {
      const { splitPdf } = await import('../pdf-ops.js');
      const parts = await busy(panel, splitPdf(
        new Uint8Array(await file.arrayBuffer()), [...cuts], baseName(file),
      ));
      await downloadZip(parts, `${baseName(file)}_split.zip`);
    } catch (err) {
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    async onFiles() {
      clearError(ID);
      file = state.pdfs()[0] || null;
      grid.innerHTML = '';
      cuts.clear();
      if (!file) { status.textContent = ''; return; }
      try {
        // Page count must be known before decorating, because the last card
        // gets no cut toggle. renderGrid calls onThumb before it returns, so
        // read the count first.
        const pdf = await loadPdfjsDoc(file);
        count = pdf.numPages;
        await renderGrid(grid, file, { onThumb: decorate });
        refresh();
      } catch (err) {
        showError(ID, err.message);
      }
    },
  });
}
```

`loadPdfjsDoc` is cheap to call twice: pdf.js is memoised by `getPdfjs`, and the second parse inside `renderGrid` reuses the same worker.

- [ ] **Step 3: Wire into `js/app.js`**

```js
import { init as initReorder } from './tools/reorder.js';
import { init as initSplit } from './tools/split.js';
```

Call `initReorder(); initSplit();` inside `init()`.

- [ ] **Step 4: Verify by hand**

Reorder: drag page 3 to the front, confirm labels renumber and the saved PDF matches. Tab to a card, press the ◀ button, confirm the same movement. Split: cut after pages 1 and 3 of a 5-page PDF, confirm the zip holds three files named `{base}_part_1_pages_1-1.pdf`, `_part_2_pages_2-4.pdf`, `_part_3_pages_5-5.pdf`.

- [ ] **Step 5: Commit**

```bash
git add js/tools/reorder.js js/tools/split.js js/app.js
git commit -m "feat: add reorder and split tools"
```

---

### Task 7: Resize to A4 and Photo to PDF panels

**Files:**
- Create: `js/tools/a4.js`, `js/tools/images.js`
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `resizeToA4`, `imagesToPdf` from `pdf-ops.js`; `downloadZip`, `downloadBlob` from `ui.js`
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Write `js/tools/a4.js`**

Batch tool. One bad file reports itself and the rest still convert, matching the desktop A4 tool's error collection.

```js
import { registerTool } from '../app.js';
import { state, downloadZip, downloadBlob, showError, clearError, busy, baseName } from '../ui.js';

const ID = 'a4';

export function init() {
  const panel = document.getElementById(`panel-${ID}`);
  const body = panel.querySelector('.panel-body');
  body.innerHTML = `
    <div class="panel-toolbar">
      <button type="button" class="btn btn-primary" id="a4-go">Convert to A4</button>
      <span id="a4-status">No PDFs added.</span>
    </div>`;
  const status = body.querySelector('#a4-status');

  body.querySelector('#a4-go').addEventListener('click', async () => {
    clearError(ID);
    const files = state.pdfs();
    if (!files.length) return showError(ID, 'Add at least one PDF first.');
    const { resizeToA4 } = await import('../pdf-ops.js');
    const done = [];
    const failed = [];
    await busy(panel, (async () => {
      for (const f of files) {
        try {
          const bytes = await resizeToA4(new Uint8Array(await f.arrayBuffer()));
          done.push({ name: `${baseName(f)}_a4.pdf`, bytes });
        } catch (err) {
          failed.push(`${f.name}: ${err.message}`);
        }
      }
    })());

    if (done.length === 1) {
      downloadBlob(new Blob([done[0].bytes], { type: 'application/pdf' }), done[0].name);
    } else if (done.length > 1) {
      await downloadZip(done, 'a4.zip');
    }
    status.textContent = `Converted ${done.length} of ${files.length} file(s).`;
    if (failed.length) showError(ID, failed.join('\n'));
  });

  registerTool(ID, {
    onFiles() {
      const n = state.pdfs().length;
      status.textContent = n ? `${n} PDF${n === 1 ? '' : 's'} queued.` : 'No PDFs added.';
    },
  });
}
```

- [ ] **Step 2: Write `js/tools/images.js`**

Pillow flattens alpha onto white; a canvas does the same job here. PNGs without alpha and JPEGs pass through untouched, which keeps the file smaller.

```js
import { registerTool } from '../app.js';
import { state, downloadBlob, showError, clearError, busy } from '../ui.js';

const ID = 'images';

async function toEmbeddable(file) {
  const isJpg = /\.jpe?g$/i.test(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isJpg) return { bytes, type: 'jpg' };
  if (/\.png$/i.test(file.name)) return { bytes, type: 'png' };
  // bmp, tif, webp: re-encode through a canvas so pdf-lib can embed it.
  return flatten(file);
}

async function flatten(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'jpg' };
}

export function init() {
  const panel = document.getElementById(`panel-${ID}`);
  const body = panel.querySelector('.panel-body');
  body.innerHTML = `
    <div class="panel-toolbar">
      <button type="button" class="btn btn-primary" id="img-go">Create PDF</button>
      <span id="img-status">No images added.</span>
    </div>`;
  const status = body.querySelector('#img-status');

  body.querySelector('#img-go').addEventListener('click', async () => {
    clearError(ID);
    const files = state.images();
    if (!files.length) return showError(ID, 'Add at least one image first.');
    try {
      const { imagesToPdf } = await import('../pdf-ops.js');
      const bytes = await busy(panel, (async () => {
        const embeddable = [];
        for (const f of files) embeddable.push(await toEmbeddable(f));
        return imagesToPdf(embeddable);
      })());
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'images.pdf');
    } catch (err) {
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    onFiles() {
      const n = state.images().length;
      status.textContent = n ? `${n} image${n === 1 ? '' : 's'} queued.` : 'No images added.';
    },
  });
}
```

PNGs with transparency embed as-is, which pdf-lib renders over the page's white background, giving the same visual result as Pillow's composite.

- [ ] **Step 3: Wire into `js/app.js`** — import and call `initA4(); initImages();`

- [ ] **Step 4: Verify by hand**

A4: queue a landscape PDF and a square one, confirm both come out A4 portrait with content centred and undistorted. Photo to PDF: combine a JPG, a transparent PNG and a WebP, confirm one page per image at the image's own dimensions and no black boxes where transparency was.

- [ ] **Step 5: Commit**

```bash
git add js/tools/a4.js js/tools/images.js js/app.js
git commit -m "feat: add A4 resize and photo-to-PDF tools"
```

---

### Task 8: PDF to PNG/JPG panel

**Files:**
- Create: `js/tools/convert.js`
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `loadPdfjsDoc`, `renderPageToCanvas`, `downloadZip` from `ui.js`
- Produces: nothing consumed by later tasks

This tool writes no PDF, so it needs nothing from `pdf-ops.js`.

- [ ] **Step 1: Write `js/tools/convert.js`**

Scale range 100–300% at 150% default and JPEG quality 0.95 both match the desktop tool.

```js
import { registerTool } from '../app.js';
import { state, loadPdfjsDoc, renderPageToCanvas, downloadZip, showError, clearError, busy, baseName } from '../ui.js';

const ID = 'convert';

export function init() {
  const panel = document.getElementById(`panel-${ID}`);
  const body = panel.querySelector('.panel-body');
  body.innerHTML = `
    <div class="panel-toolbar">
      <label>Format <select id="cv-format"><option value="png">PNG</option><option value="jpg">JPG</option></select></label>
      <label>Scale <input type="range" id="cv-scale" min="100" max="300" value="150"></label>
      <output id="cv-scale-out">150%</output>
      <button type="button" class="btn btn-primary" id="cv-go">Export pages</button>
    </div>
    <p class="panel-sub" id="cv-status">No PDF loaded.</p>`;

  const scale = body.querySelector('#cv-scale');
  const out = body.querySelector('#cv-scale-out');
  const status = body.querySelector('#cv-status');
  let file = null;

  scale.addEventListener('input', () => { out.textContent = `${scale.value}%`; });

  body.querySelector('#cv-go').addEventListener('click', async () => {
    clearError(ID);
    if (!file) return showError(ID, 'Add a PDF first.');
    try {
      const fmt = body.querySelector('#cv-format').value;
      const mime = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
      const base = baseName(file);
      const entries = await busy(panel, (async () => {
        const pdf = await loadPdfjsDoc(file);
        const acc = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const { canvas } = await renderPageToCanvas(pdf, i, Number(scale.value) / 100);
          const blob = await new Promise(r => canvas.toBlob(r, mime, 0.95));
          acc.push({ name: `${base}_page_${i}.${fmt}`, bytes: await blob.arrayBuffer() });
          status.textContent = `Rendered ${i} of ${pdf.numPages} pages…`;
        }
        return acc;
      })());
      await downloadZip(entries, `${base}_${fmt}.zip`);
      status.textContent = `Exported ${entries.length} page images.`;
    } catch (err) {
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    async onFiles() {
      clearError(ID);
      file = state.pdfs()[0] || null;
      if (!file) { status.textContent = 'No PDF loaded.'; return; }
      try {
        const pdf = await loadPdfjsDoc(file);
        status.textContent = `Loaded: ${file.name} · ${pdf.numPages} pages`;
      } catch (err) { showError(ID, err.message); }
    },
  });
}
```

- [ ] **Step 2: Wire into `js/app.js`** — import and call `initConvert();`

- [ ] **Step 3: Verify by hand**

Export a 3-page PDF as PNG at 300%, confirm three files in the zip, correct names, and that image dimensions are three times the 100% render. Repeat as JPG and confirm smaller files.

- [ ] **Step 4: Commit**

```bash
git add js/tools/convert.js js/app.js
git commit -m "feat: add PDF to PNG/JPG export"
```

---

### Task 9: Compress panel

**Files:**
- Create: `js/tools/compress.js`
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `rebuildFromImages` from `pdf-ops.js`; `loadPdfjsDoc`, `renderPageToCanvas` from `ui.js`
- Produces: nothing consumed by later tasks

This tool rasterises. The warning is part of the deliverable, not decoration: users who compress a text document lose selectable text and must be told before they click.

- [ ] **Step 1: Write `js/tools/compress.js`**

```js
import { registerTool } from '../app.js';
import { state, loadPdfjsDoc, renderPageToCanvas, downloadBlob, showError, clearError, busy, baseName, bytesToSize } from '../ui.js';

const ID = 'compress';

export function init() {
  const panel = document.getElementById(`panel-${ID}`);
  const body = panel.querySelector('.panel-body');
  body.innerHTML = `
    <p class="panel-sub">
      <strong>This rebuilds each page as an image.</strong>
      Scanned documents shrink a lot. Text documents shrink too, but the text
      stops being selectable or searchable.
    </p>
    <div class="panel-toolbar">
      <label>Quality <input type="range" id="cp-quality" min="30" max="95" value="70"></label>
      <output id="cp-quality-out">70%</output>
      <label>Resolution <input type="range" id="cp-scale" min="72" max="200" value="144"></label>
      <output id="cp-scale-out">144 dpi</output>
      <button type="button" class="btn btn-primary" id="cp-go">Compress and download</button>
    </div>
    <p class="panel-sub" id="cp-status">No PDF loaded.</p>`;

  const quality = body.querySelector('#cp-quality');
  const qOut = body.querySelector('#cp-quality-out');
  const dpi = body.querySelector('#cp-scale');
  const dOut = body.querySelector('#cp-scale-out');
  const status = body.querySelector('#cp-status');
  let file = null;

  quality.addEventListener('input', () => { qOut.textContent = `${quality.value}%`; });
  dpi.addEventListener('input', () => { dOut.textContent = `${dpi.value} dpi`; });

  body.querySelector('#cp-go').addEventListener('click', async () => {
    clearError(ID);
    if (!file) return showError(ID, 'Add a PDF first.');
    try {
      const { rebuildFromImages } = await import('../pdf-ops.js');
      const bytes = await busy(panel, (async () => {
        const pdf = await loadPdfjsDoc(file);
        // 72 dpi is 1:1 with PDF points, so scale is simply dpi/72.
        const scale = Number(dpi.value) / 72;
        const q = Number(quality.value) / 100;
        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const { canvas, page } = await renderPageToCanvas(pdf, i, scale);
          const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', q));
          const [, , w, h] = page.view;
          pages.push({
            jpegBytes: new Uint8Array(await blob.arrayBuffer()),
            width: w, height: h,
          });
          status.textContent = `Compressed ${i} of ${pdf.numPages} pages…`;
        }
        return rebuildFromImages(pages);
      })());

      const saved = file.size - bytes.length;
      const pct = Math.round((saved / file.size) * 100);
      status.textContent = saved > 0
        ? `${bytesToSize(file.size)} → ${bytesToSize(bytes.length)} (${pct}% smaller)`
        : `${bytesToSize(file.size)} → ${bytesToSize(bytes.length)}. This PDF was already well compressed; try a lower quality or resolution.`;
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${baseName(file)}_compressed.pdf`);
    } catch (err) {
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    async onFiles() {
      clearError(ID);
      file = state.pdfs()[0] || null;
      status.textContent = file ? `Loaded: ${file.name} · ${bytesToSize(file.size)}` : 'No PDF loaded.';
    },
  });
}
```

`page.view` is pdf.js's `[x0, y0, x1, y1]` MediaBox, so `w`/`h` there are the page dimensions in points. Rebuilding at those dimensions keeps the output the same physical size as the input.

- [ ] **Step 2: Wire into `js/app.js`** — import and call `initCompress();`

- [ ] **Step 3: Verify by hand**

Compress a scanned PDF from `~/Downloads` and confirm a real size reduction. Compress a text-heavy PDF, confirm the size report is honest (it may grow, and the copy handles that case). Confirm the resulting file opens and pages are the same physical size as the original.

- [ ] **Step 4: Commit**

```bash
git add js/tools/compress.js js/app.js
git commit -m "feat: add rasterising compress tool with an explicit quality warning"
```

---

### Task 10: Sign panel

**Files:**
- Create: `js/tools/sign.js`
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `stampSignature` from `pdf-ops.js`; `loadPdfjsDoc`, `renderPageToCanvas` from `ui.js`
- Produces: nothing consumed by later tasks

This is the hardest task. `viewport.convertToPdfPoint(x, y)` does the scale and rotation conversion; `signaturePlacement` (already tested in Task 2) handles the origin offset. Do not hand-roll the coordinate maths.

- [ ] **Step 1: Write `js/tools/sign.js`**

```js
import { registerTool } from '../app.js';
import { state, loadPdfjsDoc, renderPageToCanvas, downloadBlob, showError, clearError, busy, baseName } from '../ui.js';

const ID = 'sign';

/** Freehand pad. Returns PNG bytes with a transparent background. */
function makePad(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111832';
  let drawing = false;
  let dirty = false;

  const pos = e => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width),
            (e.clientY - r.top) * (canvas.height / r.height)];
  };
  canvas.addEventListener('pointerdown', e => {
    drawing = true; dirty = true;
    canvas.setPointerCapture(e.pointerId);
    ctx.beginPath(); ctx.moveTo(...pos(e));
  });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    ctx.lineTo(...pos(e)); ctx.stroke();
  });
  canvas.addEventListener('pointerup', () => { drawing = false; });

  return {
    clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; },
    isDirty: () => dirty,
    async png() {
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      return new Uint8Array(await blob.arrayBuffer());
    },
  };
}

export function init() {
  const panel = document.getElementById(`panel-${ID}`);
  const body = panel.querySelector('.panel-body');
  body.innerHTML = `
    <div class="panel-toolbar">
      <label>Page <input type="number" id="sg-page" min="1" value="1"></label>
      <button type="button" class="btn btn-ghost" id="sg-clear">Clear signature</button>
      <label class="btn btn-ghost">Upload image<input type="file" id="sg-upload" accept="image/png,image/jpeg" hidden></label>
      <button type="button" class="btn btn-primary" id="sg-go">Apply and download</button>
    </div>
    <p class="panel-sub">Draw your signature below, or upload a PNG. Then drag it onto the page and pull the corner to resize.</p>
    <canvas class="sign-pad" id="sg-pad" width="480" height="150"></canvas>
    <div class="sign-stage" id="sg-stage"></div>
    <p class="panel-sub" id="sg-status">No PDF loaded.</p>`;

  const stage = body.querySelector('#sg-stage');
  const pageInput = body.querySelector('#sg-page');
  const status = body.querySelector('#sg-status');
  const pad = makePad(body.querySelector('#sg-pad'));

  let file = null;
  let viewport = null;
  let overlay = null;
  let uploadedPng = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'sign-overlay';
    Object.assign(overlay.style, { left: '40px', top: '40px', width: '160px', height: '50px' });
    const img = document.createElement('img');
    img.style.cssText = 'width:100%;height:100%;display:block;pointer-events:none';
    const handle = document.createElement('span');
    handle.className = 'sign-handle';
    overlay.append(img, handle);
    stage.append(overlay);

    let mode = null, sx = 0, sy = 0, ox = 0, oy = 0, ow = 0, oh = 0;
    const start = (e, m) => {
      mode = m; sx = e.clientX; sy = e.clientY;
      ox = overlay.offsetLeft; oy = overlay.offsetTop;
      ow = overlay.offsetWidth; oh = overlay.offsetHeight;
      overlay.setPointerCapture(e.pointerId);
      e.preventDefault(); e.stopPropagation();
    };
    overlay.addEventListener('pointerdown', e => start(e, 'move'));
    handle.addEventListener('pointerdown', e => start(e, 'resize'));
    overlay.addEventListener('pointermove', e => {
      if (!mode) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (mode === 'move') {
        overlay.style.left = `${ox + dx}px`;
        overlay.style.top = `${oy + dy}px`;
      } else {
        overlay.style.width = `${Math.max(24, ow + dx)}px`;
        overlay.style.height = `${Math.max(12, oh + dy)}px`;
      }
    });
    overlay.addEventListener('pointerup', () => { mode = null; });
    return overlay;
  }

  async function currentPng() {
    if (uploadedPng) return uploadedPng;
    if (pad.isDirty()) return pad.png();
    return null;
  }

  async function refreshOverlayImage() {
    const png = await currentPng();
    if (!png) return;
    const el = ensureOverlay();
    const url = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
    el.querySelector('img').src = url;
  }

  body.querySelector('#sg-pad').addEventListener('pointerup', refreshOverlayImage);
  body.querySelector('#sg-clear').addEventListener('click', () => {
    pad.clear(); uploadedPng = null;
    if (overlay) { overlay.remove(); overlay = null; }
  });
  body.querySelector('#sg-upload').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    uploadedPng = new Uint8Array(await f.arrayBuffer());
    refreshOverlayImage();
  });

  async function showPage() {
    if (!file) return;
    const pdf = await loadPdfjsDoc(file);
    pageInput.max = pdf.numPages;
    const n = Math.min(Math.max(1, Number(pageInput.value)), pdf.numPages);
    pageInput.value = n;
    const rendered = await renderPageToCanvas(pdf, n, 1.2);
    viewport = rendered.viewport;
    stage.innerHTML = '';
    stage.append(rendered.canvas);
    overlay = null;
    await refreshOverlayImage();
    status.textContent = `Loaded: ${file.name} · ${pdf.numPages} pages`;
  }

  pageInput.addEventListener('change', () => showPage().catch(err => showError(ID, err.message)));

  body.querySelector('#sg-go').addEventListener('click', async () => {
    clearError(ID);
    if (!file) return showError(ID, 'Add a PDF first.');
    const png = await currentPng();
    if (!png) return showError(ID, 'Draw or upload a signature first.');
    if (!overlay) return showError(ID, 'Place the signature on the page first.');
    try {
      const { stampSignature } = await import('../pdf-ops.js');
      // Two opposite corners in canvas space, converted to PDF user space.
      const [ax, ay] = viewport.convertToPdfPoint(overlay.offsetLeft, overlay.offsetTop + overlay.offsetHeight);
      const [bx, by] = viewport.convertToPdfPoint(overlay.offsetLeft + overlay.offsetWidth, overlay.offsetTop);
      const rect = {
        x: Math.min(ax, bx), y: Math.min(ay, by),
        w: Math.abs(bx - ax), h: Math.abs(by - ay),
      };
      const bytes = await busy(panel, stampSignature(new Uint8Array(await file.arrayBuffer()), {
        pageIndex: Number(pageInput.value) - 1,
        pngBytes: png,
        rect,
      }));
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${baseName(file)}_signed.pdf`);
    } catch (err) {
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    async onFiles() {
      clearError(ID);
      file = state.pdfs()[0] || null;
      stage.innerHTML = '';
      overlay = null;
      if (!file) { status.textContent = 'No PDF loaded.'; return; }
      try { await showPage(); } catch (err) { showError(ID, err.message); }
    },
  });
}
```

- [ ] **Step 2: Wire into `js/app.js`** — import and call `initSign();`

- [ ] **Step 3: Verify placement on an unrotated page**

Draw a signature, drag it to the bottom-left of page 1, apply, and open the result. The stamp must land where the overlay sat, not mirrored vertically. If it appears flipped top-to-bottom, the two `convertToPdfPoint` corners were passed in the wrong order.

- [ ] **Step 4: Verify placement on rotated pages**

This is the check the desktop app would have failed. Build a fixture with all four rotations:

```bash
node -e '
import("./vendor/pdf-lib.esm.min.js").then(async ({PDFDocument, degrees}) => {
  const d = await PDFDocument.create();
  [0,90,180,270].forEach(r => d.addPage([400,600]).setRotation(degrees(r)));
  require("fs").writeFileSync("/tmp/rot.pdf", await d.save());
  console.log("wrote /tmp/rot.pdf");
});'
```

For each of the four pages: place the signature in the top-left corner as displayed, apply, then reopen the signed file and confirm the stamp is still in the displayed top-left and reads upright. All four must pass. A failure here means `signaturePlacement` has a wrong case; fix it in `pdf-ops.js` and add the failing rotation to `test/pdf-ops.test.mjs`.

- [ ] **Step 5: Commit**

```bash
git add js/tools/sign.js js/app.js
git commit -m "feat: add sign tool with drag placement and rotation-aware stamping"
```

---

### Task 11: Accessibility, resilience and deployment

**Files:**
- Modify: `index.html`, `css/app.css`, `js/ui.js`
- Create: `docs/DEPLOY.md`

**Interfaces:**
- Consumes: everything above
- Produces: a deployed site

- [ ] **Step 1: Accessibility pass**

- Add `<a href="#panels" class="skip-link">Skip to tools</a>` as the first child of `<body>`, styled to appear on focus.
- Give the tool nav `role="tablist"`, each `.tool-btn` `role="tab"`, and each `.panel` `role="tabpanel"` with `aria-labelledby` pointing at its button. Add `id`s to the buttons to make that possible.
- Add left/right arrow-key navigation between tool buttons.
- Confirm every icon-only button (`↑ ↓ ◀ ▶`) has an `aria-label`. They were added in Tasks 5 and 6; verify none were missed.
- Confirm focus outlines are visible against the glass panels. If `components.css` suppresses them, add `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` to `app.css`.
- Add `@media (prefers-reduced-motion: reduce)` to `app.css` disabling the dropzone and tool-button transitions.

- [ ] **Step 2: Resilience pass**

Add to `js/ui.js`, and call `initErrorTrap()` from `app.js`'s `init()`:

```js
export function initErrorTrap() {
  window.addEventListener('unhandledrejection', e => {
    const panel = document.querySelector('.panel:not([hidden]) .panel-error');
    if (!panel) return;
    panel.textContent = `Something went wrong: ${e.reason && e.reason.message ? e.reason.message : e.reason}`;
    panel.hidden = false;
  });
}
```

Then confirm by hand: dropping a `.txt` renamed to `.pdf` shows the corrupt-file message rather than a blank panel; dropping a password-protected PDF shows the password message; switching tools mid-render does not leave a panel stuck in `.busy`.

- [ ] **Step 3: Run the full test suite and check every tool once more**

```bash
npm test
```

Expected: PASS. Then walk all nine tools against a real PDF from `~/Downloads` and confirm each produces a file that opens.

- [ ] **Step 4: Write `docs/DEPLOY.md`**

Record: create a GitHub repo, push, then in Cloudflare Pages create a project from that repo with framework preset **None**, build command **empty**, output directory **`/`**. Add `pdf.harrys.monster` under Custom domains; because `harrys.monster` already uses Cloudflare nameservers, the CNAME is created automatically. Note that `_headers` is applied by Pages and needs no configuration.

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "feat: accessibility, error resilience and deployment notes"
gh repo create pdf.harrys.monster --public --source=. --remote=origin --push
```

- [ ] **Step 6: Deploy**

Create the Cloudflare Pages project against the new repo, add the custom domain, and confirm `https://pdf.harrys.monster` serves the site over HTTPS with the CSP headers present:

```bash
curl -sI https://pdf.harrys.monster | grep -i 'content-security-policy'
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: architecture and vendoring (1), pure ops and tests (2), shared widgets (3–4), the nine tools (5–10), failure handling and deployment (11). Compress's rasterising warning is in Task 9's markup. The privacy footer line is in Task 1. The `IntersectionObserver` cap is in Task 4. The four-rotation signature check is in Task 10 Step 4.

**Correction against the spec.** The spec named `embedPage` for A4 resize. The verified pdf-lib API is `embedPdf(source, indices)` returning objects with `.width`/`.height`, which Task 2 uses. Task 2 Step 4 notes the fallback if `embedPdf` rejects a `PDFDocument` argument.

**Type consistency.** `state.pdfs()`/`state.images()`, `showError(panelId, msg)`, `busy(panelEl, promise)` and `baseName(file)` are used with identical signatures across Tasks 5–10. `renderGrid(container, file, {onThumb})` returns `{pdf, count}` in Task 4 and is destructured that way in Tasks 6. `signaturePlacement` returns `{x, y, width, height, rotate}` in Task 2 and is consumed that way by `stampSignature` in the same file.

**Fixed during review.**

- Task 2's reorder-rejection test passed a promise where bytes were expected.
- Task 2's `loadPdf` test re-imported a symbol already available at the top of the file; `loadPdf` is now in the main import list.
- Task 6's Split tool decorated thumbnails before knowing the page count, so the last-page check was wrong and a second pass patched over it. It now reads the count first and decorates once.
- Task 5's Rotate tool used a dynamic `import()` for `loadPdfjsDoc`, which is unnecessary: that function is itself lazy, so a static import costs nothing.

**Found by actually running the plan's own test code.** Task 2's suite was executed against the real `@cantoo/pdf-lib` build before this plan was committed. Three things only showed up by running it:

- `node --test test/` throws `MODULE_NOT_FOUND` on Node 24. The `package.json` script is now bare `node --test`.
- `embedPdf` throws "Can't embed page with missing Contents" on a page with no content stream, and it throws at `save()` rather than at the call, so a `try`/`catch` around `embedPdf` never fires. `resizeToA4` now checks `page.node.Contents()` first. Without this, one blank page anywhere in a PDF would fail the entire conversion.
- Test fixtures built from `addPage()` alone have no content stream, so the A4 test needed real drawn content.

Final state: 16 tests, all passing.
