import { PDFDocument, degrees } from '../vendor/pdf-lib.esm.min.js';

export const A4 = [595.276, 841.890];

/**
 * True when the bytes do not end in a PDF trailer.
 *
 * A file cut short does not always fail: pdf-lib's recovery parser walks
 * whatever objects survived and hands back a **valid document with fewer
 * pages** and no error at all, so the user merges five pages and gets two.
 * Nothing downstream can notice — the repaired catalog is internally
 * consistent. The raw bytes can. Measured on a 5-page document truncated to
 * 20% and 30%: loaded clean, 1 page and 2 pages, no error, `%%EOF` absent in
 * both. Against 91 real PDFs from a downloads folder, every one carries
 * `%%EOF` inside its last 1024 bytes — the same window pdf.js scans back for
 * `startxref` — so this costs no working file.
 *
 * A heuristic, not a proof: a file truncated mid-way through an incremental
 * update can still show an older `%%EOF` in that window.
 *
 * There is a second copy of this in `ui.js`, because the pdf.js tools never
 * touch this module and importing this one for it would pull 674 KB of pdf-lib
 * into the initial page load. Change both.
 */
export function looksTruncated(bytes) {
  if (!ArrayBuffer.isView(bytes) || bytes.length < 5) return false;
  const dec = new TextDecoder('latin1');
  // Only meaningful for something that is a PDF at all. Random bytes belong in
  // the generic "could not read" path — telling someone to download a JPEG
  // again because its PDF trailer is missing helps nobody.
  if (!dec.decode(bytes.subarray(0, 5)).startsWith('%PDF')) return false;
  return !dec.decode(bytes.subarray(Math.max(0, bytes.length - 1024))).includes('%%EOF');
}

export async function loadPdf(bytes) {
  // Outside the try: this message must survive, not be flattened into the
  // generic "may be corrupt" line, because the fix is a different one.
  if (looksTruncated(bytes)) {
    throw new Error('This PDF is incomplete or damaged — the end of the file is missing, so pages would be lost. Download or copy it again.');
  }
  try {
    const doc = await PDFDocument.load(bytes);
    // A file with a %PDF header but no catalog loads without complaint and only
    // fails later, deep in an op, with a raw "reading 'Pages'" TypeError. Touch
    // the page tree here so that lands in the catch below like any other
    // unreadable file. Every op goes through loadPdf, so one check covers all.
    doc.getPageCount();
    return doc;
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
  // DOM inputs hand back strings, so '2' must be coerced to be honoured. But a
  // cleared input is '' and Number('') is 0 — a legal cut point — so blanks are
  // left as-is for the integer filter below to drop, along with every non-string.
  const toCut = c => (typeof c === 'string' && c.trim() !== '' ? Number(c) : c);
  const cuts = [...new Set([...cutPoints].map(toCut))]
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
  // DOM inputs hand back strings. Untreated, `angle` concatenates instead of
  // adding ('90' onto a 90 page gives 90, not 180) and a fractional page index
  // slips past the guard into a raw pdf-lib crash.
  const deg = Number(angle);
  const from = Number(startPage);
  const to = Number(endPage);
  if (!Number.isInteger(deg) || deg % 90 !== 0) {
    throw new Error('Rotation must be a whole number of degrees, in multiples of 90.');
  }
  const doc = await loadPdf(buf);
  const count = doc.getPageCount();
  const validRange = Number.isInteger(from) && Number.isInteger(to)
    && from >= 1 && to <= count && from <= to;
  if (!validRange) {
    throw new Error(`Page range must be between 1 and ${count}, with the start before the end.`);
  }
  for (let i = from - 1; i <= to - 1; i++) {
    const page = doc.getPage(i);
    // Normalise to [0, 360): JS % keeps the left operand's sign, and a
    // malformed PDF can carry a negative /Rotate. Matches signaturePlacement.
    const sum = page.getRotation().angle + deg;
    page.setRotation(degrees(((sum % 360) + 360) % 360));
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
  const count = doc.getPageCount();
  // getPage() out of range throws a raw pdf-lib message naming an internal
  // type. Every caller reaches the page tree through here, so guard once.
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= count) {
    throw new Error(`Page must be between 1 and ${count}.`);
  }
  const page = doc.getPage(pageIndex);
  const img = await doc.embedPng(pngBytes);
  const p = signaturePlacement({ rect, pageRotation: page.getRotation().angle });
  page.drawImage(img, {
    x: p.x, y: p.y, width: p.width, height: p.height, rotate: degrees(p.rotate),
  });
  return doc.save();
}
