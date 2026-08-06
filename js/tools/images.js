import { registerTool } from '../app.js';
import { state, downloadBlob, showError, clearError, busy, baseName } from '../ui.js';

const ID = 'images';

const MAGIC = [
  ['png', [0x89, 0x50, 0x4e, 0x47]],
  ['jpg', [0xff, 0xd8, 0xff]],
];

async function decode(file) {
  try {
    return await createImageBitmap(file);
  } catch {
    // TIFF lands here — Chromium and Firefox both refuse it and the dropzone
    // accepts .tif — and so does anything corrupt.
    throw new Error('Could not be read. It may be damaged, or in a format your browser does not support.');
  }
}

/**
 * Sniff the content, never the extension: a JPEG named `.png` would reach
 * pdf-lib's embedPng and throw a raw parse error.
 */
async function toEmbeddable(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hit = MAGIC.find(([, sig]) => sig.every((b, i) => bytes[i] === b));
  // bmp, tif, webp and anything unrecognised: re-encode so pdf-lib can embed it.
  if (!hit) return flatten(file);
  // PNG and JPEG go through untouched, which keeps the file small and keeps a
  // PNG's alpha — but only once the browser has proved it can decode them.
  // pdf-lib's PNG decoder spins forever on a truncated PNG: a frozen tab, with
  // no rejection for any try/catch to see. Verified against a half-file PNG.
  (await decode(file)).close();
  return { bytes, type: hit[0] };
}

async function flatten(file) {
  const bitmap = await decode(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  // Pillow flattens alpha onto white; JPEG has no alpha, so do the same here.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
  // toBlob hands back null on failure; without this the next line throws a
  // TypeError that names nothing.
  if (!blob) throw new Error('Could not be encoded.');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'jpg' };
}

export function init() {
  const panel = document.getElementById(`panel-${ID}`);
  const body = panel.querySelector('.panel-body');
  body.innerHTML = `
    <div class="panel-toolbar">
      <button type="button" class="btn btn-primary" id="img-go">Create PDF</button>
    </div>
    <p class="panel-sub" id="img-status">No images loaded.</p>`;
  const status = body.querySelector('#img-status');

  body.querySelector('#img-go').addEventListener('click', async () => {
    clearError(ID);
    const files = state.images();
    if (!files.length) return showError(ID, 'Add at least one image first.');
    try {
      // Everything inside busy(), including the import and the file reads: any
      // work left outside it leaves the button live for a second click.
      const { count, failed } = await busy(panel, (async () => {
        const { imagesToPdf } = await import('../pdf-ops.js');
        const embeddable = [];
        const failed = [];
        for (const f of files) {
          // Per file, like the A4 panel: one TIFF in a batch of photos must
          // cost that one page, not the whole PDF.
          try { embeddable.push(await toEmbeddable(f)); }
          catch (err) { failed.push(`${f.name}: ${err.message}`); }
        }
        if (embeddable.length) {
          const bytes = await imagesToPdf(embeddable);
          downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${baseName(files[0])}.pdf`);
        }
        return { count: embeddable.length, failed };
      })());
      // Past tense: reports the run that just finished, so it cannot go stale.
      status.textContent = `Added ${count} of ${files.length} image${files.length === 1 ? '' : 's'}.`;
      if (failed.length) showError(ID, failed.join('\n'));
    } catch (err) {
      showError(ID, err.message);
    }
  });

  registerTool(ID, {
    // Batch panel: nothing here parses a document or describes one, so there is
    // no freshness problem for loadInto() to solve. Just the count.
    onFiles() {
      const n = state.images().length;
      status.textContent = n ? `Loaded: ${n} image${n === 1 ? '' : 's'}` : 'No images loaded.';
    },
  });
}
