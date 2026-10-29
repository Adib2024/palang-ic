// Lay out the model from office-read.js onto PDF pages with pdf-lib, using
// the self-hosted fonts (Arimo ≈ Arial, Tinos ≈ Times; regular/bold, italic
// drawn slanted). Word: paragraphs, headings, lists, tables, pictures,
// page breaks. Excel: each sheet as a grid, fitted to the page width.
import { loadPdfLib } from './pdf-kit.js';
import { pdfFont } from './fonts.js';

const SERIF = /times|georgia|cambria|garamond|book|serif|palatino|minion/i;
const HEADING_SIZE = { 0: 26, 1: 16, 2: 13, 3: 12, 4: 11, 5: 11, 6: 11 };
const hex = (L, h) => (h && h !== '000000' && h !== 'auto' ? L.rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255) : L.rgb(0, 0, 0));

/** Characters the bundled Latin fonts can't draw become '?' (no blank boxes). */
const SAFE = /[^\u0009\u000a -ɏˆ-˜Ḁ-ỿ‐-‧‰-›€™←-↓−•]/g;

class Writer {
  constructor(L, doc, page) {
    this.L = L;
    this.doc = doc;
    this.size = page;
    this.page = null;
    this.y = 0;
  }

  newPage() {
    this.page = this.doc.addPage([this.size.w, this.size.h]);
    this.y = this.size.h - this.size.top;
  }

  get bottom() { return this.size.bottom; }

  /** Make room for `h` points; returns false if a fresh page still can't hold it. */
  need(h) {
    if (!this.page) this.newPage();
    if (this.y - h < this.bottom) {
      const fresh = this.y >= this.size.h - this.size.top - 0.5;
      if (!fresh) this.newPage();
      return h <= this.size.h - this.size.top - this.bottom;
    }
    return true;
  }
}

async function fontFor(L, doc, run) {
  const id = SERIF.test(run.font || '') ? 'tinos' : 'arimo';
  return (await pdfFont(L, doc, id, !!run.bold)).font;
}

/** Break styled runs into lines of at most `width` points. */
async function lines(L, doc, runs, width, scale = 1) {
  const pieces = [];
  for (const r of runs) {
    const font = await fontFor(L, doc, r);
    const size = (r.vert === 'superscript' || r.vert === 'subscript' ? r.size * 0.65 : r.size) * scale;
    for (const part of r.text.replace(SAFE, '?').split(/(\n| +)/)) {
      if (part === '') continue;
      pieces.push({ text: part, font, size, run: r, w: part === '\n' ? 0 : font.widthOfTextAtSize(part, size) });
    }
  }
  const out = [];
  let line = [];
  let w = 0;
  const push = () => {
    while (line.length && /^ +$/.test(line[line.length - 1].text)) w -= line.pop().w;
    out.push({ items: line, width: w, height: Math.max(...line.map((p) => p.size), runs[0] ? runs[0].size * scale : 11) });
    line = [];
    w = 0;
  };
  for (const p of pieces) {
    if (p.text === '\n') { push(); continue; }
    if (!line.length && /^ +$/.test(p.text)) continue;
    if (w + p.w > width && line.length) {
      push();
      if (/^ +$/.test(p.text)) continue;
    }
    if (p.w > width) {
      // A single long word: split it by characters.
      let chunk = '';
      for (const ch of p.text) {
        const cw = p.font.widthOfTextAtSize(chunk + ch, p.size);
        if (w + cw > width && (chunk || line.length)) {
          if (chunk) { line.push({ ...p, text: chunk, w: p.font.widthOfTextAtSize(chunk, p.size) }); w += line[line.length - 1].w; }
          push();
          chunk = ch;
        } else chunk += ch;
      }
      if (chunk) { const cw = p.font.widthOfTextAtSize(chunk, p.size); line.push({ ...p, text: chunk, w: cw }); w += cw; }
      continue;
    }
    line.push(p);
    w += p.w;
  }
  if (line.length || !out.length) push();
  return out;
}

function drawLine(L, page, ln, x, baseline, width, align, last) {
  let dx = 0;
  let gap = 0;
  if (align === 'center') dx = (width - ln.width) / 2;
  else if (align === 'right') dx = width - ln.width;
  else if (align === 'justify' && !last) {
    const spaces = ln.items.filter((p) => /^ +$/.test(p.text)).length;
    if (spaces) gap = (width - ln.width) / spaces;
  }
  let cx = x + Math.max(0, dx);
  // Neighbouring pieces in the same style are drawn as one string (spaces
  // included) so the text copies and searches as words, not single tokens.
  const segs = [];
  for (const p of ln.items) {
    const prev = segs[segs.length - 1];
    if (prev && !gap && prev.run === p.run && prev.font === p.font && prev.size === p.size) {
      prev.text += p.text;
      prev.w += p.w;
    } else if (gap && prev && /^ +$/.test(p.text)) {
      // Justified: keep the space inside the word before it, then stretch.
      prev.text += p.text;
      prev.w += p.w;
      prev.extra = (prev.extra || 0) + gap;
    } else segs.push({ ...p });
  }
  for (const p of segs) {
    const r = p.run;
    const y = baseline + (r.vert === 'superscript' ? p.size * 0.6 : r.vert === 'subscript' ? -p.size * 0.15 : 0);
    const color = hex(L, r.color);
    page.drawText(p.text, { x: cx, y, size: p.size, font: p.font, color, ySkew: r.italic ? L.degrees(12) : undefined });
    if (r.underline) page.drawLine({ start: { x: cx, y: y - p.size * 0.12 }, end: { x: cx + p.w, y: y - p.size * 0.12 }, thickness: Math.max(0.5, p.size / 18), color });
    if (r.strike) page.drawLine({ start: { x: cx, y: y + p.size * 0.3 }, end: { x: cx + p.w, y: y + p.size * 0.3 }, thickness: Math.max(0.5, p.size / 18), color });
    cx += p.w + (p.extra || 0);
  }
}

/** Paragraph runs with the heading look applied. */
function styled(block, base) {
  const h = block.heading;
  return block.runs.map((r) => {
    const o = { ...r, size: r.size || base };
    if (h != null && h <= 6) {
      if (!r.size || r.size === base) o.size = HEADING_SIZE[h];
      if (o.bold == null) o.bold = true;
    }
    return o;
  });
}

/** Height of a paragraph laid out at `width` (and its lines). */
async function measurePara(L, doc, block, width, base) {
  const runs = styled(block, base);
  const indent = block.indent || 0;
  const ls = await lines(L, doc, runs.length ? runs : [{ text: ' ', size: base }], Math.max(20, width - indent));
  const lh = (block.line || 1.08) * 1.17;
  return { ls, lh, h: ls.reduce((n, l) => n + l.height * lh, 0) };
}

async function writePara(L, doc, w, block, base) {
  const width = w.size.w - w.size.left - w.size.right;
  const { ls, lh } = await measurePara(L, doc, block, width, base);
  const before = block.before ?? (block.heading != null ? 12 : 0);
  const after = block.after ?? 8;
  if (w.page && w.y < w.size.h - w.size.top - 0.5) w.y -= before;
  const x0 = w.size.left + (block.indent || 0);
  // Keep a heading with the next lines.
  if (block.heading != null) w.need(ls[0].height * lh * 3);
  for (let i = 0; i < ls.length; i++) {
    const ln = ls[i];
    w.need(ln.height * lh);
    w.y -= ln.height * lh;
    const first = i === 0;
    const firstOff = first && block.first ? block.first : 0;
    if (first && block.list && block.list.label) {
      const font = await fontFor(L, doc, block.runs[0] || {});
      const s = ln.height;
      if (block.list.label === '•') {
        w.page.drawCircle({ x: x0 - 9, y: w.y + ln.height * 0.22 + s * 0.3, size: Math.max(1.4, s * 0.16), color: L.rgb(0.1, 0.1, 0.1) });
      } else {
        const label = block.list.label.replace(SAFE, '?');
        w.page.drawText(label, { x: x0 - font.widthOfTextAtSize(label, s) - 5, y: w.y + ln.height * 0.22, size: s, font });
      }
    }
    drawLine(L, w.page, ln, x0 + firstOff, w.y + ln.height * 0.22, width - (block.indent || 0) - firstOff, block.align, i === ls.length - 1);
  }
  w.y -= after;
}

async function writeImage(L, doc, w, block) {
  const width = w.size.w - w.size.left - w.size.right;
  const img = block.mime === 'png' ? await doc.embedPng(block.bytes) : await doc.embedJpg(block.bytes);
  let iw = block.w || img.width * 0.75;
  let ih = block.h || img.height * 0.75;
  const maxH = w.size.h - w.size.top - w.size.bottom;
  const s = Math.min(1, width / iw, maxH / ih);
  iw *= s;
  ih *= s;
  w.need(ih + 4);
  w.y -= ih;
  const x = w.size.left + (block.align === 'center' ? (width - iw) / 2 : block.align === 'right' ? width - iw : 0);
  w.page.drawImage(img, { x, y: w.y, width: iw, height: ih });
  w.y -= 6;
}

async function writeTable(L, doc, w, block, base) {
  const width = w.size.w - w.size.left - w.size.right;
  const ncols = Math.max(block.grid.length, ...block.rows.map((r) => r.reduce((n, c) => n + c.span, 0)));
  let grid = block.grid.length === ncols ? block.grid : Array(ncols).fill(width / ncols);
  const sum = grid.reduce((a, b) => a + b, 0) || 1;
  grid = grid.map((g) => (g / sum) * Math.min(width, Math.max(sum, width * 0.4)));
  const pad = 4;
  const border = L.rgb(0.55, 0.55, 0.55);
  for (const row of block.rows) {
    // Lay out every cell first to know the row height.
    let col = 0;
    const cells = [];
    for (const c of row) {
      const cw = grid.slice(col, col + c.span).reduce((a, b) => a + b, 0);
      const x = w.size.left + grid.slice(0, col).reduce((a, b) => a + b, 0);
      const paras = [];
      let h = 0;
      for (const b of c.merged ? [] : c.blocks) {
        if (b.type !== 'p') continue;
        const m = await measurePara(L, doc, { ...b, indent: b.list ? 12 : 0, first: 0 }, cw - 2 * pad, base);
        paras.push({ b, m });
        h += m.h + 2;
      }
      cells.push({ x, cw, paras, h });
      col += c.span;
    }
    const rh = Math.max(14, ...cells.map((c) => c.h + 2 * pad));
    w.need(rh);
    const top = w.y;
    for (const c of cells) {
      w.page.drawRectangle({ x: c.x, y: top - rh, width: c.cw, height: rh, borderColor: border, borderWidth: 0.6 });
      let y = top - pad;
      for (const { b, m } of c.paras) {
        m.ls.forEach((ln, i) => {
          y -= ln.height * m.lh;
          if (y < top - rh) return; // taller than a page: clipped
          drawLine(L, w.page, ln, c.x + pad + (b.list ? 12 : 0), y + ln.height * 0.22, c.cw - 2 * pad, b.align, i === m.ls.length - 1);
        });
        y -= 2;
      }
    }
    w.y = top - rh;
  }
  w.y -= 8;
}

/** Word model → PDF bytes. */
export async function docxToPdf(model) {
  const L = await loadPdfLib();
  const doc = await L.PDFDocument.create();
  const w = new Writer(L, doc, model.page);
  w.newPage();
  for (const b of model.blocks) {
    if (b.type === 'pagebreak') w.newPage();
    else if (b.type === 'p') await writePara(L, doc, w, b, model.base);
    else if (b.type === 'image') await writeImage(L, doc, w, b);
    else if (b.type === 'table') await writeTable(L, doc, w, b, model.base);
  }
  return doc.save();
}

/** Excel model → PDF bytes: each sheet fitted to the page width, landscape when wide. */
export async function xlsxToPdf(model, { paper = 'a4' } = {}) {
  const L = await loadPdfLib();
  const doc = await L.PDFDocument.create();
  const regular = (await pdfFont(L, doc, 'arimo', false)).font;
  const bold = (await pdfFont(L, doc, 'arimo', true)).font;
  const [pw, ph] = paper === 'letter' ? [612, 792] : [595.28, 841.89];
  const margin = 36;
  const border = L.rgb(0.75, 0.75, 0.75);
  for (const sheet of model.sheets) {
    if (!sheet.rows.length) continue;
    // Column width is in characters of the default font; leave room for 10 pt Arimo.
    const natural = sheet.cols.map((c) => Math.max(18, c * 6.6 + 8));
    const total = natural.reduce((a, b) => a + b, 0);
    const landscape = total > pw - 2 * margin;
    const [W, H] = landscape ? [ph, pw] : [pw, ph];
    const scale = Math.min(1, (W - 2 * margin) / total);
    const cols = natural.map((c) => c * scale);
    const size = Math.max(5, 10 * scale);
    const rowH = size * 1.6;
    let page = null;
    let y = 0;
    const start = () => {
      page = doc.addPage([W, H]);
      y = H - margin;
      page.drawText(sheet.name.replace(SAFE, '?'), { x: margin, y: y - 12, size: 12, font: bold, color: L.rgb(0.2, 0.2, 0.3) });
      y -= 22;
    };
    start();
    for (const row of sheet.rows) {
      if (y - rowH < margin) start();
      let x = margin;
      cols.forEach((cw, i) => {
        page.drawRectangle({ x, y: y - rowH, width: cw, height: rowH, borderColor: border, borderWidth: 0.4 });
        const cell = row.cells[i];
        if (cell) {
          const font = cell.bold ? bold : regular;
          let text = cell.text.replace(SAFE, '?').replace(/\s+/g, ' ');
          // Like Excel, text may run on into empty cells to the right; else clip.
          let room = cw;
          if (!cell.num) for (let k = i + 1; k < cols.length && !row.cells[k]; k++) room += cols[k];
          while (text && font.widthOfTextAtSize(text, size) > room - 4) text = text.slice(0, -1);
          const tw = font.widthOfTextAtSize(text, size);
          page.drawText(text, { x: cell.num ? x + cw - 2 - tw : x + 2, y: y - rowH + size * 0.5, size, font });
        }
        x += cw;
      });
      y -= rowH;
    }
  }
  if (!doc.getPageCount()) throw new Error('empty');
  return doc.save();
}
