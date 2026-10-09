// Compress PDF by re-rendering each page as a JPEG at a lower resolution
// (pdf.js) and writing a new PDF with the in-house writer. Runs entirely in
// this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import * as store from './storage.js';
import { writePdf } from './pdf.js';
import {
  openForRender, renderPage, isPdf, formatSize, safeName, download, shareOrDownload, openErrorKey,
} from './pdf-kit.js';

// Quality ladder: chosen level first, then stronger steps if a size limit is set.
const LADDER = [
  { dpi: 150, q: 0.75 }, // light
  { dpi: 110, q: 0.62 }, // medium
  { dpi: 85, q: 0.5 }, // strong
  { dpi: 72, q: 0.42 },
  { dpi: 60, q: 0.36 },
];
const LEVEL_START = { light: 0, medium: 1, strong: 2 };
const MAX_SIDE = 3500; // px cap per page so huge posters don't exhaust memory

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const settings = { level: 'medium', limit: '0', gray: false, ...store.load('compress', {}) };
/** @type {{name: string, bytes: Uint8Array, doc: any} | null} */
let input = null;
/** @type {File | null} */
let output = null;
let ready = false;

const page = initPage(() => { if (ready) renderInfo(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

function setProgress(fraction) {
  $('#progress').hidden = fraction == null;
  $('#progressBar').style.width = `${Math.round((fraction || 0) * 100)}%`;
}

/* ---------- Input ---------- */

async function openFile(file) {
  if (!file) return;
  if (!isPdf(file)) { setStatus(tr('pdfOpenError')); return; }
  setStatus(tr('pdfLoading'));
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await openForRender(bytes);
    if (input) input.doc.destroy();
    input = { name: file.name, bytes, doc };
    output = null;
    $('#result').hidden = true;
    renderInfo();
    setStatus('');
    const first = await doc.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    const canvas = await renderPage(first, 140 / vp.width);
    const thumb = $('#fileThumb');
    thumb.textContent = '';
    thumb.appendChild(canvas);
  } catch (err) {
    setStatus(tr(openErrorKey(err)));
  }
}

function renderInfo() {
  $('#toolLayout').classList.toggle('is-empty', !input);
  $('#dropzone').hidden = !!input;
  $('#fileCard').hidden = !input;
  $('#run').disabled = !input;
  if (!input) return;
  $('#fileTitle').textContent = input.name;
  $('#fileMeta').textContent = `${tr('pdfPagesN', { n: input.doc.numPages })} · ${formatSize(input.bytes.length)}`;
  if (output) showResult();
}

/* ---------- Compression ---------- */

function toGray(canvas) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  ctx.putImageData(img, 0, 0);
}

function jpegBytes(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (b) => {
      if (!b) { reject(new Error('encode')); return; }
      resolve(new Uint8Array(await b.arrayBuffer()));
    }, 'image/jpeg', quality);
  });
}

async function compressAt(step, onPage) {
  const doc = input.doc;
  const images = [];
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onPage(i);
    const pg = await doc.getPage(i);
    const vp = pg.getViewport({ scale: 1 }); // PDF points, page rotation applied
    const scale = Math.min(step.dpi / 72, MAX_SIDE / Math.max(vp.width, vp.height));
    const canvas = await renderPage(pg, scale);
    if (settings.gray) toGray(canvas);
    images.push({ jpeg: await jpegBytes(canvas, step.q), width: canvas.width, height: canvas.height });
    pages.push({ width: vp.width, height: vp.height, items: [{ image: i - 1, x: 0, y: 0, w: vp.width, h: vp.height }] });
    pg.cleanup();
    canvas.width = canvas.height = 0; // free memory early
  }
  return writePdf(pages, images);
}

/** Run compression with the current settings; resolves to the best Blob. */
export async function compress() {
  const limit = Number(settings.limit) || 0;
  const start = LEVEL_START[settings.level] ?? 1;
  const steps = limit ? LADDER.slice(start) : [LADDER[start]];
  const n = input.doc.numPages;
  let best = null;
  for (let s = 0; s < steps.length; s++) {
    const blob = await compressAt(steps[s], (i) => {
      setStatus(tr('cmpProgress', { i, n }));
      setProgress((s + i / n) / steps.length);
    });
    if (!best || blob.size < best.size) best = blob;
    if (!limit || blob.size <= limit) break;
  }
  return best;
}

function showResult() {
  const from = input.bytes.length;
  const to = output.size;
  $('#sizeFrom').textContent = formatSize(from);
  $('#sizeTo').textContent = formatSize(to);
  $('#sizePct').textContent = `−${Math.max(0, Math.round((1 - to / from) * 100))}%`;
  $('#result').hidden = false;
}

let busy = false;
async function run() {
  if (busy || !input) return;
  busy = true;
  $('#run').disabled = true;
  $('#result').hidden = true;
  output = null;
  try {
    const blob = await compress();
    setProgress(null);
    const limit = Number(settings.limit) || 0;
    if (blob.size >= input.bytes.length) {
      setStatus(tr('cmpNoGain', { from: formatSize(input.bytes.length) }));
      return;
    }
    output = new File([blob], `${safeName(input.name, 'dokumen')}-kecil.pdf`, { type: 'application/pdf' });
    showResult();
    setStatus(limit && blob.size > limit
      ? tr('cmpOverLimit', { limit: formatSize(limit), to: formatSize(blob.size) })
      : tr('cmpResult', { from: formatSize(input.bytes.length), to: formatSize(blob.size), pct: Math.round((1 - blob.size / input.bytes.length) * 100) }));
  } catch (err) {
    setProgress(null);
    setStatus(tr(openErrorKey(err)));
  } finally {
    busy = false;
    $('#run').disabled = !input;
  }
}

/* ---------- Boot ---------- */

$$('input[name="level"]').forEach((r) => {
  r.checked = r.value === settings.level;
  r.addEventListener('change', () => {
    if (!r.checked) return;
    settings.level = r.value;
    store.save('compress', settings);
  });
});
$('#limit').value = settings.limit;
$('#limit').addEventListener('change', (e) => { settings.limit = e.target.value; store.save('compress', settings); });
$('#gray').checked = !!settings.gray;
$('#gray').addEventListener('change', (e) => { settings.gray = e.target.checked; store.save('compress', settings); });

$('#pickFiles').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; openFile(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
$('#run').addEventListener('click', run);
$('#savePdf').addEventListener('click', () => { if (output) download(output); });
$('#sharePdf').addEventListener('click', async () => {
  if (!output) return;
  if ((await shareOrDownload(output)) === 'downloaded') setStatus(tr('shareFallback'));
});

// Dropping a PDF anywhere on the page opens it.
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
renderInfo();

// Exposed for the automated test only.
window.__compress = { settings, openFile, compress, run, get output() { return output; }, get input() { return input; } };
