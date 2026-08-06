import { registerTool } from '../app.js';
import { state, loadPdfjsDoc, loadInto, renderPageToCanvas, downloadBlob, showError, clearError, busy, baseName, bytesToSize } from '../ui.js';

const ID = 'compress';

/**
 * One page in, one JPEG out, plus the box to rebuild that page at.
 *
 * The size comes from the viewport, never from `page.view`. `page.view` is
 * `[x0, y0, x1, y1]`: its last two entries are coordinates, not dimensions, so
 * they are only the page size when the MediaBox origin happens to be (0,0). It
 * also ignores `/Rotate`, and pdf.js renders *through* the rotation — a
 * `/Rotate 90` A4 page comes back as a landscape canvas, which rebuilt against
 * `page.view` would be squashed into a portrait box. `viewport.width / scale`
 * is the same number pdf.js sized the canvas from, at 1:1 with PDF points.
 */
async function renderPageToJpeg(doc, pageNumber, scale, quality) {
  const { canvas, viewport, page } = await renderPageToCanvas(doc, pageNumber, scale);
  try {
    // No white flatten: pdf.js fills the canvas white in beginDrawing before any
    // operator runs, so it cannot hand back a transparent one for JPEG to
    // composite onto black. Same finding as convert.js — re-check on upgrade.
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    // toBlob hands back null on failure; without this the caller reads
    // .arrayBuffer() off null and throws a TypeError that names nothing.
    if (!blob) throw new Error(`Page ${pageNumber} could not be encoded.`);
    return {
      jpegBytes: new Uint8Array(await blob.arrayBuffer()),
      width: viewport.width / scale,
      height: viewport.height / scale,
    };
  } finally {
    // Release both backing stores now rather than waiting for GC. pdf.js keeps
    // the page's operator list until cleanup(), and this loop is already holding
    // every page's JPEG bytes at once for the rebuild.
    canvas.width = canvas.height = 0;
    page.cleanup();
  }
}

export function init() {
  const panel = document.getElementById(`panel-${ID}`);
  const body = panel.querySelector('.panel-body');
  body.innerHTML = `
    <p class="panel-sub">
      <strong>This rebuilds each page as an image.</strong>
      Scanned documents shrink a lot. Text documents shrink too, but the text
      stops being selectable or searchable, and everything that is not printed
      ink is gone: <strong>a form becomes a picture of a form</strong> that
      nobody can fill in or read the answers out of, and links, comments and
      attachments are dropped. Keep your original.
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

  quality.addEventListener('input', () => { qOut.textContent = `${quality.value}%`; });
  dpi.addEventListener('input', () => { dOut.textContent = `${dpi.value} dpi`; });

  // loadInto owns this line whenever the file changes. Only write to it while
  // the run's own file is still the selected one, or a file switch mid-run
  // leaves progress about the old document sitting under the new name.
  const say = (forFile, text) => { if (state.pdfs()[0] === forFile) status.textContent = text; };

  body.querySelector('#cp-go').addEventListener('click', async () => {
    clearError(ID);
    // Read the file at click time: loadInto owns the current one and a
    // panel-level copy can drift from it.
    const file = state.pdfs()[0] || null;
    if (!file) return showError(ID, 'Add a PDF first.');
    // Read the controls once, up front, so a run always reports the settings it
    // actually used.
    const scale = Number(dpi.value) / 72; // 72 dpi is 1:1 with PDF points
    const q = Number(quality.value) / 100;
    try {
      // Everything inside busy(): work left outside it leaves the button live
      // for a second click.
      const bytes = await busy(panel, (async () => {
        const doc = await loadPdfjsDoc(file);
        try {
          if (!doc.numPages) throw new Error('This PDF has no pages to compress.');
          const { rebuildFromImages } = await import('../pdf-ops.js');
          const pages = [];
          for (let i = 1; i <= doc.numPages; i++) {
            pages.push(await renderPageToJpeg(doc, i, scale, q));
            say(file, `Compressed ${i} of ${doc.numPages} page${doc.numPages === 1 ? '' : 's'}…`);
          }
          say(file, 'Building the new PDF…');
          return rebuildFromImages(pages);
        } finally {
          // We loaded this document, so we own it, on every path out.
          doc.loadingTask.destroy().catch(() => {});
        }
      })());

      const saved = file.size - bytes.length;
      say(file, saved > 0
        ? `${bytesToSize(file.size)} → ${bytesToSize(bytes.length)} (${Math.round((saved / file.size) * 100)}% smaller)`
        : `${bytesToSize(file.size)} → ${bytesToSize(bytes.length)}. This PDF was already well compressed; try a lower quality or resolution.`);
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${baseName(file)}_compressed.pdf`);
    } catch (err) {
      // Without this the line is left mid-progress — `Compressed 40 of 120
      // pages…` for a run that stopped. Which file here, why on the error line.
      say(file, `Could not compress ${file.name}.`);
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    onFiles: loadInto(ID, {
      // The status line is the only widget describing the document, and loadInto
      // owns it — it resets and rewrites it on every file change, which also
      // clears a finished run's size report away. The sliders are user state and
      // deliberately survive.
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
