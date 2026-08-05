import { initDropzone, state } from './ui.js';

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
  location.hash = id;
  const t = tools.get(id);
  if (t && t.onFiles) t.onFiles(state.files);
}

function init() {
  document.getElementById('year').textContent = new Date().getFullYear();
  initDropzone();

  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => select(btn.dataset.tool));
  });

  state.onChange(files => {
    const active = document.querySelector('.tool-btn[aria-current="true"]');
    if (!active) return;
    const t = tools.get(active.dataset.tool);
    if (t && t.onFiles) t.onFiles(files);
  });

  const initial = location.hash.slice(1);
  select(tools.has(initial) || document.getElementById(`panel-${initial}`) ? initial : 'merge');
}

document.addEventListener('DOMContentLoaded', init);
