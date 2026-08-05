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
      // Everything inside busy(), including the import and the file read: any
      // work left outside it leaves the button live for a second click.
      const bytes = await busy(panel, (async () => {
        const { rotatePdf } = await import('../pdf-ops.js');
        return rotatePdf(new Uint8Array(await file.arrayBuffer()), {
          angle: body.querySelector('#rot-angle').value,
          startPage: startEl.value,
          endPage: endEl.value,
        });
      })());
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${baseName(file)}_rotated.pdf`);
    } catch (err) {
      // rotatePdf throws a different message for a bad angle than for a bad
      // page range, so pass its own wording through rather than guessing.
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    async onFiles() {
      const next = state.pdfs()[0] || null;
      // onFiles also fires on every panel switch; reloading the same file would
      // reset the range the user set, and cost another parse for nothing.
      if (next === file) return;
      file = next;
      clearError(ID);
      // Reset before the parse, not after it. A failed load that only shows an
      // error would otherwise leave the previous document's page count and
      // range on screen, and the early return above means nothing corrects it.
      startEl.max = endEl.max = '';
      startEl.value = endEl.value = '1';
      status.textContent = file ? `Reading ${file.name}…` : 'No PDF loaded.';
      if (!file) return;
      let doc;
      try {
        doc = await busy(panel, loadPdfjsDoc(file));
        if (file !== next) return; // a newer file took over while this one parsed
        startEl.max = endEl.max = doc.numPages;
        startEl.value = 1;
        endEl.value = doc.numPages;
        status.textContent = `Loaded: ${file.name} · ${doc.numPages} pages`;
      } catch (err) {
        if (file !== next) return;
        // The status says which file, the error below says why.
        status.textContent = `Could not read ${file.name}.`;
        showError(ID, err.message);
      } finally {
        // We loaded this document, so we own it. This pdf.js build has no
        // PDFDocumentProxy.destroy(); teardown is on the loading task.
        if (doc) doc.loadingTask.destroy().catch(() => {});
      }
    },
  });
}
