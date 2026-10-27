// Flatten PDF: lock form fields and comments into the page, or turn every
// page into a picture. Runs in this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import { isPdf, formatSize, safeName, download, shareOrDownload } from './pdf-kit.js';
import { bindFileDrop } from './pdf-pages.js';
import { countFlattenable, flattenPdf } from './pdf-flatten.js';
import { createBatch, batchSummary } from './batch.js';

const $ = (sel) => document.querySelector(sel);
let input = null; // {name, bytes, counts}
let ready = false;

const page = initPage(() => { if (ready) sync(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

function sync() {
  $('#toolLayout').classList.toggle('is-empty', !input);
  if (input) {
    const c = input.counts;
    $('#docTitle').textContent = input.name;
    $('#docMeta').textContent = `${tr('pdfPagesN', { n: c.pages })} · ${formatSize(input.bytes.length)}`;
    $('#flatFound').textContent = tr('flatFound', { f: c.fields, a: c.annots });
  }
  const image = $('#flatImage').checked;
  $('#flatForm').disabled = image;
  $('#flatAnnots').disabled = image;
}

const options = () => ({ form: $('#flatForm').checked, annots: $('#flatAnnots').checked, image: $('#flatImage').checked });

/** Flatten one PDF with the form's settings. */
export async function buildOutput(src = input) {
  const bytes = await flattenPdf(src.bytes, options());
  return new File([bytes], `${safeName(src.name, 'dokumen')}-rata.pdf`, { type: 'application/pdf' });
}

const batch = createBatch($('#docMeta').parentElement, { tr: (k, v) => tr(k, v) });

async function exportPdf(share) {
  if (!input) return;
  setStatus(tr('working'));
  try {
    let file;
    let done;
    if (batch.active) {
      const res = await batch.run(
        async (f) => buildOutput({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }),
        `${safeName(input.name, 'dokumen')}-rata.zip`,
        (i, n, f) => setStatus(tr('batchProgress', { i, n, name: f.name })),
      );
      file = res.zip;
      done = batchSummary(tr, res, formatSize(file.size));
    } else {
      file = await buildOutput();
      done = tr('flatDone', { size: formatSize(file.size) });
    }
    if (share) {
      const how = await shareOrDownload(file);
      setStatus(how === 'cancelled' ? '' : how === 'downloaded' ? `${tr('shareFallback')} ${done}` : done);
    } else {
      download(file);
      setStatus(done);
    }
  } catch (err) {
    setStatus(err && err.message === 'encrypted' ? tr('metaEncrypted') : tr('pdfOpenError'));
  }
}

async function openFile(list) {
  batch.set(list.filter(isPdf));
  const file = list.find(isPdf);
  if (!file) { setStatus(tr('pdfOpenError')); return; }
  setStatus(tr('pdfLoading'));
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    input = { name: file.name, bytes, counts: await countFlattenable(bytes) };
    setStatus('');
  } catch (err) {
    input = null;
    setStatus(err && err.message === 'encrypted' ? tr('metaEncrypted') : tr('pdfOpenError'));
  }
  sync();
}

$('#flatImage').addEventListener('change', sync);
$('#savePdf').addEventListener('click', () => exportPdf(false));
$('#sharePdf').addEventListener('click', () => exportPdf(true));
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; openFile(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
bindFileDrop($('#dropzone'), openFile);
ready = true;
sync();

// Exposed for the automated test only.
window.__flatten = { openFile, buildOutput, batch, get input() { return input; } };
