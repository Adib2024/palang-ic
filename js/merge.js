// Merge PDF: put whole files in order and join them into one PDF. In page
// view every page of every file can be reordered or removed before joining.
// Everything happens in this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import { formatSize, safeName, download, shareOrDownload, openErrorKey } from './pdf-kit.js';
import {
  openPdfs, createThumbQueue, card, iconButton, bindReorder, bindFileDrop, moveItem, buildFromPages,
} from './pdf-pages.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/** @type {{id:number,name:string,bytes:Uint8Array,doc:any,pages:number,hue:number,thumb?:string}[]} */
let files = [];
/** Page view: null = whole files in order; else the chosen pages in order. */
/** @type {{id:number, src:number, index:number, thumb?:string}[] | null} */
let pages = null;
let view = 'files';
let nextPage = 1;
let ready = false;
const thumbs = createThumbQueue(220);

const page = initPage(() => { if (ready) render(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

async function addFiles(list) {
  setStatus(tr('pdfLoading'));
  const { sources, failed, skipped } = await openPdfs(list, files.length);
  files.push(...sources);
  if (pages) for (const f of sources) pages.push(...pagesOf(f));
  render();
  for (const f of sources) {
    thumbs.add(f.doc, 0, 0, (url) => {
      f.thumb = url;
      const img = document.querySelector(`.page-card[data-id="${f.id}"] img`);
      if (img && url) img.src = url;
    });
  }
  const msgs = failed.map((f) => `${f.name}: ${tr(openErrorKey(f.err))}`);
  if (skipped) msgs.push(tr('i2pSkipped', { n: skipped }));
  setStatus(msgs.join(' '));
  await thumbs.idle();
}

function pagesOf(f) {
  return Array.from({ length: f.pages }, (_, i) => ({ id: nextPage++, src: f.id, index: i }));
}

function setView(v) {
  view = v;
  if (v === 'pages' && !pages) pages = files.flatMap(pagesOf);
  render();
}

function renderPages(grid) {
  pages.forEach((pg, i) => {
    const f = files.find((x) => x.id === pg.src);
    const li = card({
      index: i,
      thumb: pg.thumb,
      number: tr('sigPage', { n: pg.index + 1 }),
      caption: f.name,
      hue: f.hue,
      draggable: true,
      tools: [
        iconButton(`${tr('i2pMoveLeft')}: ${f.name} ${pg.index + 1}`, '◀', () => { if (moveItem(pages, i, i - 1)) render(); }, { disabled: i === 0 }),
        iconButton(`${tr('i2pMoveRight')}: ${f.name} ${pg.index + 1}`, '▶', () => { if (moveItem(pages, i, i + 1)) render(); }, { disabled: i === pages.length - 1 }),
        iconButton(`${tr('mergeRemovePage')}: ${f.name} ${pg.index + 1}`, '✕', () => {
          pages = pages.filter((x) => x !== pg);
          render();
        }, { danger: true }),
      ],
    });
    li.dataset.page = String(pg.id);
    grid.appendChild(li);
    if (pg.thumb === undefined) {
      pg.thumb = '';
      thumbs.add(f.doc, pg.index, 0, (url) => {
        pg.thumb = url;
        const img = document.querySelector(`.page-card[data-page="${pg.id}"] img`);
        if (img && url) img.src = url;
      });
    }
  });
}

function render() {
  const grid = $('#pageGrid');
  grid.textContent = '';
  $$('input[name="mergeView"]').forEach((r) => { r.checked = r.value === view; });
  $('#mergeViewRow').hidden = !files.length;
  $('#pagesReset').hidden = view !== 'pages' || !pages || !edited();
  if (view === 'pages' && pages) renderPages(grid);
  else files.forEach((f, i) => {
    const li = card({
      index: i,
      thumb: f.thumb,
      number: tr('pdfPagesN', { n: f.pages }),
      caption: f.name,
      hue: f.hue,
      draggable: true,
      tools: [
        iconButton(`${tr('i2pMoveLeft')}: ${f.name}`, '◀', () => { if (moveItem(files, i, i - 1)) filesMoved(); }, { disabled: i === 0 }),
        iconButton(`${tr('i2pMoveRight')}: ${f.name}`, '▶', () => { if (moveItem(files, i, i + 1)) filesMoved(); }, { disabled: i === files.length - 1 }),
        iconButton(`${tr('i2pRemove')}: ${f.name}`, '✕', () => {
          f.doc.destroy();
          if (f.thumb) URL.revokeObjectURL(f.thumb);
          files = files.filter((x) => x !== f);
          if (pages) pages = pages.filter((x) => x.src !== f.id);
          render();
        }, { danger: true }),
      ],
    });
    li.dataset.id = String(f.id);
    grid.appendChild(li);
  });
  const total = outputList().length;
  $('#pageCount').textContent = String(view === 'pages' && pages ? pages.length : files.length);
  $('#mergeSummary').textContent = files.length ? tr('mergeSummary', { files: files.length, pages: total }) : '';
  $('#toolLayout').classList.toggle('is-empty', files.length === 0);
  // One file is enough once its pages have been rearranged or trimmed.
  const canMerge = total > 0 && (files.length >= 2 || edited());
  $('#savePdf').disabled = !canMerge;
  $('#sharePdf').disabled = !canMerge;
  $('#needTwo').hidden = files.length !== 1;
}

/** Whole files moved: the page order follows them again. */
function filesMoved() {
  if (pages) pages = files.flatMap((f) => pages.filter((p) => p.src === f.id));
  render();
}

/** Pages to write, in order. */
function outputList() {
  if (pages) return pages.map((p) => ({ src: p.src, index: p.index }));
  return files.flatMap((f) => Array.from({ length: f.pages }, (_, i) => ({ src: f.id, index: i })));
}

/** Has the page view changed anything compared with whole files in order? */
function edited() {
  if (!pages) return false;
  const all = files.flatMap((f) => Array.from({ length: f.pages }, (_, i) => `${f.id}:${i}`));
  const now = pages.map((p) => `${p.src}:${p.index}`);
  return all.length !== now.length || all.some((k, i) => k !== now[i]);
}

/** Join the files (or the chosen pages), in order, into one PDF. */
export async function buildOutput() {
  const list = outputList();
  if (!list.length || (files.length < 2 && !edited())) throw new Error('empty');
  const bytes = await buildFromPages(list, new Map(files.map((f) => [f.id, f.bytes])));
  return new File([bytes], `${safeName($('#fileName').value, 'gabung')}.pdf`, { type: 'application/pdf' });
}

let busy = false;
async function exportPdf(share) {
  if (busy) return;
  busy = true;
  $$('.options .buttons button').forEach((b) => { b.disabled = true; });
  setStatus(tr('working'));
  try {
    const file = await buildOutput();
    const done = tr('orgDoneOne', { pages: outputList().length, size: formatSize(file.size) });
    if (share) {
      const how = await shareOrDownload(file);
      setStatus(how === 'cancelled' ? '' : how === 'downloaded' ? `${tr('shareFallback')} ${done}` : done);
    } else {
      download(file);
      setStatus(done);
    }
  } catch (err) {
    setStatus(err && err.message === 'empty' ? tr('mergeNeedTwo') : tr(openErrorKey(err)));
  } finally {
    busy = false;
    render();
  }
}

$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); });
$('#clearAll').addEventListener('click', () => {
  files.forEach((f) => { f.doc.destroy(); if (f.thumb) URL.revokeObjectURL(f.thumb); });
  files = [];
  pages = null;
  view = 'files';
  setStatus('');
  render();
});
$$('input[name="mergeView"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) setView(r.value); }));
$('#pagesReset').addEventListener('click', () => { pages = files.flatMap(pagesOf); render(); });
$('#savePdf').addEventListener('click', () => exportPdf(false));
$('#sharePdf').addEventListener('click', () => exportPdf(true));
bindReorder($('#pageGrid'), (f, to) => {
  if (view === 'pages' && pages) { if (moveItem(pages, f, to)) render(); } else if (moveItem(files, f, to)) filesMoved();
}, () => (view === 'pages' && pages ? pages.length : files.length));
bindFileDrop($('#dropzone'), addFiles);
ready = true;
render();

// Exposed for the automated test only.
window.__merge = { get files() { return files; }, get pages() { return pages; }, setView, buildOutput, addFiles, whenIdle: () => thumbs.idle() };
