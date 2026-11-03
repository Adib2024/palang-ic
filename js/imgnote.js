// Image Notes: write a note, draw an arrow, a box or a highlight on a photo of
// a document (pay slip, bill, receipt), then save it as a JPG at full size.
// Notes are kept as shapes in image fractions, so the preview and the saved
// photo always match. Runs in this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import * as store from './storage.js';
import { loadPhoto } from './image-loader.js';
import { formatSize, download, shareOrDownload } from './pdf-kit.js';
import { createUndo, mountUndoButtons } from './undo.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const DECODE_MAX = 4000;
const PREVIEW_MAX = 1400;
export const COLORS = { red: '#d32f2f', blue: '#1546b0', green: '#2e7d32', black: '#111111', yellow: '#f5c400' };
// Relative to the photo's shorter side, so a note looks the same on any photo.
const FONT = { s: 0.03, m: 0.045, l: 0.07 };
const LINE = { s: 0.004, m: 0.007, l: 0.011 };
const FONT_FAMILY = 'Inter, system-ui, Arial, sans-serif';

const settings = { tool: 'text', color: 'red', size: 'm', bg: true, ...store.load('imgnote', {}) };
if (!COLORS[settings.color]) settings.color = 'red';
/** @type {{canvas: HTMLCanvasElement, name: string} | null} */
let photo = null;
/** @type {{id: number, kind: string, color: string, size: string, bg: boolean, text: string, x1: number, y1: number, x2: number, y2: number}[]} */
let items = [];
let selected = 0;
let nextId = 1;
let ready = false;
/** Hit boxes from the last preview paint, in preview pixels. */
let boxes = new Map();

const history = createUndo({ onChange: () => { if (ready) sync(); } });
const page = initPage(() => { if (ready) { sync(); refreshUndo(); } });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };
const clone = (list) => list.map((it) => ({ ...it }));
const current = () => items.find((it) => it.id === selected) || null;

/** Record the change from `before` to the current notes as one undo step. */
function commit(before) {
  const after = clone(items);
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  history.push({ undo: () => { items = clone(before); }, redo: () => { items = clone(after); } });
}

/* ---------- Drawing ---------- */

function textFont(it, W, H) {
  return `700 ${Math.max(8, Math.round(FONT[it.size] * Math.min(W, H)))}px ${FONT_FAMILY}`;
}

/** Draw one note on `ctx` (photo size W×H). Returns its hit box. */
function drawItem(ctx, it, W, H) {
  const m = Math.min(W, H);
  const lw = Math.max(1.5, LINE[it.size] * m);
  const col = COLORS[it.color] || COLORS.red;
  const x1 = it.x1 * W; const y1 = it.y1 * H; const x2 = it.x2 * W; const y2 = it.y2 * H;
  ctx.save();
  if (it.kind === 'text') {
    ctx.font = textFont(it, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fs = FONT[it.size] * m;
    const w = ctx.measureText(it.text).width;
    const pad = fs * 0.3;
    const box = { x: x1 - w / 2 - pad, y: y1 - fs * 0.65 - pad / 2, w: w + pad * 2, h: fs * 1.3 + pad };
    if (it.bg) {
      ctx.fillStyle = 'rgba(255, 255, 255, .92)';
      ctx.beginPath();
      // roundRect is missing on older phones: plain corners there.
      if (ctx.roundRect) ctx.roundRect(box.x, box.y, box.w, box.h, fs * 0.2); else ctx.rect(box.x, box.y, box.w, box.h);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, lw * 0.5);
      ctx.stroke();
    }
    ctx.fillStyle = col;
    ctx.fillText(it.text, x1, y1);
    ctx.restore();
    return box;
  }
  if (it.kind === 'mark') {
    // Multiply keeps the printed text under the highlight readable.
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = col;
    ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else if (it.kind === 'box') {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else if (it.kind === 'arrow') {
    const a = Math.atan2(y2 - y1, x2 - x1);
    const head = lw * 4.5;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - Math.cos(a) * head * 0.6, y2 - Math.sin(a) * head * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - Math.cos(a - 0.45) * head, y2 - Math.sin(a - 0.45) * head);
    ctx.lineTo(x2 - Math.cos(a + 0.45) * head, y2 - Math.sin(a + 0.45) * head);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  const pad = lw * 3;
  return { x: Math.min(x1, x2) - pad, y: Math.min(y1, y2) - pad, w: Math.abs(x2 - x1) + pad * 2, h: Math.abs(y2 - y1) + pad * 2 };
}

/** The photo with every note, at W×H. */
function paint(c, W, H, { preview = false } = {}) {
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(photo.canvas, 0, 0, W, H);
  const hits = new Map();
  for (const it of items) hits.set(it.id, drawItem(ctx, it, W, H));
  if (preview && current()) {
    const b = hits.get(selected);
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#4f46e5';
    ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
    ctx.restore();
  }
  return hits;
}

let raf = 0;
function draw() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    if (!photo) return;
    const cv = $('#ntCanvas');
    const s = Math.min(1, PREVIEW_MAX / Math.max(photo.canvas.width, photo.canvas.height));
    const W = Math.round(photo.canvas.width * s);
    const H = Math.round(photo.canvas.height * s);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    boxes = paint(cv, W, H, { preview: true });
  });
}

function sync() {
  $('#toolLayout').classList.toggle('is-empty', !photo);
  const sel = current();
  const show = sel || settings;
  const tool = sel ? sel.kind : settings.tool;
  $$('input[name="ntTool"]').forEach((r) => { r.checked = r.value === tool; });
  $$('input[name="ntColor"]').forEach((r) => { r.checked = r.value === show.color; });
  $$('input[name="ntSize"]').forEach((r) => { r.checked = r.value === show.size; });
  $('#ntBg').checked = sel ? sel.bg : settings.bg;
  $('#ntTextRow').hidden = tool !== 'text';
  $('#ntBgRow').hidden = tool !== 'text';
  if (sel && sel.kind === 'text' && document.activeElement !== $('#ntText')) $('#ntText').value = sel.text;
  $('#ntText').placeholder = tr('ntDefaultText');
  $('#ntDelete').disabled = !sel;
  $('#ntClear').hidden = !items.length;
  $('#ntCount').textContent = items.length ? tr('ntCount', { n: items.length }) : '';
  $('#ntHint').textContent = tr(sel ? 'ntSelectedHint' : 'ntHint');
  if (photo) {
    $('#docTitle').textContent = photo.name;
    $('#docMeta').textContent = `${photo.canvas.width}×${photo.canvas.height}`;
  }
  $('#saveNote').disabled = !photo;
  $('#shareNote').disabled = !photo;
  refreshUndo();
  draw();
}

/* ---------- Notes ---------- */

const noteText = () => $('#ntText').value.trim() || tr('ntDefaultText');

/** A new note of the current tool at (fx, fy); shapes get a default size. */
function makeItem(fx, fy) {
  const { width: W, height: H } = photo.canvas;
  const m = Math.min(W, H);
  const it = { id: nextId++, kind: settings.tool, color: settings.color, size: settings.size, bg: settings.bg, text: '', x1: fx, y1: fy, x2: fx, y2: fy };
  if (it.kind === 'text') it.text = noteText();
  else if (it.kind === 'arrow') { it.x1 = fx - (0.16 * m) / W; it.y1 = fy + (0.1 * m) / H; }
  else {
    const hw = (0.18 * m) / W;
    const hh = ((it.kind === 'mark' ? 0.035 : 0.07) * m) / H;
    Object.assign(it, { x1: fx - hw, y1: fy - hh, x2: fx + hw, y2: fy + hh });
  }
  return it;
}

/** Add a note in the middle (keyboard users, and the test). */
export function addNote(fx = 0.5, fy = 0.5, opts = {}) {
  if (!photo) return null;
  const before = clone(items);
  const it = Object.assign(makeItem(fx, fy), opts);
  items.push(it);
  selected = it.id;
  commit(before);
  sync();
  return it;
}

function removeSelected() {
  if (!current()) return;
  const before = clone(items);
  items = items.filter((it) => it.id !== selected);
  selected = 0;
  commit(before);
  sync();
}

/** Change a property of the selected note (and the default for new ones). */
function setProp(key, value) {
  if (key !== 'kind') settings[key] = value;
  store.save('imgnote', { tool: settings.tool, color: settings.color, size: settings.size, bg: settings.bg });
  const sel = current();
  if (sel && key !== 'kind') {
    const before = clone(items);
    sel[key] = value;
    commit(before);
  }
  sync();
}

/* ---------- Pointer and keyboard ---------- */

/** The top note under (px, py) in preview pixels; `tol` = a finger's slack. */
function hitTest(px, py, tol) {
  const cv = $('#ntCanvas');
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const b = boxes.get(it.id);
    if (!b || px < b.x - tol || py < b.y - tol || px > b.x + b.w + tol || py > b.y + b.h + tol) continue;
    if (it.kind === 'text' || it.kind === 'mark') return it;
    const ax = it.x1 * cv.width; const ay = it.y1 * cv.height;
    const bx = it.x2 * cv.width; const by = it.y2 * cv.height;
    if (it.kind === 'box') {
      // Only the frame, so a new note can still be drawn inside a box.
      const [l, r] = [Math.min(ax, bx), Math.max(ax, bx)];
      const [t2, btm] = [Math.min(ay, by), Math.max(ay, by)];
      const inside = px > l + tol && px < r - tol && py > t2 + tol && py < btm - tol;
      if (!inside) return it;
      continue;
    }
    // Arrows: close to the line, not just inside its box.
    const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const k = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2));
    if (Math.hypot(px - (ax + k * (bx - ax)), py - (ay + k * (by - ay))) < tol) return it;
  }
  return null;
}

(function bindCanvas() {
  const cv = $('#ntCanvas');
  let drag = null;
  const at = (e) => {
    const r = cv.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * cv.width;
    const py = ((e.clientY - r.top) / r.height) * cv.height;
    return { px, py, fx: px / cv.width, fy: py / cv.height, scale: cv.width / r.width };
  };
  cv.addEventListener('pointerdown', (e) => {
    if (!photo || e.button > 0) return;
    const p = at(e);
    const before = clone(items);
    const hit = hitTest(p.px, p.py, 12 * p.scale);
    cv.setPointerCapture(e.pointerId);
    if (hit) {
      selected = hit.id;
      settings.tool = hit.kind;
      drag = { mode: 'move', it: hit, start: p, orig: { ...hit }, before };
    } else if (settings.tool === 'text') {
      const it = makeItem(p.fx, p.fy);
      items.push(it);
      selected = it.id;
      drag = { mode: 'move', it, start: p, orig: { ...it }, before };
    } else {
      const it = { ...makeItem(p.fx, p.fy), x1: p.fx, y1: p.fy, x2: p.fx, y2: p.fy };
      items.push(it);
      selected = it.id;
      drag = { mode: 'draw', it, start: p, before };
    }
    sync();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = at(e);
    const { it } = drag;
    if (drag.mode === 'move') {
      const dx = p.fx - drag.start.fx;
      const dy = p.fy - drag.start.fy;
      Object.assign(it, { x1: drag.orig.x1 + dx, y1: drag.orig.y1 + dy, x2: drag.orig.x2 + dx, y2: drag.orig.y2 + dy });
    } else {
      it.x2 = Math.min(1, Math.max(0, p.fx));
      it.y2 = Math.min(1, Math.max(0, p.fy));
    }
    draw();
  });
  const end = (e) => {
    if (!drag) return;
    const { it } = drag;
    if (drag.mode === 'draw') {
      const p = at(e);
      // A tap (no real drag) gets a shape of the default size at that spot.
      if (Math.hypot(p.px - drag.start.px, p.py - drag.start.py) / p.scale < 10) {
        Object.assign(it, makeItem(drag.start.fx, drag.start.fy), { id: it.id });
      }
    }
    commit(drag.before);
    drag = null;
    sync();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('keydown', (e) => {
    const sel = current();
    if (e.key === 'Escape') { selected = 0; sync(); return; }
    if (!sel) {
      if (photo && e.key === 'Enter') { e.preventDefault(); addNote(); }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
    const step = e.shiftKey ? 0.05 : 0.01;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const before = clone(items);
    sel.x1 += d[0]; sel.x2 += d[0]; sel.y1 += d[1]; sel.y2 += d[1];
    commit(before);
    sync();
  });
})();

/* ---------- Output ---------- */

/** The annotated photo as a JPG at the photo's full size. */
export async function noteFile() {
  const { width: W, height: H } = photo.canvas;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  paint(c, W, H);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
  const base = photo.name.replace(/\.[^.]+$/, '') || 'gambar';
  return new File([blob], `${base}-nota.jpg`, { type: 'image/jpeg' });
}

async function save(share) {
  if (!photo) return;
  setStatus(tr('working'));
  const file = await noteFile();
  if (share) await shareOrDownload(file); else download(file);
  setStatus(tr('ntDone', { size: formatSize(file.size) }));
}

/* ---------- Input ---------- */

async function openFile(list) {
  const file = [...list].find((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif|hei[cf])$/i.test(f.name));
  if (!file) { setStatus(tr('loadError')); return; }
  setStatus(tr('working'));
  try {
    const canvas = await loadPhoto(file, DECODE_MAX);
    photo = { canvas, name: file.name };
    items = [];
    selected = 0;
    history.clear();
    setStatus('');
  } catch {
    setStatus(tr('loadError'));
  }
  sync();
}

$$('input[name="ntTool"]').forEach((r) => r.addEventListener('change', () => {
  if (!r.checked) return;
  settings.tool = r.value;
  selected = 0; // a new tool means a new note, not changing the selected one
  setProp('kind', r.value);
}));
$$('input[name="ntColor"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) setProp('color', r.value); }));
$$('input[name="ntSize"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) setProp('size', r.value); }));
$('#ntBg').addEventListener('change', (e) => setProp('bg', e.target.checked));
// Typing updates the selected note live; one undo step per edit.
let typingBefore = null;
$('#ntText').addEventListener('input', () => {
  const sel = current();
  if (!sel || sel.kind !== 'text') return;
  if (!typingBefore) typingBefore = clone(items);
  sel.text = noteText();
  draw();
});
$('#ntText').addEventListener('change', () => {
  if (typingBefore) { commit(typingBefore); typingBefore = null; }
  sync();
});
$('#ntAddCenter').addEventListener('click', () => { addNote(); $('#ntCanvas').focus(); });
$('#ntDelete').addEventListener('click', removeSelected);
$('#ntClear').addEventListener('click', () => {
  const before = clone(items);
  items = [];
  selected = 0;
  commit(before);
  sync();
});
$('#saveNote').addEventListener('click', () => save(false));
$('#shareNote').addEventListener('click', () => save(true));
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; openFile(f); });
$('#pickCamera').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; openFile(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
document.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
document.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); openFile(e.dataTransfer.files); } });
document.addEventListener('paste', (e) => {
  const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter((f) => /^image\//.test(f.type));
  if (files.length) { e.preventDefault(); openFile(files); }
});

const refreshUndo = mountUndoButtons($('.nt-actions'), history, () => page.lang());
ready = true;
sync();

// Exposed for the automated test only.
window.__imgnote = { openFile, addNote, noteFile, settings, history, get items() { return items; }, get selected() { return selected; }, get photo() { return photo; } };
