// Sign PDF: draw / type / upload a signature, place it (and text) on pages,
// then write it into the PDF with pdf-lib. Everything stays in this tab.
import { initPage } from './page.js';
import { t, todayDMY } from './i18n.js';
import * as store from './storage.js';
import { loadPhoto } from './image-loader.js';
import {
  loadPdfLib, openForRender, renderPage, isPdf, formatSize, safeName, download, shareOrDownload, openErrorKey,
} from './pdf-kit.js';

const TYPE_FONTS = [
  'italic 400 140px "Segoe Script", "Brush Script MT", "Snell Roundhand", "URW Chancery L", cursive',
  'italic 600 120px Georgia, "Times New Roman", serif',
  '600 110px Inter, system-ui, sans-serif',
];
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const settings = { tab: 'draw', ink: '#111111', typeStyle: '0', ...store.load('sign', {}) };
/** @type {{name: string, bytes: Uint8Array, doc: any} | null} */
let input = null;
/** @type {{el: HTMLElement, vp: any}[]} one per page; vp = pdf.js viewport at scale 1 */
let views = [];
/** @type {{id: number, page: number, fx: number, fy: number, fw: number, fh: number, aspect: number, canvas: HTMLCanvasElement, el: HTMLElement}[]} */
let items = [];
let nextId = 1;
let activePage = 0;
let ready = false;
let imageSource = null; // processed uploaded signature

const page = initPage(() => { if (ready) syncLabels(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

/* ---------- Canvas helpers ---------- */

/** Crop a canvas to its non-transparent pixels (plus a small margin). */
export function trim(src, pad = 8) {
  const ctx = src.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, src.width, src.height);
  let x0 = width; let y0 = height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function textCanvas(text, font, color) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 40;
  const h = Math.ceil(parseInt(font.match(/(\d+)px/)[1], 10) * 1.6);
  c.width = Math.max(1, w);
  c.height = h;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 20, h / 2);
  return trim(c, 4);
}

function fitInto(target, src) {
  const ctx = target.getContext('2d');
  ctx.clearRect(0, 0, target.width, target.height);
  if (!src) return;
  const s = Math.min(1, (target.width - 40) / src.width, (target.height - 40) / src.height);
  const w = src.width * s;
  const h = src.height * s;
  ctx.drawImage(src, (target.width - w) / 2, (target.height - h) / 2, w, h);
}

/* ---------- Signature sources ---------- */

let padDirty = false;
function bindPad() {
  const pad = $('#pad');
  const ctx = pad.getContext('2d');
  let drawing = false;
  let last = null;
  const pt = (e) => {
    const r = pad.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * pad.width, y: ((e.clientY - r.top) / r.height) * pad.height };
  };
  pad.addEventListener('pointerdown', (e) => {
    drawing = true;
    pad.setPointerCapture(e.pointerId);
    last = pt(e);
    ctx.strokeStyle = settings.ink;
    ctx.fillStyle = settings.ink;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    padDirty = true;
  });
  pad.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pt(e);
    const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  });
  const end = () => { drawing = false; };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
  $('#padClear').addEventListener('click', () => {
    ctx.clearRect(0, 0, pad.width, pad.height);
    padDirty = false;
  });
}

function typedSignature() {
  const name = $('#typedName').value.trim();
  if (!name) return null;
  return textCanvas(name, TYPE_FONTS[Number(settings.typeStyle)] || TYPE_FONTS[0], settings.ink);
}

function updateTypedPreview() {
  fitInto($('#typedPreview'), typedSignature());
}

async function loadSignatureImage(file) {
  const photo = await loadPhoto(file, 2000);
  const ctx = photo.getContext('2d');
  if ($('#removeBg').checked) {
    const img = ctx.getImageData(0, 0, photo.width, photo.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      // Paper → transparent, ink → opaque, with a soft edge in between.
      d[i + 3] = lum > 215 ? 0 : lum < 150 ? 255 : Math.round(((215 - lum) / 65) * 255);
    }
    ctx.putImageData(img, 0, 0);
  }
  imageSource = trim(photo, 4);
  fitInto($('#imagePreview'), imageSource);
}

/** The current signature as a trimmed transparent canvas, or null. */
function currentSignature() {
  if (settings.tab === 'draw') return padDirty ? trim($('#pad')) : null;
  if (settings.tab === 'type') return typedSignature();
  return imageSource;
}

/* ---------- Document ---------- */

async function openFile(file) {
  if (!file) return;
  if (!isPdf(file)) { setStatus(tr('pdfOpenError')); return; }
  setStatus(tr('pdfLoading'));
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await openForRender(bytes);
    if (input) input.doc.destroy();
    input = { name: file.name, bytes, doc };
    items = [];
    views = [];
    activePage = 0;
    $('#fileName').value = `${safeName(file.name, 'dokumen')}-ditandatangan`;
    const host = $('#signPages');
    host.textContent = '';
    syncLabels();
    const width = Math.min(1000, Math.max(300, host.clientWidth || 600));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (let i = 0; i < doc.numPages; i++) {
      const pg = await doc.getPage(i + 1);
      const vp = pg.getViewport({ scale: 1 });
      const wrap = document.createElement('div');
      wrap.className = 'sign-page';
      wrap.dataset.page = String(i);
      wrap.style.aspectRatio = `${vp.width} / ${vp.height}`;
      const label = document.createElement('span');
      label.className = 'sign-page-no';
      label.textContent = tr('sigPage', { n: i + 1 });
      const canvas = await renderPage(pg, (width * dpr) / vp.width);
      canvas.className = 'sign-canvas';
      wrap.append(canvas, label);
      wrap.addEventListener('pointerdown', (e) => {
        if (e.target === wrap || e.target === canvas) { setActive(i); select(null); }
      });
      host.appendChild(wrap);
      views.push({ el: wrap, vp });
    }
    setActive(0);
    setStatus('');
  } catch (err) {
    setStatus(tr(openErrorKey(err)));
  }
}

function setActive(i) {
  activePage = i;
  views.forEach((v, k) => v.el.classList.toggle('active', k === i));
  syncLabels();
}

function syncLabels() {
  $('#toolLayout').classList.toggle('is-empty', !input);
  $('#dropzone').hidden = !!input;
  $('#fileCard').hidden = !input;
  if (!input) return;
  $('#docTitle').textContent = input.name;
  $('#fileMeta').textContent = `${tr('pdfPagesN', { n: input.doc.numPages })} · ${formatSize(input.bytes.length)}`;
  $('#activeLabel').textContent = tr('sigActivePage', { n: activePage + 1 });
  views.forEach((v, i) => { v.el.querySelector('.sign-page-no').textContent = tr('sigPage', { n: i + 1 }); });
}

/* ---------- Placed items ---------- */

function place(it) {
  Object.assign(it.el.style, {
    left: `${it.fx * 100}%`, top: `${it.fy * 100}%`, width: `${it.fw * 100}%`, height: `${it.fh * 100}%`,
  });
}

function select(it) {
  items.forEach((x) => x.el.classList.toggle('selected', x === it));
}

/** Add a placed item (signature/text) to the active page. `widthFrac` of page width. */
export function addItem(canvas, widthFrac) {
  if (!input || !canvas) return null;
  const view = views[activePage];
  const aspect = canvas.height / canvas.width;
  const fw = Math.min(0.9, widthFrac);
  const fh = Math.min(0.9, (fw * view.vp.width * aspect) / view.vp.height);
  // Stagger new items on the same page so they don't land on top of each other.
  const k = items.filter((x) => x.page === activePage).length;
  const fy = Math.min(1 - fh, Math.max(0, (1 - fh) / 2 + ((k % 5) - 1) * 0.08));
  const it = { id: nextId++, page: activePage, fx: (1 - fw) / 2, fy, fw, fh, aspect, canvas, el: null };

  const el = document.createElement('div');
  el.className = 'sig-item';
  el.tabIndex = 0;
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  img.src = canvas.toDataURL('image/png');
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'sig-del';
  del.textContent = '✕';
  del.setAttribute('aria-label', tr('sigDelete'));
  const handle = document.createElement('span');
  handle.className = 'sig-handle';
  handle.setAttribute('aria-hidden', 'true');
  el.append(img, del, handle);
  it.el = el;
  view.el.appendChild(el);
  place(it);
  items.push(it);
  bindItem(it, view);
  select(it);
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return it;
}

function removeItem(it) {
  it.el.remove();
  items = items.filter((x) => x !== it);
}

function bindItem(it, view) {
  const el = it.el;
  let mode = null;
  let start = null;
  el.querySelector('.sig-del').addEventListener('click', (e) => { e.stopPropagation(); removeItem(it); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Delete' || e.key === 'Backspace') removeItem(it); });
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.sig-del')) return;
    e.preventDefault();
    e.stopPropagation();
    select(it);
    setActive(it.page);
    mode = e.target.closest('.sig-handle') ? 'resize' : 'move';
    start = { x: e.clientX, y: e.clientY, fx: it.fx, fy: it.fy, fw: it.fw };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!mode) return;
    const r = view.el.getBoundingClientRect();
    const dx = (e.clientX - start.x) / r.width;
    const dy = (e.clientY - start.y) / r.height;
    if (mode === 'move') {
      it.fx = Math.min(1 - it.fw, Math.max(0, start.fx + dx));
      it.fy = Math.min(1 - it.fh, Math.max(0, start.fy + dy));
    } else {
      const ratio = (view.vp.width * it.aspect) / view.vp.height; // fh per fw
      const maxW = Math.min(1 - it.fx, (1 - it.fy) / ratio);
      it.fw = Math.min(maxW, Math.max(0.03, start.fw + dx));
      it.fh = it.fw * ratio;
    }
    place(it);
  });
  const end = () => { mode = null; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

/* ---------- Export ---------- */

const pngBytes = (canvas) => new Promise((resolve) => canvas.toBlob(async (b) => resolve(new Uint8Array(await b.arrayBuffer())), 'image/png'));

/** Write the placed items into the PDF and return the new File. */
export async function buildSigned() {
  if (!items.length) throw new Error('empty');
  const PDFLib = await loadPdfLib();
  const doc = await PDFLib.PDFDocument.load(input.bytes, { updateMetadata: false });
  const embedded = new Map();
  for (const it of items) {
    let img = embedded.get(it.canvas);
    if (!img) {
      img = await doc.embedPng(await pngBytes(it.canvas));
      embedded.set(it.canvas, img);
    }
    const { vp } = views[it.page];
    const du = it.fx * vp.width;
    const dv = it.fy * vp.height;
    const dw = it.fw * vp.width;
    const dh = it.fh * vp.height;
    // Bottom-left of the box on screen, in PDF user space. Rotating by the
    // page's /Rotate keeps the image upright on rotated pages.
    const [x, y] = vp.convertToPdfPoint(du, dv + dh);
    doc.getPage(it.page).drawImage(img, { x, y, width: dw, height: dh, rotate: PDFLib.degrees(vp.rotation) });
  }
  const bytes = await doc.save();
  const name = safeName($('#fileName').value, `${safeName(input.name, 'dokumen')}-ditandatangan`);
  return new File([bytes], `${name}.pdf`, { type: 'application/pdf' });
}

let busy = false;
async function exportPdf(share) {
  if (busy || !input) return;
  busy = true;
  setStatus(tr('working'));
  try {
    const file = await buildSigned();
    const done = tr('sigDone', { n: items.length, size: formatSize(file.size) });
    if (share) {
      const how = await shareOrDownload(file);
      setStatus(how === 'cancelled' ? '' : how === 'downloaded' ? `${tr('shareFallback')} ${done}` : done);
    } else {
      download(file);
      setStatus(done);
    }
  } catch (err) {
    setStatus(err && err.message === 'empty' ? tr('sigNoItems') : tr(openErrorKey(err)));
  } finally {
    busy = false;
  }
}

/* ---------- Boot ---------- */

function syncTab() {
  $$('[data-tab]').forEach((el) => { el.hidden = el.dataset.tab !== settings.tab; });
}
$$('input[name="sigTab"]').forEach((r) => {
  r.checked = r.value === settings.tab;
  r.addEventListener('change', () => { if (r.checked) { settings.tab = r.value; store.save('sign', { ...settings }); syncTab(); } });
});
$$('input[name="ink"]').forEach((r) => {
  r.checked = r.value === settings.ink;
  r.addEventListener('change', () => { if (r.checked) { settings.ink = r.value; store.save('sign', { ...settings }); updateTypedPreview(); } });
});
$$('input[name="typeStyle"]').forEach((r) => {
  r.checked = r.value === settings.typeStyle;
  r.addEventListener('change', () => { if (r.checked) { settings.typeStyle = r.value; store.save('sign', { ...settings }); updateTypedPreview(); } });
});
$('#typedName').addEventListener('input', updateTypedPreview);
$('#sigFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) {
    try { await loadSignatureImage(f); } catch { setStatus(tr('loadError')); }
  }
});
$('#removeBg').addEventListener('change', () => { setStatus(''); });

$('#addSig').addEventListener('click', () => {
  if (!input) { setStatus(tr('sigNoPdf')); return; }
  const sig = currentSignature();
  if (!sig) { setStatus(tr('sigEmptyPad')); return; }
  setStatus('');
  addItem(sig, 0.28);
});
$('#addText').addEventListener('click', () => {
  const text = $('#extraText').value.trim();
  if (!input) { setStatus(tr('sigNoPdf')); return; }
  if (!text) { $('#extraText').focus(); return; }
  addItem(textCanvas(text, '500 72px Inter, system-ui, sans-serif', '#111111'), Math.min(0.6, 0.022 * text.length + 0.06));
});
$('#addDate').addEventListener('click', () => {
  if (!input) { setStatus(tr('sigNoPdf')); return; }
  addItem(textCanvas(todayDMY(), '500 72px Inter, system-ui, sans-serif', '#111111'), 0.2);
});
$('#pickFiles').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; openFile(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
$('#savePdf').addEventListener('click', () => exportPdf(false));
$('#sharePdf').addEventListener('click', () => exportPdf(true));
document.addEventListener('dragover', (e) => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); $('#dropzone').classList.add('over'); }
});
document.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) $('#dropzone').classList.remove('over'); });
document.addEventListener('drop', (e) => {
  if (!(e.dataTransfer && e.dataTransfer.files.length)) return;
  e.preventDefault();
  $('#dropzone').classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (isPdf(f)) openFile(f);
});

bindPad();
syncTab();
ready = true;
syncLabels();

// Exposed for the automated test only.
window.__sign = {
  openFile, addItem, buildSigned, trim, textCanvas,
  get items() { return items; }, get views() { return views; }, setActive,
};
