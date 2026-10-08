// Page numbers: add "1", "1 / 10" or "Muka surat 1 daripada 10" at one of
// six positions, with live preview from the real output. Runs in this tab.
import { initPage } from './page.js';
import { t } from './i18n.js';
import * as store from './storage.js';
import { loadPdfLib, formatSize, safeName, download, shareOrDownload, openErrorKey } from './pdf-kit.js';
import { openPdfs, bindFileDrop, displayToUser, displaySize, createPreview } from './pdf-pages.js';

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

async function number(doc, page, PDFLib, n, total, cache) {
  if (!cache.font) cache.font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const text = label(n, total).replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
  const size = settings.size;
  const w = cache.font.widthOfTextAtSize(text, size);
  const { width: Dw, height: Dh } = displaySize(page);
  const m = MARGINS[settings.margin] || MARGINS.mid;
  const [row, col] = settings.pos;
  const u = col === 'l' ? m : col === 'r' ? Dw - m - w : (Dw - w) / 2;
  const baseline = row === 't' ? m + size * 0.8 : Dh - m;
  const p = displayToUser(page, u, baseline);
  page.drawText(text, { x: p.x, y: p.y, size, font: cache.font, color: PDFLib.rgb(0.1, 0.1, 0.1), rotate: PDFLib.degrees(p.angle) });
}

/** Build the numbered PDF. */
export async function buildOutput() {
  const PDFLib = await loadPdfLib();
  const doc = await PDFLib.PDFDocument.load(src.bytes, { updateMetadata: false });
  const total = doc.getPageCount();
  const first = settings.skipFirst ? 1 : 0;
  const start = Math.max(0, Math.floor(Number(settings.start) || 1));
  const shown = total - first;
  const cache = {};
  for (let i = first; i < total; i++) {
    await number(doc, doc.getPage(i), PDFLib, start + i - first, start + shown - 1, cache);
  }
  const bytes = await doc.save();
  return new File([bytes], `${safeName($('#fileName').value, 'dokumen')}.pdf`, { type: 'application/pdf' });
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

async function openFile(list) {
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
window.__pagenum = { settings, buildOutput, openFile, label };
