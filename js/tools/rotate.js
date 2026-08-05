import { registerTool } from '../app.js';
import { state, loadPdfjsDoc, loadInto, downloadBlob, showError, clearError, busy, baseName } from '../ui.js';

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
  const file = () => state.pdfs()[0] || null;

  body.querySelector('#rot-go').addEventListener('click', async () => {
    clearError(ID);
    const pdf = file();
    if (!pdf) return showError(ID, 'Add a PDF first.');
    try {
      // Everything inside busy(), including the import and the file read: any
      // work left outside it leaves the button live for a second click.
      const bytes = await busy(panel, (async () => {
        const { rotatePdf } = await import('../pdf-ops.js');
        return rotatePdf(new Uint8Array(await pdf.arrayBuffer()), {
          angle: body.querySelector('#rot-angle').value,
          startPage: startEl.value,
          endPage: endEl.value,
        });
      })());
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${baseName(pdf)}_rotated.pdf`);
    } catch (err) {
      // rotatePdf throws a different message for a bad angle than for a bad
      // page range, so pass its own wording through rather than guessing.
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    onFiles: loadInto(ID, {
      status,
      reset() {
        startEl.max = endEl.max = '';
        startEl.value = endEl.value = '1';
      },
      async load(f) {
        // We loaded this document, so we own it. The page count is all this
        // panel needs, so it is destroyed the moment we have it. This pdf.js
        // build has no PDFDocumentProxy.destroy(); teardown is on the task.
        const doc = await loadPdfjsDoc(f);
        try { return { count: doc.numPages }; }
        finally { doc.loadingTask.destroy().catch(() => {}); }
      },
      apply(count) {
        startEl.max = endEl.max = count;
        startEl.value = 1;
        endEl.value = count;
      },
    }),
  });
}
