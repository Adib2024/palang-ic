// Reading order from a PDF for the Office converters: pdf.js text items are
// grouped into lines (same baseline), lines into paragraphs (close together,
// same left edge), and lines into table cells (big horizontal gaps).
// Positions are in PDF points, origin top-left of the displayed page.
import { renderPage } from './pdf-kit.js';

/**
 * @typedef {{x: number, x1: number, y: number, size: number, bold: boolean, text: string,
 *   cells: {x: number, x1: number, text: string}[]}} Line
 * @typedef {{width: number, height: number, lines: Line[], hasText: boolean}} PageLayout
 */

/** Text lines of one pdf.js page. */
export async function pageLines(page) {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const styles = tc.styles || {};
  // Real font names ("Helvetica-Bold") arrive with the operator list; the text
  // content only has internal ids.
  await page.getOperatorList().catch(() => {});
  const fontName = (id) => {
    try { return page.commonObjs.has(id) ? page.commonObjs.get(id).name || '' : ''; } catch { return ''; }
  };
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    // Map the item's origin into the displayed page (handles /Rotate).
    const [a, b, , , e, f] = it.transform;
    const [x, y] = vp.convertToViewportPoint(e, f);
    const size = Math.hypot(a, b) || it.height || 10;
    const font = (styles[it.fontName] && styles[it.fontName].fontFamily) || '';
    items.push({
      x, y, size, w: it.width, str: it.str,
      bold: /bold|black|heavy|semibold/i.test(`${fontName(it.fontName)} ${font}`),
    });
  }
  items.sort((p, q) => p.y - q.y || p.x - q.x);
  const lines = [];
  for (const it of items) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, Math.min(l.size, it.size) * 0.45));
    if (line) line.items.push(it);
    else lines.push({ y: it.y, size: it.size, items: [it] });
  }
  return {
    width: vp.width,
    height: vp.height,
    lines: lines.map((l) => {
      l.items.sort((p, q) => p.x - q.x);
      const size = Math.max(...l.items.map((i) => i.size));
      // Cells: split where the gap is wider than ~2 spaces; words keep a space.
      const cells = [];
      let text = '';
      for (const it of l.items) {
        const prev = cells[cells.length - 1];
        const gap = prev ? it.x - prev.x1 : 0;
        if (!prev || gap > size * 1.6) {
          cells.push({ x: it.x, x1: it.x + it.w, text: it.str });
        } else {
          prev.text += (gap > size * 0.15 && !/\s$/.test(prev.text) && !/^\s/.test(it.str) ? ' ' : '') + it.str;
          prev.x1 = Math.max(prev.x1, it.x + it.w);
        }
      }
      for (const c of cells) {
        c.text = c.text.replace(/\s+/g, ' ').trim();
        text += (text ? '  ' : '') + c.text;
      }
      return {
        x: cells[0].x, x1: Math.max(...cells.map((c) => c.x1)), y: l.y, size,
        bold: l.items.every((i) => i.bold), text, cells,
      };
    }).sort((p, q) => p.y - q.y),
    hasText: items.length > 0,
  };
}

/**
 * Group lines into paragraphs: a new paragraph starts after a bigger vertical
 * gap, a change of size/weight, or a different left edge.
 * @returns {{text: string, size: number, bold: boolean, heading: boolean, x: number}[]}
 */
export function paragraphs(lines, bodySize) {
  const out = [];
  let cur = null;
  let prev = null;
  for (const l of lines) {
    const gap = prev ? l.y - prev.y : 0;
    const sameStyle = prev && Math.abs(l.size - prev.size) < 0.6 && l.bold === prev.bold;
    const joins = cur && sameStyle && gap < l.size * 1.75 && Math.abs(l.x - prev.x) < l.size * 1.2 && l.cells.length === 1 && prev.cells.length === 1;
    if (joins) {
      cur.text += (cur.text.endsWith('-') ? '' : ' ') + l.text;
    } else {
      cur = { text: l.text, size: l.size, bold: l.bold, x: l.x, heading: l.size >= bodySize * 1.25, cells: l.cells.length > 1 ? l.cells : null };
      out.push(cur);
    }
    prev = l;
  }
  return out;
}

/** The most common text size (the body text). */
export function bodySize(pages) {
  const count = new Map();
  for (const p of pages) for (const l of p.lines) {
    const k = Math.round(l.size * 2) / 2;
    count.set(k, (count.get(k) || 0) + l.text.length);
  }
  let best = 11;
  let n = -1;
  for (const [k, v] of count) if (v > n) { best = k; n = v; }
  return best;
}

/**
 * Columns for a table-like page: cluster the left edges of cells. Returns
 * rows of cell texts aligned to those columns.
 */
export function tableRows(lines) {
  const xs = [];
  for (const l of lines) for (const c of l.cells) xs.push(c.x);
  xs.sort((a, b) => a - b);
  const cols = [];
  for (const x of xs) {
    const last = cols[cols.length - 1];
    if (last && x - last.max < 14) { last.max = x; last.sum += x; last.n++; } else cols.push({ min: x, max: x, sum: x, n: 1 });
  }
  const centres = cols.map((c) => c.sum / c.n);
  return lines.map((l) => {
    const row = new Array(centres.length).fill('');
    for (const c of l.cells) {
      let best = 0;
      for (let i = 1; i < centres.length; i++) if (Math.abs(centres[i] - c.x) < Math.abs(centres[best] - c.x)) best = i;
      row[best] = row[best] ? `${row[best]} ${c.text}` : c.text;
    }
    return row;
  });
}

/** JPEG of a page (for scanned pages and picture slides). */
export async function pageJpeg(page, dpi = 150) {
  const canvas = await renderPage(page, dpi / 72);
  const bytes = await new Promise((r) => canvas.toBlob(async (b) => r(new Uint8Array(await b.arrayBuffer())), 'image/jpeg', 0.85));
  const out = { bytes, width: canvas.width, height: canvas.height };
  canvas.width = canvas.height = 0;
  return out;
}
