// Crop PDF: drag a rectangle on the page, apply to this page or all pages
// (sets CropBox/MediaBox). Runs in this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import { loadPdfLib, renderPage, formatSize, safeName, download, shareOrDownload, openErrorKey } from './pdf-kit.js';
import { openPdfs, bindFileDrop, displayToUser, displaySize } from './pdf-pages.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let src = null;
let current = 0;
let rect = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }; // fractions of the displayed page
let scope = 'all';
let ready = false;

const page = initPage(() => { if (ready) sync(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

async function showPage(i) {
  current = Math.max(0, Math.min(src.pages - 1, i));
  const pg = await src.doc.getPage(current + 1);
  const vp = pg.getViewport({ scale: 1 });
  const width = Math.min(700, $('#cropWrap').clientWidth || 500);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = await renderPage(pg, (width * dpr) / vp.width);
  const canvas = $('#cropCanvas');
  canvas.width = c.width;
  canvas.height = c.height;
  canvas.getContext('2d').drawImage(c, 0, 0);
  sync();
}

function placeRect() {
  Object.assign($('#cropRect').style, {
    left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%`,
  });
}

function sync() {
  $('#toolLayout').classList.toggle('is-empty', !src);
  if (!src) return;
  $('#docTitle').textContent = src.name;
  $('#docMeta').textContent = `${tr('pdfPagesN', { n: src.pages })} · ${formatSize(src.bytes.length)}`;
  $('#pageLabel').textContent = tr('sigPage', { n: current + 1 });
  $('#prevPage').disabled = current === 0;
  $('#nextPage').disabled = current === src.pages - 1;
  $('#cropInfo').textContent = tr('cropInfo', { w: Math.round(rect.w * 100), h: Math.round(rect.h * 100) });
  placeRect();
}

function bindRect() {
  const box = $('#cropStage');
  let mode = null;
  let start = null;
  const MIN = 0.05;
  box.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-h]');
    if (!handle && !e.target.closest('#cropRect')) return;
    e.preventDefault();
    mode = handle ? handle.dataset.h : 'move';
    start = { x: e.clientX, y: e.clientY, r: { ...rect } };
    box.setPointerCapture(e.pointerId);
  });
  box.addEventListener('pointermove', (e) => {
    if (!mode) return;
    const b = box.getBoundingClientRect();
    const dx = (e.clientX - start.x) / b.width;
    const dy = (e.clientY - start.y) / b.height;
    const r = { ...start.r };
    if (mode === 'move') {
      r.x = Math.min(1 - r.w, Math.max(0, r.x + dx));
      r.y = Math.min(1 - r.h, Math.max(0, r.y + dy));
    } else {
      let x0 = r.x; let y0 = r.y; let x1 = r.x + r.w; let y1 = r.y + r.h;
      if (mode.includes('l')) x0 = Math.min(x1 - MIN, Math.max(0, x0 + dx));
      if (mode.includes('r')) x1 = Math.max(x0 + MIN, Math.min(1, x1 + dx));
      if (mode.includes('t')) y0 = Math.min(y1 - MIN, Math.max(0, y0 + dy));
      if (mode.includes('b')) y1 = Math.max(y0 + MIN, Math.min(1, y1 + dy));
      Object.assign(r, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    rect = r;
    sync();
  });
  const end = () => { mode = null; };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
}

/** Set the crop rectangle (fractions of the displayed page). Test hook. */
export function setRect(r) { rect = { ...r }; sync(); }

/** Build the cropped PDF. */
export async function buildOutput() {
  const PDFLib = await loadPdfLib();
  const doc = await PDFLib.PDFDocument.load(src.bytes, { updateMetadata: false });
  const targets = scope === 'all' ? doc.getPages() : [doc.getPage(current)];
  for (const pg of targets) {
    const { width: Dw, height: Dh } = displaySize(pg);
    const a = displayToUser(pg, rect.x * Dw, rect.y * Dh);
    const b = displayToUser(pg, (rect.x + rect.w) * Dw, (rect.y + rect.h) * Dh);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x);
    const h = Math.abs(a.y - b.y);
    pg.setMediaBox(x, y, w, h);
    pg.setCropBox(x, y, w, h);
  }
  const bytes = await doc.save();
  return new File([bytes], `${safeName($('#fileName').value, 'dokumen')}.pdf`, { type: 'application/pdf' });
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
  rect = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
  $('#fileName').value = `${safeName(src.name, 'dokumen')}-potong`;
  setStatus('');
  sync();
  await showPage(0);
}

let busy = false;
async function exportPdf(share) {
  if (busy || !src) return;
  busy = true;
  $$('.options .buttons button').forEach((b) => { b.disabled = true; });
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
    setStatus(tr(openErrorKey(err)));
  } finally {
    busy = false;
    $$('.options .buttons button').forEach((b) => { b.disabled = false; });
  }
}

$$('input[name="cropScope"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) scope = r.value; }));
$('#prevPage').addEventListener('click', () => showPage(current - 1));
$('#nextPage').addEventListener('click', () => showPage(current + 1));
$('#cropReset').addEventListener('click', () => { rect = { x: 0, y: 0, w: 1, h: 1 }; sync(); });
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; openFile(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
$('#savePdf').addEventListener('click', () => exportPdf(false));
$('#sharePdf').addEventListener('click', () => exportPdf(true));
bindFileDrop($('#dropzone'), openFile);
bindRect();
ready = true;
sync();

// Exposed for the automated test only.
window.__crop = { buildOutput, openFile, setRect, get rect() { return rect; }, showPage };
