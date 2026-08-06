import { initDropzone, initErrorTrap, state } from './ui.js';
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
    const on = b.dataset.tool === id;
    b.setAttribute('aria-selected', String(on));
    // Roving tabindex. The tablist is a single Tab stop and the arrow keys move
    // inside it; announcing role="tab" without this makes the keyboard
    // behaviour contradict the announced semantics.
    b.tabIndex = on ? 0 : -1;
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
  if (btn && btn.getAttribute('aria-selected') === 'true') return;
  select(id);
}

function init() {
  document.getElementById('year').textContent = new Date().getFullYear();
  initErrorTrap();
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

  // The hash is the tool router, so a real jump to #panels would be rewritten
  // to a tool id by selectFromHash. Move focus by hand instead.
  document.querySelector('.skip-link').addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('panels').focus();
  });

  const nav = document.querySelector('.tool-nav');
  nav.addEventListener('keydown', e => {
    const buttons = [...nav.querySelectorAll('.tool-btn')];
    const from = buttons.indexOf(document.activeElement);
    if (from === -1) return;
    // Both axes: the list is a column on desktop and a row on a phone.
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    const to = step ? (from + step + buttons.length) % buttons.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? buttons.length - 1
      : -1;
    if (to === -1) return;
    e.preventDefault();
    // Focus only — Enter or Space activates. Selecting on arrow would re-parse
    // the PDF in every panel the user passes through, and a load is seconds on
    // a big file.
    buttons[to].focus();
  });

  state.onChange(files => {
    const active = document.querySelector('.tool-btn[aria-selected="true"]');
    if (!active) return;
    const t = tools.get(active.dataset.tool);
    if (t && t.onFiles) t.onFiles(files);
  });

  addEventListener('hashchange', selectFromHash);
  selectFromHash();
}

document.addEventListener('DOMContentLoaded', init);
