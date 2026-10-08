// Document scanner: photos -> straightened, filtered pages -> PDF.
// All processing happens on canvases in this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import * as store from './storage.js';
import { loadPhoto } from './image-loader.js';
import { writePdf, fit, PAGE_SIZES } from './pdf.js';
import { detectCorners, defaultCorners, warp, applyFilter } from './scan-core.js';
import { formatSize, safeName, download, shareOrDownload } from './pdf-kit.js';

const QUALITY = { high: { maxSide: 2400, jpeg: 0.85 }, mid: { maxSide: 1800, jpeg: 0.75 }, low: { maxSide: 1300, jpeg: 0.62 } };
const A4_MARGIN = 18;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const settings = { filter: 'enhance', pageSize: 'a4', quality: 'mid', ...store.load('scan', {}) };
/** @type {{id: number, src: HTMLCanvasElement, corners: {x:number,y:number}[], filter: string, result: HTMLCanvasElement|null, thumb: string}[]} */
let pages = [];
let nextId = 1;
/** Page being edited, with working copies of its corners/filter/source. */
let editing = null;
let ready = false;

const page = initPage(() => { if (ready) render(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

/* ---------- Processing ---------- */

async function process(p) {
  const out = warp(p.src, p.corners, (QUALITY[settings.quality] || QUALITY.mid).maxSide);
  applyFilter(out, p.filter);
  p.result = out;
  const s = Math.min(1, 320 / Math.max(out.width, out.height));
  const c = document.createElement('canvas');
  c.width = Math.round(out.width * s);
  c.height = Math.round(out.height * s);
  c.getContext('2d').drawImage(out, 0, 0, c.width, c.height);
  if (p.thumb) URL.revokeObjectURL(p.thumb);
  p.thumb = await new Promise((r) => c.toBlob((b) => r(b ? URL.createObjectURL(b) : ''), 'image/jpeg', 0.8));
}

function rotateCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.height;
  c.height = src.width;
  const ctx = c.getContext('2d');
  ctx.translate(c.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(src, 0, 0);
  return c;
}

async function addFiles(fileList) {
  const files = [...fileList];
  let added = 0;
  let firstNew = null;
  setStatus(tr('working'));
  for (const file of files) {
    if (!(/^image\//.test(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name))) continue;
    try {
      const src = await loadPhoto(file, 3000);
      const found = detectCorners(src);
      const p = { id: nextId++, src, corners: found || defaultCorners(src.width, src.height), filter: settings.filter, result: null, thumb: '' };
      await process(p);
      pages.push(p);
      firstNew = firstNew || p;
      added++;
      render();
    } catch { /* undecodable image: counted below */ }
  }
  const msgs = [];
  if (added) msgs.push(tr('i2pAdded', { n: added }));
  if (files.length - added) msgs.push(tr('i2pSkipped', { n: files.length - added }));
  setStatus(msgs.join(' '));
  if (firstNew) openEditor(firstNew);
}

/* ---------- Corner editor ---------- */

function openEditor(p) {
  editing = { page: p, src: p.src, corners: p.corners.map((c) => ({ ...c })), filter: p.filter };
  $('#editor').hidden = false;
  $$('input[name="filter"]').forEach((r) => { r.checked = r.value === editing.filter; });
  drawStage();
  $('#editor').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function closeEditor() {
  editing = null;
  $('#editor').hidden = true;
}

function drawStage() {
  const { src } = editing;
  const canvas = $('#stageCanvas');
  const s = Math.min(1, 1200 / Math.max(src.width, src.height));
  canvas.width = Math.round(src.width * s);
  canvas.height = Math.round(src.height * s);
  canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
  $('#cropSvg').setAttribute('viewBox', `0 0 ${src.width} ${src.height}`);
  $$('.crop-handle').forEach((h) => h.remove());
  editing.corners.forEach((c, i) => {
    const h = document.createElement('button');
    h.type = 'button';
    h.className = 'crop-handle';
    h.dataset.i = String(i);
    h.setAttribute('aria-label', `${tr('scanAdjust')} ${i + 1}`);
    $('#stage').appendChild(h);
  });
  syncHandles();
}

function syncHandles() {
  const { src, corners } = editing;
  $('#cropPoly').setAttribute('points', corners.map((c) => `${c.x},${c.y}`).join(' '));
  $$('.crop-handle').forEach((h) => {
    const c = corners[Number(h.dataset.i)];
    h.style.left = `${(c.x / src.width) * 100}%`;
    h.style.top = `${(c.y / src.height) * 100}%`;
  });
}

function bindStage() {
  const stage = $('#stage');
  let drag = -1;
  stage.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.crop-handle');
    if (!h || !editing) return;
    e.preventDefault();
    drag = Number(h.dataset.i);
    h.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (drag < 0 || !editing) return;
    const r = stage.getBoundingClientRect();
    const { src } = editing;
    editing.corners[drag] = {
      x: Math.min(src.width, Math.max(0, ((e.clientX - r.left) / r.width) * src.width)),
      y: Math.min(src.height, Math.max(0, ((e.clientY - r.top) / r.height) * src.height)),
    };
    syncHandles();
  });
  const end = () => { drag = -1; };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  $('#autoBtn').addEventListener('click', () => {
    const found = detectCorners(editing.src);
    if (!found) setStatus(tr('scanNotFound'));
    editing.corners = found || defaultCorners(editing.src.width, editing.src.height);
    syncHandles();
  });
  $('#wholeBtn').addEventListener('click', () => {
    editing.corners = defaultCorners(editing.src.width, editing.src.height, 0);
    syncHandles();
  });
  $('#rotBtn').addEventListener('click', () => {
    const oldH = editing.src.height;
    editing.src = rotateCanvas(editing.src);
    // Rotate the corner points with the image; keep them in tl, tr, br, bl order.
    const r = editing.corners.map((c) => ({ x: oldH - c.y, y: c.x }));
    editing.corners = [r[3], r[0], r[1], r[2]];
    drawStage();
  });
  $$('input[name="filter"]').forEach((r) => r.addEventListener('change', () => {
    if (!r.checked || !editing) return;
    editing.filter = r.value;
    settings.filter = r.value;
    store.save('scan', settings);
  }));
  $('#applyBtn').addEventListener('click', async () => {
    if (!editing) return;
    const p = editing.page;
    p.src = editing.src;
    p.corners = editing.corners;
    p.filter = editing.filter;
    setStatus(tr('working'));
    await process(p);
    setStatus('');
    closeEditor();
    render();
  });
}

/* ---------- Page list ---------- */

function move(from, to) {
  if (to < 0 || to >= pages.length) return;
  const [p] = pages.splice(from, 1);
  pages.splice(to, 0, p);
  render();
}

function render() {
  const grid = $('#pageGrid');
  grid.textContent = '';
  pages.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = `page-card${editing && editing.page === p ? ' selected' : ''}`;
    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'page-thumb';
    thumb.setAttribute('aria-label', `${tr('scanEdit')} ${i + 1}`);
    thumb.addEventListener('click', () => { openEditor(p); render(); });
    const img = document.createElement('img');
    img.alt = '';
    if (p.thumb) img.src = p.thumb;
    thumb.appendChild(img);
    const meta = document.createElement('div');
    meta.className = 'page-meta';
    const no = document.createElement('span');
    no.className = 'page-no';
    no.textContent = String(i + 1);
    const tools = document.createElement('span');
    tools.className = 'page-tools';
    const btn = (label, text, fn, disabled, cls) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `icon-btn${cls ? ` ${cls}` : ''}`;
      b.textContent = text;
      b.title = label;
      b.setAttribute('aria-label', `${label} (${i + 1})`);
      b.disabled = !!disabled;
      b.addEventListener('click', fn);
      return b;
    };
    tools.append(
      btn(tr('i2pMoveLeft'), '◀', () => move(i, i - 1), i === 0),
      btn(tr('i2pMoveRight'), '▶', () => move(i, i + 1), i === pages.length - 1),
      btn(tr('scanEdit'), '✎', () => { openEditor(p); render(); }),
      btn(tr('i2pRemove'), '✕', () => {
        if (p.thumb) URL.revokeObjectURL(p.thumb);
        pages = pages.filter((x) => x !== p);
        if (editing && editing.page === p) closeEditor();
        render();
      }, false, 'danger'),
    );
    meta.append(no, tools);
    li.append(thumb, meta);
    grid.appendChild(li);
  });
  $('#pageCount').textContent = String(pages.length);
  $('#toolLayout').classList.toggle('is-empty', pages.length === 0);
  $('#dropzone').hidden = pages.length > 0;
  $('#makePdf').disabled = !pages.length;
  $('#sharePdf').disabled = !pages.length;
}

/* ---------- Export ---------- */

const toJpeg = (c, q) => new Promise((resolve) => c.toBlob(async (b) => resolve(new Uint8Array(await b.arrayBuffer())), 'image/jpeg', q));

export async function buildPdfFile() {
  const q = QUALITY[settings.quality] || QUALITY.mid;
  const images = [];
  const out = [];
  for (const p of pages) {
    if (!p.result) await process(p);
    let c = p.result;
    if (Math.max(c.width, c.height) > q.maxSide) {
      const s = q.maxSide / Math.max(c.width, c.height);
      const r = document.createElement('canvas');
      r.width = Math.round(c.width * s);
      r.height = Math.round(c.height * s);
      r.getContext('2d').drawImage(c, 0, 0, r.width, r.height);
      c = r;
    }
    images.push({ jpeg: await toJpeg(c, q.jpeg), width: c.width, height: c.height });
    const index = images.length - 1;
    if (settings.pageSize === 'fit') {
      const s = PAGE_SIZES.a4[1] / Math.max(c.width, c.height);
      const w = c.width * s;
      const h = c.height * s;
      out.push({ width: w, height: h, items: [{ image: index, x: 0, y: 0, w, h }] });
    } else {
      let [pw, ph] = PAGE_SIZES.a4;
      if (c.width > c.height) [pw, ph] = [ph, pw];
      const { w, h } = fit(c.width, c.height, pw - 2 * A4_MARGIN, ph - 2 * A4_MARGIN);
      out.push({ width: pw, height: ph, items: [{ image: index, w, h, x: (pw - w) / 2, y: (ph - h) / 2 }] });
    }
  }
  const name = safeName($('#fileName').value, 'imbasan');
  return new File([writePdf(out, images)], `${name}.pdf`, { type: 'application/pdf' });
}

let busy = false;
async function exportPdf(share) {
  if (busy || !pages.length) return;
  busy = true;
  setStatus(tr('working'));
  try {
    const file = await buildPdfFile();
    const done = tr('i2pDone', { pages: pages.length, size: formatSize(file.size) });
    if (share) {
      const how = await shareOrDownload(file);
      setStatus(how === 'cancelled' ? '' : how === 'downloaded' ? `${tr('shareFallback')} ${done}` : done);
    } else {
      download(file);
      setStatus(done);
    }
  } catch {
    setStatus(tr('loadError'));
  } finally {
    busy = false;
  }
}

/* ---------- Boot ---------- */

for (const name of ['pageSize', 'quality']) {
  $$(`input[name="${name}"]`).forEach((r) => {
    r.checked = r.value === settings[name];
    r.addEventListener('change', () => { if (r.checked) { settings[name] = r.value; store.save('scan', settings); } });
  });
}
for (const id of ['#pickFiles', '#pickCamera', '#addMore']) {
  $(id).addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); });
}
$('#makePdf').addEventListener('click', () => exportPdf(false));
$('#sharePdf').addEventListener('click', () => exportPdf(true));
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

bindStage();
ready = true;
render();

// Exposed for the automated test only.
window.__scan = {
  settings, addFiles, buildPdfFile, openEditor,
  get pages() { return pages; }, get editing() { return editing; },
};
