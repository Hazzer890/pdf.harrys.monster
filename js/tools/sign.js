import { registerTool } from '../app.js';
import { state, loadPdfjsDoc, loadInto, renderPageToCanvas, downloadBlob, showError, clearError, busy, baseName } from '../ui.js';

const ID = 'sign';
const SCALE = 1.2;
/** Longest side of a re-encoded upload. A phone photo of a signature is ~12 MP. */
const MAX_SIDE = 1600;

/**
 * Freehand pad. Returns PNG bytes cropped to the ink, with a transparent
 * background.
 *
 * The crop is what makes the locked aspect ratio on the overlay mean anything:
 * uncropped, every drawing would come back 480 × 150 and the box would be
 * mostly empty space that the user cannot size against.
 */
function makePad(canvas, onStroke) {
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111832';
  let drawing = false;
  let box = null; // [x0, y0, x1, y1] of the ink, in canvas pixels

  const pos = e => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width),
            (e.clientY - r.top) * (canvas.height / r.height)];
  };
  const mark = ([x, y]) => {
    const p = ctx.lineWidth; // the stroke is drawn either side of the point
    box = box
      ? [Math.min(box[0], x - p), Math.min(box[1], y - p), Math.max(box[2], x + p), Math.max(box[3], y + p)]
      : [x - p, y - p, x + p, y + p];
  };

  canvas.addEventListener('pointerdown', e => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    mark(p);
    ctx.beginPath();
    ctx.moveTo(...p);
    // A tap with no move must still leave a dot, and must still be a signature.
    ctx.lineTo(p[0] + 0.01, p[1]);
    ctx.stroke();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = pos(e);
    mark(p);
    ctx.lineTo(...p);
    ctx.stroke();
  });
  // pointercancel too: a browser gesture takeover ends the stroke without a
  // pointerup, which would otherwise leave the pad drawing on the next hover.
  ['pointerup', 'pointercancel'].forEach(ev => canvas.addEventListener(ev, () => {
    if (!drawing) return;
    drawing = false;
    onStroke();
  }));

  return {
    clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); box = null; },
    isDirty: () => box !== null,
    async png() {
      const x0 = Math.max(0, Math.floor(box[0]));
      const y0 = Math.max(0, Math.floor(box[1]));
      const w = Math.min(canvas.width, Math.ceil(box[2])) - x0;
      const h = Math.min(canvas.height, Math.ceil(box[3])) - y0;
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      out.getContext('2d').drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
      const blob = await new Promise(r => out.toBlob(r, 'image/png'));
      // toBlob hands back null on failure; without this the caller reads
      // .arrayBuffer() off null and throws a TypeError that names nothing.
      if (!blob) throw new Error('Could not read that signature.');
      return { bytes: new Uint8Array(await blob.arrayBuffer()), ratio: w / h };
    },
  };
}

/**
 * Any uploaded image in, PNG bytes out.
 *
 * `createImageBitmap` first, always: pdf-lib's PNG decoder spins forever on some
 * truncated PNGs — a synchronous spin, no rejection for any try/catch to see,
 * and it took out two browsers earlier in this project. Every other panel makes
 * its own PNGs; this is the only place a user's bytes reach `embedPng`.
 *
 * Re-encoding rather than sniffing the magic bytes settles the JPEG question
 * too: `stampSignature` calls `embedPng`, the extension lies often enough that
 * Task 7 had to sniff content, and a canvas round-trip means whatever the
 * browser could decode is a PNG by the time pdf-lib sees it. No white flatten —
 * a signature's transparency is the point of it.
 */
async function toPng(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Could not read that image. It may be damaged, or in a format your browser does not support.');
  }
  const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * k));
  canvas.height = Math.max(1, Math.round(bitmap.height * k));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Could not read that image.');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ratio: canvas.width / canvas.height };
}

export function init() {
  const panel = document.getElementById(`panel-${ID}`);
  const body = panel.querySelector('.panel-body');
  body.innerHTML = `
    <div class="panel-toolbar">
      <label>Page <input type="number" id="sg-page" min="1" value="1"></label>
      <button type="button" class="btn btn-ghost" id="sg-upload-btn">Upload image</button>
      <input type="file" id="sg-upload" accept="image/*" hidden>
      <button type="button" class="btn btn-ghost" id="sg-clear">Clear signature</button>
      <button type="button" class="btn btn-primary" id="sg-go">Apply and download</button>
    </div>
    <p class="panel-sub">
      Draw your signature below, or upload an image of one. Then drag it onto the
      page and pull the corner to resize. With it focused, the arrow keys move it
      (hold Shift for bigger steps) and + and − resize it.
    </p>
    <canvas class="sign-pad" id="sg-pad" width="480" height="150"></canvas>
    <div class="sign-stage" id="sg-stage"></div>
    <p class="panel-sub" id="sg-status">No PDF loaded.</p>`;

  const stage = body.querySelector('#sg-stage');
  const pageInput = body.querySelector('#sg-page');
  const status = body.querySelector('#sg-status');
  const upload = body.querySelector('#sg-upload');

  let viewport = null;   // of the page currently on the stage
  let sig = null;        // { bytes, ratio } — the one signature, drawn or uploaded
  let sigUrl = null;
  let overlay = null;

  /** The canvas size the overlay was last positioned against, in CSS pixels. */
  let lastBox = null;

  /**
   * Writes the overlay box, clamped inside the page canvas and locked to the
   * signature's own aspect ratio. Everything that moves or sizes the overlay
   * goes through here, so dragging off the page is impossible and a signature
   * cannot be squashed.
   */
  function place(left, top, w, h) {
    if (!overlay) return;
    const canvas = stage.querySelector('canvas');
    // The clamp needs a page with a layout box to clamp against; the size is
    // still written without one, so a zero-sized canvas cannot collapse the
    // overlay to nothing and lose the placement.
    if (canvas && canvas.clientWidth && canvas.clientHeight) {
      const maxW = canvas.clientWidth;
      const maxH = canvas.clientHeight;
      const k = Math.min(1, maxW / w, maxH / h); // shrink to fit; one factor, so the ratio survives
      w *= k;
      h *= k;
      left = Math.min(Math.max(0, left), maxW - w);
      top = Math.min(Math.max(0, top), maxH - h);
      lastBox = [maxW, maxH];
    }
    overlay.style.width = `${w}px`;
    overlay.style.height = `${h}px`;
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
  }

  /**
   * The overlay's current box relative to the page canvas, in fractional CSS
   * pixels: `[left, top, width, height]`.
   *
   * Not `offsetLeft`/`offsetWidth` — those are rounded to whole pixels, and
   * feeding a rounded height back into a ratio-locked resize loses a little of
   * the aspect ratio on every keypress. Measured: one `+` was enough to move
   * the ratio by 0.06 on a 5:1 signature.
   */
  function cur() {
    const canvas = stage.querySelector('canvas');
    const o = overlay.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    return [o.left - c.left, o.top - c.top, o.width, o.height];
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'sign-overlay';
    overlay.tabIndex = 0;
    // Placement is pointer-driven, so the keyboard path needs both a way in
    // (tabIndex) and a way to know what to press. WCAG 2.1.1.
    overlay.setAttribute('aria-label', 'Signature placement. Arrow keys move it, Shift for bigger steps, plus and minus resize it.');
    Object.assign(overlay.style, { left: '40px', top: '40px', width: '160px', height: '50px' });
    const img = document.createElement('img');
    img.alt = '';
    img.style.cssText = 'width:100%;height:100%;display:block;pointer-events:none';
    const handle = document.createElement('span');
    handle.className = 'sign-handle';
    overlay.append(img, handle);
    stage.append(overlay);

    let mode = null, sx = 0, sy = 0, ox = 0, oy = 0, ow = 0, oh = 0;
    const start = (e, m) => {
      mode = m; sx = e.clientX; sy = e.clientY;
      [ox, oy, ow, oh] = cur();
      overlay.setPointerCapture(e.pointerId);
      e.preventDefault(); e.stopPropagation();
      // preventDefault above suppresses the focus a click would normally give a
      // tabindex="0" element, so without this the arrow keys scroll the page
      // instead of nudging a signature the user has just clicked on — while the
      // panel copy tells them focusing it is what makes the arrows work.
      overlay.focus();
    };
    overlay.addEventListener('pointerdown', e => start(e, 'move'));
    handle.addEventListener('pointerdown', e => start(e, 'resize'));
    overlay.addEventListener('pointermove', e => {
      if (!mode) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (mode === 'move') place(ox + dx, oy + dy, ow, oh);
      // The width leads and the height follows the signature's ratio: a corner
      // dragged off the diagonal would otherwise stretch the handwriting.
      else { const w = Math.max(24, ow + dx); place(ox, oy, w, w / ratio()); }
    });
    ['pointerup', 'pointercancel'].forEach(ev => overlay.addEventListener(ev, () => { mode = null; }));

    overlay.addEventListener('keydown', e => {
      const step = e.shiftKey ? 10 : 1;
      const [l, t, w, h] = cur();
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) place(l + d[0], t + d[1], w, h);
      // '_' is what Shift+minus reports on a US layout, so without it the
      // documented "Shift for bigger steps" grows but cannot shrink.
      else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
        const shrink = e.key === '-' || e.key === '_';
        const next = Math.max(24, w + (shrink ? -4 * step : 4 * step));
        place(l, t, next, next / ratio());
      } else return;
      e.preventDefault();
    });
    return overlay;
  }

  const ratio = () => (sig ? sig.ratio : 3);

  // The preview is responsive, so a window resize or a phone rotation changes
  // how many CSS pixels the page occupies — and the overlay's position is in
  // CSS pixels. Without this, resizing after placing silently moves the
  // signature to a different part of the page. Scale it with the canvas.
  //
  // A page change does not trip this: mount() calls place(), which records the
  // new size, before the observer's callback runs.
  new ResizeObserver(() => {
    const canvas = stage.querySelector('canvas');
    if (!overlay || !canvas || !lastBox || !canvas.clientWidth || !canvas.clientHeight) return;
    const [pw, ph] = lastBox;
    if (pw === canvas.clientWidth && ph === canvas.clientHeight) return;
    const k = canvas.clientWidth / pw;
    const [l, t, w, h] = cur();
    place(l * k, t * (canvas.clientHeight / ph), w * k, h * k);
  }).observe(stage);

  /**
   * Puts the current signature on the page, if there is a page to put it on.
   * Nothing is shown before a PDF loads: an overlay in an empty stage has
   * nothing to be positioned against and would float over the text below it.
   */
  function paint() {
    if (!sig || !stage.querySelector('canvas')) return;
    const el = ensureOverlay();
    el.querySelector('img').src = sigUrl;
    const [l, t, w] = cur();
    place(l, t, w, w / sig.ratio);
  }

  function setSignature(next) {
    if (sigUrl) URL.revokeObjectURL(sigUrl); // one per stroke otherwise, and the pad fires a lot
    sig = next;
    sigUrl = URL.createObjectURL(new Blob([next.bytes], { type: 'image/png' }));
    paint();
  }

  function clearSignature() {
    if (sigUrl) URL.revokeObjectURL(sigUrl);
    sigUrl = null;
    sig = null;
    pad.clear();
    if (overlay) { overlay.remove(); overlay = null; }
  }

  const pad = makePad(body.querySelector('#sg-pad'), () => {
    // Drawing replaces an upload and an upload clears the pad, so there is only
    // ever one signature and it is the last thing the user did.
    pad.png().then(setSignature).catch(err => showError(ID, err.message));
  });

  body.querySelector('#sg-clear').addEventListener('click', clearSignature);
  body.querySelector('#sg-upload-btn').addEventListener('click', () => upload.click());
  // reset value, or re-picking the same file after Clear fires no change event
  upload.addEventListener('change', async () => {
    const f = upload.files[0];
    upload.value = '';
    if (!f) return;
    clearError(ID);
    try {
      const next = await busy(panel, toPng(f));
      pad.clear();
      setSignature(next);
    } catch (err) {
      showError(ID, err.message);
    }
  });

  /** Renders one page, and owns the document it opens for it. */
  async function renderPage(file, n) {
    const doc = await loadPdfjsDoc(file);
    try {
      const count = doc.numPages;
      if (!count) throw new Error('This PDF has no pages to sign.');
      const page = Math.min(Math.max(1, Math.round(Number(n) || 1)), count);
      const { canvas, viewport: vp } = await renderPageToCanvas(doc, page, SCALE);
      return { count, page, canvas, viewport: vp };
    } finally {
      // We loaded it, so we own it, on every path out. This pdf.js build has no
      // PDFDocumentProxy.destroy(); teardown is on the loading task.
      doc.loadingTask.destroy().catch(() => {});
    }
  }

  function mount(r) {
    viewport = r.viewport;
    pageInput.max = r.count;
    pageInput.value = r.page;
    const old = stage.querySelector('canvas');
    // Release the backing store now rather than waiting for GC; a full-page
    // render at 1.2 is a few megabytes and page changes make one each time.
    if (old) { old.width = old.height = 0; old.remove(); }
    stage.prepend(r.canvas);
    // The signature is the user's, not the document's, so it survives a page or
    // file change — but the new page may be smaller, so it goes back through the
    // clamp. This is also where a signature drawn before any PDF was loaded
    // first appears.
    if (overlay) overlay.hidden = false;   // a page is mounted again; see reset()
    paint();
  }

  let pageGen = 0;
  pageInput.addEventListener('change', async () => {
    const file = state.pdfs()[0] || null;
    if (!file) return;
    clearError(ID);
    const mine = ++pageGen;
    try {
      const r = await busy(panel, renderPage(file, pageInput.value));
      // a newer page change, or a different file, took the stage while this rendered
      if (mine !== pageGen || file !== state.pdfs()[0]) return;
      mount(r);
    } catch (err) {
      showError(ID, err.message);
    }
  });

  /**
   * The overlay box in PDF user space.
   *
   * Two corrections, and both are load-bearing. `getBoundingClientRect` is CSS
   * pixels and the canvas is displayed at `max-width: 100%`, so on a narrow
   * screen it is smaller than it was rendered — scale by `canvas.width /
   * rect.width` to get viewport units, the same correction the pad's `pos()`
   * does. Then `convertToPdfPoint` undoes the preview scale and the page's
   * `/Rotate`, and returns *absolute* user-space coordinates, MediaBox origin
   * included, which is the same space `page.drawImage` draws in.
   *
   * Two opposite corners, and either diagonal would do: every rotation here is
   * a multiple of 90, so opposite corners stay opposite and the min/abs below
   * recovers the axis-aligned box whichever way round they come out.
   */
  function overlayRect(canvas) {
    const c = canvas.getBoundingClientRect();
    const o = overlay.getBoundingClientRect();
    const k = canvas.width / c.width;
    const [ax, ay] = viewport.convertToPdfPoint((o.left - c.left) * k, (o.bottom - c.top) * k);
    const [bx, by] = viewport.convertToPdfPoint((o.right - c.left) * k, (o.top - c.top) * k);
    return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  }

  body.querySelector('#sg-go').addEventListener('click', async () => {
    clearError(ID);
    // Read the file at click time: loadInto owns the current one and a
    // panel-level copy can drift from it.
    const file = state.pdfs()[0] || null;
    if (!file) return showError(ID, 'Add a PDF first.');
    if (!sig) return showError(ID, 'Draw or upload a signature first.');
    const canvas = stage.querySelector('canvas');
    if (!canvas || !viewport || !overlay) return showError(ID, 'Wait for the page preview to load.');
    // Measure before busy(), so the numbers are the ones the user is looking at.
    const rect = overlayRect(canvas);
    const pageIndex = Number(pageInput.value) - 1;
    const pngBytes = sig.bytes;
    try {
      // Everything inside busy(), including the import and the file read: work
      // left outside it leaves the button live for a second click.
      const bytes = await busy(panel, (async () => {
        const { stampSignature } = await import('../pdf-ops.js');
        return stampSignature(new Uint8Array(await file.arrayBuffer()), { pageIndex, pngBytes, rect });
      })());
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${baseName(file)}_signed.pdf`);
    } catch (err) {
      showError(ID, err.message);
    }
  });

  let pending = null;
  registerTool(ID, {
    onFiles: loadInto(ID, {
      status,
      reset() {
        viewport = null;
        pageInput.value = 1;
        pageInput.removeAttribute('max');
        const old = stage.querySelector('canvas');
        if (old) { old.width = old.height = 0; old.remove(); }
        // A load that never got mounted still parked its canvas here, so on
        // removal the backing store outlived the document it came from.
        if (pending) { pending.r.canvas.width = pending.r.canvas.height = 0; pending = null; }
        // The signature and its overlay are user state, not a description of
        // the document, so they survive a file change as well as a tool switch.
        // They are hidden while no page is mounted, though: an overlay floating
        // in an empty stage after a failed load reads as broken, and Apply
        // refuses in that state anyway.
        if (overlay) overlay.hidden = true;
      },
      async load(f) {
        const r = await renderPage(f, 1);
        pending = { f, r };
        return { count: r.count };
      },
      apply() {
        // Two loads can be in flight; only mount the one for the selected file.
        if (pending && pending.f === state.pdfs()[0]) mount(pending.r);
      },
    }),
  });
}
