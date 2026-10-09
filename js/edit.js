// Edit PDF: add text, images, boxes, circles, lines, freehand drawing and
// highlights on any page, then write them into the PDF with pdf-lib.
// Everything happens in this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import { loadPhoto } from './image-loader.js';
import { loadPdfLib, formatSize, safeName, download, shareOrDownload, openErrorKey } from './pdf-kit.js';
import { openPdfs, bindFileDrop, displayToUser } from './pdf-pages.js';
import { renderPages, fracPoint, placeFrac } from './page-viewer.js';
import {
  bindFontSelect, cssFamily, pdfFont, encodable, refreshFontSelects,
} from './fonts.js';

const COLORS = { black: '#111111', red: '#d62828', blue: '#1d4ed8', green: '#15803d', yellow: '#facc15' };
const TEXT_FONT = 'Helvetica, Arial, sans-serif';
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let src = null;
/** @type {{el:HTMLElement, canvas:HTMLCanvasElement, vp:any, overlay:HTMLCanvasElement, shapes:any[]}[]} */
let views = [];
/** Text and image items: {id, kind, page, x, y, w, h, el, ...} in page fractions. */
let items = [];
/** Undo stack of {kind:'shape'|'item', page, ref}. */
let history = [];
let tool = 'select';
let color = 'black';
let stroke = 3; // points
let fontSize = 14; // points
let fontId = 'helvetica';
let fontBold = false;
let selectedShape = null;
let nextId = 1;
let ready = false;

const page = initPage(() => { if (ready) { syncToolbar(); refreshFontSelects(); } });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

/* ---------- Shapes (drawn on a per-page overlay canvas) ---------- */

// Shapes are stored in page points (display orientation, origin top-left).
function drawShape(ctx, s, k) {
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width * k;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.type === 'highlight') {
    ctx.globalAlpha = 0.35;
    ctx.fillRect(s.x * k, s.y * k, s.w * k, s.h * k);
  } else if (s.type === 'rect') {
    ctx.strokeRect(s.x * k, s.y * k, s.w * k, s.h * k);
  } else if (s.type === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse((s.x + s.w / 2) * k, (s.y + s.h / 2) * k, Math.abs(s.w / 2) * k, Math.abs(s.h / 2) * k, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.type === 'line') {
    ctx.beginPath();
    ctx.moveTo(s.x1 * k, s.y1 * k);
    ctx.lineTo(s.x2 * k, s.y2 * k);
    ctx.stroke();
  } else if (s.type === 'pen') {
    ctx.beginPath();
    s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
    ctx.stroke();
  }
  ctx.restore();
}

function bbox(s) {
  if (s.type === 'line') return { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
  if (s.type === 'pen') {
    const xs = s.points.map((p) => p[0]);
    const ys = s.points.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  return { x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) };
}

function redraw(view) {
  const c = view.overlay;
  const k = c.width / view.vp.width;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  for (const s of view.shapes) drawShape(ctx, s, k);
  if (selectedShape && view.shapes.includes(selectedShape)) {
    const b = bbox(selectedShape);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 1.5;
    ctx.strokeRect((b.x - 4) * k, (b.y - 4) * k, (b.w + 8) * k, (b.h + 8) * k);
    ctx.restore();
  }
}

function moveShape(s, dx, dy) {
  if (s.type === 'line') { s.x1 += dx; s.x2 += dx; s.y1 += dy; s.y2 += dy; } else if (s.type === 'pen') s.points = s.points.map(([x, y]) => [x + dx, y + dy]);
  else { s.x += dx; s.y += dy; }
}

function bindOverlay(view) {
  const ov = view.overlay;
  let drawing = null;
  let start = null;
  const pt = (e) => {
    const f = fracPoint(ov, e);
    return { x: f.x * view.vp.width, y: f.y * view.vp.height };
  };
  ov.addEventListener('pointerdown', (e) => {
    const p = pt(e);
    setActive(view);
    if (tool === 'text') {
      // Stop the click from moving focus away from the new text box.
      e.preventDefault();
      const it = addText(view, p.x / view.vp.width, p.y / view.vp.height, '');
      setTool('select');
      setTimeout(() => it.el.querySelector('.edit-text').focus(), 0);
      return;
    }
    if (tool === 'select') {
      // Pick the topmost shape under the pointer.
      selectedShape = [...view.shapes].reverse().find((s) => {
        const b = bbox(s);
        const pad = Math.max(6, s.width);
        return p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
      }) || null;
      views.forEach(redraw);
      syncToolbar();
      if (selectedShape) { start = p; drawing = 'move'; ov.setPointerCapture(e.pointerId); }
      return;
    }
    if (tool === 'image') return;
    e.preventDefault();
    ov.setPointerCapture(e.pointerId);
    const c = COLORS[tool === 'highlight' ? 'yellow' : color];
    start = p;
    if (tool === 'pen') drawing = { type: 'pen', points: [[p.x, p.y]], color: c, width: stroke };
    else if (tool === 'line') drawing = { type: 'line', x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: c, width: stroke };
    else drawing = { type: tool, x: p.x, y: p.y, w: 0, h: 0, color: c, width: stroke };
    view.shapes.push(drawing);
  });
  ov.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pt(e);
    if (drawing === 'move') {
      moveShape(selectedShape, p.x - start.x, p.y - start.y);
      start = p;
    } else if (drawing.type === 'pen') drawing.points.push([p.x, p.y]);
    else if (drawing.type === 'line') { drawing.x2 = p.x; drawing.y2 = p.y; } else { drawing.w = p.x - start.x; drawing.h = p.y - start.y; }
    redraw(view);
  });
  const end = () => {
    if (drawing && drawing !== 'move') {
      const b = bbox(drawing);
      // Ignore accidental taps.
      if (b.w < 2 && b.h < 2) view.shapes.pop();
      else {
        // Normalise negative sizes so hit-testing and export are simple.
        if (drawing.w != null) Object.assign(drawing, bbox(drawing));
        history.push({ kind: 'shape', view, ref: drawing });
      }
      redraw(view);
      syncToolbar();
    }
    drawing = null;
  };
  ov.addEventListener('pointerup', end);
  ov.addEventListener('pointercancel', end);
}

/* ---------- Items (text boxes and images, as DOM elements) ---------- */

let activeView = null;
function setActive(view) {
  activeView = view;
  views.forEach((v) => v.el.classList.toggle('active', v === view));
}

function scaleOf(view) { return view.el.clientWidth / view.vp.width; }

function syncTextSizes() {
  for (const it of items) {
    if (it.kind === 'text') it.el.querySelector('.edit-text').style.fontSize = `${it.size * scaleOf(views[it.page])}px`;
  }
}

function selectItem(it) {
  items.forEach((x) => x.el.classList.toggle('selected', x === it));
  if (it) { selectedShape = null; views.forEach(redraw); }
}

function removeItem(it) {
  it.el.remove();
  items = items.filter((x) => x !== it);
  history = history.filter((h) => h.ref !== it);
  syncToolbar();
}

function makeDraggable(it, view, handleSel) {
  let mode = null;
  let start = null;
  it.el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.sig-del')) return;
    const isHandle = e.target.closest('.sig-handle');
    const isGrip = handleSel ? e.target.closest(handleSel) : true;
    selectItem(it);
    setActive(view);
    if (!isHandle && !isGrip) return; // let the text box take focus
    e.preventDefault();
    mode = isHandle ? 'resize' : 'move';
    start = { x: e.clientX, y: e.clientY, it: { ...it } };
    it.el.setPointerCapture(e.pointerId);
  });
  it.el.addEventListener('pointermove', (e) => {
    if (!mode) return;
    const r = view.el.getBoundingClientRect();
    const dx = (e.clientX - start.x) / r.width;
    const dy = (e.clientY - start.y) / r.height;
    if (mode === 'move') {
      it.x = Math.min(1 - 0.02, Math.max(0, start.it.x + dx));
      it.y = Math.min(1 - 0.02, Math.max(0, start.it.y + dy));
    } else if (it.kind === 'image') {
      const ratio = (view.vp.width * it.aspect) / view.vp.height;
      it.w = Math.min(1 - it.x, Math.max(0.03, start.it.w + dx));
      it.h = it.w * ratio;
    }
    placeFrac(it.el, it.kind === 'image' ? it : { x: it.x, y: it.y });
  });
  const end = () => { mode = null; };
  it.el.addEventListener('pointerup', end);
  it.el.addEventListener('pointercancel', end);
}

function deleteButton(it) {
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'sig-del';
  del.textContent = '✕';
  del.setAttribute('aria-label', tr('sigDelete'));
  del.addEventListener('click', (e) => { e.stopPropagation(); removeItem(it); });
  return del;
}

/** Show a text item in its chosen font (loaded on demand). */
function applyFont(it) {
  const box = it.el.querySelector('.edit-text');
  box.style.fontWeight = it.bold ? '700' : '400';
  const want = `${it.font}-${it.bold}`;
  it.fontKey = want;
  cssFamily(it.font, it.bold).then((fam) => { if (it.fontKey === want) box.style.fontFamily = fam; }).catch(() => {});
}

const selectedText = () => items.find((x) => x.el.classList.contains('selected') && x.kind === 'text');

/** Add a text box at page fractions (x, y). */
export function addText(view, x, y, text) {
  const it = {
    id: nextId++, kind: 'text', page: view.index, x, y, size: fontSize, color: COLORS[color], font: fontId, bold: fontBold, el: null,
  };
  const el = document.createElement('div');
  el.className = 'edit-item text-item';
  const grip = document.createElement('span');
  grip.className = 'edit-grip';
  grip.textContent = '⠿';
  grip.setAttribute('aria-hidden', 'true');
  const box = document.createElement('div');
  box.className = 'edit-text';
  box.contentEditable = 'plaintext-only';
  if (box.contentEditable !== 'plaintext-only') box.contentEditable = 'true';
  box.spellcheck = false;
  box.textContent = text;
  box.style.color = it.color;
  box.style.fontFamily = TEXT_FONT;
  box.setAttribute('aria-label', tr('editTextBox'));
  it.el = el;
  applyFont(it);
  el.append(grip, box);
  el.appendChild(deleteButton(it));
  view.el.appendChild(el);
  placeFrac(el, { x, y });
  items.push(it);
  history.push({ kind: 'item', ref: it });
  syncTextSizes();
  makeDraggable(it, view, '.edit-grip');
  selectItem(it);
  box.focus();
  syncToolbar();
  return it;
}

async function addImage(file) {
  const view = activeView || views[0];
  if (!view) return;
  const c = await loadPhoto(file, 2000);
  const png = await new Promise((r) => c.toBlob(async (b) => r(new Uint8Array(await b.arrayBuffer())), 'image/png'));
  const aspect = c.height / c.width;
  const w = 0.3;
  const h = (w * view.vp.width * aspect) / view.vp.height;
  const it = { id: nextId++, kind: 'image', page: view.index, x: 0.35, y: Math.max(0, 0.5 - h / 2), w, h, aspect, png, el: null };
  const el = document.createElement('div');
  el.className = 'sig-item edit-item';
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  img.src = c.toDataURL('image/png');
  const handle = document.createElement('span');
  handle.className = 'sig-handle';
  it.el = el;
  el.append(img, deleteButton(it), handle);
  view.el.appendChild(el);
  placeFrac(el, it);
  items.push(it);
  history.push({ kind: 'item', ref: it });
  makeDraggable(it, view, null);
  selectItem(it);
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  syncToolbar();
}

/* ---------- Toolbar ---------- */

function setTool(name) {
  tool = name;
  $$('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === name)));
  views.forEach((v) => { v.overlay.dataset.tool = name; });
  if (name === 'image') $('#imageFile').click();
}

function syncToolbar() {
  $('#toolLayout').classList.toggle('is-empty', !src);
  $('#undoBtn').disabled = history.length === 0;
  $('#deleteBtn').disabled = !selectedShape;
  $('#strokeOut').textContent = `${stroke}`;
  $('#fontOut').textContent = `${fontSize} pt`;
  if (src) {
    $('#docTitle').textContent = src.name;
    $('#docMeta').textContent = `${tr('pdfPagesN', { n: src.pages })} · ${formatSize(src.bytes.length)}`;
  }
  const n = items.length + views.reduce((k, v) => k + v.shapes.length, 0);
  $('#savePdf').disabled = !src || n === 0;
  $('#sharePdf').disabled = !src || n === 0;
}

function undo() {
  const last = history.pop();
  if (!last) return;
  if (last.kind === 'shape') {
    last.view.shapes = last.view.shapes.filter((s) => s !== last.ref);
    if (selectedShape === last.ref) selectedShape = null;
    redraw(last.view);
  } else {
    last.ref.el.remove();
    items = items.filter((x) => x !== last.ref);
  }
  syncToolbar();
}

function deleteSelectedShape() {
  if (!selectedShape) return;
  for (const v of views) {
    if (v.shapes.includes(selectedShape)) {
      v.shapes = v.shapes.filter((s) => s !== selectedShape);
      history = history.filter((h) => h.ref !== selectedShape);
      selectedShape = null;
      redraw(v);
    }
  }
  syncToolbar();
}

/* ---------- Export ---------- */

const pngOf = (canvas) => new Promise((r) => canvas.toBlob(async (b) => r(new Uint8Array(await b.arrayBuffer())), 'image/png'));

function hexToRgb(PDFLib, hex) {
  const n = parseInt(hex.slice(1), 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Write all edits into a copy of the PDF. */
export async function buildOutput() {
  const PDFLib = await loadPdfLib();
  const doc = await PDFLib.PDFDocument.load(src.bytes, { updateMetadata: false });
  for (const view of views) {
    const pg = doc.getPage(view.index);
    const Dw = view.vp.width;
    const Dh = view.vp.height;
    // Shapes → one transparent PNG layer per page (at 2× for crisp lines).
    if (view.shapes.length) {
      const layer = document.createElement('canvas');
      layer.width = Math.round(Dw * 2);
      layer.height = Math.round(Dh * 2);
      const ctx = layer.getContext('2d');
      for (const s of view.shapes) drawShape(ctx, s, 2);
      const img = await doc.embedPng(await pngOf(layer));
      const p = displayToUser(pg, 0, Dh);
      pg.drawImage(img, { x: p.x, y: p.y, width: Dw, height: Dh, rotate: PDFLib.degrees(p.angle) });
    }
    for (const it of items.filter((x) => x.page === view.index)) {
      if (it.kind === 'image') {
        const img = await doc.embedPng(it.png);
        const p = displayToUser(pg, it.x * Dw, (it.y + it.h) * Dh);
        pg.drawImage(img, { x: p.x, y: p.y, width: it.w * Dw, height: it.h * Dh, rotate: PDFLib.degrees(p.angle) });
      } else {
        const { font, standard } = await pdfFont(PDFLib, doc, it.font, it.bold);
        const lines = encodable(it.el.querySelector('.edit-text').innerText.replace(/\n$/, ''), standard).split('\n');
        const lead = it.size * 1.2;
        // The on-screen box has no padding and line-height 1.2. For the
        // standard fonts each baseline sits ~0.88em below the top of its line
        // (Helvetica ascent); for embedded fonts use the font's own metrics
        // the way CSS does (half-leading + ascent).
        const asc = font.heightAtSize(it.size, { descender: false });
        const full = font.heightAtSize(it.size);
        const base = standard ? it.size * 0.88 : (lead - full) / 2 + asc;
        lines.forEach((line, i) => {
          if (!line) return;
          const p = displayToUser(pg, it.x * Dw, it.y * Dh + i * lead + base);
          pg.drawText(line, { x: p.x, y: p.y, size: it.size, font, color: hexToRgb(PDFLib, it.color), rotate: PDFLib.degrees(p.angle) });
        });
      }
    }
  }
  const bytes = await doc.save();
  return new File([bytes], `${safeName($('#fileName').value, 'dokumen')}.pdf`, { type: 'application/pdf' });
}

/* ---------- Boot ---------- */

async function openFile(list) {
  setStatus(tr('pdfLoading'));
  const { sources, failed } = await openPdfs(list.slice(0, 1));
  if (!sources.length) {
    setStatus(failed.length ? `${failed[0].name}: ${tr(openErrorKey(failed[0].err))}` : tr('pdfOpenError'));
    return;
  }
  if (src) src.doc.destroy();
  [src] = sources;
  items = [];
  history = [];
  selectedShape = null;
  $('#fileName').value = `${safeName(src.name, 'dokumen')}-edit`;
  syncToolbar();
  const rendered = await renderPages($('#editPages'), src.doc, { label: (n) => tr('sigPage', { n }) });
  views = rendered.map((v) => {
    const overlay = document.createElement('canvas');
    overlay.className = 'edit-overlay';
    overlay.width = v.canvas.width;
    overlay.height = v.canvas.height;
    v.el.appendChild(overlay);
    const view = { ...v, overlay, shapes: [] };
    bindOverlay(view);
    return view;
  });
  setActive(views[0]);
  setTool('select');
  setStatus('');
  syncToolbar();
}

let busy = false;
async function exportPdf(share) {
  if (busy || !src) return;
  busy = true;
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
  }
}

$$('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
$$('input[name="editColor"]').forEach((r) => r.addEventListener('change', () => {
  if (!r.checked) return;
  color = r.value;
  const it = items.find((x) => x.el.classList.contains('selected') && x.kind === 'text');
  if (it) { it.color = COLORS[color]; it.el.querySelector('.edit-text').style.color = it.color; }
}));
$('#stroke').addEventListener('input', (e) => { stroke = Number(e.target.value); syncToolbar(); });
$('#fontSize').addEventListener('input', (e) => {
  fontSize = Number(e.target.value);
  const it = items.find((x) => x.el.classList.contains('selected') && x.kind === 'text');
  if (it) { it.size = fontSize; syncTextSizes(); }
  syncToolbar();
});
bindFontSelect($('#fontFamily'), {
  lang: () => page.lang(),
  value: fontId,
  onChange: (id) => {
    fontId = id;
    const it = selectedText();
    if (it) { it.font = id; applyFont(it); }
  },
  onError: () => setStatus(tr('fontAddError')),
});
$('#fontBold').addEventListener('change', (e) => {
  fontBold = e.target.checked;
  const it = selectedText();
  if (it) { it.bold = fontBold; applyFont(it); }
});
$('#undoBtn').addEventListener('click', undo);
$('#deleteBtn').addEventListener('click', deleteSelectedShape);
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShape && !e.target.closest('[contenteditable]')) deleteSelectedShape();
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.target.closest('[contenteditable]')) { e.preventDefault(); undo(); }
});
$('#imageFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  setTool('select');
  if (f) { try { await addImage(f); } catch { setStatus(tr('loadError')); } }
});
window.addEventListener('resize', syncTextSizes);
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; openFile(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
$('#savePdf').addEventListener('click', () => exportPdf(false));
$('#sharePdf').addEventListener('click', () => exportPdf(true));
bindFileDrop($('#dropzone'), (files) => openFile(files.filter((f) => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name))));
ready = true;
syncToolbar();

// Exposed for the automated test only.
window.__edit = {
  openFile, buildOutput, setTool, addText, undo,
  get views() { return views; }, get items() { return items; }, get history() { return history; },
};
