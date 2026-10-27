// Sign PDF: draw / type / upload a signature, place it (and text or today's
// date) on pages, then write it into the PDF with pdf-lib. The signature maker
// and the placing of items are shared with workflows (sig-maker.js, placer.js).
// Everything stays in this tab.
import { initPage } from './page.js';
import { t, todayDMY } from './i18n.js';
import {
  loadPdfLib, openForRender, isPdf, formatSize, safeName, download, shareOrDownload, openErrorKey,
} from './pdf-kit.js';
import { renderPages } from './page-viewer.js';
import { initSignatureMaker, textCanvas, trim } from './sig-maker.js';
import { createPlacer } from './placer.js';
import { mountUndoButtons } from './undo.js';
import { refreshFontSelects } from './fonts.js';

const $ = (sel) => document.querySelector(sel);

/** @type {{name: string, bytes: Uint8Array, doc: any} | null} */
let input = null;
let ready = false;

const page = initPage(() => { if (ready) { syncLabels(); refreshFontSelects(); maker.relabel(); refreshUndo(); } });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };
let refreshUndo = () => {};
const placer = createPlacer({ tr, onChange: () => { if (ready) syncLabels(); refreshUndo(); } });
const maker = initSignatureMaker({ onError: () => setStatus(tr('loadError')), lang: () => page.lang() });

/* ---------- Document ---------- */

async function openFile(file) {
  if (!file) return;
  if (!isPdf(file)) { setStatus(tr('pdfOpenError')); return; }
  setStatus(tr('pdfLoading'));
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await openForRender(bytes);
    if (input) input.doc.destroy();
    input = { name: file.name, bytes, doc };
    $('#fileName').value = `${safeName(file.name, 'dokumen')}-ditandatangan`;
    placer.setViews([]);
    syncLabels();
    placer.setViews(await renderPages($('#signPages'), doc, { label: (n) => tr('sigPage', { n }) }));
    setStatus('');
  } catch (err) {
    setStatus(tr(openErrorKey(err)));
  }
}

function syncLabels() {
  $('#toolLayout').classList.toggle('is-empty', !input);
  $('#dropzone').hidden = !!input;
  $('#fileCard').hidden = !input;
  if (!input) return;
  $('#docTitle').textContent = input.name;
  $('#fileMeta').textContent = `${tr('pdfPagesN', { n: input.doc.numPages })} · ${formatSize(input.bytes.length)}`;
  $('#activeLabel').textContent = tr('sigActivePage', { n: placer.active + 1 });
  placer.views.forEach((v, i) => { v.el.querySelector('.sign-page-no').textContent = tr('sigPage', { n: i + 1 }); });
}

/** Add a placed item (signature/text) to the active page. `widthFrac` of page width. */
export function addItem(canvas, widthFrac) {
  if (!input || !canvas) return null;
  return placer.add(canvas, widthFrac)[0] || null;
}

/* ---------- Export ---------- */

/** Write the placed items into the PDF and return the new File. */
export async function buildSigned() {
  if (!placer.items.length) throw new Error('empty');
  const PDFLib = await loadPdfLib();
  const doc = await PDFLib.PDFDocument.load(input.bytes, { updateMetadata: false });
  await placer.drawInto(PDFLib, doc);
  const bytes = await doc.save();
  const name = safeName($('#fileName').value, `${safeName(input.name, 'dokumen')}-ditandatangan`);
  return new File([bytes], `${name}.pdf`, { type: 'application/pdf' });
}

let busy = false;
async function exportPdf(share) {
  if (busy || !input) return;
  busy = true;
  setStatus(tr('working'));
  try {
    const file = await buildSigned();
    const done = tr('sigDone', { n: placer.items.length, size: formatSize(file.size) });
    if (share) {
      const how = await shareOrDownload(file);
      setStatus(how === 'cancelled' ? '' : how === 'downloaded' ? `${tr('shareFallback')} ${done}` : done);
    } else {
      download(file);
      setStatus(done);
    }
  } catch (err) {
    setStatus(err && err.message === 'empty' ? tr('sigNoItems') : tr(openErrorKey(err)));
  } finally {
    busy = false;
  }
}

/* ---------- Boot ---------- */

$('#removeBg').addEventListener('change', () => { setStatus(''); });
$('#addSig').addEventListener('click', async () => {
  if (!input) { setStatus(tr('sigNoPdf')); return; }
  const sig = await maker.current();
  if (!sig) { setStatus(tr('sigEmptyPad')); return; }
  setStatus('');
  addItem(sig, 0.28);
});
$('#addText').addEventListener('click', async () => {
  const text = $('#extraText').value.trim();
  if (!input) { setStatus(tr('sigNoPdf')); return; }
  if (!text) { $('#extraText').focus(); return; }
  addItem(await maker.text(text), Math.min(0.6, 0.022 * text.length + 0.06));
});
$('#addDate').addEventListener('click', async () => {
  if (!input) { setStatus(tr('sigNoPdf')); return; }
  addItem(await maker.text(todayDMY()), 0.2);
});
$('#pickFiles').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; openFile(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
$('#savePdf').addEventListener('click', () => exportPdf(false));
$('#sharePdf').addEventListener('click', () => exportPdf(true));
document.addEventListener('dragover', (e) => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); $('#dropzone').classList.add('over'); }
});
document.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) $('#dropzone').classList.remove('over'); });
document.addEventListener('drop', (e) => {
  if (!(e.dataTransfer && e.dataTransfer.files.length)) return;
  e.preventDefault();
  $('#dropzone').classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (isPdf(f)) openFile(f);
});

refreshUndo = mountUndoButtons($('#addSig').closest('.buttons'), placer.history, () => page.lang());
ready = true;
syncLabels();

// Exposed for the automated test only.
window.__sign = {
  openFile, addItem, buildSigned, trim, textCanvas,
  get items() { return placer.items; }, get views() { return placer.views; }, setActive: (i) => placer.setActive(i),
};
