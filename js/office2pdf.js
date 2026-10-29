// Word/Excel → PDF (simple and honest): .docx paragraphs, lists, tables and
// pictures, or .xlsx sheets as grids, laid out with pdf-lib. Runs in this
// tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import { formatSize, safeName, download, shareOrDownload } from './pdf-kit.js';
import { bindFileDrop } from './pdf-pages.js';
import { readOffice } from './office-read.js';
import { docxToPdf, xlsxToPdf } from './office-layout.js';
import { createBatch, batchSummary } from './batch.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const isOffice = (f) => /\.(docx|xlsx)$/i.test(f.name) || /officedocument\.(wordprocessingml|spreadsheetml)/.test(f.type);

let input = null; // {name, bytes, model}
let ready = false;

const page = initPage(() => { if (ready) sync(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };
const paper = () => ($$('input[name="o2pPaper"]').find((r) => r.checked) || {}).value || 'a4';

function sync() {
  $('#toolLayout').classList.toggle('is-empty', !input);
  if (input) {
    $('#docTitle').textContent = input.name;
    const what = input.model.kind === 'xlsx' ? tr('o2pSheets', { n: input.model.sheets.length }) : tr('o2pWord');
    $('#docMeta').textContent = `${what} · ${formatSize(input.bytes.length)}`;
  }
  $('#paperRow').hidden = !(input && input.model.kind === 'xlsx');
}

/** Convert one file's model to a PDF File. */
export async function buildOutput(src = input, name = null) {
  const bytes = src.model.kind === 'xlsx' ? await xlsxToPdf(src.model, { paper: paper() }) : await docxToPdf(src.model);
  const base = name || safeName($('#fileName').value, safeName(src.name.replace(/\.(docx|xlsx)$/i, ''), 'dokumen'));
  return new File([bytes], `${base}.pdf`, { type: 'application/pdf' });
}

const batch = createBatch($('#docMeta').parentElement, { tr: (k, v) => tr(k, v) });

async function exportPdf(share) {
  if (!input) return;
  setStatus(tr('working'));
  try {
    let file;
    let done;
    if (batch.active) {
      const res = await batch.run(async (f) => {
        const bytes = new Uint8Array(await f.arrayBuffer());
        return buildOutput({ name: f.name, bytes, model: await readOffice(bytes) }, safeName(f.name.replace(/\.(docx|xlsx)$/i, ''), 'dokumen'));
      }, `${safeName($('#fileName').value, 'dokumen')}.zip`, (i, n, f) => setStatus(tr('batchProgress', { i, n, name: f.name })));
      file = res.zip;
      done = batchSummary(tr, res, formatSize(file.size));
    } else {
      file = await buildOutput();
      const L = await import('./pdf-kit.js').then((m) => m.loadPdfLib());
      const pages = (await L.PDFDocument.load(await file.arrayBuffer())).getPageCount();
      done = tr('o2pDone', { pages, size: formatSize(file.size) });
    }
    if (share) {
      const how = await shareOrDownload(file);
      setStatus(how === 'cancelled' ? '' : how === 'downloaded' ? `${tr('shareFallback')} ${done}` : done);
    } else {
      download(file);
      setStatus(done);
    }
  } catch (err) {
    console.error(err);
    setStatus(tr(err && /^not/.test(err.message) ? 'o2pNotOffice' : 'loadError'));
  }
}

async function openFile(list) {
  const files = [...list].filter(isOffice);
  batch.set(files);
  const file = files[0];
  if (!file) { setStatus(tr('o2pNotOffice')); return; }
  setStatus(tr('pdfLoading'));
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    input = { name: file.name, bytes, model: await readOffice(bytes) };
    $('#fileName').value = safeName(file.name.replace(/\.(docx|xlsx)$/i, ''), 'dokumen');
    setStatus('');
  } catch (err) {
    input = null;
    setStatus(tr(err && /^not/.test(err.message) ? 'o2pNotOffice' : 'loadError'));
  }
  sync();
}

$('#savePdf').addEventListener('click', () => exportPdf(false));
$('#sharePdf').addEventListener('click', () => exportPdf(true));
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; openFile(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
bindFileDrop($('#dropzone'), openFile);
ready = true;
sync();

// Exposed for the automated test only.
window.__o2p = { openFile, buildOutput, get input() { return input; } };
