// OCR PDF: recognise text in scanned PDFs or photos (Malay + English) with
// tesseract.js, then add an invisible text layer so the PDF can be searched
// and copied, and show the plain text. The engine and models are served by
// this site; the document never leaves the tab.
import { initPage } from './page.js';
import { t } from './i18n.js';
import {
  openForRender, isPdf, formatSize, safeName, download, shareOrDownload, openErrorKey,
} from './pdf-kit.js';
import { bindFileDrop } from './pdf-pages.js';
import { createOcrWorker, ocrDocument } from './ocr-core.js';
import { createBatch, batchSummary } from './batch.js';

const $ = (sel) => document.querySelector(sel);
const isImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|hei[cf])$/i.test(f.name);

/** @type {{name: string, kind: 'pdf'|'images', files: File[], bytes?: Uint8Array, doc?: any, pages: number} | null} */
let input = null;
let output = null; // {pdf: File, text: string}
let ready = false;
let busy = false;

const page = initPage(() => { if (ready) sync(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };
const setProgress = (f) => {
  $('#progress').hidden = f == null;
  $('#progressBar').style.width = `${Math.round((f || 0) * 100)}%`;
};

/* ---------- Engine ---------- */

/**
 * OCR one input (the loaded one, or another PDF in a batch).
 * @returns {Promise<{pdf: File, text: string, pages: number, skipped: number}>}
 */
export async function runOcr(inp = input, label = '', worker = null) {
  const langs = [$('#langMs').checked && 'msa', $('#langEn').checked && 'eng'].filter(Boolean);
  if (!langs.length) throw new Error('nolang');
  setStatus(tr('ocrLoadingEngine'));
  setProgress(0);
  const res = await ocrDocument(inp, {
    langs,
    skipText: $('#skipText').checked,
    worker,
    onPage: (i, n) => { setStatus(label + tr('ocrProgress', { i: i + 1, n })); setProgress(i / n); },
  });
  setProgress(1);
  const name = safeName($('#fileName').value, `${safeName(inp.name, 'dokumen')}-ocr`);
  const text = res.texts.map((s, k) => (inp.pages > 1 ? `--- ${tr('sigPage', { n: k + 1 })} ---\n${s}` : s)).join('\n\n');
  return { pdf: new File([res.bytes], `${name}.pdf`, { type: 'application/pdf' }), text, pages: inp.pages, skipped: res.skipped };
}

/* ---------- UI ---------- */

function sync() {
  $('#toolLayout').classList.toggle('is-empty', !input);
  $('#runOcr').disabled = !input || busy;
  if (input) {
    $('#docTitle').textContent = input.name;
    $('#docMeta').textContent = `${tr('pdfPagesN', { n: input.pages })} · ${formatSize(input.files.reduce((n, f) => n + f.size, 0))}`;
  }
  $('#result').hidden = !output;
  if (output) {
    $('#ocrText').value = output.text;
    $('#resultMeta').textContent = tr('ocrDone', { n: output.pages, size: formatSize(output.pdf.size) })
      + (output.skipped ? ` ${tr('ocrSkipped', { n: output.skipped })}` : '');
  }
}

const batch = createBatch($('#docMeta').parentElement, { tr: (k, v) => tr(k, v) });

/** Several PDFs: OCR each one, save the searchable PDFs as a ZIP and all text in one .txt. */
async function runBatch() {
  const langs = [$('#langMs').checked && 'msa', $('#langEn').checked && 'eng'].filter(Boolean);
  if (!langs.length) throw new Error('nolang');
  setStatus(tr('ocrLoadingEngine'));
  const worker = await createOcrWorker(langs.join('+'));
  const texts = [];
  let pages = 0;
  let skipped = 0;
  try {
    const res = await batch.run(async (f) => {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const doc = await openForRender(bytes);
      try {
        const one = await runOcr({ name: f.name, kind: 'pdf', files: [f], bytes, doc, pages: doc.numPages }, `${f.name}: `, worker);
        texts.push(`===== ${f.name} =====\n${one.text}`);
        pages += one.pages;
        skipped += one.skipped;
        return new File([one.pdf], `${safeName(f.name, 'dokumen')}-ocr.pdf`, { type: 'application/pdf' });
      } finally {
        doc.destroy();
      }
    }, `${safeName($('#fileName').value, 'dokumen-ocr')}.zip`);
    return { pdf: res.zip, text: texts.join('\n\n'), pages, skipped, summary: batchSummary(tr, res, formatSize(res.zip.size)) };
  } finally {
    await worker.terminate();
  }
}

let loading = null; // the file being opened; Start waits for it

function openFiles(list) {
  loading = openFilesNow(list).finally(() => { loading = null; });
  return loading;
}

async function openFilesNow(list) {
  batch.set(list.filter(isPdf));
  const pdf = list.find(isPdf);
  const images = list.filter(isImage);
  if (!pdf && !images.length) { setStatus(tr('pdfOpenError')); return; }
  setStatus(tr('pdfLoading'));
  output = null;
  try {
    if (input && input.doc) input.doc.destroy();
    if (pdf) {
      const bytes = new Uint8Array(await pdf.arrayBuffer());
      const doc = await openForRender(bytes);
      input = { name: pdf.name, kind: 'pdf', files: [pdf], bytes, doc, pages: doc.numPages };
    } else {
      input = { name: images.length > 1 ? tr('ocrImagesN', { n: images.length }) : images[0].name, kind: 'images', files: images, pages: images.length };
    }
    $('#fileName').value = `${safeName(input.kind === 'pdf' ? input.name : images[0].name, 'dokumen')}-ocr`;
    setStatus('');
  } catch (err) {
    input = null;
    setStatus(tr(openErrorKey(err)));
  }
  sync();
}

async function start() {
  // A file picked a moment ago may still be opening: use that one, not the last.
  if (loading) await loading;
  if (!input || busy) return;
  busy = true;
  output = null;
  sync();
  try {
    output = batch.active ? await runBatch() : await runOcr();
    setStatus(output.summary || '');
  } catch (err) {
    const m = err && err.message;
    setStatus(m === 'nolang' ? tr('ocrNeedLang') : m === 'engine' ? tr('ocrEngineError') : tr(openErrorKey(err)));
  } finally {
    busy = false;
    setProgress(null);
    sync();
  }
}

$('#runOcr').addEventListener('click', start);
$('#savePdf').addEventListener('click', () => output && download(output.pdf));
$('#sharePdf').addEventListener('click', async () => {
  if (output && (await shareOrDownload(output.pdf)) === 'downloaded') setStatus(tr('shareFallback'));
});
$('#copyText').addEventListener('click', async () => {
  if (!output) return;
  try {
    await navigator.clipboard.writeText(output.text);
    setStatus(tr('ocrCopied'));
  } catch {
    $('#ocrText').select();
    document.execCommand('copy');
    setStatus(tr('ocrCopied'));
  }
});
$('#saveTxt').addEventListener('click', () => {
  if (!output) return;
  download(new File([output.text], output.pdf.name.replace(/\.(pdf|zip)$/i, '.txt'), { type: 'text/plain;charset=utf-8' }));
});
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; openFiles(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
bindFileDrop($('#dropzone'), openFiles);
ready = true;
sync();

// Exposed for the automated test only.
window.__ocr = { openFiles, start, batch, get output() { return output; }, get busy() { return busy; } };
