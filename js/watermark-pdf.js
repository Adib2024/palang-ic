// Watermark PDF: stamp text or an image on pages (9 positions or tiled),
// with live preview rendered from the real output. Runs in this tab.
import { initPage } from './page.js';
import { t } from './i18n.js';
import * as store from './storage.js';
import { loadPhoto } from './image-loader.js';
import { loadPdfLib, formatSize, safeName, download, shareOrDownload, openErrorKey } from './pdf-kit.js';
import { openPdfs, bindFileDrop, parseRanges, createPreview } from './pdf-pages.js';
import { stampPage } from './pdf-stamps.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const settings = {
  type: 'text', text: 'SALINAN', size: 60, color: 'red', opacity: 30, angle: '45', pos: 'mc', tile: false,
  scale: 40, pages: 'all', ...store.load('watermark', {}),
};
let src = null;
let imagePng = null; // Uint8Array of the uploaded watermark image (PNG)
let imageAspect = 1;
let ready = false;
const preview = createPreview($('#preview'));

const page = initPage(() => { if (ready) sync(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

/* ---------- Drawing ---------- */

/** Stamp one page with the current settings (shared drawing: pdf-stamps.js). */
function stamp(doc, page, PDFLib, cache) {
  return stampPage(doc, page, PDFLib, cache, { ...settings, png: imagePng, aspect: imageAspect });
}

function targetPages(n) {
  if (settings.pages === 'all') return Array.from({ length: n }, (_, i) => i);
  const g = parseRanges($('#pageRange').value, n);
  return g ? [...new Set(g.flat())] : null;
}

/** Build the watermarked PDF. */
export async function buildOutput() {
  if (settings.type === 'image' && !imagePng) throw new Error('noimage');
  const PDFLib = await loadPdfLib();
  const doc = await PDFLib.PDFDocument.load(src.bytes, { updateMetadata: false });
  const targets = targetPages(doc.getPageCount());
  if (!targets) throw new Error('ranges');
  const cache = {};
  for (const i of targets) await stamp(doc, doc.getPage(i), PDFLib, cache);
  const bytes = await doc.save();
  return new File([bytes], `${safeName($('#fileName').value, 'dokumen')}.pdf`, { type: 'application/pdf' });
}

/* ---------- UI ---------- */

function refreshPreview() {
  if (!src) return;
  const targets = targetPages(src.pages) || [0];
  const index = targets[0] ?? 0;
  const width = Math.min(560, $('#previewWrap').clientWidth || 400);
  preview(src.bytes, index, async (doc, pg, PDFLib) => stamp(doc, pg, PDFLib, {}), width);
}

function sync() {
  $('#toolLayout').classList.toggle('is-empty', !src);
  $$('[data-type]').forEach((el) => { el.hidden = el.dataset.type !== settings.type; });
  $('#pageRangeField').hidden = settings.pages !== 'range';
  $('#posGrid').classList.toggle('disabled', settings.tile);
  $('#sizeOut').textContent = `${settings.size} pt`;
  $('#opacityOut').textContent = `${settings.opacity}%`;
  $('#scaleOut').textContent = `${settings.scale}%`;
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
  $('#fileName').value = `${safeName(src.name, 'dokumen')}-watermark`;
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
    if (err && err.message === 'ranges') setStatus(tr('orgRangesBad', { max: src.pages }));
    else if (err && err.message === 'noimage') setStatus(tr('wmNeedImage'));
    else setStatus(tr(openErrorKey(err)));
  } finally {
    busy = false;
    $$('.options .buttons button').forEach((b) => { b.disabled = false; });
  }
}

function bindRadio(name, key, cast = String) {
  $$(`input[name="${name}"]`).forEach((r) => {
    r.checked = String(settings[key]) === r.value;
    r.addEventListener('change', () => { if (r.checked) { settings[key] = cast(r.value); store.save('watermark', settings); sync(); } });
  });
}
bindRadio('wmType', 'type');
bindRadio('wmColor', 'color');
bindRadio('wmAngle', 'angle');
bindRadio('wmPos', 'pos');
bindRadio('wmPages', 'pages');
for (const [id, key] of [['#wmSize', 'size'], ['#wmOpacity', 'opacity'], ['#wmScale', 'scale']]) {
  $(id).value = String(settings[key]);
  $(id).addEventListener('input', () => { settings[key] = Number($(id).value); sync(); });
  $(id).addEventListener('change', () => store.save('watermark', settings));
}
$('#wmText').value = settings.text;
$('#wmText').addEventListener('input', () => { settings.text = $('#wmText').value; store.save('watermark', settings); sync(); });
$('#wmTile').checked = settings.tile;
$('#wmTile').addEventListener('change', () => { settings.tile = $('#wmTile').checked; store.save('watermark', settings); sync(); });
$('#pageRange').addEventListener('input', () => refreshPreview());
$('#wmImage').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const c = await loadPhoto(f, 2000);
    imageAspect = c.height / c.width;
    imagePng = await new Promise((r) => c.toBlob(async (b) => r(new Uint8Array(await b.arrayBuffer())), 'image/png'));
    $('#wmImageName').textContent = f.name;
    sync();
  } catch {
    setStatus(tr('loadError'));
  }
});
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; openFile(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
$('#savePdf').addEventListener('click', () => exportPdf(false));
$('#sharePdf').addEventListener('click', () => exportPdf(true));
bindFileDrop($('#dropzone'), openFile);
ready = true;
sync();

// Exposed for the automated test only.
window.__watermark = { settings, buildOutput, openFile, refresh: sync };
