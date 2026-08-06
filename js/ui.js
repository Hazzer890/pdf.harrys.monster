const MAX_WARN = 50 * 1024 * 1024;

export const state = {
  files: [],
  _subs: [],
  onChange(fn) { this._subs.push(fn); },
  set(files) {
    this.files = files;
    // one bad subscriber must not stop the rest, or escape into the DOM handler
    this._subs.forEach(fn => { try { fn(this.files); } catch (err) { console.error(err); } });
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
  // reset value, or re-picking the same file after Remove fires no change event
  input.addEventListener('change', () => { add([...input.files]); input.value = ''; });

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

/** `entries[].bytes` may be a Uint8Array or a Blob; JSZip takes either. */
export async function downloadZip(entries, zipName, options) {
  // UMD bundle: no ES export, so import for side effects and read the global.
  await import('../vendor/jszip.min.js');
  const zip = new window.JSZip();
  entries.forEach(e => zip.file(e.name, e.bytes));
  // `options` reaches generateAsync, so a caller zipping already-compressed data
  // can ask for STORE instead of paying for a deflate that gains nothing.
  downloadBlob(await zip.generateAsync({ type: 'blob', ...options }), zipName);
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

/**
 * The shared `onFiles` body for a panel that works on one PDF. Returns a
 * function to hand straight to `registerTool`.
 *
 * It owns the unchanged-file early return, the reset-before-parse, the two
 * freshness checks after the await and the four status strings, so every panel
 * words them identically and a fix here is a fix everywhere.
 *
 * `load(file)` resolves `{ count, stale }` — usually straight from `renderGrid`.
 * `reset()` clears the panel's widgets; `apply(count)` fills them back in once
 * the load has been proven to be for the file still selected.
 */
export function loadInto(id, { status, reset, load, apply }) {
  const panel = document.getElementById(`panel-${id}`);
  let current = null;
  return async function onFiles() {
    const next = state.pdfs()[0] || null;
    // onFiles fires on every panel switch, not only on a file change; rebuilding
    // here would throw away whatever the user has set up in this panel.
    if (next === current) return;
    current = next;
    clearError(id);
    // Reset before the parse, not after it. A failed load that only showed an
    // error would leave the previous document's widgets on screen, and the
    // early return above means no later tool switch corrects it.
    reset();
    status.textContent = current ? `Reading ${current.name}…` : 'No PDF loaded.';
    if (!current) return;
    try {
      const { count, stale } = await busy(panel, load(current));
      if (stale) return; // a newer render owns the container — show nothing, this is not an error
      // Distinct from `stale`: removing the file returns above without ever
      // starting a newer render, so the generation is never bumped and nothing
      // else would clear this finished load away. Only reset when the file is
      // gone — if another file took over it has already reset and applied its
      // own widgets, and clearing them here would wipe *its* state.
      if (current !== next) { if (!current) reset(); return; }
      apply(count);
      status.textContent = `Loaded: ${next.name} · ${count} pages`;
    } catch (err) {
      if (current !== next) return; // a newer file, or none, took over while this one parsed
      // The status says which file, the error line says why.
      status.textContent = `Could not read ${next.name}.`;
      showError(id, err.message);
    }
  };
}

export async function busy(panelEl, promise) {
  // depth counter: overlapping calls must not re-enable the panel early
  panelEl.dataset.busy = String(Number(panelEl.dataset.busy || 0) + 1);
  panelEl.classList.add('busy');
  try { return await promise; }
  finally {
    const left = Number(panelEl.dataset.busy) - 1;
    if (left > 0) panelEl.dataset.busy = String(left);
    else { delete panelEl.dataset.busy; panelEl.classList.remove('busy'); }
  }
}

let pdfjsPromise = null;

export function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdf.min.mjs').then(lib => {
      lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

export async function loadPdfjsDoc(file) {
  const lib = await getPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = lib.getDocument({ data });
  try {
    return await task.promise;
  } catch (err) {
    // A rejected load has already spun up a worker and nothing else holds the
    // task, so every unreadable or password-protected file leaked one. Measured:
    // a failed load left `new Worker` at 1 and `terminate()` at 0.
    task.destroy().catch(() => {});
    if (err && err.name === 'PasswordException') {
      throw new Error('This PDF is password-protected. Remove the password and try again.');
    }
    throw new Error('Could not read this PDF. The file may be corrupt.');
  }
}

export async function renderPageToCanvas(pdf, pageNumber, scale) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return { canvas, viewport, page };
}

/** Renders at most CONCURRENCY pages at a time, and only once visible. */
const CONCURRENCY = 4;

/** Live grid per container, so a re-render can tear the previous one down. */
const grids = new WeakMap();
/** Call counter per container: parsing is async, so calls can finish out of order. */
const gens = new WeakMap();

export async function renderGrid(container, file, { onThumb } = {}) {
  const gen = (gens.get(container) || 0) + 1;
  gens.set(container, gen);

  const pdf = await loadPdfjsDoc(file);

  // A newer call started while this one was parsing: it owns the container now.
  if (gens.get(container) !== gen) {
    pdf.loadingTask.destroy().catch(() => {});
    return { pdf: null, count: 0, stale: true };
  }

  const prev = grids.get(container);
  if (prev) {
    prev.observer.disconnect();
    // this pdf.js build has no PDFDocumentProxy.destroy(); teardown is on the loading task.
    prev.pdf.loadingTask.destroy().catch(() => {});
    grids.delete(container);
  }

  container.innerHTML = '';
  // add, not assign: the container is usually .panel-body and tools re-query it.
  container.classList.add('thumb-grid');

  const queue = [];
  let running = 0;

  const pump = () => {
    while (running < CONCURRENCY && queue.length) {
      const job = queue.shift();
      running++;
      // destroy() rejects in-flight renders; swallow so nothing goes unhandled.
      job().catch(() => {}).finally(() => { running--; pump(); });
    }
  };

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const el = entry.target;
      queue.push(async () => {
        try {
          const { canvas } = await renderPageToCanvas(pdf, Number(el.dataset.page), 0.4);
          const ph = el.querySelector('.thumb-ph');
          if (ph) ph.replaceWith(canvas);
        } catch (err) {
          // torn down by a newer render: expected, say nothing. Otherwise the page really failed.
          if (gens.get(container) !== gen) return;
          el.classList.add('thumb-failed');
          const label = el.querySelector('.thumb-label');
          if (label) label.textContent = `Page ${el.dataset.page} · preview failed`;
        }
      });
      pump();
    }
  }, { root: null, rootMargin: '200px' });

  for (let i = 1; i <= pdf.numPages; i++) {
    const card = document.createElement('div');
    card.className = 'thumb';
    card.dataset.page = String(i);
    card.dataset.index = String(i - 1);
    card.innerHTML = `<div class="thumb-ph"></div><div class="thumb-label">Page ${i}</div>`;
    if (onThumb) onThumb(card, i - 1);
    container.append(card);
    observer.observe(card);
  }

  grids.set(container, { observer, pdf });
  return { pdf, count: pdf.numPages };
}
