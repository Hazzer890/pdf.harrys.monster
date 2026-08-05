import { PDFDocument, degrees } from '../vendor/pdf-lib.esm.min.js';

export const A4 = [595.276, 841.890];

export async function loadPdf(bytes) {
  try {
    return await PDFDocument.load(bytes);
  } catch (err) {
    const msg = String(err && err.message);
    if (msg.includes('is encrypted')) {
      throw new Error('This PDF is password-protected. Remove the password and try again.');
    }
    throw new Error('Could not read this PDF. The file may be corrupt.');
  }
}

/** Cut points are 0-indexed pages to cut *after*. Returns half-open ranges. */
export function splitRanges(pageCount, cutPoints) {
  const cuts = [...new Set(cutPoints)]
    .filter(c => Number.isInteger(c) && c >= 0 && c < pageCount - 1)
    .sort((a, b) => a - b);
  const ranges = [];
  let start = 0;
  for (const cut of cuts) {
    ranges.push([start, cut + 1]);
    start = cut + 1;
  }
  ranges.push([start, pageCount]);
  return ranges;
}

async function copyInto(target, source, indices) {
  const pages = await target.copyPages(source, indices);
  pages.forEach(p => target.addPage(p));
}

export async function mergePdfs(buffers) {
  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const doc = await loadPdf(buf);
    await copyInto(out, doc, doc.getPageIndices());
  }
  return out.save();
}

export async function splitPdf(buf, cutPoints, baseName = 'document') {
  const doc = await loadPdf(buf);
  const ranges = splitRanges(doc.getPageCount(), cutPoints);
  const parts = [];
  for (let i = 0; i < ranges.length; i++) {
    const [a, b] = ranges[i];
    const out = await PDFDocument.create();
    await copyInto(out, doc, Array.from({ length: b - a }, (_, k) => a + k));
    parts.push({
      name: `${baseName}_part_${i + 1}_pages_${a + 1}-${b}.pdf`,
      bytes: await out.save(),
    });
  }
  return parts;
}

export async function rotatePdf(buf, { angle, startPage, endPage }) {
  const doc = await loadPdf(buf);
  const count = doc.getPageCount();
  if (!(startPage >= 1 && endPage <= count && startPage <= endPage)) {
    throw new Error(`Page range must be between 1 and ${count}, with the start before the end.`);
  }
  for (let i = startPage - 1; i <= endPage - 1; i++) {
    const page = doc.getPage(i);
    page.setRotation(degrees((page.getRotation().angle + angle) % 360));
  }
  return doc.save();
}

export async function reorderPdf(buf, order) {
  const doc = await loadPdf(buf);
  const count = doc.getPageCount();
  const valid = order.length === count
    && new Set(order).size === count
    && order.every(i => Number.isInteger(i) && i >= 0 && i < count);
  if (!valid) throw new Error('Page order is invalid.');
  const out = await PDFDocument.create();
  await copyInto(out, doc, order);
  return out.save();
}

export async function resizeToA4(buf) {
  const doc = await loadPdf(buf);
  const out = await PDFDocument.create();
  for (const index of doc.getPageIndices()) {
    const page = out.addPage([...A4]);
    // embedPdf defers the real work to save(), so a page with no content
    // stream must be detected here rather than caught. A blank page in the
    // source becomes a blank A4 page instead of failing the whole document.
    if (!doc.getPage(index).node.Contents()) continue;
    const [emb] = await out.embedPdf(doc, [index]);
    const scale = Math.min(A4[0] / emb.width, A4[1] / emb.height);
    const w = emb.width * scale;
    const h = emb.height * scale;
    page.drawPage(emb, { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2, width: w, height: h });
  }
  return out.save();
}

export async function imagesToPdf(images) {
  const out = await PDFDocument.create();
  for (const img of images) {
    const emb = img.type === 'png'
      ? await out.embedPng(img.bytes)
      : await out.embedJpg(img.bytes);
    const page = out.addPage([emb.width, emb.height]);
    page.drawImage(emb, { x: 0, y: 0, width: emb.width, height: emb.height });
  }
  return out.save();
}

export async function rebuildFromImages(pages) {
  const out = await PDFDocument.create();
  for (const { jpegBytes, width, height } of pages) {
    const emb = await out.embedJpg(jpegBytes);
    const page = out.addPage([width, height]);
    page.drawImage(emb, { x: 0, y: 0, width, height });
  }
  return out.save();
}

/**
 * Map an axis-aligned rect in PDF user space to pdf-lib drawImage arguments,
 * compensating for the page's own /Rotate value.
 */
export function signaturePlacement({ rect, pageRotation }) {
  const r = (((pageRotation | 0) % 360) + 360) % 360;
  const { x, y, w, h } = rect;
  switch (r) {
    case 90:  return { x: x + w, y,         width: h, height: w, rotate: 90 };
    case 180: return { x: x + w, y: y + h,  width: w, height: h, rotate: 180 };
    case 270: return { x,        y: y + h,  width: h, height: w, rotate: 270 };
    default:  return { x,        y,         width: w, height: h, rotate: 0 };
  }
}

export async function stampSignature(buf, { pageIndex, pngBytes, rect }) {
  const doc = await loadPdf(buf);
  const page = doc.getPage(pageIndex);
  const img = await doc.embedPng(pngBytes);
  const p = signaturePlacement({ rect, pageRotation: page.getRotation().angle });
  page.drawImage(img, {
    x: p.x, y: p.y, width: p.width, height: p.height, rotate: degrees(p.rotate),
  });
  return doc.save();
}
