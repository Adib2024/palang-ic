// Compare PDF: show what changed between two versions — a word-level text
// diff and a page-by-page visual diff with the changed areas marked.
// Both files are read in this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import { openForRender, renderPage, isPdf, formatSize, openErrorKey } from './pdf-kit.js';
import { diffTokens, runs, tokenize } from './diff.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const CONTEXT = 8; // words of unchanged text shown around each change
const CELL = 10; // px grid for the visual diff

/** @type {{A: any, B: any}} each {name, size, doc, tokens, pageOf} */
const docs = { A: null, B: null };
let result = null; // {text: {ins, del, runs}, visual: [{page, changed, a, b}]}
let ready = false;
let busy = false;

const page = initPage(() => { if (ready) { syncSlots(); if (result) renderAll(); } });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };

/* ---------- Loading ---------- */

/** Words of every page, with the page each word came from. */
async function extract(doc) {
  const tokens = [];
  const pageOf = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    const tc = await pg.getTextContent();
    let text = '';
    for (const it of tc.items) text += it.str + (it.hasEOL ? '\n' : ' ');
    for (const w of tokenize(text)) { tokens.push(w); pageOf.push(i); }
    pg.cleanup();
  }
  return { tokens, pageOf };
}

async function load(slot, file) {
  if (!file) return;
  if (!isPdf(file)) { setStatus(tr('pdfOpenError')); return; }
  setStatus(tr('pdfLoading'));
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await openForRender(bytes);
    if (docs[slot]) docs[slot].doc.destroy();
    docs[slot] = { name: file.name, size: file.size, doc, ...(await extract(doc)) };
    setStatus('');
  } catch (err) {
    setStatus(`${file.name}: ${tr(openErrorKey(err))}`);
  }
  syncSlots();
  if (docs.A && docs.B) await compare();
}

function syncSlots() {
  for (const slot of ['A', 'B']) {
    const d = docs[slot];
    const el = $(`#slot${slot}`);
    el.classList.toggle('filled', !!d);
    el.querySelector('.cmp-name').textContent = d ? d.name : '';
    el.querySelector('.cmp-meta').textContent = d ? `${tr('pdfPagesN', { n: d.doc.numPages })} · ${formatSize(d.size)}` : '';
  }
  $('#swap').disabled = !(docs.A && docs.B);
  $('#results').hidden = !result;
}

/* ---------- Comparing ---------- */

function textDiff() {
  const a = docs.A.tokens;
  const b = docs.B.tokens;
  const script = diffTokens(a, b);
  let ins = 0;
  let del = 0;
  for (const s of script) { if (s.op === 'ins') ins++; else if (s.op === 'del') del++; }
  return { ins, del, runs: runs(a, b, script) };
}

/** Grid cells (in canvas px) where two same-size renders differ. */
function changedCells(ca, cb) {
  const w = ca.width;
  const h = ca.height;
  const da = ca.getContext('2d').getImageData(0, 0, w, h).data;
  const db = cb.getContext('2d').getImageData(0, 0, w, h).data;
  const cols = Math.ceil(w / CELL);
  const rows = Math.ceil(h / CELL);
  const count = new Uint16Array(cols * rows);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      if (Math.abs(da[k] - db[k]) + Math.abs(da[k + 1] - db[k + 1]) + Math.abs(da[k + 2] - db[k + 2]) > 90) {
        count[Math.floor(y / CELL) * cols + Math.floor(x / CELL)]++;
      }
    }
  }
  const cells = [];
  for (let i = 0; i < count.length; i++) if (count[i] >= 3) cells.push([(i % cols) * CELL, Math.floor(i / cols) * CELL]);
  return cells;
}

/** Render a page on white at `width` px wide (or a blank page if missing). */
async function renderAt(doc, n, width, height) {
  const c = document.createElement('canvas');
  if (n > doc.numPages) {
    c.width = width; c.height = height || Math.round(width * 1.414);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    return { canvas: c, missing: true };
  }
  const pg = await doc.getPage(n);
  const vp = pg.getViewport({ scale: 1 });
  const src = await renderPage(pg, width / vp.width);
  pg.cleanup();
  c.width = width;
  c.height = height || src.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0);
  src.width = src.height = 0;
  return { canvas: c, missing: false };
}

function mark(canvas, cells, color) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  for (const [x, y] of cells) ctx.fillRect(x, y, CELL, CELL);
}

async function visualDiff(onPage) {
  const n = Math.max(docs.A.doc.numPages, docs.B.doc.numPages);
  const width = 600;
  const pages = [];
  for (let i = 1; i <= n; i++) {
    onPage(i, n);
    const a = await renderAt(docs.A.doc, i, width);
    const b = await renderAt(docs.B.doc, i, width, a.canvas.height);
    const cells = a.missing || b.missing ? [] : changedCells(a.canvas, b.canvas);
    const changed = a.missing || b.missing || cells.length > 0;
    mark(a.canvas, cells, 'rgba(225, 29, 72, .28)');
    mark(b.canvas, cells, 'rgba(5, 150, 105, .28)');
    pages.push({ page: i, changed, onlyA: b.missing, onlyB: a.missing, a: a.canvas, b: b.canvas });
  }
  return pages;
}

/** Compare the two loaded files (text + visual). */
export async function compare() {
  if (!docs.A || !docs.B || busy) return;
  busy = true;
  setStatus(tr('working'));
  try {
    const text = textDiff();
    const visual = await visualDiff((i, n) => setStatus(tr('difPageProgress', { i, n })));
    result = { text, visual };
    setStatus('');
    renderAll();
  } catch (err) {
    setStatus(tr(openErrorKey(err)));
  } finally {
    busy = false;
  }
}

/* ---------- Showing ---------- */

function span(cls, text) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function renderText() {
  const box = $('#diffText');
  box.textContent = '';
  const { runs: list } = result.text;
  if (!list.some((r) => r.op !== 'eq')) {
    box.appendChild(span('cmp-same', tr('difTextSame')));
    return;
  }
  let lastPage = 0;
  list.forEach((r, i) => {
    if (r.op === 'eq') {
      const words = r.tokens;
      const head = i > 0 ? words.slice(0, CONTEXT) : [];
      const tail = i < list.length - 1 ? words.slice(-CONTEXT) : [];
      if (words.length > 2 * CONTEXT + 4) {
        if (head.length) box.append(span('cmp-eq', `${head.join(' ')} `));
        box.append(span('cmp-gap', tr('difSkipped', { n: words.length - head.length - tail.length })));
        if (tail.length) box.append(span('cmp-eq', ` ${tail.join(' ')} `));
      } else box.append(span('cmp-eq', `${words.join(' ')} `));
      return;
    }
    // Page tag for the first change on each page (new file's page; old file's for deletions).
    const pg = r.op === 'ins' ? docs.B.pageOf[r.b] : docs.A.pageOf[r.a];
    if (pg !== lastPage) {
      box.append(span('cmp-page', tr('difPageTag', { n: pg })));
      lastPage = pg;
    }
    const el = document.createElement(r.op === 'ins' ? 'ins' : 'del');
    el.textContent = r.tokens.join(' ');
    box.append(el, ' ');
  });
}

function renderVisual() {
  const host = $('#diffVisual');
  host.textContent = '';
  const onlyChanged = $('#onlyChanged').checked;
  const shown = result.visual.filter((p) => !onlyChanged || p.changed);
  if (!shown.length) {
    host.appendChild(span('cmp-same', tr('difVisualSame')));
    return;
  }
  for (const p of shown) {
    const row = document.createElement('section');
    row.className = 'cmp-row';
    const head = document.createElement('h3');
    head.textContent = tr('sigPage', { n: p.page });
    const badge = span(`cmp-badge ${p.changed ? 'diff' : 'same'}`, tr(p.onlyA ? 'difOnlyA' : p.onlyB ? 'difOnlyB' : p.changed ? 'difChanged' : 'difUnchanged'));
    head.appendChild(badge);
    const pair = document.createElement('div');
    pair.className = 'cmp-pair';
    for (const [label, canvas] of [['A', p.a], ['B', p.b]]) {
      const fig = document.createElement('figure');
      fig.append(canvas);
      const cap = document.createElement('figcaption');
      cap.textContent = label === 'A' ? tr('difOld') : tr('difNew');
      fig.append(cap);
      pair.appendChild(fig);
    }
    row.append(head, pair);
    host.appendChild(row);
  }
}

function renderAll() {
  const { ins, del } = result.text;
  const changedPages = result.visual.filter((p) => p.changed).length;
  $('#sumIns').textContent = tr('difIns', { n: ins });
  $('#sumDel').textContent = tr('difDel', { n: del });
  $('#sumPages').textContent = tr('difPagesChanged', { n: changedPages, total: result.visual.length });
  renderText();
  renderVisual();
  syncSlots();
  syncTab();
}

function syncTab() {
  const tab = $('input[name="cmpTab"]:checked').value;
  $('#diffText').hidden = tab !== 'text';
  $('#visualPanel').hidden = tab !== 'visual';
}

/* ---------- Boot ---------- */

for (const slot of ['A', 'B']) {
  const input = $(`#file${slot}`);
  input.addEventListener('change', () => { const f = input.files[0]; input.value = ''; load(slot, f); });
  const zone = $(`#slot${slot}`);
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const files = [...e.dataTransfer.files].filter(isPdf);
    if (files.length >= 2 && slot === 'A' && !docs.A) { load('A', files[0]).then(() => load('B', files[1])); return; }
    load(slot, files[0]);
  });
}
$('#swap').addEventListener('click', () => {
  [docs.A, docs.B] = [docs.B, docs.A];
  result = null;
  syncSlots();
  compare();
});
$$('input[name="cmpTab"]').forEach((r) => r.addEventListener('change', syncTab));
$('#onlyChanged').addEventListener('change', () => { if (result) renderVisual(); });
ready = true;
syncSlots();

// Exposed for the automated test only.
window.__compare = { load, compare, get result() { return result; }, get docs() { return docs; } };
