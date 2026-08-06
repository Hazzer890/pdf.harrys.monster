import { registerTool } from '../app.js';
import { state, renderGrid, releaseGrid, loadInto, downloadZip, showError, clearError, busy, baseName } from '../ui.js';

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
  const file = () => state.pdfs()[0] || null;
  let count = 0;
  const cuts = new Set();

  function refresh() {
    [...grid.children].forEach(card => {
      const i = Number(card.dataset.index);
      card.classList.toggle('cut-after', cuts.has(i));
      const btn = card.querySelector('.cut-btn');
      // The visible text stays put and aria-pressed carries the state: swapping
      // the label out from under a fixed accessible name breaks WCAG 2.5.3.
      if (btn) btn.setAttribute('aria-pressed', String(cuts.has(i)));
    });
    cutsEl.textContent = count ? `${cuts.size + 1} file${cuts.size ? 's' : ''} will be created` : '';
  }

  function decorate(card, index) {
    const actions = document.createElement('div');
    actions.className = 'thumb-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost cut-btn';
    btn.textContent = 'Cut after';
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
    const pdf = file();
    if (!pdf) return showError(ID, 'Add a PDF first.');
    try {
      // Everything inside busy(), including the import, the file read and the
      // zipping: any work left outside it leaves the button live for a second
      // click, and a second click means a second zip downloaded.
      await busy(panel, (async () => {
        const { splitPdf } = await import('../pdf-ops.js');
        const bytes = new Uint8Array(await pdf.arrayBuffer());
        // splitRanges already coerces cut points and drops blanks; pass them through.
        const parts = await splitPdf(bytes, [...cuts], baseName(pdf));
        await downloadZip(parts, `${baseName(pdf)}_split.zip`);
      })());
    } catch (err) {
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    onFiles: loadInto(ID, {
      status,
      reset() {
        // Emptying the DOM is not enough: on removal no new render follows, so
        // without this the parsed document stays in memory after Remove.
        releaseGrid(grid);
        grid.innerHTML = '';
        cuts.clear();
        count = 0;
        cutsEl.textContent = '';
      },
      load: f => renderGrid(grid, f, { onThumb: decorate }),
      apply(pages) {
        count = pages;
        // A cut sits *after* a page, so the last page cannot have one. onThumb
        // runs before renderGrid knows the count, so give every card a toggle
        // and take the last one back here rather than parsing the file twice.
        const last = grid.lastElementChild;
        if (last) last.querySelector('.thumb-actions').remove();
        refresh();
      },
    }),
  });
}
