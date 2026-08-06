import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, degrees } from '../vendor/pdf-lib.esm.min.js';
import {
  loadPdf, splitRanges, mergePdfs, splitPdf, rotatePdf, reorderPdf,
  resizeToA4, signaturePlacement, stampSignature, A4,
} from '../js/pdf-ops.js';

async function makePdf(pageCount, size = [400, 600]) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage(size);
  return doc.save();
}

/** Distinct page widths make "which page went where" observable. */
async function makePdfWithWidths(widths) {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 500]);
  return doc.save();
}

async function widthsOf(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map(p => Math.round(p.getWidth()));
}

test('splitRanges cuts after the given 0-indexed pages', () => {
  assert.deepEqual(splitRanges(5, [0, 2]), [[0, 1], [1, 3], [3, 5]]);
});

test('splitRanges with no cuts returns one whole range', () => {
  assert.deepEqual(splitRanges(4, []), [[0, 4]]);
});

test('splitRanges ignores duplicates and out-of-bounds cuts', () => {
  assert.deepEqual(splitRanges(3, [1, 1, 2, 99, -1]), [[0, 2], [2, 3]]);
});

test('splitRanges honours cut points arriving as strings from a DOM input', () => {
  assert.deepEqual(splitRanges(5, ['0', '2']), [[0, 1], [1, 3], [3, 5]]);
  assert.deepEqual(splitRanges(3, ['1', 1]), [[0, 2], [2, 3]]);   // '1' and 1 are one cut
});

test('splitRanges ignores a blank cut point rather than reading it as 0', () => {
  // Number('') is 0, which is a legal cut point — a cleared DOM input must not
  // silently insert a cut after page 1.
  assert.deepEqual(splitRanges(5, ['', 2]), splitRanges(5, [2]));
  assert.deepEqual(splitRanges(5, ['', 2]), [[0, 3], [3, 5]]);
  assert.deepEqual(splitRanges(5, ['  ', null, undefined, NaN, 'abc']), [[0, 5]]);
});

test('splitPdf produces parts of the right sizes and names', async () => {
  const src = await makePdfWithWidths([100, 200, 300, 400, 500]);
  const parts = await splitPdf(src, [0, 2], 'doc');
  assert.equal(parts.length, 3);
  // Widths, not just counts: a part copying the wrong page window has the
  // right size but the wrong pages in it.
  const widths = [];
  for (const p of parts) widths.push(await widthsOf(p.bytes));
  assert.deepEqual(widths, [[100], [200, 300], [400, 500]]);
  assert.equal(parts[0].name, 'doc_part_1_pages_1-1.pdf');
  assert.equal(parts[1].name, 'doc_part_2_pages_2-3.pdf');
  assert.equal(parts[2].name, 'doc_part_3_pages_4-5.pdf');
});

test('mergePdfs concatenates the inputs in order', async () => {
  const out = await mergePdfs([
    await makePdfWithWidths([100, 200]),
    await makePdfWithWidths([300, 400, 500]),
  ]);
  assert.equal((await PDFDocument.load(out)).getPageCount(), 5);
  assert.deepEqual(await widthsOf(out), [100, 200, 300, 400, 500]);
});

test('reorderPdf permutes rather than copying in order', async () => {
  // Pages get distinct widths so the permutation is observable.
  const doc = await PDFDocument.create();
  [100, 200, 300].forEach(w => doc.addPage([w, 500]));
  const out = await reorderPdf(await doc.save(), [2, 0, 1]);
  const widths = (await PDFDocument.load(out)).getPages().map(p => Math.round(p.getWidth()));
  assert.deepEqual(widths, [300, 100, 200]);
});

test('reorderPdf rejects an incomplete permutation', async () => {
  const bytes = await makePdf(3);
  await assert.rejects(() => reorderPdf(bytes, [0, 1]));
});

test('rotatePdf composes with existing rotation and respects the range', async () => {
  const doc = await PDFDocument.create();
  [0, 1, 2].forEach(() => doc.addPage([400, 600]));
  doc.getPage(1).setRotation(degrees(90));
  const out = await rotatePdf(await doc.save(), { angle: 90, startPage: 2, endPage: 3 });
  const angles = (await PDFDocument.load(out)).getPages().map(p => p.getRotation().angle);
  assert.deepEqual(angles, [0, 180, 90]);
});

test('rotatePdf wraps past 360', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 600]);
  doc.getPage(0).setRotation(degrees(270));
  const out = await rotatePdf(await doc.save(), { angle: 180, startPage: 1, endPage: 1 });
  assert.equal((await PDFDocument.load(out)).getPage(0).getRotation().angle, 90);
});

test('rotatePdf normalises a negative existing rotation to zero', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 600]);
  doc.getPage(0).setRotation(degrees(-90));
  const out = await rotatePdf(await doc.save(), { angle: 90, startPage: 1, endPage: 1 });
  assert.equal((await PDFDocument.load(out)).getPage(0).getRotation().angle, 0);
});

test('rotatePdf never emits a negative rotation', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 600]);
  doc.getPage(0).setRotation(degrees(-270));
  const out = await rotatePdf(await doc.save(), { angle: 90, startPage: 1, endPage: 1 });
  const { angle } = (await PDFDocument.load(out)).getPage(0).getRotation();
  assert.equal(angle, 180);            // -270 + 90 = -180 -> 180
  assert.ok(angle >= 0 && angle < 360, `rotation ${angle} outside [0, 360)`);
});

test('rotatePdf rejects an invalid range', async () => {
  const bytes = await makePdf(3);
  await assert.rejects(() => rotatePdf(bytes, { angle: 90, startPage: 3, endPage: 1 }));
  await assert.rejects(() => rotatePdf(bytes, { angle: 90, startPage: 1, endPage: 9 }));
});

test('rotatePdf adds a string angle instead of concatenating it', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 600]);
  doc.getPage(0).setRotation(degrees(90));
  // Uncoerced, 90 + '90' is '9090', and '9090' % 360 is 90 — silently wrong.
  const out = await rotatePdf(await doc.save(), { angle: '90', startPage: '1', endPage: '1' });
  assert.equal((await PDFDocument.load(out)).getPage(0).getRotation().angle, 180);
});

test('rotatePdf rejects an angle that is not a whole multiple of 90', async () => {
  const bytes = await makePdf(3);
  for (const angle of [45, 90.5, 'abc', undefined]) {
    await assert.rejects(() => rotatePdf(bytes, { angle, startPage: 1, endPage: 1 }),
      /multiples of 90/, `angle ${String(angle)} should be rejected`);
  }
});

test('rotatePdf rejects a fractional page number with the range message', async () => {
  const bytes = await makePdf(3);
  // 1.5 slips past a bare `>= 1` guard and dies inside pdf-lib on getPage(0.5).
  await assert.rejects(() => rotatePdf(bytes, { angle: 90, startPage: 1.5, endPage: 2 }),
    /Page range must be between 1 and 3/);
  await assert.rejects(() => rotatePdf(bytes, { angle: 90, startPage: 1, endPage: 2.5 }),
    /Page range must be between 1 and 3/);
});

test('resizeToA4 produces A4 pages from any input size', async () => {
  const doc = await PDFDocument.create();
  // Pages need a content stream to be embeddable, so draw something.
  for (const size of [[200, 200], [1200, 400]]) {
    doc.addPage(size).drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
  }
  const out = await resizeToA4(await doc.save());
  for (const page of (await PDFDocument.load(out)).getPages()) {
    assert.equal(Math.round(page.getWidth()), Math.round(A4[0]));
    assert.equal(Math.round(page.getHeight()), Math.round(A4[1]));
    // Right page size but no content is exactly how a resize tool fails.
    const contents = page.node.Contents();
    assert.ok(contents && contents.size() > 0,
      'resized page has no /Contents — the source page was never embedded');
  }
});

test('resizeToA4 keeps a contentless page as a blank A4 page', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);                                    // no content stream
  doc.addPage([300, 300]).drawRectangle({ x: 5, y: 5, width: 20, height: 20 });
  const out = await resizeToA4(await doc.save());
  const pages = (await PDFDocument.load(out)).getPages();
  assert.equal(pages.length, 2);
  assert.equal(Math.round(pages[0].getWidth()), Math.round(A4[0]));
  // The blank page stays blank, and the drawn one is still distinguishable
  // from it — otherwise "keeps it blank" would also pass for "drops everything".
  assert.ok(!pages[0].node.Contents(), 'the contentless page gained content');
  assert.ok(pages[1].node.Contents()?.size() > 0, 'the drawn page lost its content');
});

test('signaturePlacement passes an unrotated page straight through', () => {
  const r = signaturePlacement({ rect: { x: 10, y: 20, w: 100, h: 50 }, pageRotation: 0 });
  assert.deepEqual(r, { x: 10, y: 20, width: 100, height: 50, rotate: 0 });
});

test('signaturePlacement offsets the origin for each page rotation', () => {
  const rect = { x: 10, y: 20, w: 100, h: 50 };
  assert.deepEqual(signaturePlacement({ rect, pageRotation: 90 }),
    { x: 110, y: 20, width: 50, height: 100, rotate: 90 });
  assert.deepEqual(signaturePlacement({ rect, pageRotation: 180 }),
    { x: 110, y: 70, width: 100, height: 50, rotate: 180 });
  assert.deepEqual(signaturePlacement({ rect, pageRotation: 270 }),
    { x: 10, y: 70, width: 50, height: 100, rotate: 270 });
});

test('signaturePlacement normalises negative and oversized rotations', () => {
  const rect = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(signaturePlacement({ rect, pageRotation: -90 }).rotate, 270);
  assert.equal(signaturePlacement({ rect, pageRotation: 450 }).rotate, 90);
});

test('stampSignature rejects an out-of-range page in plain language', async () => {
  // Unguarded, getPage() throws a raw pdf-lib message naming an internal type.
  // The guard runs before embedPng, so the PNG bytes are never reached.
  const buf = await makePdf(2);
  await assert.rejects(() => stampSignature(buf, { pageIndex: 2, pngBytes: new Uint8Array(), rect: {} }),
    /Page must be between 1 and 2\./);
  await assert.rejects(() => stampSignature(buf, { pageIndex: -1, pngBytes: new Uint8Array(), rect: {} }),
    /Page must be between 1 and 2\./);
  await assert.rejects(() => stampSignature(buf, { pageIndex: 0.5, pngBytes: new Uint8Array(), rect: {} }),
    /Page must be between 1 and 2\./);
});

test('loadPdf reports unreadable input in plain language', async () => {
  await assert.rejects(() => loadPdf(new Uint8Array([1, 2, 3])), /corrupt|read/i);
});

test('loadPdf reports a file that parses but has no page tree', async () => {
  // A distinct branch from the test above: PDFDocument.load ACCEPTS this file
  // and the failure only surfaces when the page tree is touched. Without the
  // getPageCount() check in loadPdf this rejects with a raw
  // "this.catalog.Pages is not a function" instead of the friendly message.
  const body = [
    '%PDF-1.4',
    '1 0 obj<</Type/NotACatalog>>endobj',
    'trailer<</Root 1 0 R/Size 2>>',
    '%%EOF',
  ].join('\n');
  await assert.rejects(
    () => loadPdf(new TextEncoder().encode(body)),
    /corrupt|read/i,
  );
});
