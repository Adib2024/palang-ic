// Compress / resize images. Each image is decoded, optionally scaled down and
// re-encoded on a canvas, which also drops EXIF metadata (GPS, device, date).
// Runs entirely in this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import * as store from './storage.js';
import { loadPhoto } from './image-loader.js';
import { makeZip } from './zip.js';
import { formatSize, download, shareFiles } from './pdf-kit.js';

const DECODE_MAX = 8000; // keep originals at full size up to 8000 px
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const settings = { limit: '0', maxDim: '0', format: 'jpeg', ...store.load('imgsmall', {}) };
/** @type {{id: number, name: string, size: number, canvas: HTMLCanvasElement, thumb: string, out: File|null, outW?: number, outH?: number, over: boolean}[]} */
let items = [];
let nextId = 1;
let ready = false;

const page = initPage(() => { if (ready) render(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };
function setProgress(f) {
  $('#progress').hidden = f == null;
  $('#progressBar').style.width = `${Math.round((f || 0) * 100)}%`;
}

/* ---------- Encoding ---------- */

function scaled(src, maxDim) {
  const s = maxDim ? Math.min(1, maxDim / Math.max(src.width, src.height)) : 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * s));
  c.height = Math.max(1, Math.round(src.height * s));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function flattenWhite(c) {
  // JPEG has no transparency: put transparent areas on white, not black.
  const out = document.createElement('canvas');
  out.width = c.width;
  out.height = c.height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(c, 0, 0);
  return out;
}

const encode = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));

/**
 * Encode `src` within `limit` bytes if possible: highest JPEG quality that
 * fits, then smaller dimensions if even low quality is too big.
 * @returns {Promise<{blob: Blob, width: number, height: number, over: boolean}>}
 */
export async function fit(src, { limit, maxDim, format }) {
  const type = format === 'png' ? 'image/png' : 'image/jpeg';
  let c = scaled(src, maxDim);
  if (type === 'image/jpeg') c = flattenWhite(c);
  let best = null;
  for (let round = 0; round < 10; round++) {
    if (type === 'image/png') {
      const blob = await encode(c, type);
      best = { blob, width: c.width, height: c.height };
      if (!limit || blob.size <= limit) return { ...best, over: false };
    } else {
      const top = await encode(c, type, 0.9);
      if (!limit || top.size <= limit) return { blob: top, width: c.width, height: c.height, over: false };
      let lo = 0.3;
      let hi = 0.9;
      let found = null;
      for (let i = 0; i < 7; i++) {
        const q = (lo + hi) / 2;
        const blob = await encode(c, type, q);
        if (blob.size <= limit) { found = blob; lo = q; } else hi = q;
      }
      if (!found) {
        const floor = await encode(c, type, 0.3);
        if (floor.size <= limit) found = floor;
        else best = { blob: floor, width: c.width, height: c.height };
      }
      if (found) return { blob: found, width: c.width, height: c.height, over: false };
    }
    if (c.width < 64 || c.height < 64) break;
    c = scaled(c, Math.round(Math.max(c.width, c.height) * 0.8));
  }
  return { ...best, over: true };
}

/* ---------- Items ---------- */

async function addFiles(fileList) {
  const files = [...fileList];
  const images = files.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name));
  let added = 0;
  setStatus(tr('working'));
  for (const file of images) {
    try {
      const canvas = await loadPhoto(file, DECODE_MAX);
      const small = scaled(canvas, 240);
      const thumb = await new Promise((r) => small.toBlob((b) => r(b ? URL.createObjectURL(b) : ''), 'image/jpeg', 0.8));
      items.push({ id: nextId++, name: file.name, size: file.size, canvas, thumb, out: null, over: false });
      added++;
      render();
    } catch { /* undecodable: counted as skipped */ }
  }
  const msgs = [];
  if (added) msgs.push(tr('i2pAdded', { n: added }));
  if (files.length - added) msgs.push(tr('i2pSkipped', { n: files.length - added }));
  setStatus(msgs.join(' '));
}

function outName(name, format) {
  const base = name.replace(/\.[^.]+$/, '') || 'gambar';
  return `${base}-kecil.${format === 'png' ? 'png' : 'jpg'}`;
}

function render() {
  const list = $('#imgList');
  list.textContent = '';
  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'img-item';
    const img = document.createElement('img');
    img.alt = '';
    if (it.thumb) img.src = it.thumb;
    const info = document.createElement('div');
    info.className = 'img-info';
    const name = document.createElement('strong');
    name.textContent = it.name;
    name.title = it.name;
    const meta = document.createElement('span');
    meta.className = 'img-meta';
    meta.textContent = `${it.canvas.width}×${it.canvas.height} · ${formatSize(it.size)}`;
    info.append(name, meta);
    if (it.out) {
      const res = document.createElement('span');
      res.className = `img-result${it.over ? ' warn' : ''}`;
      const pct = Math.round((1 - it.out.size / it.size) * 100);
      res.textContent = `→ ${it.outW}×${it.outH} · ${formatSize(it.out.size)}${pct > 0 ? ` (−${pct}%)` : ''}${it.over ? ` · ${tr('isOver', { limit: formatSize(Number(settings.limit)) })}` : ''}`;
      info.appendChild(res);
    }
    const actions = document.createElement('div');
    actions.className = 'img-actions';
    if (it.out) {
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn small';
      save.textContent = tr('isSaveOne');
      save.addEventListener('click', () => download(it.out));
      actions.appendChild(save);
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'icon-btn danger';
    rm.textContent = '✕';
    rm.title = tr('i2pRemove');
    rm.setAttribute('aria-label', `${tr('i2pRemove')}: ${it.name}`);
    rm.addEventListener('click', () => {
      if (it.thumb) URL.revokeObjectURL(it.thumb);
      items = items.filter((x) => x !== it);
      render();
    });
    actions.appendChild(rm);
    li.append(img, info, actions);
    list.appendChild(li);
  }
  const done = items.length && items.every((it) => it.out);
  $('#count').textContent = String(items.length);
  $('#toolLayout').classList.toggle('is-empty', items.length === 0);
  $('#run').disabled = items.length === 0;
  $('#saveAll').disabled = !done;
  $('#shareAll').disabled = !done;
  $('#pngNote').hidden = settings.format !== 'png';
}

/** Compress every image with the current settings. */
export async function runAll() {
  const opts = { limit: Number(settings.limit) || 0, maxDim: Number(settings.maxDim) || 0, format: settings.format };
  for (let i = 0; i < items.length; i++) {
    setStatus(tr('cmpProgress', { i: i + 1, n: items.length }));
    setProgress(i / items.length);
    const it = items[i];
    const r = await fit(it.canvas, opts);
    const file = new File([r.blob], outName(it.name, settings.format), { type: r.blob.type });
    it.out = file;
    it.outW = r.width;
    it.outH = r.height;
    it.over = r.over;
  }
  setProgress(null);
  const from = items.reduce((n, it) => n + it.size, 0);
  const to = items.reduce((n, it) => n + it.out.size, 0);
  setStatus(tr('isDone', { n: items.length, from: formatSize(from), to: formatSize(to) }));
  render();
}

async function saveAll(share) {
  const files = items.map((it) => it.out).filter(Boolean);
  if (!files.length) return;
  if (share) {
    const how = await shareFiles(files, 'DokuJaga');
    if (how !== 'unsupported') return;
  }
  if (files.length === 1) { download(files[0]); return; }
  const entries = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
  download(new File([makeZip(entries)], 'gambar-kecil.zip', { type: 'application/zip' }));
  if (share) setStatus(tr('shareFallback'));
}

/* ---------- Boot ---------- */

function invalidate() {
  items.forEach((it) => { it.out = null; it.over = false; });
  store.save('imgsmall', settings);
  render();
}
$('#limit').value = settings.limit;
$('#maxDim').value = settings.maxDim;
$('#limit').addEventListener('change', (e) => { settings.limit = e.target.value; invalidate(); });
$('#maxDim').addEventListener('change', (e) => { settings.maxDim = e.target.value; invalidate(); });
$$('input[name="format"]').forEach((r) => {
  r.checked = r.value === settings.format;
  r.addEventListener('change', () => { if (r.checked) { settings.format = r.value; invalidate(); } });
});
let busy = false;
$('#run').addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  $('#run').disabled = true;
  try { await runAll(); } finally { busy = false; render(); }
});
$('#saveAll').addEventListener('click', () => saveAll(false));
$('#shareAll').addEventListener('click', () => saveAll(true));
$('#clearAll').addEventListener('click', () => {
  items.forEach((it) => it.thumb && URL.revokeObjectURL(it.thumb));
  items = [];
  setStatus('');
  render();
});
$('#pickFiles').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
$('#pickCamera').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
document.addEventListener('dragover', (e) => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); $('#dropzone').classList.add('over'); }
});
document.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) $('#dropzone').classList.remove('over'); });
document.addEventListener('drop', (e) => {
  if (!(e.dataTransfer && e.dataTransfer.files.length)) return;
  e.preventDefault();
  $('#dropzone').classList.remove('over');
  addFiles(e.dataTransfer.files);
});

ready = true;
render();

// Exposed for the automated test only.
window.__imgsmall = { settings, fit, runAll, addFiles, get items() { return items; } };
