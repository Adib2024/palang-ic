// Page numbers: add "1", "1 / 10" or "Muka surat 1 daripada 10" at one of
// six positions, with live preview from the real output. Runs in this tab.
import { initPage } from './page.js';
import { t } from './i18n.js';
import * as store from './storage.js';
import { loadPdfLib, isPdf, formatSize, safeName, download, shareOrDownload, openErrorKey } from './pdf-kit.js';
import { createBatch, batchSummary } from './batch.js';
import { openPdfs, bindFileDrop, createPreview } from './pdf-pages.js';
import { numberPage } from './pdf-stamps.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const settings = { pos: 'bc', format: 'n', start: 1, skipFirst: false, size: 11, margin: 'mid', ...store.load('pagenum', {}) };
const MARGINS = { small: 18, mid: 30, large: 48 };
let src = null;
let ready = false;
const preview = createPreview($('#preview'));

const page = initPage(() => { if (ready) sync(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

/** Label for page `n` of `total` in the chosen format and UI language. */
export function label(n, total) {
  if (settings.format === 'nOfTotal') return `${n} / ${total}`;
  if (settings.format === 'words') return tr('pnWords', { n, total });
  return String(n);
}

function number(doc, page, PDFLib, n, total, cache) {
  return numberPage(doc, page, PDFLib, cache, {
    text: label(n, total), size: settings.size, pos: settings.pos, margin: MARGINS[settings.margin] || MARGINS.mid,
  });
}

/** Build the numbered PDF. */
export async function buildOutput(bytes = src.bytes, outName = safeName($('#fileName').value, 'dokumen')) {
  const PDFLib = await loadPdfLib();
  const doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
  const total = doc.getPageCount();
  const first = settings.skipFirst ? 1 : 0;
  const start = Math.max(0, Math.floor(Number(settings.start) || 1));
  const shown = total - first;
  const cache = {};
  for (let i = first; i < total; i++) {
    await number(doc, doc.getPage(i), PDFLib, start + i - first, start + shown - 1, cache);
  }
  return new File([await doc.save()], `${outName}.pdf`, { type: 'application/pdf' });
}

function refreshPreview() {
  if (!src) return;
  const index = settings.skipFirst && src.pages > 1 ? 1 : 0;
  const start = Math.max(0, Math.floor(Number(settings.start) || 1));
  const shown = src.pages - (settings.skipFirst ? 1 : 0);
  const width = Math.min(560, $('#previewWrap').clientWidth || 400);
  preview(src.bytes, index, async (doc, pg, PDFLib) => number(doc, pg, PDFLib, start, start + shown - 1, {}), width);
}

function sync() {
  $('#toolLayout').classList.toggle('is-empty', !src);
  $('#sizeOut').textContent = `${settings.size} pt`;
  $$('#pnFormat option').forEach((o) => { o.textContent = o.value === 'words' ? tr('pnWords', { n: 1, total: 10 }) : o.value === 'nOfTotal' ? '1 / 10' : '1'; });
  if (src) {
    $('#docTitle').textContent = src.name;
    $('#docMeta').textContent = `${tr('pdfPagesN', { n: src.pages })} · ${formatSize(src.bytes.length)}`;
  }
  refreshPreview();
}

const batch = createBatch($('#docMeta').parentElement, { tr: (k, v) => tr(k, v) });

async function openFile(list) {
  batch.set(list.filter(isPdf));
  setStatus(tr('pdfLoading'));
  const { sources, failed } = await openPdfs(list.slice(0, 1));
  if (!sources.length) {
    setStatus(failed.length ? `${failed[0].name}: ${tr(openErrorKey(failed[0].err))}` : tr('pdfOpenError'));
    return;
  }
  if (src) src.doc.destroy();
  [src] = sources;
  $('#fileName').value = `${safeName(src.name, 'dokumen')}-bernombor`;
  setStatus('');
  sync();
}

let busy = false;
async function exportPdf(share) {
  if (busy || !src) return;
  busy = true;
  $$('.options .buttons button').forEach((b) => { b.disabled = true; });
  setStatus(tr('working'));
  try {
    let file;
    let done;
    if (batch.active) {
      const res = await batch.run(
        async (f) => buildOutput(new Uint8Array(await f.arrayBuffer()), `${safeName(f.name, 'dokumen')}-bernombor`),
        `${safeName($('#fileName').value, 'dokumen')}.zip`,
        (i, n, f) => setStatus(tr('batchProgress', { i, n, name: f.name })),
      );
      file = res.zip;
      done = batchSummary(tr, res, formatSize(file.size));
    } else {
      file = await buildOutput();
      done = tr('splitDoneOne', { size: formatSize(file.size) });
    }
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
    $$('.options .buttons button').forEach((b) => { b.disabled = false; });
  }
}

$$('input[name="pnPos"]').forEach((r) => {
  r.checked = r.value === settings.pos;
  r.addEventListener('change', () => { if (r.checked) { settings.pos = r.value; store.save('pagenum', settings); sync(); } });
});
$$('input[name="pnMargin"]').forEach((r) => {
  r.checked = r.value === settings.margin;
  r.addEventListener('change', () => { if (r.checked) { settings.margin = r.value; store.save('pagenum', settings); sync(); } });
});
$('#pnFormat').value = settings.format;
$('#pnFormat').addEventListener('change', (e) => { settings.format = e.target.value; store.save('pagenum', settings); sync(); });
$('#pnStart').value = String(settings.start);
$('#pnStart').addEventListener('input', (e) => { settings.start = Number(e.target.value) || 1; store.save('pagenum', settings); sync(); });
$('#pnSkip').checked = settings.skipFirst;
$('#pnSkip').addEventListener('change', (e) => { settings.skipFirst = e.target.checked; store.save('pagenum', settings); sync(); });
$('#pnSize').value = String(settings.size);
$('#pnSize').addEventListener('input', (e) => { settings.size = Number(e.target.value); sync(); });
$('#pnSize').addEventListener('change', () => store.save('pagenum', settings));
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; openFile(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
$('#savePdf').addEventListener('click', () => exportPdf(false));
$('#sharePdf').addEventListener('click', () => exportPdf(true));
bindFileDrop($('#dropzone'), openFile);
ready = true;
sync();

// Exposed for the automated test only.
window.__pagenum = { settings, buildOutput, openFile, label, batch };
