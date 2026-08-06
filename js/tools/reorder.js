import { registerTool } from '../app.js';
import { state, renderGrid, loadInto, downloadBlob, showError, clearError, busy, baseName } from '../ui.js';

const ID = 'reorder';

export function init() {
  const panel = document.getElementById(`panel-${ID}`);
  const body = panel.querySelector('.panel-body');
  body.innerHTML = `
    <div class="panel-toolbar">
      <button type="button" class="btn btn-primary" id="reorder-go">Save reordered PDF</button>
    </div>
    <p class="panel-sub" id="reorder-status">No PDF loaded.</p>
    <p class="sr-only" id="reorder-say" aria-live="polite"></p>
    <div id="reorder-grid"></div>`;

  const grid = body.querySelector('#reorder-grid');
  const say = body.querySelector('#reorder-say');
  const status = body.querySelector('#reorder-status');
  const file = () => state.pdfs()[0] || null;
  let order = [];
  let dragFrom = null;

  function move(from, to) {
    if (from < 0 || from >= order.length || to < 0 || to >= order.length) return;
    const [item] = order.splice(from, 1);
    order.splice(to, 0, item);
    // The cards move visually but not in the DOM, so nothing about this is
    // perceivable without sight of the grid unless it is said out loud.
    say.textContent = `Page ${item + 1} moved to position ${to + 1} of ${order.length}.`;
    const pressed = document.activeElement;
    paint();
    // paint() may have just disabled the arrow that was pressed, and the browser
    // drops focus to the document when that happens. Hand it to the sibling so a
    // keyboard user can keep going.
    if (pressed && pressed.disabled && pressed.parentElement) {
      const sibling = [...pressed.parentElement.children].find(b => !b.disabled);
      if (sibling) sibling.focus();
    }
  }

  function paint() {
    [...grid.children].forEach(card => {
      const pageIdx = Number(card.dataset.index);
      const pos = order.indexOf(pageIdx);
      // Visual order only: the cards stay in DOM order so a move never rebuilds
      // a button, and a keyboard user keeps focus on the arrow they just pressed.
      card.style.order = String(pos);
      card.querySelector('.thumb-label').textContent = `Position ${pos + 1} · page ${pageIdx + 1}`;
      const [earlier, later] = card.querySelector('.thumb-actions').children;
      earlier.disabled = pos === 0;
      later.disabled = pos === order.length - 1;
    });
  }

  function decorate(card, index) {
    card.draggable = true;
    card.addEventListener('dragstart', () => {
      dragFrom = order.indexOf(index);
      card.classList.add('is-dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      // Clear the position too. A drag cancelled with Esc or released outside the
      // grid still ends here, and a leftover dragFrom would be applied by the next
      // drop to land on a card — including a file dragged in from the desktop.
      dragFrom = null;
    });
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
    const pdf = file();
    if (!pdf) return showError(ID, 'Add a PDF first.');
    try {
      // Everything inside busy(), including the import and the file read: any
      // work left outside it leaves the button live for a second click.
      const bytes = await busy(panel, (async () => {
        const { reorderPdf } = await import('../pdf-ops.js');
        return reorderPdf(new Uint8Array(await pdf.arrayBuffer()), order);
      })());
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${baseName(pdf)}_reordered.pdf`);
    } catch (err) {
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    onFiles: loadInto(ID, {
      status,
      reset() {
        grid.innerHTML = '';
        order = [];
      },
      load: f => renderGrid(grid, f, { onThumb: decorate }),
      apply(count) {
        order = Array.from({ length: count }, (_, i) => i);
        paint();
      },
    }),
  });
}
