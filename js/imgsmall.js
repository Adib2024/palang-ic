// Compress / resize images. Each image is decoded, optionally rotated, cropped
// and scaled down, then re-encoded on a canvas, which also drops EXIF metadata
// (GPS, device, date). Results update live as settings change.
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

/** Can this browser write WebP? (Older Safari silently writes PNG instead.) */
export const WEBP = (() => {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    return c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch { return false; }
})();

/** Ready-made settings for common uses. */
export const PRESETS = {
  portal: { limit: '204800', maxDim: '1600', quality: 85, format: 'jpeg' },
  whatsapp: { limit: '0', maxDim: '1600', quality: 80, format: 'jpeg' },
  email: { limit: '1048576', maxDim: '1920', quality: 85, format: 'jpeg' },
  profile: { limit: '102400', maxDim: '800', quality: 85, format: 'jpeg' },
  web: { limit: '0', maxDim: '1280', quality: 80, format: WEBP ? 'webp' : 'jpeg' },
  best: { limit: '0', maxDim: '0', quality: 92, format: 'jpeg' },
};
const PRESET_KEYS = { portal: 'isPresetPortal', whatsapp: 'isPresetWhatsapp', email: 'isPresetEmail', profile: 'isPresetProfile', web: 'isPresetWeb', best: 'isPresetBest' };

const settings = { ...PRESETS.portal, limitCustom: 250, dimCustom: 1500, ...store.load('imgsmall', {}) };
if (settings.format === 'webp' && !WEBP) settings.format = 'jpeg';
settings.quality = Math.min(100, Math.max(30, Number(settings.quality) || 85));

/**
 * @typedef {{id: number, name: string, size: number, orig: HTMLCanvasElement, canvas: HTMLCanvasElement,
 *   edit: {rot: number, flip: boolean, crop: null|{x: number, y: number, w: number, h: number}},
 *   thumb: string, out: File|null, outUrl: string, outW?: number, outH?: number, over: boolean,
 *   ver: number, rev: number, busy: boolean, el?: HTMLLIElement}} Item
 */
/** @type {Item[]} */
let items = [];
let nextId = 1;
let ready = false;
let version = 1; // bumps when settings change; an item is fresh when item.ver === version

const page = initPage(() => { if (ready) { renderPresets(); render(); } });
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

/** Current settings as numbers. */
function resolved() {
  const limit = settings.limit === 'custom' ? Math.max(10, Number(settings.limitCustom) || 0) * 1024 : Number(settings.limit) || 0;
  let maxDim = 0;
  let scale = 1;
  if (settings.maxDim === 'custom') maxDim = Math.max(64, Number(settings.dimCustom) || 0);
  else if (/^p\d+$/.test(settings.maxDim)) scale = Number(settings.maxDim.slice(1)) / 100;
  else maxDim = Number(settings.maxDim) || 0;
  return { limit, maxDim, scale, quality: settings.quality / 100, format: settings.format };
}

/**
 * Encode `src` within `limit` bytes if possible: the chosen quality if it
 * fits, else the highest quality that fits, then smaller dimensions if even
 * low quality is too big.
 * @returns {Promise<{blob: Blob, width: number, height: number, over: boolean}>}
 */
export async function fit(src, { limit = 0, maxDim = 0, scale = 1, quality = 0.9, format = 'jpeg' }) {
  const type = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
  const target = scale < 1 ? Math.round(Math.max(src.width, src.height) * scale) : maxDim;
  let c = scaled(src, target);
  if (type === 'image/jpeg') c = flattenWhite(c);
  let best = null;
  for (let round = 0; round < 10; round++) {
    if (type === 'image/png') {
      const blob = await encode(c, type);
      best = { blob, width: c.width, height: c.height };
      if (!limit || blob.size <= limit) return { ...best, over: false };
    } else {
      const top = await encode(c, type, quality);
      if (!limit || top.size <= limit) return { blob: top, width: c.width, height: c.height, over: false };
      const floorQ = Math.min(0.3, quality);
      let lo = floorQ;
      let hi = quality;
      let found = null;
      for (let i = 0; i < 7; i++) {
        const q = (lo + hi) / 2;
        const blob = await encode(c, type, q);
        if (blob.size <= limit) { found = blob; lo = q; } else hi = q;
      }
      if (!found) {
        const floor = await encode(c, type, floorQ);
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

/* ---------- Rotate / flip / crop ---------- */

function rotFlip(src, rot, flip) {
  if (!rot && !flip) return src;
  const odd = rot % 2 === 1;
  const c = document.createElement('canvas');
  c.width = odd ? src.height : src.width;
  c.height = odd ? src.width : src.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rot * Math.PI) / 2);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** Apply an edit {rot (quarter turns clockwise), flip, crop (fractions)} to a canvas. */
export function applyEdit(src, e) {
  const r = rotFlip(src, e.rot, e.flip);
  if (!e.crop) return r;
  const sx = Math.round(e.crop.x * r.width);
  const sy = Math.round(e.crop.y * r.height);
  const sw = Math.max(1, Math.round(e.crop.w * r.width));
  const sh = Math.max(1, Math.round(e.crop.h * r.height));
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  c.getContext('2d').drawImage(r, sx, sy, sw, sh, 0, 0, sw, sh);
  if (r !== src) r.width = r.height = 0;
  return c;
}

const isEdited = (e) => e.rot || e.flip || e.crop;

/* ---------- Items ---------- */

async function makeThumb(canvas) {
  const small = scaled(canvas, 240);
  return new Promise((r) => small.toBlob((b) => r(b ? URL.createObjectURL(b) : ''), 'image/jpeg', 0.8));
}

export async function addFiles(fileList) {
  const files = [...fileList];
  const images = files.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name));
  let added = 0;
  setStatus(tr('working'));
  for (const file of images) {
    try {
      const canvas = await loadPhoto(file, DECODE_MAX);
      items.push({
        id: nextId++, name: file.name || 'gambar.png', size: file.size, orig: canvas, canvas,
        edit: { rot: 0, flip: false, crop: null }, thumb: await makeThumb(canvas),
        out: null, outUrl: '', over: false, ver: 0, rev: 0, busy: false,
      });
      added++;
      render();
    } catch { /* undecodable: counted as skipped */ }
  }
  const msgs = [];
  if (added) msgs.push(tr('i2pAdded', { n: added }));
  if (files.length - added) msgs.push(tr('i2pSkipped', { n: files.length - added }));
  setStatus(msgs.join(' '));
  schedule(0);
}

function removeItem(it) {
  if (it.thumb) URL.revokeObjectURL(it.thumb);
  if (it.outUrl) URL.revokeObjectURL(it.outUrl);
  items = items.filter((x) => x !== it);
  render();
}

function outName(name, format) {
  const base = name.replace(/\.[^.]+$/, '') || 'gambar';
  return `${base}-kecil.${format === 'png' ? 'png' : format === 'webp' ? 'webp' : 'jpg'}`;
}

/* ---------- Live processing ---------- */

let processing = false;
let timer = null;

/** Re-run soon (debounced so dragging a slider doesn't queue work). */
function schedule(delay = 350) {
  clearTimeout(timer);
  timer = setTimeout(() => { timer = null; process(); }, delay);
  render();
}

async function process() {
  if (processing) return;
  processing = true;
  try {
    for (;;) {
      const it = items.find((x) => x.ver !== version);
      if (!it) break;
      const v = version;
      const rev = it.rev;
      const fmt = settings.format;
      it.busy = true;
      render();
      const r = await fit(it.canvas, resolved());
      it.busy = false;
      if (!items.includes(it)) continue;
      if (v !== version || rev !== it.rev) continue; // settings or the image changed meanwhile: redo
      if (it.outUrl) URL.revokeObjectURL(it.outUrl);
      it.out = new File([r.blob], outName(it.name, fmt), { type: r.blob.type });
      it.outUrl = URL.createObjectURL(it.out);
      it.outW = r.width;
      it.outH = r.height;
      it.over = r.over;
      it.ver = v;
      render();
    }
  } finally {
    processing = false;
  }
  // (The summary line in the save bar shows the result.)
  if (items.length && items.every((x) => x.ver === version)) setStatus('');
  render();
}

/** True while anything still needs (re)compressing. */
const pending = () => processing || timer !== null || items.some((x) => x.ver !== version);

/** Compress every image now with the current settings. */
export async function runAll() {
  clearTimeout(timer);
  timer = null;
  await process();
  while (pending()) {
    if (!processing && !timer) await process();
    else await new Promise((r) => setTimeout(r, 50));
  }
}

function settingsChanged(delay) {
  version++;
  store.save('imgsmall', settings);
  syncControls();
  schedule(delay);
}

/* ---------- Rendering ---------- */

function presetSpec(p) {
  const parts = [];
  parts.push(Number(p.limit) ? `≤ ${formatSize(Number(p.limit))}` : tr('isNoLimitShort'));
  if (Number(p.maxDim)) parts.push(`${p.maxDim} px`);
  parts.push(p.format === 'jpeg' ? 'JPG' : p.format.toUpperCase());
  return parts.join(' · ');
}

const currentPreset = () => Object.keys(PRESETS).find((k) => {
  const p = PRESETS[k];
  return p.limit === settings.limit && p.maxDim === settings.maxDim && p.quality === settings.quality && p.format === settings.format;
}) || 'custom';

function renderPresets() {
  const host = $('#presets');
  host.textContent = '';
  const cur = currentPreset();
  for (const k of Object.keys(PRESETS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset';
    b.dataset.preset = k;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(k === cur));
    b.tabIndex = k === cur || (cur === 'custom' && k === 'portal') ? 0 : -1;
    const name = document.createElement('strong');
    name.textContent = tr(PRESET_KEYS[k]);
    const spec = document.createElement('span');
    spec.textContent = presetSpec(PRESETS[k]);
    b.append(name, spec);
    b.addEventListener('click', () => setPreset(k));
    host.appendChild(b);
  }
}

export function setPreset(k) {
  Object.assign(settings, PRESETS[k]);
  settingsChanged(0);
  const b = $(`.preset[data-preset="${k}"]`);
  if (b) b.focus();
}

// Arrow keys move between presets (radio group behaviour).
$('#presets').addEventListener('keydown', (e) => {
  const keys = Object.keys(PRESETS);
  const i = keys.indexOf(e.target.dataset && e.target.dataset.preset);
  if (i < 0) return;
  const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!d) return;
  e.preventDefault();
  setPreset(keys[(i + d + keys.length) % keys.length]);
});

function syncControls() {
  $('#limit').value = settings.limit;
  $('#maxDim').value = settings.maxDim;
  $('#limitCustomRow').hidden = settings.limit !== 'custom';
  $('#dimCustomRow').hidden = settings.maxDim !== 'custom';
  $('#limitCustom').value = settings.limitCustom;
  $('#dimCustom').value = settings.dimCustom;
  $('#quality').value = settings.quality;
  $('#qualityOut').textContent = `${settings.quality}%`;
  $$('input[name="format"]').forEach((r) => { r.checked = r.value === settings.format; });
  $('#pngNote').hidden = settings.format !== 'png';
  renderPresets();
}

function btn(label, cls, onClick, aria) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  if (aria) b.setAttribute('aria-label', aria);
  b.addEventListener('click', onClick);
  return b;
}

function itemEl(it) {
  const li = document.createElement('li');
  li.className = 'img-item';
  const thumb = document.createElement('button');
  thumb.type = 'button';
  thumb.className = 'img-thumb';
  thumb.addEventListener('click', () => (it.out && it.ver === version ? openCompare(it) : openEdit(it)));
  const img = document.createElement('img');
  img.alt = '';
  thumb.appendChild(img);
  const info = document.createElement('div');
  info.className = 'img-info';
  const name = document.createElement('strong');
  const meta = document.createElement('span');
  meta.className = 'img-meta';
  const res = document.createElement('span');
  res.className = 'img-result';
  const bar = document.createElement('span');
  bar.className = 'img-bar';
  bar.appendChild(document.createElement('span'));
  info.append(name, meta, res, bar);
  const actions = document.createElement('div');
  actions.className = 'img-actions';
  li.append(thumb, info, actions);
  li._parts = { img, name, meta, res, bar, actions, thumb };
  return li;
}

function updateItem(it) {
  const p = it.el._parts;
  if (p.img.dataset.src !== it.thumb) { p.img.src = it.thumb; p.img.dataset.src = it.thumb; }
  p.thumb.setAttribute('aria-label', `${tr(it.out && it.ver === version ? 'isBtnCompare' : 'isBtnEdit')}: ${it.name}`);
  p.name.textContent = it.name;
  p.name.title = it.name;
  p.meta.textContent = `${it.canvas.width}×${it.canvas.height} · ${formatSize(it.size)}${isEdited(it.edit) ? ` · ${tr('isEdited')}` : ''}`;
  const fresh = it.out && it.ver === version;
  it.el.classList.toggle('busy', !fresh);
  let pct = 0;
  if (fresh) {
    pct = Math.round((1 - it.out.size / it.size) * 100);
    p.res.textContent = `→ ${it.outW}×${it.outH} · ${formatSize(it.out.size)}${pct > 0 ? ` (−${pct}%)` : ''}${it.over ? ` · ${tr('isOver', { limit: formatSize(resolved().limit) })}` : ''}`;
    p.res.className = `img-result${it.over || pct <= 0 ? ' warn' : ''}`;
  } else {
    p.res.textContent = tr(it.busy ? 'isWorking' : 'isWaiting');
    p.res.className = 'img-result muted';
  }
  p.bar.hidden = !fresh;
  p.bar.firstChild.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  // Buttons are rebuilt only when their state changes (keeps keyboard focus).
  const key = `${fresh}|${page.lang()}`;
  if (p.actions.dataset.key !== key) {
    p.actions.dataset.key = key;
    p.actions.textContent = '';
    const cmp = btn(tr('isBtnCompare'), 'btn small', () => openCompare(it), `${tr('isBtnCompare')}: ${it.name}`);
    cmp.disabled = !fresh;
    const edit = btn(tr('isBtnEdit'), 'btn small', () => openEdit(it), `${tr('isEditTitle')}: ${it.name}`);
    const save = btn(tr('isSaveOne'), 'btn small', () => download(it.out), `${tr('isSaveOne')}: ${it.name}`);
    save.disabled = !fresh;
    const rm = btn('✕', 'icon-btn danger', () => removeItem(it), `${tr('i2pRemove')}: ${it.name}`);
    rm.title = tr('i2pRemove');
    p.actions.append(cmp, edit, save, rm);
  } else {
    const [cmp, , save] = p.actions.children;
    cmp.disabled = !fresh;
    save.disabled = !fresh;
  }
}

function render() {
  const list = $('#imgList');
  const live = new Set(items.map((it) => it.el));
  [...list.children].forEach((li) => { if (!live.has(li)) li.remove(); });
  for (const it of items) {
    if (!it.el) it.el = itemEl(it);
    if (it.el.parentNode !== list) list.appendChild(it.el);
    updateItem(it);
  }
  const done = items.length > 0 && items.every((it) => it.out && it.ver === version);
  $('#count').textContent = String(items.length);
  $('#toolLayout').classList.toggle('is-empty', items.length === 0);
  $('#saveAll').disabled = !done;
  $('#shareAll').disabled = !done;
  $('#saveLabel').textContent = tr(items.length > 1 ? 'isSaveZip' : 'isSaveImg');

  // Summary line + savings meter.
  const n = items.length;
  const fresh = items.filter((it) => it.out && it.ver === version);
  let sum = tr('isSumEmpty');
  let pct = 0;
  if (n && !done) {
    sum = tr('isSumWorking', { i: Math.min(n, fresh.length + 1), n });
    setProgress(fresh.length / n);
  } else {
    setProgress(null);
  }
  if (done) {
    const from = items.reduce((a, it) => a + it.size, 0);
    const to = items.reduce((a, it) => a + it.out.size, 0);
    pct = Math.max(0, Math.round((1 - to / from) * 100));
    sum = tr('isSum', { n, from: formatSize(from), to: formatSize(to), p: pct });
  }
  $('#sumText').textContent = sum;
  $('#sumMeter').style.width = `${pct}%`;

  // Steps: 1 choose → 2 purpose → 3 save.
  const step = !n ? 1 : done ? 3 : 2;
  $$('#stepsBar li').forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle('done', s < step || (s === 3 && done));
    if (s === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
}

/* ---------- Save / share ---------- */

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

/* ---------- Dialogs ---------- */

function openDialog(dlg) {
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}
function closeDialog(dlg) {
  if (typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
}
$$('dialog').forEach((dlg) => {
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeDialog(dlg)));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDialog(dlg); }); // backdrop
});

/* Edit: rotate, mirror, crop */
let editing = null; // {it, preview, draft, ratio}
const FULL = { x: 0, y: 0, w: 1, h: 1 };

function drawEdit() {
  const { preview, draft } = editing;
  const r = rotFlip(preview, draft.rot, draft.flip);
  const cv = $('#cropCanvas');
  cv.width = r.width;
  cv.height = r.height;
  cv.getContext('2d').drawImage(r, 0, 0);
  editing.W = r.width;
  editing.H = r.height;
  placeCropBox();
}

function placeCropBox() {
  const c = editing.draft.crop || FULL;
  const box = $('#cropBox');
  box.style.left = `${c.x * 100}%`;
  box.style.top = `${c.y * 100}%`;
  box.style.width = `${c.w * 100}%`;
  box.style.height = `${c.h * 100}%`;
}

/** Largest centred crop with pixel aspect `ratio` (w/h). */
function aspectCrop(ratio) {
  const rf = (ratio * editing.H) / editing.W; // in fractions
  let w = 1;
  let h = w / rf;
  if (h > 1) { h = 1; w = rf; }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

export function openEdit(it) {
  editing = { it, preview: scaled(it.orig, 1200), draft: JSON.parse(JSON.stringify(it.edit)), ratio: 0 };
  $$('input[name="aspect"]').forEach((r) => { r.checked = r.value === 'free'; });
  openDialog($('#editDlg'));
  drawEdit();
}

function setAspect(v) {
  editing.ratio = v === 'free' ? 0 : Number(v);
  editing.draft.crop = editing.ratio ? aspectCrop(editing.ratio) : null;
  placeCropBox();
}
$$('input[name="aspect"]').forEach((r) => r.addEventListener('change', () => { if (r.checked && editing) setAspect(r.value); }));
$('#rotL').addEventListener('click', () => { editing.draft.rot = (editing.draft.rot + 3) % 4; editing.draft.crop = null; drawEdit(); if (editing.ratio) setAspect(editing.ratio); });
$('#rotR').addEventListener('click', () => { editing.draft.rot = (editing.draft.rot + 1) % 4; editing.draft.crop = null; drawEdit(); if (editing.ratio) setAspect(editing.ratio); });
$('#flipH').addEventListener('click', () => {
  editing.draft.flip = !editing.draft.flip;
  // Mirror the crop too so it stays on the same part of the picture.
  const c = editing.draft.crop;
  if (c) { if (editing.draft.rot % 2) c.y = 1 - c.y - c.h; else c.x = 1 - c.x - c.w; }
  drawEdit();
});
$('#editReset').addEventListener('click', () => {
  editing.draft = { rot: 0, flip: false, crop: null };
  editing.ratio = 0;
  $$('input[name="aspect"]').forEach((r) => { r.checked = r.value === 'free'; });
  drawEdit();
});

/** Apply an edit to an item (used by the dialog and the automated test). */
export async function applyEditTo(it, edit) {
  const e = { rot: edit.rot || 0, flip: !!edit.flip, crop: edit.crop && (edit.crop.w < 0.999 || edit.crop.h < 0.999) ? edit.crop : null };
  it.edit = e;
  if (it.canvas !== it.orig) it.canvas.width = it.canvas.height = 0;
  it.canvas = isEdited(e) ? applyEdit(it.orig, e) : it.orig;
  it.rev++;
  it.ver = 0; // stale from now on, before any await
  schedule(0);
  const old = it.thumb;
  it.thumb = await makeThumb(it.canvas);
  if (old) URL.revokeObjectURL(old);
  render();
}
$('#editApply').addEventListener('click', async () => {
  const { it, draft } = editing;
  closeDialog($('#editDlg'));
  await applyEditTo(it, draft);
});

// Crop box: drag inside to move, drag a corner to resize; arrow keys move it.
(function cropInteraction() {
  const stage = $('#cropStage');
  let drag = null;
  const pt = (e) => {
    const r = $('#cropCanvas').getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  stage.addEventListener('pointerdown', (e) => {
    if (!editing) return;
    const h = e.target.dataset && e.target.dataset.h;
    const inBox = e.target === $('#cropBox');
    if (!h && !inBox) return;
    e.preventDefault();
    const c = { ...(editing.draft.crop || FULL) };
    drag = { mode: h || 'move', start: pt(e), c };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = pt(e);
    const c0 = drag.c;
    const MIN = 0.05;
    if (drag.mode === 'move') {
      editing.draft.crop = {
        ...c0,
        x: clamp(c0.x + p.x - drag.start.x, 0, 1 - c0.w),
        y: clamp(c0.y + p.y - drag.start.y, 0, 1 - c0.h),
      };
    } else {
      // The opposite corner stays put.
      const ax = drag.mode.includes('w') ? c0.x + c0.w : c0.x;
      const ay = drag.mode.includes('n') ? c0.y + c0.h : c0.y;
      const sx = drag.mode.includes('w') ? -1 : 1;
      const sy = drag.mode.includes('n') ? -1 : 1;
      const maxW = sx > 0 ? 1 - ax : ax;
      const maxH = sy > 0 ? 1 - ay : ay;
      let w = clamp((p.x - ax) * sx, MIN, maxW);
      let h = clamp((p.y - ay) * sy, MIN, maxH);
      if (editing.ratio) {
        const rf = (editing.ratio * editing.H) / editing.W;
        h = w / rf;
        if (h > maxH) { h = maxH; w = h * rf; }
      }
      editing.draft.crop = { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h };
    }
    placeCropBox();
  });
  const end = () => { drag = null; };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  $('#cropBox').addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d || !editing) return;
    e.preventDefault();
    const step = e.shiftKey ? 0.05 : 0.01;
    const c = { ...(editing.draft.crop || FULL) };
    c.x = clamp(c.x + d[0] * step, 0, 1 - c.w);
    c.y = clamp(c.y + d[1] * step, 0, 1 - c.h);
    editing.draft.crop = c;
    placeCropBox();
  });
})();

/* Compare: before/after slider */
let comparing = null;

function setSplit(v) {
  v = Math.max(0, Math.min(100, Math.round(v)));
  $('#cmpRange').value = v;
  $('#cmpOut').textContent = `${v}%`;
  $('#cmpAfter').style.clipPath = `inset(0 0 0 ${v}%)`;
  $('#cmpLine').style.left = `${v}%`;
}

export function openCompare(it) {
  if (!it.out) return;
  comparing = it;
  const before = $('#cmpBefore');
  before.width = it.outW;
  before.height = it.outH;
  const ctx = before.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(it.canvas, 0, 0, it.outW, it.outH);
  $('#cmpAfter').src = it.outUrl;
  $('#cmpInner').style.setProperty('--ar', String(it.outW / it.outH));
  $('#cmpInner').style.setProperty('--w', `${it.outW}px`);
  $('#cmpLabelA').textContent = tr('isBefore', { size: formatSize(it.size) });
  $('#cmpLabelB').textContent = tr('isAfter', { size: formatSize(it.out.size) });
  $$('input[name="cmpZoom"]').forEach((r) => { r.checked = r.value === 'fit'; });
  $('#cmpView').classList.remove('full');
  setSplit(50);
  openDialog($('#cmpDlg'));
}
$('#cmpRange').addEventListener('input', (e) => setSplit(Number(e.target.value)));
$$('input[name="cmpZoom"]').forEach((r) => r.addEventListener('change', () => {
  if (r.checked) $('#cmpView').classList.toggle('full', r.value === 'full');
}));
(function compareDrag() {
  const view = $('#cmpView');
  let on = false;
  const move = (e) => {
    const r = $('#cmpInner').getBoundingClientRect();
    setSplit(((e.clientX - r.left) / r.width) * 100);
  };
  view.addEventListener('pointerdown', (e) => {
    if (view.classList.contains('full') || !comparing) return; // zoomed: drag pans instead
    on = true;
    view.setPointerCapture(e.pointerId);
    move(e);
  });
  view.addEventListener('pointermove', (e) => { if (on) move(e); });
  view.addEventListener('pointerup', () => { on = false; });
  view.addEventListener('pointercancel', () => { on = false; });
})();
$('#cmpDlg').addEventListener('close', () => { comparing = null; $('#cmpAfter').removeAttribute('src'); });

/* ---------- Boot ---------- */

if (!WEBP) $('#webpOpt').hidden = true;
$('#limit').addEventListener('change', (e) => { settings.limit = e.target.value; settingsChanged(0); });
$('#maxDim').addEventListener('change', (e) => { settings.maxDim = e.target.value; settingsChanged(0); });
$('#limitCustom').addEventListener('input', (e) => { settings.limitCustom = Number(e.target.value) || 0; settingsChanged(600); });
$('#dimCustom').addEventListener('input', (e) => { settings.dimCustom = Number(e.target.value) || 0; settingsChanged(600); });
$('#quality').addEventListener('input', (e) => { settings.quality = Number(e.target.value); settingsChanged(450); });
$$('input[name="format"]').forEach((r) => {
  r.addEventListener('change', () => { if (r.checked) { settings.format = r.value; settingsChanged(0); } });
});
$('#saveAll').addEventListener('click', () => saveAll(false));
$('#shareAll').addEventListener('click', () => saveAll(true));
$('#clearAll').addEventListener('click', () => {
  items.forEach((it) => { if (it.thumb) URL.revokeObjectURL(it.thumb); if (it.outUrl) URL.revokeObjectURL(it.outUrl); });
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
// Paste a screenshot or copied image (Ctrl+V / long-press → Paste).
document.addEventListener('paste', (e) => {
  if (e.target.closest && e.target.closest('input, textarea')) return;
  const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter((f) => /^image\//.test(f.type));
  if (!files.length) return;
  e.preventDefault();
  addFiles(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `${tr('isPasteName')}-${i + 1}.png`, { type: f.type }))));
});

syncControls();
ready = true;
render();

// Exposed for the automated test only.
window.__imgsmall = {
  settings, fit, runAll, addFiles, setPreset, applyEditTo, openCompare, openEdit,
  get items() { return items; }, get pending() { return pending(); }, get preset() { return currentPreset(); },
};
