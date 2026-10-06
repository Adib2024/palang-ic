import { renderWatermark, composite } from './watermark.js';
import { loadPhoto } from './image-loader.js';
import { buildPdf } from './pdf.js';
import { applyI18n, t, TEMPLATES, todayDMY } from './i18n.js';
import * as store from './storage.js';

// Per-mode slider defaults, tuned so the IC number and face stay readable.
const MODE_DEFAULTS = {
  palang: { opacity: 0.4, fontSize: 4.5, angle: -30, thickness: 0.6, density: 'mid' },
  tiled: { opacity: 0.3, fontSize: 3.5, angle: -30, thickness: 0.6, density: 'mid' },
  gabung: { opacity: 0.35, fontSize: 4, angle: -30, thickness: 0.5, density: 'mid' },
};
const MODES = Object.keys(MODE_DEFAULTS);
const PREVIEW_MAX = 1400;
const EXPORT_QUALITY = 0.92;
const PDF_MAX_SIDE = 2000;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const savedPerMode = store.load('perMode', {});
const state = {
  lang: store.load('lang', 'ms') === 'en' ? 'en' : 'ms',
  mode: MODES.includes(store.load('mode', 'palang')) ? store.load('mode', 'palang') : 'palang',
  template: store.load('template', 'ms') === 'en' ? 'en' : 'ms',
  addDate: store.load('addDate', false) === true,
  color: store.load('color', 'black'),
  palangShape: store.load('palangShape', 'parallel'),
  lineStyle: store.load('lineStyle', 'solid'),
  perMode: Object.fromEntries(MODES.map((m) => [m, { ...MODE_DEFAULTS[m], ...(savedPerMode[m] || {}) }])),
  recipient: '',
  photos: { front: null, back: null },
};

function watermarkText(forPreview) {
  const who = state.recipient.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!who && !forPreview) return '';
  let text = TEMPLATES[state.template](who || '_____');
  if (state.addDate) text += ` · ${todayDMY()}`;
  return text;
}

function options(forPreview = false) {
  return {
    mode: state.mode,
    text: watermarkText(forPreview),
    color: state.color,
    palangShape: state.palangShape,
    lineStyle: state.lineStyle,
    ...state.perMode[state.mode],
  };
}

function persist() {
  store.save('lang', state.lang);
  store.save('mode', state.mode);
  store.save('template', state.template);
  store.save('addDate', state.addDate);
  store.save('color', state.color);
  store.save('palangShape', state.palangShape);
  store.save('lineStyle', state.lineStyle);
  store.save('perMode', state.perMode);
}

function setStatus(msg) {
  $('#status').textContent = msg || '';
}

/* ---------- Preview ---------- */

let frame = 0;
function schedulePreview() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    drawPreview();
  });
}

function drawPreview() {
  let any = false;
  for (const side of ['front', 'back']) {
    const fig = $(`[data-preview="${side}"]`);
    const photo = state.photos[side];
    fig.hidden = !photo;
    if (!photo) continue;
    any = true;
    composite($('canvas', fig), photo, photo.width, photo.height, options(true), PREVIEW_MAX);
  }
  $('#emptyPreview').hidden = any;
}

/* ---------- Controls ---------- */

const RANGE_FORMAT = {
  opacity: (v) => `${Math.round(v * 100)}%`,
  fontSize: (v) => `${v}`,
  angle: (v) => `${v}°`,
  thickness: (v) => `${v}`,
};

function syncControls() {
  $$('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang)));
  $$('input[name="mode"]').forEach((r) => { r.checked = r.value === state.mode; });
  $$('input[name="color"]').forEach((r) => { r.checked = r.value === state.color; });
  $$('input[name="palangShape"]').forEach((r) => { r.checked = r.value === state.palangShape; });
  $$('input[name="lineStyle"]').forEach((r) => { r.checked = r.value === state.lineStyle; });
  const m = state.perMode[state.mode];
  $$('input[name="density"]').forEach((r) => { r.checked = r.value === m.density; });
  for (const key of Object.keys(RANGE_FORMAT)) {
    const input = $(`#${key}`);
    input.value = m[key];
    input.nextElementSibling.textContent = RANGE_FORMAT[key](m[key]);
  }
  $('#template').value = state.template;
  $('#addDate').checked = state.addDate;
  $$('[data-for]').forEach((el) => { el.hidden = !el.dataset.for.split(' ').includes(state.mode); });
}

function bindRadio(name, apply) {
  $$(`input[name="${name}"]`).forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    apply(r.value);
    persist();
    syncControls();
    schedulePreview();
  }));
}

function bindControls() {
  $$('[data-lang]').forEach((b) => b.addEventListener('click', () => {
    state.lang = b.dataset.lang;
    // Follow the UI language for the wording until the user picks one.
    if (store.load('templateChosen', false) !== true) state.template = state.lang;
    applyI18n(document, state.lang);
    persist();
    syncControls();
    schedulePreview();
  }));

  bindRadio('mode', (v) => { state.mode = v; });
  bindRadio('color', (v) => { state.color = v; });
  bindRadio('palangShape', (v) => { state.palangShape = v; });
  bindRadio('lineStyle', (v) => { state.lineStyle = v; });
  bindRadio('density', (v) => { state.perMode[state.mode].density = v; });

  for (const key of Object.keys(RANGE_FORMAT)) {
    const input = $(`#${key}`);
    input.addEventListener('input', () => {
      state.perMode[state.mode][key] = Number(input.value);
      input.nextElementSibling.textContent = RANGE_FORMAT[key](input.value);
      schedulePreview();
    });
    input.addEventListener('change', persist);
  }

  $('#reset').addEventListener('click', () => {
    state.perMode[state.mode] = { ...MODE_DEFAULTS[state.mode] };
    persist();
    syncControls();
    schedulePreview();
  });

  $('#recipient').addEventListener('input', (e) => {
    state.recipient = e.target.value;
    schedulePreview();
  });
  $('#template').addEventListener('change', (e) => {
    state.template = e.target.value === 'en' ? 'en' : 'ms';
    store.save('templateChosen', true);
    persist();
    schedulePreview();
  });
  $('#addDate').addEventListener('change', (e) => {
    state.addDate = e.target.checked;
    persist();
    schedulePreview();
  });

  for (const side of ['front', 'back']) {
    const input = $(`[data-input="${side}"]`);
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      setStatus(t(state.lang, 'working'));
      try {
        setPhoto(side, await loadPhoto(file));
        setStatus('');
      } catch {
        setStatus(t(state.lang, 'loadError'));
      }
      input.value = ''; // allow re-picking the same file
    });
    $(`[data-remove="${side}"]`).addEventListener('click', () => setPhoto(side, null));
  }

  $('#saveJpg').addEventListener('click', () => run(saveJpg));
  $('#savePdf').addEventListener('click', () => run(savePdf));
  $('#share').addEventListener('click', () => run(share));
}

function setPhoto(side, canvas) {
  state.photos[side] = canvas;
  const slot = $(`.slot[data-side="${side}"]`);
  const thumb = $('.thumb', slot);
  if (thumb.src) URL.revokeObjectURL(thumb.src);
  thumb.removeAttribute('src');
  thumb.hidden = !canvas;
  $('.pick', slot).classList.toggle('has-image', !!canvas);
  $('.pick-text', slot).dataset.i18n = canvas ? 'change' : 'pick';
  $('.pick-text', slot).textContent = t(state.lang, canvas ? 'change' : 'pick');
  $(`[data-remove="${side}"]`).hidden = !canvas;
  if (canvas) {
    const small = composite(document.createElement('canvas'), canvas, canvas.width, canvas.height, { text: '' }, 480);
    small.toBlob((b) => { if (b && state.photos[side] === canvas) thumb.src = URL.createObjectURL(b); }, 'image/jpeg', 0.8);
  }
  schedulePreview();
}

/* ---------- Export ---------- */

function sides() {
  return ['front', 'back'].filter((s) => state.photos[s]);
}

function fileBase() {
  const who = state.recipient.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `ic-${who || 'palang'}`;
}

function renderFull(side, maxSide) {
  const photo = state.photos[side];
  return composite(document.createElement('canvas'), photo, photo.width, photo.height, options(), maxSide);
}

function toJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', EXPORT_QUALITY);
  });
}

async function jpgFiles() {
  const label = { front: state.lang === 'en' ? 'front' : 'depan', back: state.lang === 'en' ? 'back' : 'belakang' };
  const list = sides();
  return Promise.all(list.map(async (side) => {
    const blob = await toJpeg(renderFull(side));
    return new File([blob], `${fileBase()}-${label[side]}.jpg`, { type: 'image/jpeg' });
  }));
}

async function pdfFile() {
  const images = await Promise.all(sides().map(async (side) => {
    const canvas = renderFull(side, PDF_MAX_SIDE);
    const blob = await toJpeg(canvas);
    return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
  }));
  return new File([buildPdf(images)], `${fileBase()}.pdf`, { type: 'application/pdf' });
}

function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function saveJpg() {
  (await jpgFiles()).forEach((f, i) => setTimeout(() => download(f), i * 400));
}

async function savePdf() {
  download(await pdfFile());
}

async function share() {
  const files = await jpgFiles();
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, title: watermarkText() });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // user closed the sheet
    }
  }
  files.forEach((f, i) => setTimeout(() => download(f), i * 400));
  setStatus(t(state.lang, 'shareFallback'));
}

let busy = false;
async function run(task) {
  if (busy) return;
  if (!sides().length) { setStatus(t(state.lang, 'noImage')); return; }
  if (!watermarkText()) {
    setStatus(t(state.lang, 'noText'));
    $('#recipient').focus();
    return;
  }
  busy = true;
  $$('.buttons button').forEach((b) => { b.disabled = true; });
  setStatus(t(state.lang, 'working'));
  try {
    await task();
    if ($('#status').textContent === t(state.lang, 'working')) setStatus('');
  } catch {
    setStatus(t(state.lang, 'loadError'));
  } finally {
    busy = false;
    $$('.buttons button').forEach((b) => { b.disabled = false; });
  }
}

/* ---------- Boot ---------- */

applyI18n(document, state.lang);
syncControls();
bindControls();
drawPreview();
window.addEventListener('resize', schedulePreview);

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Exposed for the automated render test only; harmless in production.
window.__palangic = { state, renderWatermark, setPhoto, options, pdfFile, jpgFiles, schedulePreview };
