// Passport / profile photo: frame a face photo to an official size, brighten
// it (and the background), then save one photo or a print sheet (4R JPG or
// A4 PDF) with cut lines. Runs in this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import * as store from './storage.js';
import { loadPhoto } from './image-loader.js';
import { writePdf } from './pdf.js';
import { formatSize, download } from './pdf-kit.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const DPI = 600; // single photo
const SHEET_DPI = 300; // print sheets
const mm = (v, dpi) => Math.round((v / 25.4) * dpi);
export const SIZES = { my: [35, 50], intl: [35, 45] };
export const PAPERS = { '4r': [102, 152], a4: [210, 297] };

const settings = { size: 'my', w: 40, h: 50, paper: '4r', bright: 0, contrast: 0, white: 0, ...store.load('passport', {}) };
let photo = null; // {canvas, name}
let view = { zoom: 1, cx: 0, cy: 0 }; // image point shown at the frame centre
let ready = false;

const page = initPage(() => { if (ready) sync(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

/** Photo size in mm. */
export function sizeMm() {
  if (settings.size === 'custom') return [Math.min(100, Math.max(15, Number(settings.w) || 35)), Math.min(120, Math.max(15, Number(settings.h) || 45))];
  return SIZES[settings.size] || SIZES.my;
}

/** How many photos fit on the paper (2 mm gaps, 4 mm margins). */
export function layout(paper = settings.paper) {
  const [pw, ph] = PAPERS[paper];
  const [w, h] = sizeMm();
  const gap = 2;
  const margin = 4;
  const cols = Math.max(0, Math.floor((pw - 2 * margin + gap) / (w + gap)));
  const rows = Math.max(0, Math.floor((ph - 2 * margin + gap) / (h + gap)));
  return { cols, rows, n: cols * rows, pw, ph, w, h, gap };
}

/* ---------- Rendering ---------- */

function coverScale(fw, fh) {
  return Math.max(fw / photo.canvas.width, fh / photo.canvas.height);
}

function clampView(fw, fh) {
  const s = coverScale(fw, fh) * view.zoom;
  const hw = fw / (2 * s);
  const hh = fh / (2 * s);
  const { width: iw, height: ih } = photo.canvas;
  view.cx = Math.min(iw - hw, Math.max(hw, view.cx));
  view.cy = Math.min(ih - hh, Math.max(hh, view.cy));
}

/** Brightness, contrast and background whitening on a canvas, in place. */
export function adjust(c, { bright = 0, contrast = 0, white = 0 }) {
  if (!bright && !contrast && !white) return c;
  const ctx = c.getContext('2d');
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const b = bright * 2.55;
  const cv = contrast * 2.55;
  const f = (259 * (cv + 255)) / (255 * (259 - cv));
  const thr = 255 - white * 1.4; // whiter backgrounds: light pixels pushed to white
  for (let i = 0; i < d.length; i += 4) {
    let r = f * (d[i] - 128) + 128 + b;
    let g = f * (d[i + 1] - 128) + 128 + b;
    let bl = f * (d[i + 2] - 128) + 128 + b;
    if (white) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * bl;
      if (lum > thr) {
        const k = Math.min(1, (lum - thr) / 45);
        r += (255 - r) * k; g += (255 - g) * k; bl += (255 - bl) * k;
      }
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = bl;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** The framed photo at `fw`×`fh` pixels. */
function framed(fw, fh) {
  clampView(fw, fh);
  const c = document.createElement('canvas');
  c.width = fw;
  c.height = fh;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, fw, fh);
  ctx.imageSmoothingQuality = 'high';
  const s = coverScale(fw, fh) * view.zoom;
  ctx.drawImage(photo.canvas, fw / 2 - view.cx * s, fh / 2 - view.cy * s, photo.canvas.width * s, photo.canvas.height * s);
  return adjust(c, settings);
}

let raf = 0;
function draw() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    if (!photo) return;
    const cv = $('#ppCanvas');
    const [w, h] = sizeMm();
    const W = 600;
    const H = Math.round((W * h) / w);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    ctx.drawImage(framed(W, H), 0, 0);
    // Face guide (preview only): an oval and the usual head band.
    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(14, 165, 233, .9)';
    ctx.beginPath();
    ctx.ellipse(W / 2, H * 0.45, W * 0.27, H * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(14, 165, 233, .55)';
    for (const y of [H * 0.12, H * 0.78]) { ctx.beginPath(); ctx.moveTo(W * 0.1, y); ctx.lineTo(W * 0.9, y); ctx.stroke(); }
    ctx.restore();
  });
}

function sync() {
  $('#toolLayout').classList.toggle('is-empty', !photo);
  $$('input[name="ppSize"]').forEach((r) => { r.checked = r.value === settings.size; });
  $$('input[name="ppPaper"]').forEach((r) => { r.checked = r.value === settings.paper; });
  $('#ppCustomRow').hidden = settings.size !== 'custom';
  for (const [id, key, unit] of [['#ppBright', 'bright', ''], ['#ppContrast', 'contrast', ''], ['#ppWhite', 'white', '%']]) {
    $(id).value = settings[key];
    $(`${id}Out`).textContent = `${settings[key] > 0 && unit === '' ? '+' : ''}${settings[key]}${unit}`;
  }
  $('#ppZoom').value = Math.round(view.zoom * 100);
  $('#ppZoomOut').textContent = `${Math.round(view.zoom * 100)}%`;
  const L = layout();
  const [w, h] = sizeMm();
  $('#ppCopies').textContent = tr('ppCopies', { n: L.n, paper: settings.paper === 'a4' ? 'A4' : '4R', size: `${w}×${h} mm` });
  if (photo) {
    $('#docTitle').textContent = photo.name;
    $('#docMeta').textContent = `${photo.canvas.width}×${photo.canvas.height}`;
  }
  $('#savePhoto').disabled = !photo;
  $('#saveSheet').disabled = !photo || !L.n;
  draw();
}

/* ---------- Output ---------- */

const jpeg = (c, q = 0.92) => new Promise((r) => c.toBlob(r, 'image/jpeg', q));

/** One photo at 600 DPI. */
export async function photoFile() {
  const [w, h] = sizeMm();
  const blob = await jpeg(framed(mm(w, DPI), mm(h, DPI)));
  return new File([blob], `gambar-pasport-${w}x${h}mm.jpg`, { type: 'image/jpeg' });
}

/** A print sheet: 4R as JPG, A4 as PDF (both at 300 DPI, real size). */
export async function sheetFile() {
  const L = layout();
  const sw = mm(L.pw, SHEET_DPI);
  const sh = mm(L.ph, SHEET_DPI);
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, sw, sh);
  const pw = mm(L.w, SHEET_DPI);
  const ph = mm(L.h, SHEET_DPI);
  const one = framed(pw, ph);
  const gridW = L.cols * L.w + (L.cols - 1) * L.gap;
  const gridH = L.rows * L.h + (L.rows - 1) * L.gap;
  const x0 = (L.pw - gridW) / 2;
  const y0 = (L.ph - gridH) / 2;
  ctx.strokeStyle = '#bdbdbd';
  ctx.lineWidth = 1;
  for (let r = 0; r < L.rows; r++) {
    for (let k = 0; k < L.cols; k++) {
      const x = mm(x0 + k * (L.w + L.gap), SHEET_DPI);
      const y = mm(y0 + r * (L.h + L.gap), SHEET_DPI);
      ctx.drawImage(one, x, y, pw, ph);
      ctx.strokeRect(x - 0.5, y - 0.5, pw + 1, ph + 1); // cut line
    }
  }
  const blob = await jpeg(c, 0.92);
  if (settings.paper === '4r') return new File([blob], 'helaian-pasport-4R.jpg', { type: 'image/jpeg' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const [W, H] = [(L.pw / 25.4) * 72, (L.ph / 25.4) * 72];
  const pdf = writePdf([{ width: W, height: H, items: [{ image: 0, x: 0, y: 0, w: W, h: H }] }], [{ jpeg: bytes, width: sw, height: sh }]);
  return new File([pdf], 'helaian-pasport-A4.pdf', { type: 'application/pdf' });
}

async function save(kind) {
  if (!photo) return;
  setStatus(tr('working'));
  const file = kind === 'sheet' ? await sheetFile() : await photoFile();
  download(file);
  setStatus(tr(kind === 'sheet' ? 'ppSheetDone' : 'ppPhotoDone', { size: formatSize(file.size), n: layout().n }));
}

/* ---------- Input ---------- */

async function openFile(list) {
  const file = [...list].find((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
  if (!file) { setStatus(tr('loadError')); return; }
  setStatus(tr('working'));
  try {
    const canvas = await loadPhoto(file, 3000);
    photo = { canvas, name: file.name };
    view = { zoom: 1, cx: canvas.width / 2, cy: canvas.height * 0.45 };
    setStatus('');
  } catch {
    setStatus(tr('loadError'));
  }
  sync();
}

function saveSettings() { store.save('passport', settings); }
$$('input[name="ppSize"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) { settings.size = r.value; saveSettings(); sync(); } }));
$$('input[name="ppPaper"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) { settings.paper = r.value; saveSettings(); sync(); } }));
for (const [id, key] of [['#ppW', 'w'], ['#ppH', 'h']]) {
  $(id).value = settings[key];
  $(id).addEventListener('input', () => { settings[key] = Number($(id).value) || 0; saveSettings(); sync(); });
}
for (const [id, key] of [['#ppBright', 'bright'], ['#ppContrast', 'contrast'], ['#ppWhite', 'white']]) {
  $(id).addEventListener('input', () => { settings[key] = Number($(id).value); sync(); });
  $(id).addEventListener('change', saveSettings);
}
$('#ppZoom').addEventListener('input', (e) => { view.zoom = Number(e.target.value) / 100; sync(); });

// Drag to move the photo in the frame; wheel / + − to zoom; arrows to move.
(function pan() {
  const cv = $('#ppCanvas');
  let last = null;
  const scale = () => {
    const r = cv.getBoundingClientRect();
    return coverScale(cv.width, cv.height) * view.zoom * (r.width / cv.width);
  };
  cv.addEventListener('pointerdown', (e) => { if (!photo) return; last = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => {
    if (!last) return;
    const s = scale();
    view.cx -= (e.clientX - last.x) / s;
    view.cy -= (e.clientY - last.y) / s;
    last = { x: e.clientX, y: e.clientY };
    draw();
  });
  const end = () => { last = null; };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', (e) => {
    if (!photo) return;
    e.preventDefault();
    view.zoom = Math.min(4, Math.max(1, view.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
    sync();
  }, { passive: false });
  cv.addEventListener('keydown', (e) => {
    if (!photo) return;
    const step = 10 / scale();
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) { view.cx += moves[e.key][0]; view.cy += moves[e.key][1]; }
    else if (e.key === '+' || e.key === '=') view.zoom = Math.min(4, view.zoom * 1.1);
    else if (e.key === '-') view.zoom = Math.max(1, view.zoom / 1.1);
    else return;
    e.preventDefault();
    sync();
  });
})();

$('#savePhoto').addEventListener('click', () => save('photo'));
$('#saveSheet').addEventListener('click', () => save('sheet'));
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; openFile(f); });
$('#pickCamera').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; openFile(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
document.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
document.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); openFile(e.dataTransfer.files); } });
ready = true;
sync();

// Exposed for the automated test only.
window.__passport = { openFile, photoFile, sheetFile, layout, settings, get view() { return view; }, get photo() { return photo; } };
