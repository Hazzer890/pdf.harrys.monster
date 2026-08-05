import { registerTool } from '../app.js';
import { state, renderGrid, downloadZip, showError, clearError, busy, baseName } from '../ui.js';

const ID = 'split';

export function init() {
  const panel = document.getElementById(`panel-${ID}`);
  const body = panel.querySelector('.panel-body');
  body.innerHTML = `
    <div class="panel-toolbar">
      <button type="button" class="btn btn-ghost" id="split-all">Cut after every page</button>
      <button type="button" class="btn btn-ghost" id="split-clear">Clear cuts</button>
      <button type="button" class="btn btn-primary" id="split-go">Split and download zip</button>
      <span id="split-cuts"></span>
    </div>
    <p class="panel-sub" id="split-status">No PDF loaded.</p>
    <div id="split-grid"></div>`;

  const grid = body.querySelector('#split-grid');
  const status = body.querySelector('#split-status');
  const cutsEl = body.querySelector('#split-cuts');
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
    cutsEl.textContent = count ? `${cuts.size + 1} file${cuts.size ? 's' : ''} will be created` : '';
  }

  function decorate(card, index) {
    const actions = document.createElement('div');
    actions.className = 'thumb-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost cut-btn';
    btn.setAttribute('aria-label', `Cut after page ${index + 1}`);
    btn.addEventListener('click', () => {
      if (cuts.has(index)) cuts.delete(index); else cuts.add(index);
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
      // Everything inside busy(), including the import, the file read and the
      // zipping: any work left outside it leaves the button live for a second
      // click, and a second click means a second zip downloaded.
      await busy(panel, (async () => {
        const { splitPdf } = await import('../pdf-ops.js');
        const bytes = new Uint8Array(await file.arrayBuffer());
        // splitRanges already coerces cut points and drops blanks; pass them through.
        const parts = await splitPdf(bytes, [...cuts], baseName(file));
        await downloadZip(parts, `${baseName(file)}_split.zip`);
      })());
    } catch (err) {
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    async onFiles() {
      const next = state.pdfs()[0] || null;
      // onFiles also fires on every panel switch; rebuilding the grid would
      // throw away the cut points the user just placed, and re-parse for nothing.
      if (next === file) return;
      file = next;
      clearError(ID);
      // Reset before the parse, not after it. A failed load that only shows an
      // error would otherwise leave the previous document's thumbnails and cut
      // count on screen, and the early return above means nothing corrects it.
      grid.innerHTML = '';
      cuts.clear();
      count = 0;
      cutsEl.textContent = '';
      status.textContent = file ? `Reading ${file.name}…` : 'No PDF loaded.';
      if (!file) return;
      try {
        const res = await busy(panel, renderGrid(grid, file, { onThumb: decorate }));
        if (res.stale) return; // a newer render owns the grid — show nothing, this is not an error
        count = res.count;
        // A cut sits *after* a page, so the last page cannot have one. onThumb
        // runs before renderGrid knows the count, so give every card a toggle
        // and take the last one back here rather than parsing the file twice.
        const last = grid.lastElementChild;
        if (last) last.querySelector('.thumb-actions').remove();
        refresh();
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
