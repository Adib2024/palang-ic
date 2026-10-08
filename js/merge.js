// Merge PDF: put whole files in order and join them into one PDF. An optional
// second step places a date, signature or text on the merged pages.
// Everything happens in this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import {
  loadPdfLib, openForRender, formatSize, safeName, download, shareOrDownload, openErrorKey,
} from './pdf-kit.js';
import {
  openPdfs, createThumbQueue, card, iconButton, bindReorder, bindFileDrop, moveItem, buildFromPages,
} from './pdf-pages.js';
import { renderPages } from './page-viewer.js';
import { initSignatureMaker, textCanvas, isoDate, toDMY } from './sig-maker.js';
import { createPlacer } from './placer.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/** @type {{id:number,name:string,bytes:Uint8Array,doc:any,pages:number,hue:number,thumb?:string}[]} */
let files = [];
let ready = false;
const thumbs = createThumbQueue(220);

/** Step 2 state: the merged PDF being annotated, or null on step 1. */
let merged = null; // {bytes, doc}

const page = initPage(() => { if (ready) { render(); syncStep2(); } });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };
const setStatus2 = (msg) => { $('#status2').textContent = msg || ''; };
const placer = createPlacer({ tr, onChange: () => { if (ready) syncStep2(); } });
const maker = initSignatureMaker({ onError: () => setStatus2(tr('loadError')) });

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
  $('#annotateBtn').disabled = !canMerge;
  $('#needTwo').hidden = files.length !== 1;
}

/** All files, in order, joined into one PDF (bytes). */
async function mergeBytes() {
  if (files.length < 2) throw new Error('empty');
  const list = files.flatMap((f) => Array.from({ length: f.pages }, (_, i) => ({ src: f.id, index: i })));
  return buildFromPages(list, new Map(files.map((f) => [f.id, f.bytes])));
}

/** Join all files, in order, into one PDF. */
export async function buildOutput() {
  const bytes = await mergeBytes();
  return new File([bytes], `${safeName($('#fileName').value, 'gabung')}.pdf`, { type: 'application/pdf' });
}

/* ---------- Step 2 (optional): date, signature, text ---------- */

function showStep(n) {
  $('#toolLayout').hidden = n !== 1;
  $('#annotateLayout').hidden = n !== 2;
  $$('.steps li').forEach((li) => li.classList.toggle('on', Number(li.dataset.step) <= n));
  window.scrollTo({ top: 0 });
}

function syncStep2() {
  if (!merged) return;
  $('#annMeta').textContent = `${tr('mergeSummary', { files: files.length, pages: merged.doc.numPages })} · ${formatSize(merged.bytes.length)}`;
  $('#activeLabel').textContent = tr('sigActivePage', { n: placer.active + 1 });
  placer.views.forEach((v, i) => { v.el.querySelector('.sign-page-no').textContent = tr('sigPage', { n: i + 1 }); });
  $('#saveSigned').disabled = !placer.items.length;
  $('#shareSigned').disabled = !placer.items.length;
}

/** Merge now and open the result for placing items. */
export async function openStep2() {
  if (files.length < 2 || busy) return;
  busy = true;
  setStatus(tr('working'));
  try {
    const bytes = await mergeBytes();
    const doc = await openForRender(bytes);
    merged = { bytes, doc };
    $('#fileName2').value = safeName($('#fileName').value, 'gabung');
    setStatus('');
    setStatus2('');
    showStep(2);
    placer.setViews(await renderPages($('#signPages'), doc, { label: (n) => tr('sigPage', { n }) }));
    syncStep2();
  } catch (err) {
    setStatus(tr(openErrorKey(err)));
  } finally {
    busy = false;
  }
}

function backToStep1() {
  placer.setViews([]);
  $('#signPages').textContent = '';
  if (merged) merged.doc.destroy();
  merged = null;
  showStep(1);
  render();
}

function place(canvas, widthFrac) {
  if (!merged || !canvas) return [];
  setStatus2('');
  return placer.add(canvas, widthFrac, { allPages: $('#allPages').checked });
}

/** The merged PDF with the placed items drawn in. */
export async function buildSigned() {
  if (!placer.items.length) throw new Error('empty');
  const PDFLib = await loadPdfLib();
  const doc = await PDFLib.PDFDocument.load(merged.bytes, { updateMetadata: false });
  await placer.drawInto(PDFLib, doc);
  const bytes = await doc.save();
  return new File([bytes], `${safeName($('#fileName2').value, 'gabung')}.pdf`, { type: 'application/pdf' });
}

async function exportSigned(share) {
  if (busy || !merged) return;
  busy = true;
  setStatus2(tr('working'));
  try {
    const file = await buildSigned();
    const done = tr('sigDone', { n: placer.items.length, size: formatSize(file.size) });
    if (share) {
      const how = await shareOrDownload(file);
      setStatus2(how === 'cancelled' ? '' : how === 'downloaded' ? `${tr('shareFallback')} ${done}` : done);
    } else {
      download(file);
      setStatus2(done);
    }
  } catch (err) {
    setStatus2(err && err.message === 'empty' ? tr('sigNoItems') : tr(openErrorKey(err)));
  } finally {
    busy = false;
  }
}

let busy = false;
async function exportPdf(share) {
  if (busy) return;
  busy = true;
  $$('#toolLayout .options .buttons button').forEach((b) => { b.disabled = true; });
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
$('#annotateBtn').addEventListener('click', openStep2);
$('#backToFiles').addEventListener('click', backToStep1);
$('#dateValue').value = isoDate();
$('#addSig').addEventListener('click', () => {
  const sig = maker.current();
  if (!sig) { setStatus2(tr('sigEmptyPad')); return; }
  place(sig, 0.28);
});
$('#addDate').addEventListener('click', () => {
  const d = toDMY($('#dateValue').value);
  if (!d) { $('#dateValue').focus(); return; }
  place(textCanvas(d, undefined, maker.ink()), 0.2);
});
$('#addText').addEventListener('click', () => {
  const text = $('#extraText').value.trim();
  if (!text) { $('#extraText').focus(); return; }
  place(textCanvas(text, undefined, maker.ink()), Math.min(0.6, 0.022 * text.length + 0.06));
});
$('#saveSigned').addEventListener('click', () => exportSigned(false));
$('#shareSigned').addEventListener('click', () => exportSigned(true));
bindReorder($('#pageGrid'), (f, to) => { if (moveItem(files, f, to)) render(); }, () => files.length);
bindFileDrop($('#dropzone'), addFiles);
ready = true;
render();

// Exposed for the automated test only.
window.__merge = {
  get files() { return files; }, buildOutput, addFiles, whenIdle: () => thumbs.idle(),
  openStep2, buildSigned, get items() { return placer.items; }, get views() { return placer.views; }, setActive: (i) => placer.setActive(i),
};
