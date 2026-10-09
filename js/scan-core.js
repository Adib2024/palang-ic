// Image processing for the document scanner: find the page in a photo,
// straighten it (perspective warp) and apply "scan" filters. Pure canvas /
// typed-array code; nothing is sent anywhere.

/** @typedef {{x: number, y: number}} Pt */

/* ---------- Page detection ---------- */

/**
 * Guess the four corners of a light document on a darker background.
 * Returns corners in source-pixel coordinates [tl, tr, br, bl], or null.
 * @param {HTMLCanvasElement} src
 */
export function detectCorners(src) {
  const size = 320;
  const s = Math.min(1, size / Math.max(src.width, src.height));
  const w = Math.max(8, Math.round(src.width * s));
  const h = Math.max(8, Math.round(src.height * s));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;

  const lum = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    const v = (d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000;
    lum[i] = v;
    hist[lum[i]]++;
  }
  const thr = otsu(hist, lum.length);

  // Largest connected bright region (4-neighbour flood fill).
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < lum.length; i++) mask[i] = lum[i] > thr ? 1 : 0;
  const label = new Int32Array(w * h);
  let best = { id: 0, count: 0 };
  let next = 1;
  const stack = new Int32Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i]) continue;
    let top = 0;
    stack[top++] = i;
    label[i] = next;
    let count = 0;
    while (top) {
      const k = stack[--top];
      count++;
      const x = k % w;
      const nb = [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, k - w, k + w];
      for (const n of nb) {
        if (n >= 0 && n < mask.length && mask[n] && !label[n]) { label[n] = next; stack[top++] = n; }
      }
    }
    if (count > best.count) best = { id: next, count };
    next++;
  }
  // Too small (no clear page) or the whole frame (no background): give up.
  if (best.count < w * h * 0.15 || best.count > w * h * 0.97) return null;

  // Extreme points along the diagonals give the corners of a quadrilateral.
  let tl = null; let tr = null; let br = null; let bl = null;
  let mTl = Infinity; let mTr = -Infinity; let mBr = -Infinity; let mBl = Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (label[y * w + x] !== best.id) continue;
      if (x + y < mTl) { mTl = x + y; tl = { x, y }; }
      if (x - y > mTr) { mTr = x - y; tr = { x, y }; }
      if (x + y > mBr) { mBr = x + y; br = { x, y }; }
      if (x - y < mBl) { mBl = x - y; bl = { x, y }; }
    }
  }
  const up = (p) => ({ x: (p.x + 0.5) / s, y: (p.y + 0.5) / s });
  return [up(tl), up(tr), up(br), up(bl)];
}

function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0; let wB = 0; let max = 0; let thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > max) { max = between; thr = t; }
  }
  return thr;
}

/** Corners inset a little from the image edges (fallback when detection fails). */
export function defaultCorners(w, h, inset = 0.04) {
  const ix = w * inset;
  const iy = h * inset;
  return [{ x: ix, y: iy }, { x: w - ix, y: iy }, { x: w - ix, y: h - iy }, { x: ix, y: h - iy }];
}

/* ---------- Perspective warp ---------- */

/** Solve A·x = b (n×n) by Gaussian elimination with partial pivoting. */
function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    [b[i], b[p]] = [b[p], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let acc = b[i];
    for (let c = i + 1; c < n; c++) acc -= A[i][c] * x[c];
    x[i] = acc / A[i][i];
  }
  return x;
}

/** Homography mapping each `from[i]` to `to[i]` (4 point pairs). */
export function homography(from, to) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Straighten the quadrilateral `corners` [tl, tr, br, bl] of `src` into a
 * rectangle. The output size follows the quad's edge lengths, capped at maxSide.
 */
export function warp(src, corners, maxSide = 2400) {
  const [tl, tr, br, bl] = corners;
  let W = Math.max(dist(tl, tr), dist(bl, br));
  let H = Math.max(dist(tl, bl), dist(tr, br));
  const s = Math.min(1, maxSide / Math.max(W, H));
  W = Math.max(2, Math.round(W * s));
  H = Math.max(2, Math.round(H * s));

  const sctx = src.getContext('2d', { willReadFrequently: true });
  const sw = src.width;
  const sh = src.height;
  const sd = sctx.getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d');
  const img = octx.createImageData(W, H);
  const od = img.data;

  // Map output pixel -> source pixel.
  const m = homography(
    [{ x: 0, y: 0 }, { x: W - 1, y: 0 }, { x: W - 1, y: H - 1 }, { x: 0, y: H - 1 }],
    [tl, tr, br, bl],
  );
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const z = m[6] * x + m[7] * y + 1;
      let sx = (m[0] * x + m[1] * y + m[2]) / z;
      let sy = (m[3] * x + m[4] * y + m[5]) / z;
      sx = Math.min(sw - 1.001, Math.max(0, sx));
      sy = Math.min(sh - 1.001, Math.max(0, sy));
      const x0 = sx | 0;
      const y0 = sy | 0;
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * fx;
        const bot = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * fx;
        od[o + c] = top + (bot - top) * fy;
      }
      od[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/* ---------- Filters ---------- */

/** Apply a scan filter in place: 'original' | 'enhance' | 'gray' | 'bw'. */
export function applyFilter(canvas, filter) {
  if (filter === 'original') return canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const n = canvas.width * canvas.height;
  const lum = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    lum[i] = (d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000;
    hist[lum[i]]++;
  }
  // 1st / 97th percentile → black / white point (paper becomes white).
  const pct = (q) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * q) return v; }
    return 255;
  };
  const lo = pct(0.01);
  const hi = Math.max(lo + 1, pct(0.97));
  const stretch = (v) => Math.max(0, Math.min(255, ((v - lo) * 255) / (hi - lo)));

  if (filter === 'enhance') {
    for (let p = 0; p < d.length; p += 4) {
      d[p] = stretch(d[p]); d[p + 1] = stretch(d[p + 1]); d[p + 2] = stretch(d[p + 2]);
    }
  } else if (filter === 'gray') {
    for (let i = 0, p = 0; i < n; i++, p += 4) d[p] = d[p + 1] = d[p + 2] = stretch(lum[i]);
  } else if (filter === 'bw') {
    // Adaptive threshold against the local mean (integral image), so shadows
    // and uneven light don't turn into black blotches.
    const w = canvas.width;
    const h = canvas.height;
    const integral = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += lum[y * w + x];
        integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
      }
    }
    const r = Math.max(8, Math.round(Math.max(w, h) / 40));
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r); const y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r); const x1 = Math.min(w, x + r + 1);
        const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
        const mean = sum / ((x1 - x0) * (y1 - y0));
        const i = y * w + x;
        const v = lum[i] < mean * 0.86 ? 0 : 255;
        const p = i * 4;
        d[p] = d[p + 1] = d[p + 2] = v;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
