// Watermark PDF: stamp text or an image on pages (9 positions or tiled),
// with live preview rendered from the real output. Runs in this tab.
import { initPage } from './page.js';
import { t } from './i18n.js';
import * as store from './storage.js';
import { loadPhoto } from './image-loader.js';
import { loadPdfLib, formatSize, safeName, download, shareOrDownload, openErrorKey } from './pdf-kit.js';
import { openPdfs, bindFileDrop, parseRanges, displayToUser, displaySize, createPreview } from './pdf-pages.js';

const COLORS = { black: [0, 0, 0], red: [0.78, 0.16, 0.16], blue: [0.08, 0.27, 0.69], gray: [0.45, 0.45, 0.45] };
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

/** pdf-lib's standard fonts only cover Latin-1 (fine for BM/EN). */
const latin1 = (s) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');

/* ---------- Drawing ---------- */

/**
 * Centre points for the stamp. Mosaic mode lays a lattice along the text
 * direction (`deg`) so rotated copies tile the page evenly.
 */
function centers(Dw, Dh, ex, ey, w = 0, h = 0, deg = 0) {
  const m = Math.min(Dw, Dh) * 0.06;
  if (settings.tile) {
    const th = (deg * Math.PI) / 180;
    const along = [Math.cos(th), -Math.sin(th)]; // text direction on screen (y down)
    const across = [Math.sin(th), Math.cos(th)];
    const stepA = w + Math.max(h * 1.6, 24);
    const stepB = Math.max(h * 3.2, 40);
    const reach = Math.hypot(Dw, Dh);
    const out = [];
    for (let j = -Math.ceil(reach / stepB); j <= Math.ceil(reach / stepB); j++) {
      const shift = (j % 2) * stepA / 2;
      for (let i = -Math.ceil(reach / stepA) - 1; i <= Math.ceil(reach / stepA) + 1; i++) {
        const u = Dw / 2 + (i * stepA + shift) * along[0] + j * stepB * across[0];
        const v = Dh / 2 + (i * stepA + shift) * along[1] + j * stepB * across[1];
        if (u > -ex && u < Dw + ex && v > -ey && v < Dh + ey) out.push([u, v]);
      }
    }
    return out;
  }
  const [r, c] = settings.pos;
  const u = c === 'l' ? m + ex : c === 'r' ? Dw - m - ex : Dw / 2;
  const v = r === 't' ? m + ey : r === 'b' ? Dh - m - ey : Dh / 2;
  return [[u, v]];
}

/** Draw a w×h box rotated by `deg`, centred at display point (cu, cv). */
function placeBox(page, w, h, deg, cu, cv, draw) {
  const th = (deg * Math.PI) / 180;
  const { height: Dh } = displaySize(page);
  // Work in a y-up display frame, then convert the box origin to PDF space.
  const offX = (w / 2) * Math.cos(th) - (h / 2) * Math.sin(th);
  const offY = (w / 2) * Math.sin(th) + (h / 2) * Math.cos(th);
  const ox = cu - offX;
  const oy = (Dh - cv) - offY;
  const p = displayToUser(page, ox, Dh - oy);
  draw(p.x, p.y, deg + p.angle);
}

async function stamp(doc, page, PDFLib, cache) {
  const { width: Dw, height: Dh } = displaySize(page);
  const deg = Number(settings.angle) || 0;
  const th = (deg * Math.PI) / 180;
  const opacity = Math.max(0.05, Math.min(1, settings.opacity / 100));
  if (settings.type === 'image') {
    if (!imagePng) return;
    if (!cache.img) cache.img = await doc.embedPng(imagePng);
    const w = Dw * (settings.scale / 100);
    const h = w * imageAspect;
    const ex = (Math.abs(Math.cos(th)) * w + Math.abs(Math.sin(th)) * h) / 2;
    const ey = (Math.abs(Math.sin(th)) * w + Math.abs(Math.cos(th)) * h) / 2;
    for (const [cu, cv] of centers(Dw, Dh, ex, ey, w, h, deg)) {
      placeBox(page, w, h, deg, cu, cv, (x, y, rot) => page.drawImage(cache.img, { x, y, width: w, height: h, opacity, rotate: PDFLib.degrees(rot) }));
    }
    return;
  }
  const text = latin1(settings.text.trim() || 'SALINAN');
  if (!cache.font) cache.font = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const size = settings.size;
  const w = cache.font.widthOfTextAtSize(text, size);
  const h = size * 0.72;
  const [r, g, b] = COLORS[settings.color] || COLORS.red;
  const ex = (Math.abs(Math.cos(th)) * w + Math.abs(Math.sin(th)) * h) / 2;
  const ey = (Math.abs(Math.sin(th)) * w + Math.abs(Math.cos(th)) * h) / 2;
  for (const [cu, cv] of centers(Dw, Dh, ex, ey, w, h, deg)) {
    placeBox(page, w, h, deg, cu, cv, (x, y, rot) => page.drawText(text, {
      x, y, size, font: cache.font, color: PDFLib.rgb(r, g, b), opacity, rotate: PDFLib.degrees(rot),
    }));
  }
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
