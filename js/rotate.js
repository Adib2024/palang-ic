// Rotate PDF: rotate every page or single pages of one or more PDFs.
// Each input file is saved back as its own PDF (ZIP when there are several).
import { initPage } from './page.js';
import { t } from './i18n.js';
import { makeZip } from './zip.js';
import { formatSize, safeName, download, shareOrDownload, openErrorKey } from './pdf-kit.js';
import { openPdfs, createThumbQueue, card, iconButton, bindFileDrop, buildFromPages } from './pdf-pages.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let sources = [];
/** @type {{key:string, src:number, index:number, rotation:number, thumb:string}[]} */
let pages = [];
let ready = false;
const thumbs = createThumbQueue(200);

const page = initPage(() => { if (ready) render(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };
const srcOf = (p) => sources.find((s) => s.id === p.src);

function queueThumb(p) {
  thumbs.add(srcOf(p).doc, p.index, p.rotation, (url) => {
    if (p.thumb) URL.revokeObjectURL(p.thumb);
    p.thumb = url;
    const img = document.querySelector(`.page-card[data-key="${p.key}"] img`);
    if (img && url) img.src = url;
  });
}

async function addFiles(list) {
  setStatus(tr('pdfLoading'));
  const { sources: added, failed, skipped } = await openPdfs(list, sources.length);
  for (const s of added) {
    sources.push(s);
    for (let i = 0; i < s.pages; i++) pages.push({ key: `${s.id}-${i}`, src: s.id, index: i, rotation: 0, thumb: '' });
  }
  render();
  pages.filter((p) => added.some((s) => s.id === p.src)).forEach(queueThumb);
  const msgs = failed.map((f) => `${f.name}: ${tr(openErrorKey(f.err))}`);
  if (skipped) msgs.push(tr('i2pSkipped', { n: skipped }));
  setStatus(msgs.join(' '));
  await thumbs.idle();
}

function rotate(list, deg) {
  list.forEach((p) => { p.rotation = (p.rotation + deg + 360) % 360; queueThumb(p); });
  render();
}

function render() {
  const grid = $('#pageGrid');
  grid.textContent = '';
  pages.forEach((p, i) => {
    const src = srcOf(p);
    const li = card({
      index: i,
      thumb: p.thumb,
      number: sources.length > 1 ? `${src.name.replace(/\.pdf$/i, '')} · ${p.index + 1}` : String(p.index + 1),
      hue: sources.length > 1 ? src.hue : null,
      tools: [
        iconButton(`${tr('rotLeft')} (${i + 1})`, '⟲', () => rotate([p], -90)),
        iconButton(`${tr('rotRight')} (${i + 1})`, '⟳', () => rotate([p], 90)),
      ],
    });
    li.dataset.key = p.key;
    if (p.rotation) li.classList.add('rotated');
    grid.appendChild(li);
  });
  $('#pageCount').textContent = String(pages.length);
  $('#toolLayout').classList.toggle('is-empty', sources.length === 0);
  const changed = pages.some((p) => p.rotation);
  $('#savePdf').disabled = !changed;
  $('#sharePdf').disabled = !changed;
}

/** One rotated PDF per input file (ZIP when several). */
export async function buildOutput() {
  const files = [];
  for (const s of sources) {
    const list = pages.filter((p) => p.src === s.id);
    const data = await buildFromPages(list, new Map([[s.id, s.bytes]]));
    files.push({ name: `${safeName(s.name, 'dokumen')}-putar.pdf`, data });
  }
  if (files.length === 1) return new File([files[0].data], files[0].name, { type: 'application/pdf' });
  return new File([makeZip(files)], 'pdf-putar.zip', { type: 'application/zip' });
}

let busy = false;
async function exportFiles(share) {
  if (busy || !sources.length) return;
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
    setStatus(tr(openErrorKey(err)));
  } finally {
    busy = false;
    render();
  }
}

$('#rotAllLeft').addEventListener('click', () => rotate(pages, -90));
$('#rotAllRight').addEventListener('click', () => rotate(pages, 90));
$('#rotReset').addEventListener('click', () => { pages.forEach((p) => { if (p.rotation) { p.rotation = 0; queueThumb(p); } }); render(); });
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); });
$('#clearAll').addEventListener('click', () => {
  sources.forEach((s) => s.doc.destroy());
  pages.forEach((p) => p.thumb && URL.revokeObjectURL(p.thumb));
  sources = [];
  pages = [];
  setStatus('');
  render();
});
$('#savePdf').addEventListener('click', () => exportFiles(false));
$('#sharePdf').addEventListener('click', () => exportFiles(true));
bindFileDrop($('#dropzone'), addFiles);
ready = true;
render();

// Exposed for the automated test only.
window.__rotate = { get pages() { return pages; }, buildOutput, addFiles, whenIdle: () => thumbs.idle() };
