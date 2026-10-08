// Unlock PDF: remove the password from a PDF you can open (user or owner
// password). Decrypts in this tab with our security handler; nothing is
// uploaded. Falls back to re-rendering pages if a file's structure is unusual.
import { initPage } from './page.js';
import { t } from './i18n.js';
import { loadPdfJs, loadPdfLib, renderPage, isPdf, formatSize, safeName, download, shareOrDownload } from './pdf-kit.js';
import { bindFileDrop } from './pdf-pages.js';
import { isEncrypted, unlockPdf } from './pdf-security.js';

const $ = (sel) => document.querySelector(sel);
let input = null; // {name, bytes, encrypted}
let output = null;
let ready = false;

const page = initPage(() => { if (ready) sync(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

function sync() {
  $('#toolLayout').classList.toggle('is-empty', !input);
  if (input) {
    $('#docTitle').textContent = input.name;
    $('#docMeta').textContent = formatSize(input.bytes.length);
  }
  $('#notLocked').hidden = !input || input.encrypted;
  $('#pwBlock').hidden = !input || !input.encrypted || !!output;
  $('#result').hidden = !output;
}

/** Last resort: open with pdf.js (supports every variant) and rebuild from page images. */
async function rasterUnlock(bytes, password) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: bytes.slice(), password, isEvalSupported: false }).promise;
  const L = await loadPdfLib();
  const out = await L.PDFDocument.create();
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    const vp = pg.getViewport({ scale: 1 });
    const c = await renderPage(pg, 200 / 72);
    const jpg = await new Promise((r) => c.toBlob(async (b) => r(new Uint8Array(await b.arrayBuffer())), 'image/jpeg', 0.9));
    const img = await out.embedJpg(jpg);
    out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
  }
  doc.destroy();
  return out.save();
}

/** Try to unlock with `password`; returns {bytes, raster} or throws Error('password'). */
export async function unlock(password) {
  try {
    return { bytes: await unlockPdf(input.bytes, password), raster: false };
  } catch (err) {
    if (err && err.message === 'password') throw err;
    try {
      return { bytes: await rasterUnlock(input.bytes, password), raster: true };
    } catch (e2) {
      if (e2 && e2.name === 'PasswordException') throw new Error('password');
      throw e2;
    }
  }
}

async function openFile(list) {
  const file = list.find(isPdf);
  if (!file) { setStatus(tr('pdfOpenError')); return; }
  setStatus(tr('pdfLoading'));
  output = null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    input = { name: file.name, bytes, encrypted: await isEncrypted(bytes) };
    setStatus('');
    sync();
    if (input.encrypted) {
      // Files that only restrict printing/copying open with an empty password.
      try { await run(''); } catch { $('#password').focus(); }
    }
  } catch {
    input = null;
    setStatus(tr('pdfOpenError'));
    sync();
  }
}

async function run(password) {
  setStatus(tr('working'));
  const res = await unlock(password);
  output = new File([res.bytes], `${safeName(input.name, 'dokumen')}-dibuka.pdf`, { type: 'application/pdf' });
  setStatus(res.raster ? tr('unlockRaster') : tr('unlockDone', { size: formatSize(output.size) }));
  sync();
}

$('#unlockBtn').addEventListener('click', async () => {
  if (!input) return;
  try {
    await run($('#password').value);
  } catch (err) {
    setStatus(err && err.message === 'password' ? tr('unlockWrong') : tr('pdfOpenError'));
    $('#password').select();
  }
});
$('#password').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#unlockBtn').click(); });
$('#showPw').addEventListener('change', (e) => { $('#password').type = e.target.checked ? 'text' : 'password'; });
$('#savePdf').addEventListener('click', () => output && download(output));
$('#sharePdf').addEventListener('click', async () => {
  if (output && (await shareOrDownload(output)) === 'downloaded') setStatus(tr('shareFallback'));
});
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; openFile(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
bindFileDrop($('#dropzone'), openFile);
ready = true;
sync();

window.__unlock = { openFile, unlock, get output() { return output; }, get input() { return input; } };
