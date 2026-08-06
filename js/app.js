import { initDropzone, state } from './ui.js';
import { init as initMerge } from './tools/merge.js';
import { init as initRotate } from './tools/rotate.js';
import { init as initReorder } from './tools/reorder.js';
import { init as initSplit } from './tools/split.js';
import { init as initA4 } from './tools/a4.js';
import { init as initImages } from './tools/images.js';
import { init as initConvert } from './tools/convert.js';
import { init as initCompress } from './tools/compress.js';
import { init as initSign } from './tools/sign.js';

const tools = new Map();

export function registerTool(id, handlers) {
  tools.set(id, handlers);
}

function select(id) {
  document.querySelectorAll('.tool-btn').forEach(b => {
    b.setAttribute('aria-current', String(b.dataset.tool === id));
  });
  document.querySelectorAll('.panel').forEach(p => {
    p.hidden = p.id !== `panel-${id}`;
  });
  // Only assign when it actually differs, so hashchange never re-enters.
  if (location.hash.slice(1) !== id) location.hash = id;
  const t = tools.get(id);
  if (t && t.onFiles) t.onFiles(state.files);
}

function selectFromHash() {
  let id = location.hash.slice(1);
  if (!document.getElementById(`panel-${id}`)) {
    id = 'merge';
    // replace, not push: otherwise Back returns to the bad hash and bounces forward again.
    location.replace(`#${id}`);
  }
  // Our own select() assigns the hash, which fires hashchange. Bail so onFiles runs once.
  const btn = document.querySelector(`.tool-btn[data-tool="${id}"]`);
  if (btn && btn.getAttribute('aria-current') === 'true') return;
  select(id);
}

function init() {
  document.getElementById('year').textContent = new Date().getFullYear();
  initDropzone();

  initMerge();
  initRotate();
  initReorder();
  initSplit();
  initA4();
  initImages();
  initConvert();
  initCompress();
  initSign();

  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => select(btn.dataset.tool));
  });

  state.onChange(files => {
    const active = document.querySelector('.tool-btn[aria-current="true"]');
    if (!active) return;
    const t = tools.get(active.dataset.tool);
    if (t && t.onFiles) t.onFiles(files);
  });

  addEventListener('hashchange', selectFromHash);
  selectFromHash();
}

document.addEventListener('DOMContentLoaded', init);
