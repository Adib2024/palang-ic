// Merge PDF: put whole files in order and join them into one PDF.
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
let ready = false;
const thumbs = createThumbQueue(220);

const page = initPage(() => { if (ready) render(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

async function addFiles(list) {
  setStatus(tr('pdfLoading'));
  const { sources, failed, skipped } = await openPdfs(list, files.length);
  files.push(...sources);
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

function render() {
  const grid = $('#pageGrid');
  grid.textContent = '';
  files.forEach((f, i) => {
    const li = card({
      index: i,
      thumb: f.thumb,
      number: tr('pdfPagesN', { n: f.pages }),
      caption: f.name,
      hue: f.hue,
      draggable: true,
      tools: [
        iconButton(`${tr('i2pMoveLeft')}: ${f.name}`, '◀', () => { if (moveItem(files, i, i - 1)) render(); }, { disabled: i === 0 }),
        iconButton(`${tr('i2pMoveRight')}: ${f.name}`, '▶', () => { if (moveItem(files, i, i + 1)) render(); }, { disabled: i === files.length - 1 }),
        iconButton(`${tr('i2pRemove')}: ${f.name}`, '✕', () => {
          f.doc.destroy();
          if (f.thumb) URL.revokeObjectURL(f.thumb);
          files = files.filter((x) => x !== f);
          render();
        }, { danger: true }),
      ],
    });
    li.dataset.id = String(f.id);
    grid.appendChild(li);
  });
  const total = files.reduce((n, f) => n + f.pages, 0);
  $('#pageCount').textContent = String(files.length);
  $('#mergeSummary').textContent = files.length ? tr('mergeSummary', { files: files.length, pages: total }) : '';
  $('#toolLayout').classList.toggle('is-empty', files.length === 0);
  const canMerge = files.length >= 2;
  $('#savePdf').disabled = !canMerge;
  $('#sharePdf').disabled = !canMerge;
  $('#needTwo').hidden = files.length !== 1;
}

/** Join all files, in order, into one PDF. */
export async function buildOutput() {
  if (files.length < 2) throw new Error('empty');
  const list = files.flatMap((f) => Array.from({ length: f.pages }, (_, i) => ({ src: f.id, index: i })));
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
    const done = tr('orgDoneOne', { pages: files.reduce((n, f) => n + f.pages, 0), size: formatSize(file.size) });
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
  setStatus('');
  render();
});
$('#savePdf').addEventListener('click', () => exportPdf(false));
$('#sharePdf').addEventListener('click', () => exportPdf(true));
bindReorder($('#pageGrid'), (f, to) => { if (moveItem(files, f, to)) render(); }, () => files.length);
bindFileDrop($('#dropzone'), addFiles);
ready = true;
render();

// Exposed for the automated test only.
window.__merge = { get files() { return files; }, buildOutput, addFiles, whenIdle: () => thumbs.idle() };
