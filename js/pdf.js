// Minimal PDF writer: one A4 page with up to two JPEG images stacked
// vertically. Hand-rolled so the app needs no third-party libraries.

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 42; // ~15 mm
const GAP = 28;

const enc = new TextEncoder();

/**
 * @param {{jpeg: Uint8Array, width: number, height: number}[]} images
 * @returns {Blob} application/pdf
 */
export function buildPdf(images) {
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

  // Each image gets an equal share of the printable height.
  const slots = images.length || 1;
  const boxW = A4_W - MARGIN * 2;
  const boxH = (A4_H - MARGIN * 2 - GAP * (slots - 1)) / slots;
  let content = '';
  images.forEach((img, i) => {
    const s = Math.min(boxW / img.width, boxH / img.height);
    const w = img.width * s;
    const h = img.height * s;
    const x = (A4_W - w) / 2;
    const top = A4_H - MARGIN - i * (boxH + GAP);
    const y = top - (boxH + h) / 2;
    content += `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${i} Do Q\n`;
  });

  // Object numbers: 1 catalog, 2 pages, 3 page, 4 content, 5.. images.
  const xobjects = images.map((_, i) => `/Im${i} ${5 + i} 0 R`).join(' ');
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  startObj(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObj(2);
  push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  startObj(3);
  push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] ` +
    `/Resources << /XObject << ${xobjects} >> >> /Contents 4 0 R >>\nendobj\n`);
  startObj(4);
  push(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);
  images.forEach((img, i) => {
    startObj(5 + i);
    push(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`);
    push(img.jpeg);
    push('\nendstream\nendobj\n');
  });

  const count = 5 + images.length;
  const xref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
