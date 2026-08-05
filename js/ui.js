const MAX_WARN = 50 * 1024 * 1024;

export const state = {
  files: [],
  _subs: [],
  onChange(fn) { this._subs.push(fn); },
  set(files) {
    this.files = files;
    this._subs.forEach(fn => fn(this.files));
  },
  pdfs() { return this.files.filter(f => /\.pdf$/i.test(f.name)); },
  images() { return this.files.filter(f => /\.(png|jpe?g|bmp|tiff?|webp)$/i.test(f.name)); },
};

export function baseName(file) {
  return String(file.name).replace(/\.[^.]+$/, '');
}

export function bytesToSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initDropzone() {
  const zone = document.getElementById('dropzone');
  const input = document.getElementById('file-input');
  const list = document.getElementById('file-list');

  document.getElementById('browse').addEventListener('click', () => input.click());
  input.addEventListener('change', () => add([...input.files]));

  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); zone.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault();
    if (ev === 'dragleave' && zone.contains(e.relatedTarget)) return;
    zone.classList.remove('is-over');
  }));
  zone.addEventListener('drop', e => add([...e.dataTransfer.files]));

  function add(files) {
    state.set([...state.files, ...files]);
  }

  state.onChange(files => {
    list.innerHTML = '';
    files.forEach((f, i) => {
      const li = document.createElement('li');
      const warn = f.size > MAX_WARN ? ' · large file, this may be slow' : '';
      li.textContent = `${f.name} · ${bytesToSize(f.size)}${warn}`;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'btn btn-ghost';
      rm.textContent = 'Remove';
      rm.setAttribute('aria-label', `Remove ${f.name}`);
      rm.addEventListener('click', () => {
        state.set(state.files.filter((_, j) => j !== i));
      });
      li.append(rm);
      list.append(li);
    });
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadZip(entries, zipName) {
  // UMD bundle: no ES export, so import for side effects and read the global.
  await import('../vendor/jszip.min.js');
  const zip = new window.JSZip();
  entries.forEach(e => zip.file(e.name, e.bytes));
  downloadBlob(await zip.generateAsync({ type: 'blob' }), zipName);
}

export function showError(panelId, message) {
  const el = document.querySelector(`#panel-${panelId} .panel-error`);
  el.textContent = message;
  el.hidden = false;
}

export function clearError(panelId) {
  const el = document.querySelector(`#panel-${panelId} .panel-error`);
  el.hidden = true;
  el.textContent = '';
}

export async function busy(panelEl, promise) {
  panelEl.classList.add('busy');
  try { return await promise; }
  finally { panelEl.classList.remove('busy'); }
}
