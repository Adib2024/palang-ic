// Convert Images: JPG / PNG / WebP (any picture the device can open, plus
// iPhone HEIC) at full size, one or many at once. EXIF is dropped.
// Runs entirely in this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import * as store from './storage.js';
import { loadPhoto } from './image-loader.js';
import { makeZip } from './zip.js';
import { formatSize, download, shareFiles } from './pdf-kit.js';
import { WEBP_OK } from './webp.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const DECODE_MAX = 10000;
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' };

const settings = { format: 'jpeg', quality: 92, white: true, ...store.load('imgconvert', {}) };
if (settings.format === 'webp' && !WEBP_OK) settings.format = 'jpeg';
/** @type {{id: number, file: File, name: string, size: number, out: File|null}[]} */
let items = [];
let nextId = 1;
let ready = false;
let busy = false;

const page = initPage(() => { if (ready) render(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

/** One picture → File in the chosen format, at its full size. */
export async function convertOne(file, o = settings) {
  const src = await loadPhoto(file, DECODE_MAX);
  let c = src;
  if (o.format === 'jpeg' || (o.white && o.format !== 'png')) {
    // JPEG has no transparency: transparent parts become white.
    c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0);
  }
  const type = `image/${o.format}`;
  const blob = await new Promise((r) => c.toBlob(r, type, o.format === 'png' ? undefined : o.quality / 100));
  const base = file.name.replace(/\.[^.]+$/, '') || 'gambar';
  return new File([blob], `${base}.${EXT[o.format]}`, { type: blob.type });
}

function render() {
  const list = $('#imgList');
  list.textContent = '';
  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'img-item ic-item';
    const info = document.createElement('div');
    info.className = 'img-info';
    const name = document.createElement('strong');
    name.textContent = it.name;
    name.title = it.name;
    const meta = document.createElement('span');
    meta.className = 'img-meta';
    meta.textContent = formatSize(it.size);
    info.append(name, meta);
    if (it.out) {
      const res = document.createElement('span');
      res.className = 'img-result';
      res.textContent = `→ ${it.out.name} · ${formatSize(it.out.size)}`;
      info.appendChild(res);
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'icon-btn danger';
    rm.textContent = '✕';
    rm.title = tr('i2pRemove');
    rm.setAttribute('aria-label', `${tr('i2pRemove')}: ${it.name}`);
    rm.addEventListener('click', () => { items = items.filter((x) => x !== it); render(); });
    li.append(info, rm);
    list.appendChild(li);
  }
  $('#count').textContent = String(items.length);
  $('#toolLayout').classList.toggle('is-empty', !items.length);
  if (items.length) {
    $('#docTitle').textContent = tr('icCount', { n: items.length });
    $('#docMeta').textContent = formatSize(items.reduce((n, it) => n + it.size, 0));
  }
  $$('input[name="icFormat"]').forEach((r) => { r.checked = r.value === settings.format; });
  $('#icWebp').hidden = !WEBP_OK;
  $('#icQualityRow').hidden = settings.format === 'png';
  $('#icBgRow').hidden = settings.format !== 'webp';
  $('#icQuality').value = settings.quality;
  $('#icQualityOut').textContent = `${settings.quality}%`;
  $('#icWhite').checked = settings.white;
  $('#icHint').textContent = tr(`icHint_${settings.format}`);
  $('#saveAll').textContent = tr(items.length > 1 ? 'icSaveZip' : 'icSave');
  $('#saveAll').disabled = !items.length || busy;
  $('#shareAll').disabled = !items.length || busy;
}

/** Convert everything with the current settings. */
export async function convertAll() {
  const out = [];
  let failed = 0;
  for (let i = 0; i < items.length; i++) {
    setStatus(tr('icProgress', { i: i + 1, n: items.length }));
    try {
      items[i].out = await convertOne(items[i].file);
      out.push(items[i].out);
    } catch {
      items[i].out = null;
      failed++;
    }
    render();
  }
  return { out, failed };
}

async function save(share) {
  if (!items.length || busy) return;
  busy = true;
  render();
  try {
    const { out, failed } = await convertAll();
    if (!out.length) { setStatus(tr('loadError')); return; }
    const total = formatSize(out.reduce((n, f) => n + f.size, 0));
    let msg = tr('icDone', { n: out.length, size: total });
    if (failed) msg += ` ${tr('i2pSkipped', { n: failed })}`;
    if (share && (await shareFiles(out, 'DokuJaga')) !== 'unsupported') { setStatus(msg); return; }
    if (out.length === 1) download(out[0]);
    else {
      // Same names (e.g. a.jpg + a.png → a.jpg twice) get a number.
      const seen = new Map();
      const entries = await Promise.all(out.map(async (f) => {
        const k = seen.get(f.name) || 0;
        seen.set(f.name, k + 1);
        const name = k ? f.name.replace(/(\.[^.]+)$/, ` (${k + 1})$1`) : f.name;
        return { name, data: new Uint8Array(await f.arrayBuffer()) };
      }));
      download(new File([makeZip(entries)], `gambar-${EXT[settings.format]}.zip`, { type: 'application/zip' }));
    }
    setStatus(msg);
  } finally {
    busy = false;
    render();
  }
}

function addFiles(list) {
  const ok = [...list].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif|hei[cf])$/i.test(f.name));
  for (const f of ok) items.push({ id: nextId++, file: f, name: f.name, size: f.size, out: null });
  setStatus(ok.length < list.length ? tr('i2pSkipped', { n: list.length - ok.length }) : '');
  render();
}

function changed() {
  store.save('imgconvert', settings);
  items.forEach((it) => { it.out = null; });
  render();
}
$$('input[name="icFormat"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) { settings.format = r.value; changed(); } }));
$('#icQuality').addEventListener('input', (e) => { settings.quality = Number(e.target.value); changed(); });
$('#icWhite').addEventListener('change', (e) => { settings.white = e.target.checked; changed(); });
$('#saveAll').addEventListener('click', () => save(false));
$('#shareAll').addEventListener('click', () => save(true));
$('#clearAll').addEventListener('click', () => { items = []; setStatus(''); render(); });
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); });
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
window.__imgconvert = { addFiles, convertOne, convertAll, settings, get items() { return items; } };
