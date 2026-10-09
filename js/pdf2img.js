// PDF -> images: render pages with the vendored pdf.js and save them as
// JPG/PNG (one file, or a ZIP for several). Nothing leaves the device.
import { initPage } from './page.js';
import { t } from './i18n.js';
import * as store from './storage.js';
import { makeZip } from './zip.js';
import {
  openForRender, renderPage, isPdf, formatSize, safeName, download, shareFiles, openErrorKey,
} from './pdf-kit.js';

const THUMB_W = 200;
const MAX_SIDE = 5000; // px cap per image
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const settings = { format: 'jpeg', dpi: '150', which: 'all', ...store.load('pdf2img', {}) };
/** @type {{name: string, bytes: Uint8Array, doc: any} | null} */
let input = null;
/** @type {{index: number, selected: boolean, thumb: string}[]} */
let pages = [];
let ready = false;

const page = initPage(() => { if (ready) render(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };
function setProgress(f) {
  $('#progress').hidden = f == null;
  $('#progressBar').style.width = `${Math.round((f || 0) * 100)}%`;
}

let queue = Promise.resolve();
function queueThumb(p) {
  const doc = input.doc;
  queue = queue.then(async () => {
    if (!input || input.doc !== doc) return;
    try {
      const pg = await doc.getPage(p.index + 1);
      const canvas = await renderPage(pg, THUMB_W / pg.getViewport({ scale: 1 }).width);
      p.thumb = await new Promise((r) => canvas.toBlob((b) => r(b ? URL.createObjectURL(b) : ''), 'image/jpeg', 0.8));
      const img = document.querySelector(`.page-card[data-index="${p.index}"] img`);
      if (img && p.thumb) img.src = p.thumb;
    } catch { /* leave blank */ }
  });
  return queue;
}

async function openFile(file) {
  if (!file) return;
  if (!isPdf(file)) { setStatus(tr('pdfOpenError')); return; }
  setStatus(tr('pdfLoading'));
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await openForRender(bytes);
    if (input) input.doc.destroy();
    pages.forEach((p) => p.thumb && URL.revokeObjectURL(p.thumb));
    input = { name: file.name, bytes, doc };
    pages = Array.from({ length: doc.numPages }, (_, i) => ({ index: i, selected: false, thumb: '' }));
    setStatus('');
    render();
    pages.forEach(queueThumb);
    await queue;
  } catch (err) {
    setStatus(tr(openErrorKey(err)));
  }
}

function render() {
  $('#toolLayout').classList.toggle('is-empty', !input);
  $('#dropzone').hidden = !!input;
  $('#fileCard').hidden = !input;
  if (input) {
    $('#fileTitle').textContent = input.name;
    $('#fileMeta').textContent = `${tr('pdfPagesN', { n: input.doc.numPages })} · ${formatSize(input.bytes.length)}`;
  }
  const grid = $('#pageGrid');
  grid.textContent = '';
  for (const p of pages) {
    const li = document.createElement('li');
    li.className = `page-card${p.selected ? ' selected' : ''}`;
    li.dataset.index = String(p.index);
    const sel = document.createElement('input');
    sel.type = 'checkbox';
    sel.className = 'page-select';
    sel.checked = p.selected;
    sel.setAttribute('aria-label', `${tr('orgSelect')} ${p.index + 1}`);
    sel.addEventListener('change', () => { p.selected = sel.checked; render(); });
    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'page-thumb';
    thumb.setAttribute('aria-label', `${tr('orgSelect')} ${p.index + 1}`);
    thumb.addEventListener('click', () => { p.selected = !p.selected; render(); });
    const img = document.createElement('img');
    img.alt = '';
    if (p.thumb) img.src = p.thumb;
    thumb.appendChild(img);
    const meta = document.createElement('div');
    meta.className = 'page-meta';
    const no = document.createElement('span');
    no.className = 'page-no';
    no.textContent = String(p.index + 1);
    meta.appendChild(no);
    li.append(sel, thumb, meta);
    grid.appendChild(li);
  }
  const nSel = pages.filter((p) => p.selected).length;
  $('#pageCount').textContent = String(pages.length);
  $('#selCount').textContent = nSel ? tr('orgSelected', { n: nSel }) : '';
  $('#saveImgs').disabled = !input;
  $('#shareImgs').disabled = !input;
}

/** Render the chosen pages to image Files. */
export async function buildImages() {
  const list = settings.which === 'selected' ? pages.filter((p) => p.selected) : pages;
  if (!list.length) throw new Error('none');
  const type = settings.format === 'png' ? 'image/png' : 'image/jpeg';
  const ext = settings.format === 'png' ? 'png' : 'jpg';
  const base = safeName(input.name, 'dokumen');
  const files = [];
  for (let k = 0; k < list.length; k++) {
    setStatus(tr('cmpProgress', { i: k + 1, n: list.length }));
    setProgress(k / list.length);
    const pg = await input.doc.getPage(list[k].index + 1);
    const vp = pg.getViewport({ scale: 1 });
    const scale = Math.min(Number(settings.dpi) / 72, MAX_SIDE / Math.max(vp.width, vp.height));
    const canvas = await renderPage(pg, scale);
    const blob = await new Promise((r) => canvas.toBlob(r, type, 0.9));
    files.push(new File([blob], `${base}-${list[k].index + 1}.${ext}`, { type }));
    canvas.width = canvas.height = 0;
  }
  setProgress(null);
  return files;
}

async function zipOf(files) {
  const entries = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
  return new File([makeZip(entries)], `${safeName(input.name, 'dokumen')}-gambar.zip`, { type: 'application/zip' });
}

let busy = false;
async function exportImages(share) {
  if (busy || !input) return;
  busy = true;
  $$('.options .buttons button').forEach((b) => { b.disabled = true; });
  try {
    const files = await buildImages();
    const total = files.reduce((n, f) => n + f.size, 0);
    const done = tr('p2iDone', { n: files.length, size: formatSize(total) });
    if (share) {
      const how = await shareFiles(files, input.name);
      if (how === 'shared') { setStatus(done); return; }
      if (how === 'cancelled') { setStatus(''); return; }
    }
    download(files.length === 1 ? files[0] : await zipOf(files));
    setStatus(share ? `${tr('shareFallback')} ${done}` : done);
  } catch (err) {
    setProgress(null);
    setStatus(err && err.message === 'none' ? tr('p2iNoneSelected') : tr(openErrorKey(err)));
  } finally {
    busy = false;
    render();
  }
}

for (const name of ['format', 'dpi', 'which']) {
  $$(`input[name="${name}"]`).forEach((r) => {
    r.checked = r.value === settings[name];
    r.addEventListener('change', () => {
      if (!r.checked) return;
      settings[name] = r.value;
      store.save('pdf2img', settings);
    });
  });
}
$('#selAll').addEventListener('click', () => { pages.forEach((p) => { p.selected = true; }); render(); });
$('#selNone').addEventListener('click', () => { pages.forEach((p) => { p.selected = false; }); render(); });
$('#pickFiles').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; openFile(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
$('#saveImgs').addEventListener('click', () => exportImages(false));
$('#shareImgs').addEventListener('click', () => exportImages(true));
document.addEventListener('dragover', (e) => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); $('#dropzone').classList.add('over'); }
});
document.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) $('#dropzone').classList.remove('over'); });
document.addEventListener('drop', (e) => {
  if (!(e.dataTransfer && e.dataTransfer.files.length)) return;
  e.preventDefault();
  $('#dropzone').classList.remove('over');
  openFile(e.dataTransfer.files[0]);
});

ready = true;
render();

// Exposed for the automated test only.
window.__pdf2img = { settings, openFile, buildImages, get pages() { return pages; }, whenIdle: () => queue };
