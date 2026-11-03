// Photo Collage: put 2, 4, 6 or 9 photos on one A4 page (IC front and back,
// receipts, proof of payment) and save it as a PDF or JPG. More photos than
// fit on a page simply start the next page. Runs in this tab; nothing is
// uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import * as store from './storage.js';
import { loadPhoto } from './image-loader.js';
import { writePdf, PAGE_SIZES } from './pdf.js';
import { makeZip } from './zip.js';
import { formatSize, download, shareOrDownload, shareFiles } from './pdf-kit.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const DECODE_MAX = 2600;
const DPI = 200;
const A4_MM = [210, 297];
const MARGIN_MM = 10;
const GAP_MM = 5;
const px = (mm) => Math.round((mm / 25.4) * DPI);
// Columns × rows for each choice, A4 portrait; landscape swaps them.
export const GRIDS = { 2: [1, 2], 4: [2, 2], 6: [2, 3], 9: [3, 3] };

const settings = { grid: '2', paper: 'portrait', fit: 'contain', border: false, format: 'pdf', ...store.load('collage', {}) };
if (!GRIDS[settings.grid]) settings.grid = '2';
/** @type {{id: number, name: string, canvas: HTMLCanvasElement, rotation: number, thumb: string}[]} */
let items = [];
let nextId = 1;
let ready = false;
let busy = false;

const page = initPage(() => { if (ready) render(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

/** Page size in pixels and the grid for the current settings. */
export function layout() {
  const land = settings.paper === 'landscape';
  const [w, h] = land ? [A4_MM[1], A4_MM[0]] : A4_MM;
  const [c, r] = GRIDS[settings.grid];
  const [cols, rows] = land ? [r, c] : [c, r];
  return { W: px(w), H: px(h), cols, rows, slots: cols * rows, land };
}
export const pageCount = () => Math.ceil(items.length / layout().slots);

function rotated(it) {
  if (!it.rotation) return it.canvas;
  const swap = it.rotation % 180 !== 0;
  const c = document.createElement('canvas');
  c.width = swap ? it.canvas.height : it.canvas.width;
  c.height = swap ? it.canvas.width : it.canvas.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((it.rotation * Math.PI) / 180);
  ctx.drawImage(it.canvas, -it.canvas.width / 2, -it.canvas.height / 2);
  return c;
}

/** Page `k` drawn at `scale` (1 = 200 DPI). */
export function renderPage(k, scale = 1) {
  const L = layout();
  const W = Math.round(L.W * scale);
  const H = Math.round(L.H * scale);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = 'high';
  const m = px(MARGIN_MM) * scale;
  const g = px(GAP_MM) * scale;
  const cw = (W - 2 * m - g * (L.cols - 1)) / L.cols;
  const ch = (H - 2 * m - g * (L.rows - 1)) / L.rows;
  items.slice(k * L.slots, (k + 1) * L.slots).forEach((it, i) => {
    const src = rotated(it);
    const cx = m + (i % L.cols) * (cw + g);
    const cy = m + Math.floor(i / L.cols) * (ch + g);
    const s = (settings.fit === 'cover' ? Math.max : Math.min)(cw / src.width, ch / src.height);
    const w = src.width * s;
    const h = src.height * s;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, cw, ch);
    ctx.clip();
    const x = cx + (cw - w) / 2;
    const y = cy + (ch - h) / 2;
    ctx.drawImage(src, x, y, w, h);
    ctx.restore();
    if (settings.border) {
      ctx.strokeStyle = '#9aa0a6';
      ctx.lineWidth = Math.max(1, 1.5 * scale);
      const bx = Math.max(cx, x); const by = Math.max(cy, y);
      ctx.strokeRect(bx, by, Math.min(cw, w), Math.min(ch, h));
    }
  });
  return c;
}

/* ---------- List and preview ---------- */

async function makeThumb(it) {
  const src = rotated(it);
  const s = Math.min(1, 240 / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * s));
  c.height = Math.max(1, Math.round(src.height * s));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
  if (it.thumb) URL.revokeObjectURL(it.thumb);
  it.thumb = URL.createObjectURL(blob);
}

function move(from, to) {
  if (to < 0 || to >= items.length) return;
  const [it] = items.splice(from, 1);
  items.splice(to, 0, it);
  render();
}

let previewRaf = 0;
function preview() {
  cancelAnimationFrame(previewRaf);
  previewRaf = requestAnimationFrame(() => {
    const box = $('#clPreview');
    box.textContent = '';
    const n = pageCount();
    for (let k = 0; k < n; k++) {
      const c = renderPage(k, 0.3);
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', tr('clPreviewLabel', { i: k + 1, n }));
      box.appendChild(c);
    }
  });
}

function render() {
  const grid = $('#photoGrid');
  grid.textContent = '';
  items.forEach((it, i) => {
    const li = document.createElement('li');
    li.className = 'page-card';
    const thumb = document.createElement('div');
    thumb.className = 'page-thumb';
    const img = document.createElement('img');
    img.alt = `${tr('clPhotos')} ${i + 1}: ${it.name}`;
    if (it.thumb) img.src = it.thumb;
    thumb.appendChild(img);
    const meta = document.createElement('div');
    meta.className = 'page-meta';
    const no = document.createElement('span');
    no.className = 'page-no';
    no.textContent = String(i + 1);
    const tools = document.createElement('span');
    tools.className = 'page-tools';
    const button = (label, text, onClick, disabled, cls) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `icon-btn${cls ? ` ${cls}` : ''}`;
      b.textContent = text;
      b.title = label;
      b.setAttribute('aria-label', `${label} (${i + 1})`);
      b.disabled = !!disabled;
      b.addEventListener('click', onClick);
      return b;
    };
    tools.append(
      button(tr('i2pMoveLeft'), '◀', () => move(i, i - 1), i === 0),
      button(tr('i2pMoveRight'), '▶', () => move(i, i + 1), i === items.length - 1),
      button(tr('i2pRotate'), '⟳', async () => { it.rotation = (it.rotation + 90) % 360; await makeThumb(it); render(); }),
      button(tr('i2pRemove'), '✕', () => {
        if (it.thumb) URL.revokeObjectURL(it.thumb);
        items = items.filter((x) => x !== it);
        render();
      }, false, 'danger'),
    );
    meta.append(no, tools);
    li.append(thumb, meta);
    grid.appendChild(li);
  });

  const n = items.length;
  const pages = pageCount();
  $('#count').textContent = String(n);
  $('#toolLayout').classList.toggle('is-empty', !n);
  if (n) {
    $('#docTitle').textContent = tr('icCount', { n });
    $('#docMeta').textContent = tr('clPages', { n, pages });
  }
  $$('input[name="clGrid"]').forEach((r) => { r.checked = r.value === settings.grid; });
  $$('input[name="clPaper"]').forEach((r) => { r.checked = r.value === settings.paper; });
  $$('input[name="clFit"]').forEach((r) => { r.checked = r.value === settings.fit; });
  $$('input[name="clFormat"]').forEach((r) => { r.checked = r.value === settings.format; });
  $('#clBorder').checked = settings.border;
  $('#clPages').textContent = n ? tr('clPages', { n, pages }) : '';
  $('#saveCollage').disabled = !n || busy;
  $('#shareCollage').disabled = !n || busy;
  preview();
}

/* ---------- Output ---------- */

const jpeg = (c) => new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));

/** The collage: one PDF, one JPG, or one JPG per page. @returns {Promise<File[]>} */
export async function buildFiles() {
  const n = pageCount();
  const blobs = [];
  for (let k = 0; k < n; k++) blobs.push(await jpeg(renderPage(k)));
  if (settings.format === 'jpeg') {
    return blobs.map((b, k) => new File([b], n > 1 ? `kolaj-${k + 1}.jpg` : 'kolaj.jpg', { type: 'image/jpeg' }));
  }
  const L = layout();
  const [W, H] = L.land ? [PAGE_SIZES.a4[1], PAGE_SIZES.a4[0]] : PAGE_SIZES.a4;
  const images = await Promise.all(blobs.map(async (b) => ({ jpeg: new Uint8Array(await b.arrayBuffer()), width: L.W, height: L.H })));
  const pdf = writePdf(images.map((_, i) => ({ width: W, height: H, items: [{ image: i, x: 0, y: 0, w: W, h: H }] })), images);
  return [new File([pdf], 'kolaj.pdf', { type: 'application/pdf' })];
}

async function save(share) {
  if (!items.length || busy) return;
  busy = true;
  render();
  setStatus(tr('working'));
  try {
    const files = await buildFiles();
    const msg = tr('clDone', { pages: pageCount(), size: formatSize(files.reduce((s, f) => s + f.size, 0)) });
    if (files.length === 1) {
      if (share) await shareOrDownload(files[0]); else download(files[0]);
    } else if (!share || (await shareFiles(files, 'DokuJaga')) === 'unsupported') {
      const entries = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
      download(new File([makeZip(entries)], 'kolaj-jpg.zip', { type: 'application/zip' }));
    }
    setStatus(msg);
  } catch {
    setStatus(tr('loadError'));
  } finally {
    busy = false;
    render();
  }
}

/* ---------- Input ---------- */

async function addFiles(list) {
  const all = [...list];
  const ok = all.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif|hei[cf])$/i.test(f.name));
  let failed = all.length - ok.length;
  if (ok.length) setStatus(tr('working'));
  for (const f of ok) {
    try {
      const it = { id: nextId++, name: f.name, canvas: await loadPhoto(f, DECODE_MAX), rotation: 0, thumb: '' };
      await makeThumb(it);
      items.push(it);
    } catch {
      failed++;
    }
    render();
  }
  setStatus(failed ? tr('i2pSkipped', { n: failed }) : '');
  render();
}

function changed(key, value) {
  settings[key] = value;
  store.save('collage', settings);
  render();
}
for (const name of ['clGrid', 'clPaper', 'clFit', 'clFormat']) {
  const key = name.slice(2).toLowerCase();
  $$(`input[name="${name}"]`).forEach((r) => r.addEventListener('change', () => { if (r.checked) changed(key, r.value); }));
}
$('#clBorder').addEventListener('change', (e) => changed('border', e.target.checked));
$('#saveCollage').addEventListener('click', () => save(false));
$('#shareCollage').addEventListener('click', () => save(true));
$('#clearAll').addEventListener('click', () => { items.forEach((it) => it.thumb && URL.revokeObjectURL(it.thumb)); items = []; setStatus(''); render(); });
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); });
$('#pickCamera').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
document.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
document.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
document.addEventListener('paste', (e) => {
  const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter((f) => /^image\//.test(f.type));
  if (files.length) { e.preventDefault(); addFiles(files); }
});
ready = true;
render();

// Exposed for the automated test only.
window.__collage = { addFiles, buildFiles, renderPage, layout, settings, get items() { return items; } };
