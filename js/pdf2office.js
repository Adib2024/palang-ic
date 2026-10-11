// PDF → Word / Excel / PowerPoint (simple and honest): text, paragraphs,
// headings and simple tables are rebuilt from the PDF's own text; scanned
// pages become pictures. Runs in this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import { openForRender, isPdf, formatSize, safeName, download, shareOrDownload, openErrorKey } from './pdf-kit.js';
import { bindFileDrop } from './pdf-pages.js';
import { pageLines, pageJpeg } from './pdf-layout.js';
import { buildDocx, buildXlsx, buildPptx } from './office.js';

const $ = (sel) => document.querySelector(sel);
const FORMAT = $('#toolLayout').dataset.format; // 'docx' | 'xlsx' | 'pptx'
const EXT = { docx: 'docx', xlsx: 'xlsx', pptx: 'pptx' };

let input = null; // {name, bytes, doc}
let output = null;
let busy = false;
let ready = false;

const page = initPage(() => { if (ready) sync(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

function sync() {
  $('#toolLayout').classList.toggle('is-empty', !input);
  if (input) {
    $('#docTitle').textContent = input.name;
    $('#docMeta').textContent = `${tr('pdfPagesN', { n: input.doc.numPages })} · ${formatSize(input.bytes.length)}`;
  }
  $('#convert').disabled = !input || busy;
  $('#result').hidden = !output;
}

async function openFile(list) {
  const file = list.find(isPdf);
  if (!file) { setStatus(tr('pdfOpenError')); return; }
  setStatus(tr('pdfLoading'));
  output = null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await openForRender(bytes);
    if (input) input.doc.destroy();
    input = { name: file.name, bytes, doc };
    $('#fileName').value = safeName(file.name, 'dokumen');
    setStatus('');
  } catch (err) {
    setStatus(`${file.name}: ${tr(openErrorKey(err))}`);
  }
  sync();
}

/** Convert the loaded PDF; resolves to the Office file. */
export async function convert() {
  const pages = [];
  const images = new Map();
  const pptMode = FORMAT === 'pptx' ? $('input[name="pptMode"]:checked').value : '';
  const scans = FORMAT === 'docx' ? $('#scanImages').checked : true;
  let scanned = 0;
  for (let i = 1; i <= input.doc.numPages; i++) {
    setStatus(tr('officeProgress', { i, n: input.doc.numPages }));
    const pg = await input.doc.getPage(i);
    const layout = await pageLines(pg);
    pages.push(layout);
    if (!layout.hasText) scanned++;
    const needPicture = FORMAT === 'pptx' ? pptMode === 'image' || !layout.hasText : FORMAT === 'docx' && scans && !layout.hasText;
    if (needPicture) images.set(i - 1, await pageJpeg(pg, FORMAT === 'pptx' ? 144 : 150));
    pg.cleanup();
  }
  const name = safeName($('#fileName').value, 'dokumen');
  let blob;
  if (FORMAT === 'docx') blob = buildDocx(pages, images, input.name);
  else if (FORMAT === 'xlsx') blob = buildXlsx(pages, (i) => tr('officeSheet', { n: i + 1 }));
  else blob = buildPptx(pages, pptMode, images);
  return { file: new File([blob], `${name}.${EXT[FORMAT]}`, { type: blob.type }), scanned, pages: pages.length };
}

async function run(share) {
  if (!input || busy) return;
  busy = true;
  sync();
  try {
    const res = await convert();
    output = res.file;
    let msg = tr('officeDone', { n: res.pages, size: formatSize(output.size) });
    if (res.scanned) msg += ` ${tr(FORMAT === 'xlsx' ? 'officeScannedXlsx' : 'officeScanned', { n: res.scanned })}`;
    if (share) {
      const how = await shareOrDownload(output);
      setStatus(how === 'cancelled' ? '' : how === 'downloaded' ? `${tr('shareFallback')} ${msg}` : msg);
    } else {
      download(output);
      setStatus(msg);
    }
  } catch (err) {
    setStatus(tr(openErrorKey(err)));
  } finally {
    busy = false;
    sync();
  }
}

$('#convert').addEventListener('click', () => run(false));
$('#shareOut').addEventListener('click', () => (output ? shareOrDownload(output) : run(true)));
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; openFile(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
bindFileDrop($('#dropzone'), openFile);
ready = true;
sync();

// Exposed for the automated test only.
window.__office = { openFile, convert, get output() { return output; }, format: FORMAT };
