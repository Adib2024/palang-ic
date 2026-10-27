// Remove Metadata: show the hidden information a PDF carries (author,
// software, dates, XMP, attachments, JavaScript, comment authors) and save a
// clean copy. Runs in this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import { isPdf, formatSize, safeName, download, shareOrDownload } from './pdf-kit.js';
import { bindFileDrop } from './pdf-pages.js';
import { readMeta, cleanPdf } from './pdf-meta.js';
import { createBatch, batchSummary } from './batch.js';

const $ = (sel) => document.querySelector(sel);
const LABELS = {
  Title: 'metaTitle', Author: 'metaAuthor', Subject: 'metaSubject', Keywords: 'metaKeywords',
  Creator: 'metaCreator', Producer: 'metaProducer', CreationDate: 'metaCreated', ModDate: 'metaModified',
};

let input = null; // {name, bytes, meta}
let after = null;
let ready = false;

const page = initPage(() => { if (ready) sync(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

/** Rows for a metadata summary; empty → one "nothing found" row. */
function rows(meta) {
  const out = meta.info.map((r) => [LABELS[r.key] ? tr(LABELS[r.key]) : r.key, r.value]);
  if (meta.xmp) out.push([tr('metaXmp'), tr('metaPresent')]);
  if (meta.id) out.push([tr('metaId'), tr('metaPresent')]);
  if (meta.files) out.push([tr('metaFiles'), String(meta.files)]);
  if (meta.js) out.push([tr('metaJs'), tr('metaPresent')]);
  if (meta.authors.length) out.push([tr('metaAuthors'), meta.authors.join(', ')]);
  return out;
}

function fill(dl, meta) {
  dl.textContent = '';
  const list = rows(meta);
  if (!list.length) {
    const p = document.createElement('div');
    p.className = 'meta-clean';
    p.textContent = tr('metaNone');
    dl.appendChild(p);
    return;
  }
  for (const [k, v] of list) {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    row.append(dt, dd);
    dl.appendChild(row);
  }
}

function sync() {
  $('#toolLayout').classList.toggle('is-empty', !input);
  if (input) {
    $('#docTitle').textContent = input.name;
    $('#docMeta').textContent = `${tr('pdfPagesN', { n: input.meta.pages })} · ${formatSize(input.bytes.length)}`;
    fill($('#metaFound'), input.meta);
  }
  $('#result').hidden = !after;
  if (after) fill($('#metaAfter'), after);
}

const options = () => ({
  info: $('#rmInfo').checked, xmp: $('#rmXmp').checked, files: $('#rmFiles').checked,
  js: $('#rmJs').checked, authors: $('#rmAuthors').checked, title: $('#newTitle').value,
});

/** Clean one PDF with the form's settings. */
export async function buildOutput(src = input) {
  const bytes = await cleanPdf(src.bytes, options());
  return new File([bytes], `${safeName(src.name, 'dokumen')}-bersih.pdf`, { type: 'application/pdf' });
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
        `${safeName(input.name, 'dokumen')}-bersih.zip`,
        (i, n, f) => setStatus(tr('batchProgress', { i, n, name: f.name })),
      );
      file = res.zip;
      done = batchSummary(tr, res, formatSize(file.size));
      after = null;
    } else {
      file = await buildOutput();
      after = await readMeta(new Uint8Array(await file.arrayBuffer()));
      done = tr('metaDone', { size: formatSize(file.size) });
    }
    sync();
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
    input = { name: file.name, bytes, meta: await readMeta(bytes) };
    after = null;
    setStatus('');
  } catch (err) {
    input = null;
    setStatus(err && err.message === 'encrypted' ? tr('metaEncrypted') : tr('pdfOpenError'));
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
window.__meta = { openFile, buildOutput, readMeta, batch, get input() { return input; }, get after() { return after; } };
