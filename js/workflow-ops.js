// Workflow engine: each step takes PDF bytes plus its options and returns new
// PDF bytes. Pure functions (no page UI), so steps can be chained in any
// order the user picks. Everything runs in this tab; nothing is uploaded.
import { loadPdfLib, openForRender, renderPage } from './pdf-kit.js';
import { displayToUser, displaySize } from './pdf-pages.js';
import { writePdf } from './pdf.js';
import { loadPhoto } from './image-loader.js';
import { composite } from './watermark.js';
import { TEMPLATES, todayDMY } from './i18n.js';
import { protectPdf } from './pdf-security.js';
import { permissions } from './pdf-crypto.js';

/** Step types, in the order offered in the "add step" menu. */
export const STEP_TYPES = ['palang', 'place', 'watermark', 'pagenum', 'rotate', 'compress', 'protect'];

/** Default options per step type. */
export const DEFAULTS = {
  palang: { who: '', lang: 'ms', date: true, corner: 'tl', color: 'black' },
  place: {},
  watermark: { text: 'SALINAN', color: 'red', opacity: 30, layout: 'center' },
  pagenum: { pos: 'bc', format: 'nOfTotal' },
  rotate: { deg: 90 },
  compress: { level: 'medium', limit: 0 },
  protect: { password: '', print: true, copy: true },
};

/** Ready-made workflows. Users can edit them before running. */
export const TEMPLATES_WF = [
  {
    id: 'loan', icon: 'loan',
    steps: [
      { type: 'palang', opts: { ...DEFAULTS.palang, who: 'BANK' } },
      { type: 'pagenum', opts: { ...DEFAULTS.pagenum } },
      { type: 'compress', opts: { level: 'medium', limit: 2 * 1024 * 1024 } },
    ],
  },
  {
    id: 'signed', icon: 'sign',
    steps: [
      { type: 'place', opts: {} },
      { type: 'protect', opts: { ...DEFAULTS.protect } },
    ],
  },
  {
    id: 'copy', icon: 'watermark',
    steps: [
      { type: 'watermark', opts: { ...DEFAULTS.watermark } },
      { type: 'pagenum', opts: { ...DEFAULTS.pagenum } },
      { type: 'compress', opts: { level: 'medium', limit: 0 } },
    ],
  },
];

/**
 * Keep steps in a runnable order: the IC stamp works on photos, so it runs
 * first; a password makes the file unreadable to later steps, so it runs last.
 */
export function normalize(steps) {
  const rank = (s) => (s.type === 'palang' ? 0 : s.type === 'protect' ? 2 : 1);
  return steps.map((s, i) => [s, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([s]) => s);
}

const latin1 = (s) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const isPdfFile = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

const jpeg = (canvas, q) => new Promise((resolve, reject) => {
  canvas.toBlob(async (b) => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error('encode'))), 'image/jpeg', q);
});

/** Palang text for the IC stamp, e.g. "UNTUK KEGUNAAN BANK SAHAJA · 08/10/2026". */
export function palangText(o) {
  const who = (o.who || '').trim().toUpperCase().replace(/\s+/g, ' ') || '_____';
  return (TEMPLATES[o.lang] || TEMPLATES.ms)(who) + (o.date ? ` · ${todayDMY()}` : '');
}

/**
 * Join the input files (PDFs and photos) into one PDF. Photos go on A4 pages
 * (landscape when wide); with a palang step they are stamped first.
 * @param {File[]} files
 * @param {object|null} palang options of the palang step, if any
 */
export async function buildInput(files, palang) {
  const L = await loadPdfLib();
  const out = await L.PDFDocument.create();
  for (const f of files) {
    if (isPdfFile(f)) {
      let src;
      try {
        src = await L.PDFDocument.load(new Uint8Array(await f.arrayBuffer()), { updateMetadata: false });
      } catch (err) {
        const e = new Error(/encrypt/i.test(String(err && err.message)) ? 'encrypted' : 'pdf');
        e.file = f.name;
        throw e;
      }
      for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
      continue;
    }
    const photo = await loadPhoto(f, 2400);
    const canvas = palang
      ? composite(document.createElement('canvas'), photo, photo.width, photo.height, {
        mode: 'palang', text: palangText(palang), color: palang.color, palangShape: 'corner', stampAt: { corner: palang.corner },
      })
      : photo;
    const img = await out.embedJpg(await jpeg(canvas, 0.86));
    const wide = canvas.width > canvas.height;
    const [pw, ph] = wide ? [841.89, 595.28] : [595.28, 841.89];
    const m = 28;
    const s = Math.min((pw - 2 * m) / canvas.width, (ph - 2 * m) / canvas.height);
    const w = canvas.width * s;
    const h = canvas.height * s;
    out.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  if (!out.getPageCount()) throw new Error('empty');
  out.setProducer('DokuJaga');
  out.setCreator('DokuJaga');
  return out.save();
}

/* ---------- Page stamps (pdf-lib) ---------- */

const WM_COLORS = { black: [0, 0, 0], red: [0.78, 0.16, 0.16], blue: [0.08, 0.27, 0.69], gray: [0.45, 0.45, 0.45] };

/** Watermark text across each page, centred or tiled, at 45°. */
export async function watermark(bytes, o) {
  const L = await loadPdfLib();
  const doc = await L.PDFDocument.load(bytes, { updateMetadata: false });
  const font = await doc.embedFont(L.StandardFonts.HelveticaBold);
  const text = latin1((o.text || '').trim() || 'SALINAN');
  const [r, g, b] = WM_COLORS[o.color] || WM_COLORS.red;
  const opacity = Math.max(0.05, Math.min(1, (Number(o.opacity) || 30) / 100));
  const deg = 45;
  const th = (deg * Math.PI) / 180;
  for (const page of doc.getPages()) {
    const { width: Dw, height: Dh } = displaySize(page);
    // Centred: the text spans ~60% of the page diagonal (capped); tiled: smaller copies.
    const unit = font.widthOfTextAtSize(text, 1);
    const size = o.layout === 'tile' ? Math.min(Dw, Dh) / 16 : Math.min(Math.min(Dw, Dh) / 4, (0.6 * Math.hypot(Dw, Dh)) / unit);
    const w = font.widthOfTextAtSize(text, size);
    const h = size * 0.72;
    const centers = [];
    if (o.layout === 'tile') {
      const stepA = w + h * 1.6;
      const stepB = h * 3.6;
      const along = [Math.cos(th), -Math.sin(th)];
      const across = [Math.sin(th), Math.cos(th)];
      const reach = Math.hypot(Dw, Dh);
      for (let j = -Math.ceil(reach / stepB); j <= Math.ceil(reach / stepB); j++) {
        const shift = ((j % 2) * stepA) / 2;
        for (let i = -Math.ceil(reach / stepA) - 1; i <= Math.ceil(reach / stepA) + 1; i++) {
          const u = Dw / 2 + (i * stepA + shift) * along[0] + j * stepB * across[0];
          const v = Dh / 2 + (i * stepA + shift) * along[1] + j * stepB * across[1];
          if (u > -w && u < Dw + w && v > -w && v < Dh + w) centers.push([u, v]);
        }
      }
    } else centers.push([Dw / 2, Dh / 2]);
    for (const [cu, cv] of centers) {
      // Box origin for a w×h box rotated by `deg` around (cu, cv), y-up display frame.
      const ox = cu - ((w / 2) * Math.cos(th) - (h / 2) * Math.sin(th));
      const oy = (Dh - cv) - ((w / 2) * Math.sin(th) + (h / 2) * Math.cos(th));
      const p = displayToUser(page, ox, Dh - oy);
      page.drawText(text, {
        x: p.x, y: p.y, size, font, color: L.rgb(r, g, b), opacity, rotate: L.degrees(deg + p.angle),
      });
    }
  }
  return doc.save();
}

/** Page numbers: "1", "1 / N" at one of six positions. */
export async function pagenum(bytes, o) {
  const L = await loadPdfLib();
  const doc = await L.PDFDocument.load(bytes, { updateMetadata: false });
  const font = await doc.embedFont(L.StandardFonts.Helvetica);
  const total = doc.getPageCount();
  const size = 11;
  const m = 30;
  doc.getPages().forEach((page, i) => {
    const text = o.format === 'n' ? String(i + 1) : `${i + 1} / ${total}`;
    const w = font.widthOfTextAtSize(text, size);
    const { width: Dw, height: Dh } = displaySize(page);
    const [row, col] = o.pos || 'bc';
    const u = col === 'l' ? m : col === 'r' ? Dw - m - w : (Dw - w) / 2;
    const baseline = row === 't' ? m + size * 0.8 : Dh - m;
    const p = displayToUser(page, u, baseline);
    page.drawText(text, { x: p.x, y: p.y, size, font, color: L.rgb(0.1, 0.1, 0.1), rotate: L.degrees(p.angle) });
  });
  return doc.save();
}

/** Rotate every page by `deg` (90, 180, 270). */
export async function rotate(bytes, o) {
  const L = await loadPdfLib();
  const doc = await L.PDFDocument.load(bytes, { updateMetadata: false });
  for (const p of doc.getPages()) p.setRotation(L.degrees((((p.getRotation().angle + Number(o.deg)) % 360) + 360) % 360));
  return doc.save();
}

/* ---------- Compress (pdf.js render → JPEG pages) ---------- */

const LADDER = [
  { dpi: 150, q: 0.75 }, { dpi: 110, q: 0.62 }, { dpi: 85, q: 0.5 }, { dpi: 72, q: 0.42 }, { dpi: 60, q: 0.36 },
];
const LEVEL_START = { light: 0, medium: 1, strong: 2 };

/** Re-render pages as JPEG; with a size limit, step down until it fits. */
export async function compress(bytes, o, onProgress = () => {}) {
  const doc = await openForRender(bytes);
  try {
    const limit = Number(o.limit) || 0;
    const start = LEVEL_START[o.level] ?? 1;
    const steps = limit ? LADDER.slice(start) : [LADDER[start]];
    let best = null;
    for (let s = 0; s < steps.length; s++) {
      const images = [];
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        onProgress((s + i / doc.numPages) / steps.length);
        const pg = await doc.getPage(i);
        const vp = pg.getViewport({ scale: 1 });
        const canvas = await renderPage(pg, Math.min(steps[s].dpi / 72, 3500 / Math.max(vp.width, vp.height)));
        images.push({ jpeg: await jpeg(canvas, steps[s].q), width: canvas.width, height: canvas.height });
        pages.push({ width: vp.width, height: vp.height, items: [{ image: i - 1, x: 0, y: 0, w: vp.width, h: vp.height }] });
        pg.cleanup();
        canvas.width = canvas.height = 0;
      }
      const blob = writePdf(pages, images);
      if (!best || blob.size < best.size) best = blob;
      if (!limit || blob.size <= limit) break;
    }
    // Never make a file bigger than it was.
    return best.size < bytes.length ? new Uint8Array(await best.arrayBuffer()) : bytes;
  } finally {
    doc.destroy();
  }
}

/** Lock with a password (AES-256). */
export async function protect(bytes, o) {
  if (!o.password) throw new Error('nopassword');
  return protectPdf(bytes, o.password, '', permissions({ print: o.print !== false, copy: o.copy !== false }));
}

/** Run one non-interactive step. */
export function runStep(step, bytes, onProgress) {
  switch (step.type) {
    case 'watermark': return watermark(bytes, step.opts);
    case 'pagenum': return pagenum(bytes, step.opts);
    case 'rotate': return rotate(bytes, step.opts);
    case 'compress': return compress(bytes, step.opts, onProgress);
    case 'protect': return protect(bytes, step.opts);
    default: return Promise.resolve(bytes); // palang runs on input; place is interactive
  }
}
