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
  palangShape: 'parallel', // 'parallel' | 'x'
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

function drawPalang(ctx, w, h, o) {
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
    ctx.globalAlpha = Math.min(1, o.opacity * 1.35);
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
