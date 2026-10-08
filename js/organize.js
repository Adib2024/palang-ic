// Organise PDF: see every page, reorder, rotate, delete, then save one PDF.
// Files are read and rebuilt in this tab; nothing is sent anywhere.
import { initPage } from './page.js';
import { t } from './i18n.js';
import { formatSize, safeName, download, shareOrDownload, openErrorKey } from './pdf-kit.js';
import {
  openPdfs, createThumbQueue, card, iconButton, bindReorder, bindFileDrop, moveItem, buildFromPages, newId,
} from './pdf-pages.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let sources = [];
/** @type {{key:number, src:number, index:number, rotation:number, thumb:string}[]} */
let pages = [];
let ready = false;
const thumbs = createThumbQueue(220);

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

async function addFiles(files) {
  setStatus(tr('pdfLoading'));
  const { sources: added, failed, skipped } = await openPdfs(files, sources.length);
  for (const src of added) {
    sources.push(src);
    for (let i = 0; i < src.pages; i++) pages.push({ key: newId(), src: src.id, index: i, rotation: 0, thumb: '' });
  }
  render();
  pages.filter((p) => !p.thumb && added.some((s) => s.id === p.src)).forEach(queueThumb);
  const msgs = failed.map((f) => `${f.name}: ${tr(openErrorKey(f.err))}`);
  if (skipped) msgs.push(tr('i2pSkipped', { n: skipped }));
  setStatus(msgs.join(' '));
  await thumbs.idle();
}

function removeSource(id) {
  const src = sources.find((s) => s.id === id);
  if (src) src.doc.destroy();
  pages.filter((p) => p.src === id).forEach((p) => p.thumb && URL.revokeObjectURL(p.thumb));
  pages = pages.filter((p) => p.src !== id);
  sources = sources.filter((s) => s.id !== id);
  render();
}

function render() {
  const chips = $('#fileChips');
  chips.textContent = '';
  for (const src of sources) {
    const li = document.createElement('li');
    li.className = 'file-chip';
    li.style.setProperty('--hue', src.hue);
    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = src.name;
    name.title = src.name;
    const meta = document.createElement('span');
    meta.className = 'chip-meta';
    meta.textContent = `${tr('pdfPagesN', { n: src.pages })} · ${formatSize(src.bytes.length)}`;
    li.append(name, meta, iconButton(`${tr('orgRemoveFile')}: ${src.name}`, '✕', () => removeSource(src.id), { danger: true }));
    chips.appendChild(li);
  }

  const grid = $('#pageGrid');
  grid.textContent = '';
  pages.forEach((p, i) => {
    const src = srcOf(p);
    const li = card({
      index: i,
      thumb: p.thumb,
      number: String(i + 1),
      title: `${src.name} · ${p.index + 1}`,
      hue: src.hue,
      draggable: true,
      tools: [
        iconButton(`${tr('i2pMoveLeft')} (${i + 1})`, '◀', () => { if (moveItem(pages, i, i - 1)) render(); }, { disabled: i === 0 }),
        iconButton(`${tr('i2pMoveRight')} (${i + 1})`, '▶', () => { if (moveItem(pages, i, i + 1)) render(); }, { disabled: i === pages.length - 1 }),
        iconButton(`${tr('i2pRotate')} (${i + 1})`, '⟳', () => { p.rotation = (p.rotation + 90) % 360; queueThumb(p); }),
        iconButton(`${tr('i2pRemove')} (${i + 1})`, '✕', () => {
          if (p.thumb) URL.revokeObjectURL(p.thumb);
          pages = pages.filter((x) => x !== p);
          render();
        }, { danger: true }),
      ],
    });
    li.dataset.key = String(p.key);
    grid.appendChild(li);
  });
  $('#pageCount').textContent = String(pages.length);
  $('#toolLayout').classList.toggle('is-empty', sources.length === 0);
  $('#savePdf').disabled = pages.length === 0;
  $('#sharePdf').disabled = pages.length === 0;
}

/** Build the organised PDF. */
export async function buildOutput() {
  if (!pages.length) throw new Error('empty');
  const bytes = await buildFromPages(pages, new Map(sources.map((s) => [s.id, s.bytes])));
  const name = safeName($('#fileName').value, 'dokumen');
  return new File([bytes], `${name}.pdf`, { type: 'application/pdf' });
}

let busy = false;
async function exportPdf(share) {
  if (busy || !pages.length) return;
  busy = true;
  $$('.options .buttons button').forEach((b) => { b.disabled = true; });
  setStatus(tr('working'));
  try {
    const file = await buildOutput();
    const done = tr('orgDoneOne', { pages: pages.length, size: formatSize(file.size) });
    if (share) {
      const how = await shareOrDownload(file);
      setStatus(how === 'cancelled' ? '' : how === 'downloaded' ? `${tr('shareFallback')} ${done}` : done);
    } else {
      download(file);
      setStatus(done);
    }
  } catch (err) {
    setStatus(err && err.message === 'empty' ? tr('orgNothing') : tr(openErrorKey(err)));
  } finally {
    busy = false;
    render();
  }
}

$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); });
$('#clearAll').addEventListener('click', () => { [...sources].forEach((s) => removeSource(s.id)); setStatus(''); });
$('#savePdf').addEventListener('click', () => exportPdf(false));
$('#sharePdf').addEventListener('click', () => exportPdf(true));
bindReorder($('#pageGrid'), (f, to) => { if (moveItem(pages, f, to)) render(); }, () => pages.length);
bindFileDrop($('#dropzone'), addFiles);
ready = true;
render();

// Exposed for the automated test only.
window.__organize = {
  get pages() { return pages; }, get sources() { return sources; }, buildOutput, addFiles, whenIdle: () => thumbs.idle(),
};
