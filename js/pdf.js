// Minimal PDF writer: pages of JPEG images, hand-rolled so the app needs no
// third-party libraries. Sizes are in PDF points (1/72 inch).

export const PAGE_SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

const A4_W = PAGE_SIZES.a4[0];
const A4_H = PAGE_SIZES.a4[1];
const MARGIN = 42; // ~15 mm
const GAP = 28;

const enc = new TextEncoder();

/**
 * Write a PDF from pages of placed JPEG images.
 * @param {{width: number, height: number,
 *          items: {image: number, x: number, y: number, w: number, h: number}[]}[]} pages
 *   `y` is measured from the bottom of the page, as in PDF.
 * @param {{jpeg: Uint8Array, width: number, height: number}[]} images
 * @returns {Blob} application/pdf
 */
export function writePdf(pages, images) {
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (chunk) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const startObj = (n) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
  };

  // Object numbers: 1 catalog, 2 pages, then images, then (page, content) pairs.
  const imageObj = (i) => 3 + i;
  const pageObj = (p) => 3 + images.length + p * 2;
  const n = (v) => Number(v.toFixed(2));

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  startObj(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObj(2);
  push(`<< /Type /Pages /Kids [${pages.map((_, p) => `${pageObj(p)} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`);

  images.forEach((img, i) => {
    startObj(imageObj(i));
    push(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`);
    push(img.jpeg);
    push('\nendstream\nendobj\n');
  });

  pages.forEach((page, p) => {
    const used = [...new Set(page.items.map((it) => it.image))];
    const xobjects = used.map((i) => `/Im${i} ${imageObj(i)} 0 R`).join(' ');
    const content = page.items
      .map((it) => `q ${n(it.w)} 0 0 ${n(it.h)} ${n(it.x)} ${n(it.y)} cm /Im${it.image} Do Q\n`)
      .join('');
    startObj(pageObj(p));
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] ` +
      `/Resources << /XObject << ${xobjects} >> >> /Contents ${pageObj(p) + 1} 0 R >>\nendobj\n`);
    startObj(pageObj(p) + 1);
    push(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);
  });

  const count = 3 + images.length + pages.length * 2;
  const xref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

/** Scale `w`×`h` to fit inside `boxW`×`boxH`, keeping the aspect ratio. */
export function fit(w, h, boxW, boxH) {
  const s = Math.min(boxW / w, boxH / h);
  return { w: w * s, h: h * s };
}

/**
 * One A4 page with up to two images stacked vertically (IC front + back).
 * @param {{jpeg: Uint8Array, width: number, height: number}[]} images
 */
export function buildPdf(images) {
  const slots = images.length || 1;
  const boxW = A4_W - MARGIN * 2;
  const boxH = (A4_H - MARGIN * 2 - GAP * (slots - 1)) / slots;
  const items = images.map((img, i) => {
    const { w, h } = fit(img.width, img.height, boxW, boxH);
    const top = A4_H - MARGIN - i * (boxH + GAP);
    return { image: i, w, h, x: (A4_W - w) / 2, y: top - (boxH + h) / 2 };
  });
  return writePdf([{ width: A4_W, height: A4_H, items }], images);
}
