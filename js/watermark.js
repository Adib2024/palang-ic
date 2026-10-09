// Pure watermark renderer. No DOM access beyond the 2D context it is given,
// so the same code runs for the live preview and the full-size export.

export const COLORS = {
  black: '#111111',
  red: '#c62828',
  blue: '#1546b0',
};

// Row/column spacing multipliers for tiled mode, in units of font size.
const DENSITY = {
  low: { row: 4.2, col: 2.6 },
  mid: { row: 3.0, col: 1.8 },
  high: { row: 2.1, col: 1.1 },
};

export const DEFAULTS = {
  mode: 'palang', // 'palang' | 'tiled' | 'gabung'
  text: 'UNTUK KEGUNAAN SAHAJA',
  color: 'black',
  opacity: 0.4,
  angle: -30, // degrees, negative = rising left to right
  fontSize: 4.5, // % of the image's shorter side
  density: 'mid',
  palangShape: 'corner', // 'corner' | 'parallel' | 'x'
  stampSize: 40, // corner stamp length, % of the image's shorter side (diagonal)
  stampAt: { corner: 'tl' }, // preset corner, or { corner: 'custom', x, y, angle }
  lineStyle: 'solid', // 'solid' | 'double'
  thickness: 0.6, // % of the image's shorter side
};

const FONT_STACK = '"Helvetica Neue", Arial, "Segoe UI", Roboto, sans-serif';
const SEP = '   •   ';

function font(px) {
  return `700 ${Math.round(px)}px ${FONT_STACK}`;
}

// Draw a straight line of length `len` centred on the origin (current
// transform), optionally as two thin parallel strokes.
function drawLine(ctx, len, y, thick, style) {
  if (style === 'double') {
    const t = Math.max(1, thick * 0.55);
    const gap = thick * 1.1;
    ctx.fillRect(-len / 2, y - gap / 2 - t, len, t);
    ctx.fillRect(-len / 2, y + gap / 2, len, t);
  } else {
    ctx.fillRect(-len / 2, y - thick / 2, len, thick);
  }
}

// Repeat `text` along a horizontal strip (in the rotated frame) so it spans
// the whole image diagonal — cropping a corner off can't remove it.
function drawTextStrip(ctx, text, len, y) {
  const unit = text + SEP;
  const w = ctx.measureText(unit).width;
  if (w <= 0) return;
  const count = Math.ceil(len / w) + 1;
  // Centre one copy of the text exactly on the middle of the strip.
  const textW = ctx.measureText(text).width;
  let x = -textW / 2 - Math.ceil(count / 2) * w;
  for (let i = 0; i <= count + 1; i++, x += w) ctx.fillText(unit, x, y);
}

// Diagonal angle per corner so the stamp always cuts across that corner.
export const CORNER_ANGLE = { tl: -45, br: -45, tr: 45, bl: 45 };

/**
 * Size and placement of the corner stamp, in pixels.
 * The bars are exactly as long as the text (plus a little padding), and the
 * whole stamp is kept inside the image so nothing gets clipped at the edge.
 */
export function stampGeometry(ctx, w, h, o) {
  const base = Math.min(w, h);
  const thick = Math.max(1, base * o.thickness / 100);
  const at = o.stampAt || { corner: 'tl' };
  const angle = at.corner === 'custom' ? (at.angle ?? -45) : (CORNER_ANGLE[at.corner] ?? -45);

  // Target length along the diagonal; 100% would span the short side corner to corner.
  const target = base * o.stampSize / 100 * Math.SQRT2;
  ctx.font = font(100);
  const perPx = ctx.measureText(o.text).width / 100; // text width per px of font size
  const pad = 0.5; // bar overhang at each end, in units of font size
  const fontPx = Math.max(6, Math.min(base * 0.12, target / (perPx + 2 * pad)));
  const len = fontPx * (perPx + 2 * pad);
  const half = fontPx * 0.8 + thick; // centre line to each bar
  const height = 2 * half + 2 * thick;

  // Half-extent of the rotated stamp on each axis.
  const rad = (angle * Math.PI) / 180;
  const ex = Math.min(w / 2, (Math.abs(Math.cos(rad)) * len + Math.abs(Math.sin(rad)) * height) / 2);
  const ey = Math.min(h / 2, (Math.abs(Math.sin(rad)) * len + Math.abs(Math.cos(rad)) * height) / 2);

  let cx;
  let cy;
  if (at.corner === 'custom') {
    cx = at.x * w;
    cy = at.y * h;
  } else {
    // Push the stamp right into the corner so it cuts across it.
    cx = at.corner === 'tr' || at.corner === 'br' ? w - ex : ex;
    cy = at.corner === 'bl' || at.corner === 'br' ? h - ey : ey;
  }
  cx = Math.min(w - ex, Math.max(ex, cx));
  cy = Math.min(h - ey, Math.max(ey, cy));
  return { cx, cy, angle, len, fontPx, half, thick, ex, ey };
}

// Classic Malaysian palang: a short double bar with the purpose text
// between the lines, stamped across one corner (or wherever it's dragged).
function drawStamp(ctx, w, h, o) {
  const g = stampGeometry(ctx, w, h, o);
  ctx.font = font(g.fontPx);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.save();
  ctx.translate(g.cx, g.cy);
  ctx.rotate((g.angle * Math.PI) / 180);
  drawLine(ctx, g.len, -g.half, g.thick, o.lineStyle);
  drawLine(ctx, g.len, g.half, g.thick, o.lineStyle);
  ctx.fillText(o.text, 0, g.fontPx * 0.06);
  ctx.restore();
  ctx.textAlign = 'start';
}

function drawPalang(ctx, w, h, o) {
  if (o.palangShape === 'corner') {
    drawStamp(ctx, w, h, o);
    return;
  }
  const base = Math.min(w, h);
  const diag = Math.hypot(w, h);
  const fontPx = base * (o.fontSize * 1.15) / 100;
  const thick = Math.max(1, base * o.thickness / 100);
  ctx.font = font(fontPx);
  ctx.textBaseline = 'middle';

  const arms = o.palangShape === 'x' ? [o.angle, -o.angle] : [o.angle];
  arms.forEach((deg, i) => {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate((deg * Math.PI) / 180);
    if (o.palangShape === 'x') {
      // X: one line per arm; purpose text runs just above the main arm.
      drawLine(ctx, diag, 0, thick, o.lineStyle);
      if (i === 0) drawTextStrip(ctx, o.text, diag, -(fontPx * 0.75 + thick));
    } else {
      // Classic palang: two parallel bars with the text running between them.
      const half = fontPx * 0.85 + thick;
      drawLine(ctx, diag, -half, thick, o.lineStyle);
      drawLine(ctx, diag, half, thick, o.lineStyle);
      drawTextStrip(ctx, o.text, diag, 0);
    }
    ctx.restore();
  });
}

function drawTiled(ctx, w, h, o, densityKey) {
  const base = Math.min(w, h);
  const diag = Math.hypot(w, h);
  const fontPx = base * o.fontSize / 100;
  const d = DENSITY[densityKey] || DENSITY.mid;
  ctx.font = font(fontPx);
  ctx.textBaseline = 'middle';
  const textW = ctx.measureText(o.text).width;
  const stepX = textW + fontPx * d.col;
  const stepY = fontPx * d.row;

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((o.angle * Math.PI) / 180);
  // Cover a square of side = diagonal so every rotation fills the image.
  const rows = Math.ceil(diag / 2 / stepY) + 1;
  for (let r = -rows; r <= rows; r++) {
    const offset = (r & 1) * stepX / 2; // brick pattern: no clean gaps
    const cols = Math.ceil((diag / 2 + stepX) / stepX) + 1;
    for (let c = -cols; c <= cols; c++) {
      ctx.fillText(o.text, c * stepX - textW / 2 + offset, r * stepY);
    }
  }
  ctx.restore();
}

/**
 * Draw the watermark over whatever is already on `ctx` (the photo).
 * Sizes are relative to the image so preview and export look identical.
 */
export function renderWatermark(ctx, w, h, options) {
  const o = { ...DEFAULTS, ...options };
  o.text = (o.text || '').trim().toUpperCase();
  if (!o.text) return;
  const fill = COLORS[o.color] || o.color;

  ctx.save();
  ctx.fillStyle = fill;
  if (o.mode === 'tiled' || o.mode === 'gabung') {
    // In combined mode the tiles sit behind the palang at a lighter weight
    // so the IC number and face stay readable.
    const combined = o.mode === 'gabung';
    ctx.globalAlpha = combined ? o.opacity * 0.6 : o.opacity;
    drawTiled(ctx, w, h, combined ? { ...o, fontSize: o.fontSize * 0.75 } : o,
      combined && o.density === 'high' ? 'mid' : o.density);
  }
  if (o.mode === 'palang' || o.mode === 'gabung') {
    // A corner stamp stays clear of the face and IC number, so it can be
    // much bolder than a full-width bar.
    ctx.globalAlpha = Math.min(1, o.opacity * (o.palangShape === 'corner' ? 2.2 : 1.35));
    drawPalang(ctx, w, h, o);
  }
  ctx.restore();
}

/** Draw `source` (an image/bitmap/canvas) plus watermark onto `canvas`. */
export function composite(canvas, source, srcW, srcH, options, maxSide) {
  const scale = maxSide ? Math.min(1, maxSide / Math.max(srcW, srcH)) : 1;
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  renderWatermark(ctx, w, h, options);
  return canvas;
}
