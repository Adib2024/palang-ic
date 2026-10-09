// Protect PDF: encrypt with a password (AES-256), optionally blocking
// printing or copying. Runs in this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import { isPdf, formatSize, safeName, download, shareOrDownload } from './pdf-kit.js';
import { bindFileDrop } from './pdf-pages.js';
import { protectPdf } from './pdf-security.js';
import { permissions } from './pdf-crypto.js';

const $ = (sel) => document.querySelector(sel);
let input = null;
let ready = false;

const page = initPage(() => { if (ready) sync(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

/** Rough strength: 0 weak, 1 ok, 2 strong. */
export function strength(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return pw.length < 6 ? 0 : score >= 4 ? 2 : score >= 2 ? 1 : 0;
}

function sync() {
  $('#toolLayout').classList.toggle('is-empty', !input);
  if (input) {
    $('#docTitle').textContent = input.name;
    $('#docMeta').textContent = formatSize(input.bytes.length);
  }
  const pw = $('#pw1').value;
  const s = strength(pw);
  const meter = $('#pwMeter');
  meter.dataset.level = pw ? String(s) : '';
  meter.textContent = pw ? tr(['pwWeak', 'pwOk', 'pwStrong'][s]) : '';
  const match = pw && pw === $('#pw2').value;
  $('#pwMismatch').hidden = !$('#pw2').value || match;
  $('#savePdf').disabled = !input || !match;
  $('#sharePdf').disabled = !input || !match;
}

/** Encrypt the loaded PDF with the form's settings. */
export async function buildOutput() {
  const P = permissions({ print: $('#allowPrint').checked, copy: $('#allowCopy').checked });
  const bytes = await protectPdf(input.bytes, $('#pw1').value, $('#ownerPw').value, P);
  return new File([bytes], `${safeName(input.name, 'dokumen')}-dilindungi.pdf`, { type: 'application/pdf' });
}

async function exportPdf(share) {
  if (!input) return;
  setStatus(tr('working'));
  try {
    const file = await buildOutput();
    const done = tr('protectDone', { size: formatSize(file.size) });
    if (share) {
      const how = await shareOrDownload(file);
      setStatus(how === 'cancelled' ? '' : how === 'downloaded' ? `${tr('shareFallback')} ${done}` : done);
    } else {
      download(file);
      setStatus(done);
    }
  } catch (err) {
    setStatus(err && err.message === 'encrypted' ? tr('protectAlready') : tr('pdfOpenError'));
  }
}

async function openFile(list) {
  const file = list.find(isPdf);
  if (!file) { setStatus(tr('pdfOpenError')); return; }
  input = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
  setStatus('');
  sync();
  $('#pw1').focus();
}

for (const id of ['#pw1', '#pw2']) $(id).addEventListener('input', sync);
$('#showPw').addEventListener('change', (e) => {
  for (const id of ['#pw1', '#pw2', '#ownerPw']) $(id).type = e.target.checked ? 'text' : 'password';
});
$('#savePdf').addEventListener('click', () => exportPdf(false));
$('#sharePdf').addEventListener('click', () => exportPdf(true));
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; openFile(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
bindFileDrop($('#dropzone'), openFile);
ready = true;
sync();

window.__protect = { openFile, buildOutput, strength };
