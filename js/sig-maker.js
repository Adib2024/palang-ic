// Signature maker shared by Sign PDF and Merge PDF: draw on a pad, type a
// name, or upload a picture (paper made transparent). Binds to the markup
// from the sign panel (#pad, #typedName, #sigFile, …).
import * as store from './storage.js';
import { loadPhoto } from './image-loader.js';

const TYPE_FONTS = [
  'italic 400 140px "Segoe Script", "Brush Script MT", "Snell Roundhand", "URW Chancery L", cursive',
  'italic 600 120px Georgia, "Times New Roman", serif',
  '600 110px Inter, system-ui, sans-serif',
];
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

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

/** `text` drawn in `font` on a transparent, trimmed canvas. */
export function textCanvas(text, font = '500 72px Inter, system-ui, sans-serif', color = '#111111') {
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

/** Local date input value (YYYY-MM-DD) for `d`. */
export function isoDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** YYYY-MM-DD → DD/MM/YYYY ('' if not a date). */
export function toDMY(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/**
 * Wire up the signature panel.
 * @param {{onError: () => void}} opts called when an uploaded picture can't be read
 * @returns {{current: () => HTMLCanvasElement | null, ink: () => string}}
 */
export function initSignatureMaker({ onError }) {
  const settings = { tab: 'draw', ink: '#111111', typeStyle: '0', ...store.load('sign', {}) };
  const save = () => store.save('sign', { ...settings });
  let padDirty = false;
  let imageSource = null;

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

  const typed = () => {
    const name = $('#typedName').value.trim();
    return name ? textCanvas(name, TYPE_FONTS[Number(settings.typeStyle)] || TYPE_FONTS[0], settings.ink) : null;
  };
  const updateTyped = () => fitInto($('#typedPreview'), typed());

  async function loadImage(file) {
    const photo = await loadPhoto(file, 2000);
    const c = photo.getContext('2d');
    if ($('#removeBg').checked) {
      const img = c.getImageData(0, 0, photo.width, photo.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        // Paper → transparent, ink → opaque, with a soft edge in between.
        d[i + 3] = lum > 215 ? 0 : lum < 150 ? 255 : Math.round(((215 - lum) / 65) * 255);
      }
      c.putImageData(img, 0, 0);
    }
    imageSource = trim(photo, 4);
    fitInto($('#imagePreview'), imageSource);
  }

  const syncTab = () => { $$('[data-tab]').forEach((el) => { el.hidden = el.dataset.tab !== settings.tab; }); };
  const bindRadios = (name, key, after) => {
    $$(`input[name="${name}"]`).forEach((r) => {
      r.checked = r.value === settings[key];
      r.addEventListener('change', () => { if (r.checked) { settings[key] = r.value; save(); after(); } });
    });
  };
  bindRadios('sigTab', 'tab', syncTab);
  bindRadios('ink', 'ink', updateTyped);
  bindRadios('typeStyle', 'typeStyle', updateTyped);
  $('#typedName').addEventListener('input', updateTyped);
  $('#sigFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) {
      try { await loadImage(f); } catch { onError(); }
    }
  });
  syncTab();

  return {
    current() {
      if (settings.tab === 'draw') return padDirty ? trim(pad) : null;
      if (settings.tab === 'type') return typed();
      return imageSource;
    },
    ink: () => settings.ink,
  };
}
