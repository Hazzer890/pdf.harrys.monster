import { registerTool } from '../app.js';
import { state, loadPdfjsDoc, loadInto, renderPageToCanvas, downloadZip, downloadBlob, showError, clearError, busy, baseName, bytesToSize } from '../ui.js';

const ID = 'convert';

/**
 * Hard stop, so a run that would kill the tab fails with a message instead.
 * Nothing else here is bounded: page count comes from the file and the scale
 * goes to 300%, so the encoded bytes are the only thing we can cap.
 */
const MAX_BYTES = 1024 * 1024 * 1024;

async function renderPage(doc, pageNumber, scale, mime) {
  const { canvas, page } = await renderPageToCanvas(doc, pageNumber, scale);
  try {
    // No white flatten here, deliberately. A transparent canvas would make JPEG
    // composite the page onto black, but this pdf.js build cannot hand one back:
    // `beginDrawing` fills the canvas `background || "#ffffff"` before any
    // operator runs, and nothing passes a background. Measured on plain text, on
    // 35%-opacity shapes, and on a soft-masked RGBA image: every exported pixel
    // came back alpha 255 with white margins, and adding a fill changed the
    // output by zero bytes. Re-check this if pdf.js is ever upgraded — it is the
    // one change that would break these exports silently and visibly.
    const blob = await new Promise(r => canvas.toBlob(r, mime, 0.95));
    // toBlob hands back null on failure; without this the caller reads .size
    // off null and throws a TypeError that names nothing.
    if (!blob) throw new Error(`Page ${pageNumber} could not be encoded.`);
    return blob;
  } finally {
    // Release both backing stores now rather than waiting for GC. An A4 page at
    // 300% is ~35 MB of canvas, and pdf.js keeps the page's operator list until
    // cleanup(); across a few hundred pages that is what kills the tab.
    canvas.width = canvas.height = 0;
    page.cleanup();
  }
}

export function init() {
  const panel = document.getElementById(`panel-${ID}`);
  const body = panel.querySelector('.panel-body');
  body.innerHTML = `
    <div class="panel-toolbar">
      <label>Format <select id="cv-format"><option value="png">PNG</option><option value="jpg">JPG</option></select></label>
      <label>Scale <input type="range" id="cv-scale" min="100" max="300" step="10" value="150"></label>
      <output id="cv-scale-out">150%</output>
      <button type="button" class="btn btn-primary" id="cv-go">Export pages</button>
    </div>
    <p class="panel-sub" id="cv-status">No PDF loaded.</p>`;

  const scale = body.querySelector('#cv-scale');
  const out = body.querySelector('#cv-scale-out');
  const status = body.querySelector('#cv-status');

  scale.addEventListener('input', () => { out.textContent = `${scale.value}%`; });

  // loadInto owns this line whenever the file changes. Only write to it while
  // the export's own file is still the selected one, or a file switch
  // mid-export leaves progress about the old document under the new name.
  const say = (forFile, text) => { if (state.pdfs()[0] === forFile) status.textContent = text; };

  body.querySelector('#cv-go').addEventListener('click', async () => {
    clearError(ID);
    // Read the file at click time: the helper owns the current one and a
    // panel-level copy can drift from it.
    const file = state.pdfs()[0] || null;
    if (!file) return showError(ID, 'Add a PDF first.');
    // Read the controls once, up front. `.busy` only blocks the pointer, so a
    // focused slider can still be nudged with the arrow keys mid-export.
    const fmt = body.querySelector('#cv-format').value;
    const mime = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
    const pageScale = Number(scale.value) / 100;
    const base = baseName(file);
    try {
      // Everything inside busy(), the zipping included: any work left outside it
      // leaves the button live for a second click.
      const count = await busy(panel, (async () => {
        const doc = await loadPdfjsDoc(file);
        try {
          if (!doc.numPages) throw new Error('This PDF has no pages to export.');
          const entries = [];
          let total = 0;
          for (let i = 1; i <= doc.numPages; i++) {
            const blob = await renderPage(doc, i, pageScale, mime);
            total += blob.size;
            if (total > MAX_BYTES) {
              throw new Error(`This export passed ${bytesToSize(MAX_BYTES)} at page ${i} of ${doc.numPages}. Lower the scale, or choose JPG, and try again.`);
            }
            // Blobs, not ArrayBuffers: the browser can back these with disk, and
            // JSZip reads them one at a time when it builds the archive.
            entries.push({ name: `${base}_page_${i}.${fmt}`, bytes: blob });
            say(file, `Rendered ${i} of ${doc.numPages} page${doc.numPages === 1 ? '' : 's'}…`);
          }
          // One page is one image, as in the A4 panel — a zip around a single
          // file is just an extra step for the user.
          if (entries.length === 1) downloadBlob(entries[0].bytes, entries[0].name);
          // STORE: PNG and JPEG are already compressed, so deflating them costs
          // the time and the buffers and saves nothing worth having.
          else await downloadZip(entries, `${base}_${fmt}.zip`, { compression: 'STORE' });
          return entries.length;
        } finally {
          // We loaded this document, so we own it, on every path out.
          doc.loadingTask.destroy().catch(() => {});
        }
      })());
      // Past tense: reports the run that just finished, so it cannot go stale.
      say(file, `Exported ${count} page image${count === 1 ? '' : 's'}.`);
    } catch (err) {
      // Without this the line is left mid-progress — `Rendered 40 of 120 pages…`
      // for a run that stopped. Same split as the house style: which file here,
      // why on the error line.
      say(file, `Could not export ${file.name}.`);
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    onFiles: loadInto(ID, {
      // The status line is the only thing here that describes the document, and
      // loadInto owns it — it resets and rewrites it on every file change, which
      // also clears a finished export's message away.
      reset() {},
      status,
      async load(f) {
        // A page count is all this needs, so the document is destroyed the
        // moment we have it. This pdf.js build has no PDFDocumentProxy.destroy();
        // teardown is on the loading task.
        const doc = await loadPdfjsDoc(f);
        try { return { count: doc.numPages }; }
        finally { doc.loadingTask.destroy().catch(() => {}); }
      },
      apply() {},
    }),
  });
}
