// Workflow engine: each step takes PDF bytes plus its options and returns new
// PDF bytes. Pure functions (no page UI), so steps can be chained in any
// order the user picks. Everything runs in this tab; nothing is uploaded.
import { loadPdfLib, openForRender, renderPage } from './pdf-kit.js';
import { stampPage, numberPage } from './pdf-stamps.js';
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
    id: 'mergesign', icon: 'merge',
    steps: [{ type: 'place', opts: {} }],
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

/* ---------- Page stamps (shared with the Watermark and Page Numbers tools) ---------- */

/** Watermark text across each page, centred (large) or tiled, at 45°. */
export async function watermark(bytes, o) {
  const L = await loadPdfLib();
  const doc = await L.PDFDocument.load(bytes, { updateMetadata: false });
  const cache = {};
  for (const page of doc.getPages()) {
    await stampPage(doc, page, L, cache, {
      type: 'text', text: o.text, color: o.color, opacity: o.opacity, angle: 45, pos: 'mc', tile: o.layout === 'tile', size: 'auto',
    });
  }
  return doc.save();
}

/** Page numbers: "1", "1 / N" at one of six positions. */
export async function pagenum(bytes, o) {
  const L = await loadPdfLib();
  const doc = await L.PDFDocument.load(bytes, { updateMetadata: false });
  const total = doc.getPageCount();
  const cache = {};
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    await numberPage(doc, pages[i], L, cache, { text: o.format === 'n' ? String(i + 1) : `${i + 1} / ${total}`, size: 11, pos: o.pos, margin: 30 });
  }
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
