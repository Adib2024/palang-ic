// Images -> PDF. Everything happens in memory in this tab; nothing is sent
// anywhere (the page's CSP blocks all network connections).
import { initPage } from './page.js';
import { loadPhoto } from './image-loader.js';
import { writePdf, fit, PAGE_SIZES } from './pdf.js';
import { t } from './i18n.js';
import * as store from './storage.js';

const QUALITY = {
  high: { maxSide: 2800, jpeg: 0.9 },
  mid: { maxSide: 2000, jpeg: 0.82 },
  low: { maxSide: 1400, jpeg: 0.7 },
};
const MARGIN_PT = { none: 0, small: 24, large: 54 };
// "Fit image" pages: long side ≈ A4's long side, so on-screen size feels familiar.
const FIT_LONG_SIDE = PAGE_SIZES.a4[1];
const THUMB_SIDE = 320;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const settings = {
  pageSize: 'a4',
  orientation: 'auto',
  margin: 'small',
  quality: 'mid',
  ...store.load('img2pdf', {}),
};
/** @type {{id: number, canvas: HTMLCanvasElement, rotation: number, thumb: string}[]} */
let items = [];
let nextId = 1;
let ready = false;
// Re-render on language change (labels on the cards are translated).
const page = initPage(() => { if (ready) render(); });

const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

/* ---------- Image handling ---------- */

function rotated(canvas, rotation, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const w = Math.round(canvas.width * scale);
  const h = Math.round(canvas.height * scale);
  const swap = rotation % 180 !== 0;
  const out = document.createElement('canvas');
  out.width = swap ? h : w;
  out.height = swap ? w : h;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(canvas, -w / 2, -h / 2, w, h);
  return out;
}

function makeThumb(item) {
  if (item.thumb) URL.revokeObjectURL(item.thumb);
  item.thumb = '';
  return new Promise((resolve) => {
    rotated(item.canvas, item.rotation, THUMB_SIDE).toBlob((b) => {
      if (b) item.thumb = URL.createObjectURL(b);
      resolve();
    }, 'image/jpeg', 0.8);
  });
}

async function addFiles(fileList) {
  const files = [...fileList];
  const images = files.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name));
  const skipped = files.length - images.length;
  let added = 0;
  setStatus(t(page.lang(), 'working'));
  for (const file of images) {
    try {
      const item = { id: nextId++, canvas: await loadPhoto(file), rotation: 0, thumb: '' };
      await makeThumb(item);
      items.push(item);
      added++;
      render();
    } catch {
      /* undecodable file: counted as skipped below */
    }
  }
  const msgs = [];
  if (added) msgs.push(tr('i2pAdded', { n: added }));
  if (skipped + (images.length - added)) msgs.push(tr('i2pSkipped', { n: skipped + images.length - added }));
  setStatus(msgs.join(' '));
}

/* ---------- Page grid ---------- */

function move(from, to) {
  if (to < 0 || to >= items.length || from === to) return;
  const [it] = items.splice(from, 1);
  items.splice(to, 0, it);
  render();
}

function render() {
  const grid = $('#pageGrid');
  grid.textContent = '';
  items.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'page-card';
    li.draggable = true;
    li.dataset.index = String(i);

    const thumb = document.createElement('div');
    thumb.className = 'page-thumb';
    // Show the real paper shape (portrait/landscape/fit) behind the image.
    const swap = item.rotation % 180 !== 0;
    const [pw, ph] = pageBox(swap ? item.canvas.height : item.canvas.width, swap ? item.canvas.width : item.canvas.height);
    thumb.style.aspectRatio = `${pw} / ${ph}`;
    const img = document.createElement('img');
    img.alt = `${tr('i2pPages')} ${i + 1}`;
    if (item.thumb) img.src = item.thumb;
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
      button(tr('i2pRotate'), '⟳', async () => {
        item.rotation = (item.rotation + 90) % 360;
        await makeThumb(item);
        render();
      }),
      button(tr('i2pRemove'), '✕', () => {
        if (item.thumb) URL.revokeObjectURL(item.thumb);
        items = items.filter((x) => x !== item);
        render();
      }, false, 'danger'),
    );
    meta.append(no, tools);
    li.append(thumb, meta);
    grid.appendChild(li);
  });

  const n = items.length;
  $('#pageCount').textContent = String(n);
  $('#emptyPages').hidden = n > 0;
  $('#clearAll').hidden = n === 0;
  $('#orderHint').hidden = n < 2;
  $('#makePdf').disabled = n === 0;
  $('#sharePdf').disabled = n === 0;
}

// Desktop drag-and-drop reordering of the cards.
function bindReorder() {
  const grid = $('#pageGrid');
  let from = -1;
  const cardOf = (e) => e.target.closest && e.target.closest('.page-card');
  grid.addEventListener('dragstart', (e) => {
    const card = cardOf(e);
    if (!card) return;
    from = Number(card.dataset.index);
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(from));
  });
  grid.addEventListener('dragover', (e) => {
    if (from < 0) return;
    e.preventDefault();
    $$('.page-card.drop-target').forEach((c) => c.classList.remove('drop-target'));
    const card = cardOf(e);
    if (card) card.classList.add('drop-target');
  });
  grid.addEventListener('drop', (e) => {
    if (from < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const card = cardOf(e);
    const to = card ? Number(card.dataset.index) : items.length - 1;
    const f = from;
    from = -1;
    move(f, to);
  });
  grid.addEventListener('dragend', () => {
    from = -1;
    $$('.page-card').forEach((c) => c.classList.remove('dragging', 'drop-target'));
  });
}

// Dropping files anywhere on the page adds them.
function bindFileDrop() {
  const zone = $('#dropzone');
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    zone.classList.add('over');
  });
  document.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) zone.classList.remove('over');
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    zone.classList.remove('over');
    addFiles(e.dataTransfer.files);
  });
}

/* ---------- Export ---------- */

function pageBox(imgW, imgH) {
  if (settings.pageSize === 'fit') {
    const s = FIT_LONG_SIDE / Math.max(imgW, imgH);
    const m = MARGIN_PT[settings.margin];
    return [imgW * s + 2 * m, imgH * s + 2 * m];
  }
  let [w, h] = PAGE_SIZES[settings.pageSize] || PAGE_SIZES.a4;
  const landscape = settings.orientation === 'landscape' || (settings.orientation === 'auto' && imgW > imgH);
  if (landscape) [w, h] = [h, w];
  return [w, h];
}

function toJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (b) => {
      if (!b) { reject(new Error('encode')); return; }
      resolve(new Uint8Array(await b.arrayBuffer()));
    }, 'image/jpeg', quality);
  });
}

export async function buildPdfFile() {
  const q = QUALITY[settings.quality] || QUALITY.mid;
  const images = [];
  const pages = [];
  for (const item of items) {
    const canvas = rotated(item.canvas, item.rotation, q.maxSide);
    const index = images.length;
    images.push({ jpeg: await toJpeg(canvas, q.jpeg), width: canvas.width, height: canvas.height });
    const [pw, ph] = pageBox(canvas.width, canvas.height);
    const m = MARGIN_PT[settings.margin];
    const { w, h } = fit(canvas.width, canvas.height, pw - 2 * m, ph - 2 * m);
    pages.push({ width: pw, height: ph, items: [{ image: index, w, h, x: (pw - w) / 2, y: (ph - h) / 2 }] });
  }
  const name = ($('#fileName').value.trim() || 'dokumen').replace(/[\\/:*?"<>|]+/g, '-').replace(/\.pdf$/i, '');
  return new File([writePdf(pages, images)], `${name}.pdf`, { type: 'application/pdf' });
}

function formatSize(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
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

let busy = false;
async function exportPdf(share) {
  if (busy || !items.length) return;
  busy = true;
  $$('.options .buttons button').forEach((b) => { b.disabled = true; });
  setStatus(tr('working'));
  try {
    const file = await buildPdfFile();
    const done = tr('i2pDone', { pages: items.length, size: formatSize(file.size) });
    if (share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: file.name });
        setStatus(done);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') { setStatus(''); return; }
      }
    }
    download(file);
    setStatus(share ? `${tr('shareFallback')} ${done}` : done);
  } catch {
    setStatus(tr('loadError'));
  } finally {
    busy = false;
    render();
  }
}

/* ---------- Boot ---------- */

function bindOptions() {
  for (const name of ['pageSize', 'orientation', 'margin', 'quality']) {
    $$(`input[name="${name}"]`).forEach((r) => {
      r.checked = r.value === settings[name];
      r.addEventListener('change', () => {
        if (!r.checked) return;
        settings[name] = r.value;
        store.save('img2pdf', settings);
        syncOptions();
        render();
      });
    });
  }
  syncOptions();
}

function syncOptions() {
  // Orientation is decided by the image itself on "fit image" pages.
  $('#orientationSet').disabled = settings.pageSize === 'fit';
}

$('#pickFiles').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
$('#pickCamera').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
$('#clearAll').addEventListener('click', () => {
  items.forEach((it) => it.thumb && URL.revokeObjectURL(it.thumb));
  items = [];
  render();
  setStatus('');
});
$('#makePdf').addEventListener('click', () => exportPdf(false));
$('#sharePdf').addEventListener('click', () => exportPdf(true));
bindOptions();
bindReorder();
bindFileDrop();
ready = true;
render();

// Exposed for the automated test only.
window.__img2pdf = { get items() { return items; }, settings, buildPdfFile, move };
