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
    <p class="panel-sub" id="reorder-status">No PDF loaded.</p>
    <div id="reorder-grid"></div>`;

  const grid = body.querySelector('#reorder-grid');
  const status = body.querySelector('#reorder-status');
  let file = null;
  let order = [];
  let dragFrom = null;

  function move(from, to) {
    if (from < 0 || to < 0 || to >= order.length) return;
    const [item] = order.splice(from, 1);
    order.splice(to, 0, item);
    paint();
  }

  function paint() {
    [...grid.children].forEach(card => {
      const pageIdx = Number(card.dataset.index);
      const pos = order.indexOf(pageIdx);
      // Visual order only: the cards stay in DOM order so a move never rebuilds
      // a button, and a keyboard user keeps focus on the arrow they just pressed.
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
    // Dragging alone is unusable without a mouse, so the arrows are the
    // keyboard path to the same move, not decoration.
    actions.append(arrow(index, -1), arrow(index, 1));
    card.append(actions);
  }

  function arrow(index, dir) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-ghost';
    b.textContent = dir < 0 ? '◀' : '▶';
    b.setAttribute('aria-label', `Move page ${index + 1} ${dir < 0 ? 'earlier' : 'later'}`);
    b.addEventListener('click', () => move(order.indexOf(index), order.indexOf(index) + dir));
    return b;
  }

  body.querySelector('#reorder-go').addEventListener('click', async () => {
    clearError(ID);
    if (!file) return showError(ID, 'Add a PDF first.');
    try {
      // Everything inside busy(), including the import and the file read: any
      // work left outside it leaves the button live for a second click.
      const bytes = await busy(panel, (async () => {
        const { reorderPdf } = await import('../pdf-ops.js');
        return reorderPdf(new Uint8Array(await file.arrayBuffer()), order);
      })());
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${baseName(file)}_reordered.pdf`);
    } catch (err) {
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    async onFiles() {
      const next = state.pdfs()[0] || null;
      // onFiles also fires on every panel switch; rebuilding the grid would
      // throw away the order the user just arranged, and re-parse for nothing.
      if (next === file) return;
      file = next;
      clearError(ID);
      // Reset before the parse, not after it. A failed load that only shows an
      // error would otherwise leave the previous document's thumbnails and page
      // count on screen, and the early return above means nothing corrects it.
      grid.innerHTML = '';
      order = [];
      status.textContent = file ? `Reading ${file.name}…` : 'No PDF loaded.';
      if (!file) return;
      try {
        const { count, stale } = await busy(panel, renderGrid(grid, file, { onThumb: decorate }));
        if (stale) return; // a newer render owns the grid — show nothing, this is not an error
        order = Array.from({ length: count }, (_, i) => i);
        paint();
        status.textContent = `Loaded: ${file.name} · ${count} pages`;
      } catch (err) {
        if (file !== next) return; // a newer file took over while this one parsed
        // The status says which file, the error below says why.
        status.textContent = `Could not read ${file.name}.`;
        showError(ID, err.message);
      }
    },
  });
}
