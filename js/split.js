// Split PDF: by ranges, every N pages, or picked pages. Output is one PDF
// or a ZIP of several. Runs in this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import * as store from './storage.js';
import { makeZip } from './zip.js';
import { formatSize, safeName, download, shareOrDownload, openErrorKey } from './pdf-kit.js';
import { openPdfs, createThumbQueue, card, bindFileDrop, parseRanges, buildFromPages } from './pdf-pages.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const settings = { mode: 'ranges', every: 1, ...store.load('split', {}) };
let src = null;
/** @type {{index:number, selected:boolean, thumb:string}[]} */
let pages = [];
let ready = false;
const thumbs = createThumbQueue(200);

const page = initPage(() => { if (ready) render(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

async function openFile(list) {
  setStatus(tr('pdfLoading'));
  const { sources, failed, skipped } = await openPdfs(list.slice(0, 1));
  if (!sources.length) {
    setStatus(failed.length ? `${failed[0].name}: ${tr(openErrorKey(failed[0].err))}` : skipped ? tr('pdfOpenError') : '');
    return;
  }
  if (src) src.doc.destroy();
  pages.forEach((p) => p.thumb && URL.revokeObjectURL(p.thumb));
  [src] = sources;
  pages = Array.from({ length: src.pages }, (_, i) => ({ index: i, selected: false, thumb: '' }));
  $('#fileName').value = safeName(src.name, 'dokumen');
  setStatus('');
  render();
  for (const p of pages) {
    thumbs.add(src.doc, p.index, 0, (url) => {
      p.thumb = url;
      const img = document.querySelector(`.page-card[data-index="${p.index}"] img`);
      if (img && url) img.src = url;
    });
  }
  await thumbs.idle();
}

/** Page index groups for the current mode, or null if the input is invalid. */
export function groups() {
  if (!src) return null;
  if (settings.mode === 'ranges') return parseRanges($('#ranges').value, src.pages);
  if (settings.mode === 'every') {
    const n = Math.max(1, Math.floor(Number($('#every').value) || 1));
    const out = [];
    for (let i = 0; i < src.pages; i += n) out.push(Array.from({ length: Math.min(n, src.pages - i) }, (_, k) => i + k));
    return out;
  }
  const picked = pages.filter((p) => p.selected).map((p) => p.index);
  if (!picked.length) return null;
  return $('#pickSeparate').checked ? picked.map((i) => [i]) : [picked];
}

function render() {
  $('#toolLayout').classList.toggle('is-empty', !src);
  $$('[data-mode]').forEach((el) => { el.hidden = el.dataset.mode !== settings.mode; });
  if (src) {
    $('#docTitle').textContent = src.name;
    $('#docMeta').textContent = `${tr('pdfPagesN', { n: src.pages })} · ${formatSize(src.bytes.length)}`;
  }
  // Show which output file each page lands in.
  const g = groups() || [];
  const fileOf = new Map();
  const merged = settings.mode === 'ranges' && $('#rangesMerge').checked;
  g.forEach((grp, k) => grp.forEach((i) => { if (!fileOf.has(i)) fileOf.set(i, merged ? 1 : k + 1); }));
  const grid = $('#pageGrid');
  grid.textContent = '';
  for (const p of pages) {
    const f = fileOf.get(p.index);
    const li = card({
      index: p.index,
      thumb: p.thumb,
      number: String(p.index + 1),
      selected: settings.mode === 'pick' ? p.selected : f != null,
      onToggle: settings.mode === 'pick' ? () => { p.selected = !p.selected; render(); } : null,
      selectLabel: `${tr('orgSelect')} ${p.index + 1}`,
      caption: f != null ? tr('splitFileN', { n: f }) : '',
      hue: f != null ? (f * 67) % 360 : null,
    });
    if (f == null) li.classList.add('dim');
    grid.appendChild(li);
  }
  const count = g.length ? (merged ? 1 : g.length) : 0;
  $('#splitSummary').textContent = src && count ? tr('splitSummary', { n: count }) : '';
  $('#savePdf').disabled = !count;
  $('#sharePdf').disabled = !count;
}

/** Build the output: one PDF, or a ZIP when there are several files. */
export async function buildOutput() {
  const g = groups();
  if (!g) throw new Error(settings.mode === 'pick' ? 'none' : 'ranges');
  const base = safeName($('#fileName').value, 'dokumen');
  const bytesById = new Map([[src.id, src.bytes]]);
  const cache = new Map();
  const merged = settings.mode === 'ranges' && $('#rangesMerge').checked;
  const sets = merged ? [g.flat()] : g;
  const files = [];
  for (const set of sets) {
    const label = set.length > 1 && set[set.length - 1] - set[0] === set.length - 1
      ? `${set[0] + 1}-${set[set.length - 1] + 1}` : set.length === 1 ? `${set[0] + 1}` : `${files.length + 1}`;
    files.push({ name: `${base}-${label}.pdf`, data: await buildFromPages(set.map((index) => ({ src: src.id, index })), bytesById, cache) });
  }
  if (files.length === 1) return { file: new File([files[0].data], files[0].name, { type: 'application/pdf' }), count: 1 };
  return { file: new File([makeZip(files)], `${base}.zip`, { type: 'application/zip' }), count: files.length };
}

let busy = false;
async function exportFiles(share) {
  if (busy || !src) return;
  busy = true;
  $$('.options .buttons button').forEach((b) => { b.disabled = true; });
  setStatus(tr('working'));
  try {
    const out = await buildOutput();
    const done = out.count > 1
      ? tr('orgDoneZip', { files: out.count, size: formatSize(out.file.size) })
      : tr('splitDoneOne', { size: formatSize(out.file.size) });
    if (share) {
      const how = await shareOrDownload(out.file);
      setStatus(how === 'cancelled' ? '' : how === 'downloaded' ? `${tr('shareFallback')} ${done}` : done);
    } else {
      download(out.file);
      setStatus(done);
    }
  } catch (err) {
    if (err && err.message === 'ranges') setStatus(tr('orgRangesBad', { max: src.pages }));
    else if (err && err.message === 'none') setStatus(tr('p2iNoneSelected'));
    else setStatus(tr(openErrorKey(err)));
  } finally {
    busy = false;
    render();
  }
}

$$('input[name="splitMode"]').forEach((r) => {
  r.checked = r.value === settings.mode;
  r.addEventListener('change', () => { if (r.checked) { settings.mode = r.value; store.save('split', settings); render(); } });
});
$('#every').value = String(settings.every);
$('#every').addEventListener('input', () => { settings.every = Number($('#every').value) || 1; store.save('split', settings); render(); });
$('#ranges').addEventListener('input', render);
$('#rangesMerge').addEventListener('change', render);
$('#pickSeparate').addEventListener('change', render);
$('#selAll').addEventListener('click', () => { pages.forEach((p) => { p.selected = true; }); render(); });
$('#selNone').addEventListener('click', () => { pages.forEach((p) => { p.selected = false; }); render(); });
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; openFile(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
$('#savePdf').addEventListener('click', () => exportFiles(false));
$('#sharePdf').addEventListener('click', () => exportFiles(true));
bindFileDrop($('#dropzone'), openFile);
ready = true;
render();

// Exposed for the automated test only.
window.__split = { settings, groups, buildOutput, openFile, get pages() { return pages; }, whenIdle: () => thumbs.idle() };
