import { registerTool } from '../app.js';
import { state, downloadBlob, showError, clearError, busy, baseName } from '../ui.js';

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

  function moveBtn(file, i, dir) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-ghost';
    b.dataset.dir = String(dir);
    b.textContent = dir < 0 ? '↑' : '↓';
    b.setAttribute('aria-label', `Move ${file.name} ${dir < 0 ? 'up' : 'down'}`);
    b.disabled = dir < 0 ? i === 0 : i === order.length - 1;
    b.addEventListener('click', () => swap(i, i + dir));
    return b;
  }

  function render() {
    listEl.innerHTML = '';
    order.forEach((file, i) => {
      const li = document.createElement('li');
      li.textContent = file.name;
      li.append(moveBtn(file, i, -1), moveBtn(file, i, 1));
      listEl.append(li);
    });
  }

  function swap(a, b) {
    [order[a], order[b]] = [order[b], order[a]];
    render();
    // render() rebuilt every button, so a keyboard user would lose focus mid-reorder.
    const moved = listEl.children[b].querySelector(`[data-dir="${b > a ? 1 : -1}"]`);
    if (moved && !moved.disabled) moved.focus();
  }

  body.querySelector('#merge-go').addEventListener('click', async () => {
    clearError(ID);
    if (order.length < 2) return showError(ID, 'Add at least two PDFs first.');
    try {
      // Everything inside busy(), including the import and the file reads: any
      // work left outside it leaves the button live for a second click, and the
      // arrows live for a reorder while this loop is still reading `order`.
      const name = `${baseName(order[0])}_merged.pdf`;
      const bytes = await busy(panel, (async () => {
        const { mergePdfs } = await import('../pdf-ops.js');
        const buffers = [];
        for (const f of order) buffers.push(new Uint8Array(await f.arrayBuffer()));
        return mergePdfs(buffers);
      })());
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), name);
    } catch (err) {
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    onFiles() {
      // onFiles also fires on every panel switch, so rebuilding the list from
      // scratch would throw away the order the user just set. Keep the files
      // still loaded in their chosen order and append whatever is new.
      // By name, not identity: re-picking a file replaces the File object in
      // place, and an identity match would treat the replacement as new and
      // send it to the end — in the one panel where position is the product.
      const pdfs = state.pdfs();
      const kept = order.map(f => pdfs.find(p => p.name === f.name)).filter(Boolean);
      order = kept.concat(pdfs.filter(p => !kept.includes(p)));
      render();
    },
  });
}
