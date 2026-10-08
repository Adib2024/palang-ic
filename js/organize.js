// Merge / split / organise PDF. Files are read and rebuilt in this tab with
// the vendored pdf.js + pdf-lib; nothing is sent anywhere.
import { initPage } from './page.js';
import { t } from './i18n.js';
import * as store from './storage.js';
import { makeZip } from './zip.js';
import {
  loadPdfLib, openForRender, renderPage, isPdf, formatSize, safeName,
  download, shareOrDownload, openErrorKey,
} from './pdf-kit.js';

const THUMB_W = 220;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/** @type {{id: number, name: string, bytes: Uint8Array, doc: any, pages: number, hue: number}[]} */
let sources = [];
/** @type {{key: number, src: number, index: number, rotation: number, selected: boolean, thumb: string}[]} */
let pages = [];
let nextId = 1;
let ready = false;
const settings = { outMode: 'merge', splitBy: 'each', ...store.load('organize', {}) };

const page = initPage(() => { if (ready) render(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };
const srcOf = (p) => sources.find((s) => s.id === p.src);
// Distinct, readable hues for telling source files apart.
const HUES = [152, 222, 28, 330, 262, 190, 4, 88];

/* ---------- Loading ---------- */

async function thumbFor(p) {
  const src = srcOf(p);
  const pg = await src.doc.getPage(p.index + 1);
  const vp = pg.getViewport({ scale: 1, rotation: (pg.rotate + p.rotation) % 360 });
  const canvas = await renderPage(pg, THUMB_W / vp.width, p.rotation);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : ''), 'image/jpeg', 0.8));
}

// Render thumbnails one at a time so big documents don't freeze the tab.
let queue = Promise.resolve();
function queueThumb(p) {
  queue = queue.then(async () => {
    if (!pages.includes(p)) return;
    const url = await thumbFor(p).catch(() => '');
    if (p.thumb) URL.revokeObjectURL(p.thumb);
    p.thumb = url;
    const img = document.querySelector(`.page-card[data-key="${p.key}"] img`);
    if (img && url) img.src = url;
  });
  return queue;
}

async function addFiles(fileList) {
  const files = [...fileList].filter(isPdf);
  const skipped = fileList.length - files.length;
  const errors = [];
  for (const file of files) {
    setStatus(tr('pdfLoading'));
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await openForRender(bytes);
      const src = { id: nextId++, name: file.name, bytes, doc, pages: doc.numPages, hue: HUES[sources.length % HUES.length] };
      sources.push(src);
      for (let i = 0; i < doc.numPages; i++) {
        pages.push({ key: nextId++, src: src.id, index: i, rotation: 0, selected: false, thumb: '' });
      }
      render();
      pages.filter((p) => p.src === src.id).forEach(queueThumb);
    } catch (err) {
      errors.push(`${file.name}: ${tr(openErrorKey(err))}`);
    }
  }
  const msgs = [...errors];
  if (skipped) msgs.push(tr('i2pSkipped', { n: skipped }));
  setStatus(msgs.join(' '));
  await queue;
}

function removeSource(id) {
  const src = sources.find((s) => s.id === id);
  if (src) src.doc.destroy();
  pages.filter((p) => p.src === id).forEach((p) => p.thumb && URL.revokeObjectURL(p.thumb));
  pages = pages.filter((p) => p.src !== id);
  sources = sources.filter((s) => s.id !== id);
  render();
}

/* ---------- Rendering ---------- */

function move(from, to) {
  if (to < 0 || to >= pages.length || from === to) return;
  const [p] = pages.splice(from, 1);
  pages.splice(to, 0, p);
  render();
}

function iconButton(label, text, onClick, disabled, cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `icon-btn${cls ? ` ${cls}` : ''}`;
  b.textContent = text;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.disabled = !!disabled;
  b.addEventListener('click', onClick);
  return b;
}

function render() {
  // Source file chips
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
    li.append(name, meta, iconButton(`${tr('orgRemoveFile')}: ${src.name}`, '✕', () => removeSource(src.id), false, 'danger'));
    chips.appendChild(li);
  }

  // Page grid
  const grid = $('#pageGrid');
  grid.textContent = '';
  pages.forEach((p, i) => {
    const src = srcOf(p);
    const li = document.createElement('li');
    li.className = `page-card${p.selected ? ' selected' : ''}`;
    li.draggable = true;
    li.dataset.index = String(i);
    li.dataset.key = String(p.key);
    li.style.setProperty('--hue', src.hue);

    const sel = document.createElement('input');
    sel.type = 'checkbox';
    sel.className = 'page-select';
    sel.checked = p.selected;
    sel.setAttribute('aria-label', `${tr('orgSelect')} ${i + 1}`);
    sel.addEventListener('change', () => { p.selected = sel.checked; render(); });

    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'page-thumb';
    thumb.setAttribute('aria-label', `${tr('orgSelect')} ${i + 1}`);
    thumb.addEventListener('click', () => { p.selected = !p.selected; render(); });
    const img = document.createElement('img');
    img.alt = '';
    if (p.thumb) img.src = p.thumb;
    thumb.appendChild(img);

    const meta = document.createElement('div');
    meta.className = 'page-meta';
    const no = document.createElement('span');
    no.className = 'page-no';
    no.textContent = String(i + 1);
    no.title = `${src.name} · ${p.index + 1}`;
    const tools = document.createElement('span');
    tools.className = 'page-tools';
    tools.append(
      iconButton(`${tr('i2pMoveLeft')} (${i + 1})`, '◀', () => move(i, i - 1), i === 0),
      iconButton(`${tr('i2pMoveRight')} (${i + 1})`, '▶', () => move(i, i + 1), i === pages.length - 1),
      iconButton(`${tr('i2pRotate')} (${i + 1})`, '⟳', () => {
        p.rotation = (p.rotation + 90) % 360;
        queueThumb(p);
      }),
      iconButton(`${tr('i2pRemove')} (${i + 1})`, '✕', () => {
        if (p.thumb) URL.revokeObjectURL(p.thumb);
        pages = pages.filter((x) => x !== p);
        render();
      }, false, 'danger'),
    );
    meta.append(no, tools);
    li.append(sel, thumb, meta);
    grid.appendChild(li);
  });

  const n = pages.length;
  const nSel = pages.filter((p) => p.selected).length;
  $('#pageCount').textContent = String(n);
  $('#selCount').textContent = nSel ? tr('orgSelected', { n: nSel }) : '';
  $('#toolLayout').classList.toggle('is-empty', sources.length === 0);
  $('#savePdf').disabled = n === 0;
  $('#sharePdf').disabled = n === 0;
  syncOptions();
}

/* ---------- Reorder (desktop drag and drop) and file drop ---------- */

function bindReorder() {
  const grid = $('#pageGrid');
  let from = -1;
  const cardOf = (e) => e.target.closest && e.target.closest('.page-card');
  grid.addEventListener('dragstart', (e) => {
    const card = cardOf(e);
    if (!card) return;
    from = Number(card.dataset.index);
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(from));
  });
  grid.addEventListener('dragover', (e) => {
    if (from < 0) return;
    e.preventDefault();
    $$('.page-card.drop-target').forEach((c) => c.classList.remove('drop-target'));
    const card = cardOf(e);
    if (card) card.classList.add('drop-target');
  });
  grid.addEventListener('drop', (e) => {
    if (from < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const card = cardOf(e);
    const to = card ? Number(card.dataset.index) : pages.length - 1;
    const f = from;
    from = -1;
    move(f, to);
  });
  grid.addEventListener('dragend', () => {
    from = -1;
    $$('.page-card').forEach((c) => c.classList.remove('dragging', 'drop-target'));
  });
}

function bindFileDrop() {
  const zone = $('#dropzone');
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    zone.classList.add('over');
  });
  document.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) zone.classList.remove('over'); });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    zone.classList.remove('over');
    addFiles(e.dataTransfer.files);
  });
}

/* ---------- Output ---------- */

/** Parse "1-3, 5, 7-9" into 0-based index groups; null if invalid. */
export function parseRanges(text, max) {
  const groups = [];
  for (const part of text.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*(?:[-–]\s*(\d+))?$/);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < 1 || a > max || b > max) return null;
    const group = [];
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) group.push(i - 1);
    groups.push(group);
  }
  return groups.length ? groups : null;
}

async function buildPdf(list, PDFLib, loaded) {
  const out = await PDFLib.PDFDocument.create();
  for (const p of list) {
    let srcDoc = loaded.get(p.src);
    if (!srcDoc) {
      srcDoc = await PDFLib.PDFDocument.load(srcOf(p).bytes, { updateMetadata: false });
      loaded.set(p.src, srcDoc);
    }
    const [copy] = await out.copyPages(srcDoc, [p.index]);
    if (p.rotation) copy.setRotation(PDFLib.degrees((copy.getRotation().angle + p.rotation) % 360));
    out.addPage(copy);
  }
  return out.save();
}

/** Build the output file(s) as one File (PDF, or ZIP when splitting into several). */
export async function buildOutput() {
  const PDFLib = await loadPdfLib();
  const loaded = new Map();
  const base = safeName($('#fileName').value, 'dokumen');

  if (settings.outMode === 'merge') {
    const list = $('#onlySelected').checked ? pages.filter((p) => p.selected) : pages;
    if (!list.length) throw new Error('empty');
    const bytes = await buildPdf(list, PDFLib, loaded);
    return { file: new File([bytes], `${base}.pdf`, { type: 'application/pdf' }), pages: list.length };
  }

  let groups;
  if (settings.splitBy === 'ranges') {
    groups = parseRanges($('#ranges').value, pages.length);
    if (!groups) throw new Error('ranges');
  } else {
    groups = pages.map((_, i) => [i]);
  }
  const files = [];
  for (const g of groups) {
    const label = g.length > 1 ? `${g[0] + 1}-${g[g.length - 1] + 1}` : `${g[0] + 1}`;
    files.push({ name: `${base}-${label}.pdf`, data: await buildPdf(g.map((i) => pages[i]), PDFLib, loaded) });
  }
  if (files.length === 1) {
    return { file: new File([files[0].data], files[0].name, { type: 'application/pdf' }), pages: groups[0].length };
  }
  return { file: new File([makeZip(files)], `${base}.zip`, { type: 'application/zip' }), files: files.length };
}

let busy = false;
async function exportFiles(share) {
  if (busy || !pages.length) return;
  busy = true;
  $$('.options .buttons button').forEach((b) => { b.disabled = true; });
  setStatus(tr('working'));
  try {
    const out = await buildOutput();
    const done = out.files
      ? tr('orgDoneZip', { files: out.files, size: formatSize(out.file.size) })
      : tr('orgDoneOne', { pages: out.pages, size: formatSize(out.file.size) });
    if (share) {
      const how = await shareOrDownload(out.file);
      setStatus(how === 'cancelled' ? '' : how === 'downloaded' ? `${tr('shareFallback')} ${done}` : done);
    } else {
      download(out.file);
      setStatus(done);
    }
  } catch (err) {
    if (err && err.message === 'ranges') setStatus(tr('orgRangesBad', { max: pages.length }));
    else if (err && err.message === 'empty') setStatus(tr('orgNothing'));
    else setStatus(tr(openErrorKey(err)));
  } finally {
    busy = false;
    render();
  }
}

/* ---------- Options ---------- */

function syncOptions() {
  $('#mergeOpts').hidden = settings.outMode !== 'merge';
  $('#splitOpts').hidden = settings.outMode !== 'split';
  $('#rangesField').hidden = settings.splitBy !== 'ranges';
}

function bindOptions() {
  for (const name of ['outMode', 'splitBy']) {
    $$(`input[name="${name}"]`).forEach((r) => {
      r.checked = r.value === settings[name];
      r.addEventListener('change', () => {
        if (!r.checked) return;
        settings[name] = r.value;
        store.save('organize', settings);
        syncOptions();
      });
    });
  }
  $('#selAll').addEventListener('click', () => { pages.forEach((p) => { p.selected = true; }); render(); });
  $('#selNone').addEventListener('click', () => { pages.forEach((p) => { p.selected = false; }); render(); });
  $('#clearAll').addEventListener('click', () => {
    [...sources].forEach((s) => removeSource(s.id));
    setStatus('');
  });
}

$('#pickFiles').addEventListener('change', (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  addFiles(files);
});
$('#savePdf').addEventListener('click', () => exportFiles(false));
$('#sharePdf').addEventListener('click', () => exportFiles(true));
bindOptions();
bindReorder();
bindFileDrop();
ready = true;
render();

// Exposed for the automated test only.
window.__organize = {
  get pages() { return pages; },
  get sources() { return sources; },
  settings, buildOutput, parseRanges, addFiles, whenIdle: () => queue,
};
