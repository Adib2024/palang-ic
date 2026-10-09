// Redact PDF: draw boxes (or find IC numbers, phone numbers, emails, account
// numbers or any text) and permanently black them out. Redacted pages are
// re-rendered as images so the hidden text is truly gone, not just covered.
// Runs in this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import { loadPdfJs, loadPdfLib, renderPage, formatSize, safeName, download, shareOrDownload, openErrorKey } from './pdf-kit.js';
import { openPdfs, bindFileDrop } from './pdf-pages.js';
import { renderPages, fracPoint, placeFrac } from './page-viewer.js';

const DPI = 200;
export const PATTERNS = {
  ic: /\b\d{6}-?\d{2}-?\d{4}\b/g,
  phone: /(?:\+?6?0)1\d[-\s]?\d{3,4}[-\s]?\d{4}\b/g,
  email: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  account: /\b\d(?:[\d-]{8,18})\d\b/g,
};
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let src = null;
let views = [];
/** Redaction boxes in page fractions: {page, x, y, w, h, el}. */
let boxes = [];
let ready = false;

const page = initPage(() => { if (ready) sync(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

function addBox(view, r) {
  const b = { page: view.index, ...r, el: null };
  const el = document.createElement('div');
  el.className = 'redact-box';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'sig-del';
  del.textContent = '✕';
  del.setAttribute('aria-label', tr('sigDelete'));
  del.addEventListener('pointerdown', (e) => e.stopPropagation());
  del.addEventListener('click', (e) => { e.stopPropagation(); removeBox(b); });
  el.appendChild(del);
  b.el = el;
  view.el.appendChild(el);
  placeFrac(el, b);
  boxes.push(b);
  sync();
  return b;
}

function removeBox(b) {
  b.el.remove();
  boxes = boxes.filter((x) => x !== b);
  sync();
}

function bindDraw(view) {
  let start = null;
  let live = null;
  view.el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.redact-box')) return;
    e.preventDefault();
    start = fracPoint(view.el, e);
    live = document.createElement('div');
    live.className = 'redact-box drawing';
    view.el.appendChild(live);
    view.el.setPointerCapture(e.pointerId);
  });
  view.el.addEventListener('pointermove', (e) => {
    if (!start) return;
    const p = fracPoint(view.el, e);
    placeFrac(live, { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) });
  });
  const end = (e) => {
    if (!start) return;
    const p = fracPoint(view.el, e);
    const r = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
    live.remove();
    start = null;
    if (r.w > 0.005 && r.h > 0.004) addBox(view, r);
  };
  view.el.addEventListener('pointerup', end);
  view.el.addEventListener('pointercancel', () => { if (live) live.remove(); start = null; });
}

/* ---------- Find text ---------- */

/**
 * Boxes (page fractions) around every match of `regex` on a page, using the
 * text positions from pdf.js. Matches may span several text items.
 */
export async function findOnPage(view, regex) {
  const pdfjs = await loadPdfJs();
  const tc = await view.page.getTextContent();
  const vp = view.vp;
  let text = '';
  const owners = []; // per character: [itemIndex, offsetInItem]
  tc.items.forEach((it, k) => {
    for (let i = 0; i < it.str.length; i++) owners.push([k, i]);
    text += it.str;
    if (it.hasEOL) { owners.push([-1, 0]); text += '\n'; }
  });
  const out = [];
  regex.lastIndex = 0;
  for (let m = regex.exec(text); m; m = regex.exec(text)) {
    if (!m[0]) { regex.lastIndex++; continue; }
    // Group the matched characters by text item, then box each part.
    const parts = new Map();
    for (let c = m.index; c < m.index + m[0].length; c++) {
      const [k, off] = owners[c];
      if (k < 0) continue;
      const p = parts.get(k) || { a: off, b: off };
      p.a = Math.min(p.a, off);
      p.b = Math.max(p.b, off);
      parts.set(k, p);
    }
    for (const [k, { a, b }] of parts) {
      const it = tc.items[k];
      const tx = pdfjs.Util.transform(vp.transform, it.transform);
      const fh = Math.hypot(tx[2], tx[3]);
      // Character positions from real glyph widths (measured on a canvas and
      // scaled to the item's width), not an even split, so the box covers
      // exactly the matched characters.
      const full = measure(it.str) || 1;
      const x0 = tx[4] + (it.width * measure(it.str.slice(0, a))) / full;
      const x1 = tx[4] + (it.width * measure(it.str.slice(0, b + 1))) / full;
      const top = tx[5] - fh * 0.9;
      const bottom = tx[5] + fh * 0.28;
      // Generous margin: a redaction must never leave part of a glyph showing.
      const pad = Math.max(1.5, fh * 0.18);
      out.push({
        x: Math.max(0, (x0 - pad) / vp.width),
        y: Math.max(0, (top - pad) / vp.height),
        w: Math.min(1, (x1 - x0 + 2 * pad) / vp.width),
        h: Math.min(1, (bottom - top + 2 * pad) / vp.height),
      });
    }
  }
  return out;
}

let measureCtx;
/** Width of `s` in a Helvetica-like font (only ratios matter). */
function measure(s) {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = '100px Helvetica, Arial, sans-serif';
  }
  return measureCtx.measureText(s).width;
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function findAll(kind) {
  let regex;
  if (kind === 'custom') {
    const q = $('#findText').value.trim();
    if (!q) { $('#findText').focus(); return; }
    regex = new RegExp(escapeRegExp(q), 'gi');
  } else regex = new RegExp(PATTERNS[kind].source, 'g');
  let n = 0;
  for (const v of views) {
    for (const r of await findOnPage(v, regex)) {
      // Skip exact duplicates of boxes already placed.
      if (boxes.some((b) => b.page === v.index && Math.abs(b.x - r.x) < 0.002 && Math.abs(b.y - r.y) < 0.002)) continue;
      addBox(v, r);
      n++;
    }
  }
  setStatus(n ? tr('redFound', { n }) : tr('redNone'));
}

/* ---------- Export ---------- */

const jpeg = (c) => new Promise((r) => c.toBlob(async (b) => r(new Uint8Array(await b.arrayBuffer())), 'image/jpeg', 0.92));

/** Build the redacted PDF. Pages with boxes become flattened images. */
export async function buildOutput() {
  if (!boxes.length) throw new Error('empty');
  const PDFLib = await loadPdfLib();
  const original = await PDFLib.PDFDocument.load(src.bytes, { updateMetadata: false });
  const out = await PDFLib.PDFDocument.create();
  for (const v of views) {
    const mine = boxes.filter((b) => b.page === v.index);
    if (!mine.length) {
      const [copy] = await out.copyPages(original, [v.index]);
      out.addPage(copy);
      continue;
    }
    const canvas = await renderPage(v.page, DPI / 72);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    for (const b of mine) ctx.fillRect(b.x * canvas.width, b.y * canvas.height, b.w * canvas.width, b.h * canvas.height);
    const img = await out.embedJpg(await jpeg(canvas));
    const pg = out.addPage([v.vp.width, v.vp.height]);
    pg.drawImage(img, { x: 0, y: 0, width: v.vp.width, height: v.vp.height });
    canvas.width = canvas.height = 0;
  }
  if (!$('#stripMeta').checked) {
    const title = original.getTitle();
    const author = original.getAuthor();
    if (title) out.setTitle(title);
    if (author) out.setAuthor(author);
  }
  out.setProducer('DokuJaga');
  out.setCreator('DokuJaga');
  const bytes = await out.save();
  return new File([bytes], `${safeName($('#fileName').value, 'dokumen')}.pdf`, { type: 'application/pdf' });
}

/* ---------- UI ---------- */

function sync() {
  $('#toolLayout').classList.toggle('is-empty', !src);
  if (src) {
    $('#docTitle').textContent = src.name;
    $('#docMeta').textContent = `${tr('pdfPagesN', { n: src.pages })} · ${formatSize(src.bytes.length)}`;
  }
  $('#boxCount').textContent = boxes.length ? tr('redCount', { n: boxes.length }) : '';
  $('#clearBoxes').hidden = !boxes.length;
  $('#savePdf').disabled = !boxes.length;
  $('#sharePdf').disabled = !boxes.length;
}

async function openFile(list) {
  setStatus(tr('pdfLoading'));
  const { sources, failed } = await openPdfs(list.slice(0, 1));
  if (!sources.length) {
    setStatus(failed.length ? `${failed[0].name}: ${tr(openErrorKey(failed[0].err))}` : tr('pdfOpenError'));
    return;
  }
  if (src) src.doc.destroy();
  [src] = sources;
  boxes = [];
  $('#fileName').value = `${safeName(src.name, 'dokumen')}-dihitamkan`;
  sync();
  views = await renderPages($('#redactPages'), src.doc, { label: (n) => tr('sigPage', { n }) });
  views.forEach(bindDraw);
  setStatus('');
  sync();
}

let busy = false;
async function exportPdf(share) {
  if (busy || !src) return;
  busy = true;
  setStatus(tr('working'));
  try {
    const file = await buildOutput();
    const done = tr('splitDoneOne', { size: formatSize(file.size) });
    if (share) {
      const how = await shareOrDownload(file);
      setStatus(how === 'cancelled' ? '' : how === 'downloaded' ? `${tr('shareFallback')} ${done}` : done);
    } else {
      download(file);
      setStatus(done);
    }
  } catch (err) {
    setStatus(err && err.message === 'empty' ? tr('redNeedBox') : tr(openErrorKey(err)));
  } finally {
    busy = false;
  }
}

$$('[data-find]').forEach((b) => b.addEventListener('click', () => findAll(b.dataset.find)));
$('#findText').addEventListener('keydown', (e) => { if (e.key === 'Enter') findAll('custom'); });
$('#clearBoxes').addEventListener('click', () => { [...boxes].forEach(removeBox); setStatus(''); });
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; openFile(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
$('#savePdf').addEventListener('click', () => exportPdf(false));
$('#sharePdf').addEventListener('click', () => exportPdf(true));
bindFileDrop($('#dropzone'), openFile);
ready = true;
sync();

// Exposed for the automated test only.
window.__redact = { openFile, buildOutput, findAll, get boxes() { return boxes; }, get views() { return views; } };
