// Page stamps shared by Watermark PDF, Page Numbers and workflows: a text or
// image watermark (9 positions or a tiled mosaic) and a page number, drawn
// upright on rotated pages too. Pure pdf-lib; no page UI.
import { displayToUser, displaySize } from './pdf-pages.js';

export const STAMP_COLORS = { black: [0, 0, 0], red: [0.78, 0.16, 0.16], blue: [0.08, 0.27, 0.69], gray: [0.45, 0.45, 0.45] };

/** pdf-lib's standard fonts only cover Latin-1 (fine for BM/EN). */
const latin1 = (s) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');

/**
 * Centre points for the stamp. Mosaic mode lays a lattice along the text
 * direction (`deg`) so rotated copies tile the page evenly.
 */
function centers(o, Dw, Dh, ex, ey, w = 0, h = 0, deg = 0) {
  const m = Math.min(Dw, Dh) * 0.06;
  if (o.tile) {
    const th = (deg * Math.PI) / 180;
    const along = [Math.cos(th), -Math.sin(th)]; // text direction on screen (y down)
    const across = [Math.sin(th), Math.cos(th)];
    const stepA = w + Math.max(h * 1.6, 24);
    const stepB = Math.max(h * 3.2, 40);
    const reach = Math.hypot(Dw, Dh);
    const out = [];
    for (let j = -Math.ceil(reach / stepB); j <= Math.ceil(reach / stepB); j++) {
      const shift = (j % 2) * stepA / 2;
      for (let i = -Math.ceil(reach / stepA) - 1; i <= Math.ceil(reach / stepA) + 1; i++) {
        const u = Dw / 2 + (i * stepA + shift) * along[0] + j * stepB * across[0];
        const v = Dh / 2 + (i * stepA + shift) * along[1] + j * stepB * across[1];
        if (u > -ex && u < Dw + ex && v > -ey && v < Dh + ey) out.push([u, v]);
      }
    }
    return out;
  }
  const [r, c] = o.pos || 'mc';
  const u = c === 'l' ? m + ex : c === 'r' ? Dw - m - ex : Dw / 2;
  const v = r === 't' ? m + ey : r === 'b' ? Dh - m - ey : Dh / 2;
  return [[u, v]];
}

/** Draw a w×h box rotated by `deg`, centred at display point (cu, cv). */
function placeBox(page, w, h, deg, cu, cv, draw) {
  const th = (deg * Math.PI) / 180;
  const { height: Dh } = displaySize(page);
  // Work in a y-up display frame, then convert the box origin to PDF space.
  const offX = (w / 2) * Math.cos(th) - (h / 2) * Math.sin(th);
  const offY = (w / 2) * Math.sin(th) + (h / 2) * Math.cos(th);
  const ox = cu - offX;
  const oy = (Dh - cv) - offY;
  const p = displayToUser(page, ox, Dh - oy);
  draw(p.x, p.y, deg + p.angle);
}

/**
 * Stamp one page.
 * @param {object} o {type:'text'|'image', text, size (pt) | 'auto', color, opacity (0-100),
 *   angle (deg), pos ('tl'..'br', 'mc'), tile, scale (% of width, image),
 *   png (Uint8Array), aspect (h/w)}
 * @param {object} cache per-document cache for the embedded font/image
 */
export async function stampPage(doc, page, PDFLib, cache, o) {
  const { width: Dw, height: Dh } = displaySize(page);
  const deg = Number(o.angle) || 0;
  const th = (deg * Math.PI) / 180;
  const opacity = Math.max(0.05, Math.min(1, (Number(o.opacity) || 30) / 100));
  const extent = (w, h) => [
    (Math.abs(Math.cos(th)) * w + Math.abs(Math.sin(th)) * h) / 2,
    (Math.abs(Math.sin(th)) * w + Math.abs(Math.cos(th)) * h) / 2,
  ];
  if (o.type === 'image') {
    if (!o.png) return;
    if (!cache.img) cache.img = await doc.embedPng(o.png);
    const w = Dw * ((o.scale || 40) / 100);
    const h = w * (o.aspect || 1);
    const [ex, ey] = extent(w, h);
    for (const [cu, cv] of centers(o, Dw, Dh, ex, ey, w, h, deg)) {
      placeBox(page, w, h, deg, cu, cv, (x, y, rot) => page.drawImage(cache.img, { x, y, width: w, height: h, opacity, rotate: PDFLib.degrees(rot) }));
    }
    return;
  }
  const text = latin1((o.text || '').trim() || 'SALINAN');
  if (!cache.font) cache.font = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  let size = Number(o.size);
  if (o.size === 'auto') {
    // Centred: about 60% of the page diagonal (capped); tiled: smaller copies.
    const unit = cache.font.widthOfTextAtSize(text, 1);
    size = o.tile ? Math.min(Dw, Dh) / 16 : Math.min(Math.min(Dw, Dh) / 4, (0.6 * Math.hypot(Dw, Dh)) / unit);
  }
  const w = cache.font.widthOfTextAtSize(text, size);
  const h = size * 0.72;
  const [r, g, b] = STAMP_COLORS[o.color] || STAMP_COLORS.red;
  const [ex, ey] = extent(w, h);
  for (const [cu, cv] of centers(o, Dw, Dh, ex, ey, w, h, deg)) {
    placeBox(page, w, h, deg, cu, cv, (x, y, rot) => page.drawText(text, {
      x, y, size, font: cache.font, color: PDFLib.rgb(r, g, b), opacity, rotate: PDFLib.degrees(rot),
    }));
  }
}

/**
 * Write a page number label.
 * @param {object} o {text, size (pt), pos ('tl','tc','tr','bl','bc','br'), margin (pt)}
 */
export async function numberPage(doc, page, PDFLib, cache, o) {
  if (!cache.numFont) cache.numFont = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const font = cache.numFont;
  const text = latin1(o.text);
  const size = o.size || 11;
  const w = font.widthOfTextAtSize(text, size);
  const { width: Dw, height: Dh } = displaySize(page);
  const m = o.margin ?? 30;
  const [row, col] = o.pos || 'bc';
  const u = col === 'l' ? m : col === 'r' ? Dw - m - w : (Dw - w) / 2;
  const baseline = row === 't' ? m + size * 0.8 : Dh - m;
  const p = displayToUser(page, u, baseline);
  page.drawText(text, { x: p.x, y: p.y, size, font, color: PDFLib.rgb(0.1, 0.1, 0.1), rotate: PDFLib.degrees(p.angle) });
}
