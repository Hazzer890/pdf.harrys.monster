import { registerTool } from '../app.js';
import { state, downloadZip, downloadBlob, showError, clearError, busy, baseName } from '../ui.js';

const ID = 'a4';

export function init() {
  const panel = document.getElementById(`panel-${ID}`);
  const body = panel.querySelector('.panel-body');
  body.innerHTML = `
    <div class="panel-toolbar">
      <button type="button" class="btn btn-primary" id="a4-go">Convert to A4</button>
    </div>
    <p class="panel-sub" id="a4-status">No PDFs loaded.</p>`;
  const status = body.querySelector('#a4-status');

  body.querySelector('#a4-go').addEventListener('click', async () => {
    clearError(ID);
    const files = state.pdfs();
    if (!files.length) return showError(ID, 'Add at least one PDF first.');
    try {
      // Everything inside busy(), including the import and the file reads: any
      // work left outside it leaves the button live for a second click.
      const { done, failed } = await busy(panel, (async () => {
        const { resizeToA4 } = await import('../pdf-ops.js');
        const done = [];
        const failed = [];
        for (const f of files) {
          // Per file, so one unreadable PDF still lets the rest convert.
          try {
            const bytes = await resizeToA4(new Uint8Array(await f.arrayBuffer()));
            done.push({ name: `${baseName(f)}_a4.pdf`, bytes });
          } catch (err) {
            failed.push(`${f.name}: ${err.message}`);
          }
        }
        if (done.length === 1) {
          downloadBlob(new Blob([done[0].bytes], { type: 'application/pdf' }), done[0].name);
        } else if (done.length > 1) {
          await downloadZip(done, `${baseName(files[0])}_a4.zip`);
        }
        return { done, failed };
      })());
      // Past tense: this reports the run that just finished, so it cannot go
      // stale the way a description of the current queue would. Any later file
      // change fires onFiles and replaces it with the count.
      status.textContent = `Converted ${done.length} of ${files.length} file${files.length === 1 ? '' : 's'}.`;
      if (failed.length) showError(ID, failed.join('\n'));
    } catch (err) {
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    // Batch panel: nothing here parses a document or describes one, so there is
    // no freshness problem for loadInto() to solve. Just the count.
    onFiles() {
      const n = state.pdfs().length;
      status.textContent = n ? `Loaded: ${n} PDF${n === 1 ? '' : 's'}` : 'No PDFs loaded.';
    },
  });
}
