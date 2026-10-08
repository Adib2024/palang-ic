// Advanced mode: workflows. Pick a template or build your own list of steps
// (IC stamp, date/signature/text, watermark, page numbers, rotate, compress,
// password), add PDFs and photos, then run every step in one go.
// Everything runs in this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import * as store from './storage.js';
import {
  loadPdfLib, openForRender, formatSize, safeName, download, shareOrDownload,
} from './pdf-kit.js';
import { bindFileDrop, moveItem } from './pdf-pages.js';
import { renderPages } from './page-viewer.js';
import { initSignatureMaker, textCanvas, isoDate, toDMY } from './sig-maker.js';
import { createPlacer } from './placer.js';
import {
  STEP_TYPES, DEFAULTS, TEMPLATES_WF, normalize, buildInput, runStep,
} from './workflow-ops.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const clone = (o) => JSON.parse(JSON.stringify(o));
const isImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|gif|bmp)$/i.test(f.name);
const isPdfFile = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** @type {{id:number, file:File}[]} */
let files = [];
/** @type {{id:number, type:string, opts:object}[]} */
let steps = [];
let chosen = null; // template id / saved index / 'blank'
let nextId = 1;
let result = null;
let runToken = 0;
let ready = false;

const page = initPage(() => { if (ready) renderAll(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };
const setStatus2 = (msg) => { $('#status2').textContent = msg || ''; };
const placer = createPlacer({ tr, onChange: () => { if (ready) syncPlace(); } });
const maker = initSignatureMaker({ onError: () => setStatus2(tr('loadError')) });

/* ---------- Persistence (passwords are never stored) ---------- */

const strip = (list) => list.map(({ type, opts }) => ({ type, opts: type === 'protect' ? { ...opts, password: '' } : opts }));
const saveCurrent = () => store.save('wf-current', { steps: strip(steps), chosen });
const savedList = () => store.load('wf-saved', []);

function setSteps(list, which) {
  steps = normalize(list.map((s) => ({ id: nextId++, type: s.type, opts: { ...DEFAULTS[s.type], ...clone(s.opts || {}) } })));
  chosen = which;
  saveCurrent();
  renderAll();
}

/* ---------- Templates ---------- */

function stepChips(list) {
  const ul = document.createElement('ul');
  ul.className = 'wf-chips';
  for (const s of normalize(list)) {
    const li = document.createElement('li');
    li.textContent = tr(`wfStep_${s.type}`);
    ul.appendChild(li);
  }
  if (!list.length) {
    const li = document.createElement('li');
    li.textContent = tr('wfInput');
    ul.appendChild(li);
  }
  return ul;
}

function tplCard(id, title, desc, list, onDelete) {
  const card = document.createElement('div');
  card.className = 'wf-tpl';
  card.classList.toggle('on', chosen === id);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'wf-tpl-btn';
  btn.dataset.tpl = String(id);
  btn.setAttribute('aria-pressed', String(chosen === id));
  const strong = document.createElement('strong');
  strong.textContent = title;
  const p = document.createElement('span');
  p.textContent = desc;
  btn.append(strong, p, stepChips(list));
  btn.addEventListener('click', () => { setSteps(list, id); setStatus(''); });
  card.appendChild(btn);
  if (onDelete) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sig-del wf-del';
    del.textContent = '✕';
    del.setAttribute('aria-label', `${tr('wfDelete')}: ${title}`);
    del.addEventListener('click', onDelete);
    card.appendChild(del);
  }
  return card;
}

function renderTemplates() {
  const grid = $('#tplGrid');
  grid.textContent = '';
  for (const tpl of TEMPLATES_WF) {
    grid.appendChild(tplCard(tpl.id, tr(`wfTpl_${tpl.id}`), tr(`wfTpl_${tpl.id}Desc`), tpl.steps));
  }
  savedList().forEach((w, i) => {
    grid.appendChild(tplCard(`saved-${i}`, w.name, tr('wfMine'), w.steps, () => {
      const list = savedList();
      list.splice(i, 1);
      store.save('wf-saved', list);
      if (chosen === `saved-${i}`) chosen = null;
      renderTemplates();
    }));
  });
  grid.appendChild(tplCard('blank', tr('wfBlank'), tr('wfBlankDesc'), []));
}

/* ---------- Files ---------- */

function addFiles(list) {
  const ok = list.filter((f) => isPdfFile(f) || isImage(f));
  for (const f of ok) files.push({ id: nextId++, file: f });
  setStatus(ok.length < list.length ? tr('wfSkipped', { n: list.length - ok.length }) : '');
  renderFiles();
}

function smallButton(label, text, onClick, disabled = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn';
  b.textContent = text;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function renderFiles() {
  const ol = $('#fileList');
  ol.textContent = '';
  files.forEach((f, i) => {
    const li = document.createElement('li');
    const kind = document.createElement('span');
    kind.className = `wf-kind ${isPdfFile(f.file) ? 'pdf' : 'img'}`;
    kind.textContent = isPdfFile(f.file) ? 'PDF' : tr('wfImage');
    const name = document.createElement('span');
    name.className = 'wf-fname';
    name.textContent = f.file.name;
    const size = document.createElement('small');
    size.textContent = formatSize(f.file.size);
    const tools = document.createElement('span');
    tools.className = 'wf-tools';
    tools.append(
      smallButton(`${tr('wfUp')}: ${f.file.name}`, '▲', () => { moveItem(files, i, i - 1); renderFiles(); }, i === 0),
      smallButton(`${tr('wfDown')}: ${f.file.name}`, '▼', () => { moveItem(files, i, i + 1); renderFiles(); }, i === files.length - 1),
      smallButton(`${tr('wfRemove')}: ${f.file.name}`, '✕', () => { files = files.filter((x) => x !== f); renderFiles(); }),
    );
    li.append(kind, name, size, tools);
    ol.appendChild(li);
  });
  $('#fileCount').textContent = String(files.length);
  $('#builder').classList.toggle('has-files', files.length > 0);
  if (!$('#fileName').value && files.length) $('#fileName').value = `${safeName(files[0].file.name, 'dokumen')}-siap`;
}

/* ---------- Steps ---------- */

function field(labelKey, control) {
  const label = document.createElement('label');
  label.className = 'field';
  const span = document.createElement('span');
  span.textContent = tr(labelKey);
  label.append(span, control);
  return label;
}

function select(value, options, onChange) {
  const s = document.createElement('select');
  for (const [v, text] of options) s.appendChild(new Option(text, String(v), false, String(v) === String(value)));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function input(type, value, onInput, attrs = {}) {
  const el = document.createElement('input');
  el.type = type;
  el.value = value ?? '';
  Object.assign(el, attrs);
  el.addEventListener('input', () => onInput(el.value));
  return el;
}

function check(labelKey, checked, onChange) {
  const label = document.createElement('label');
  label.className = 'check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !!checked;
  box.addEventListener('change', () => onChange(box.checked));
  const span = document.createElement('span');
  span.textContent = tr(labelKey);
  label.append(box, span);
  return label;
}

/** The settings form for one step. */
function stepForm(step) {
  const o = step.opts;
  const set = (k) => (v) => { o[k] = v; saveCurrent(); };
  const wrap = document.createElement('div');
  wrap.className = 'wf-form';
  const opts = (prefix, keys) => keys.map((k) => [k, tr(`${prefix}${k}`)]);
  switch (step.type) {
    case 'palang':
      wrap.append(
        field('wfWho', input('text', o.who, set('who'), { maxLength: 40, placeholder: tr('wfWhoPh') })),
        field('wfStampLang', select(o.lang, [['ms', 'BM — UNTUK KEGUNAAN … SAHAJA'], ['en', 'EN — FOR … USE ONLY']], set('lang'))),
        field('wfCorner', select(o.corner, opts('wfCorner_', ['tl', 'tr', 'bl', 'br']), set('corner'))),
        field('wfColor', select(o.color, opts('wfColor_', ['black', 'red', 'blue']), set('color'))),
        check('wfAddDate', o.date, set('date')),
      );
      break;
    case 'place': {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = tr('wfPlaceNote');
      wrap.append(p);
      break;
    }
    case 'watermark':
      wrap.append(
        field('wfText', input('text', o.text, set('text'), { maxLength: 40 })),
        field('wfLayout', select(o.layout, opts('wfLayout_', ['center', 'tile']), set('layout'))),
        field('wfColor', select(o.color, opts('wfColor_', ['red', 'black', 'blue', 'gray']), set('color'))),
        field('wfOpacity', select(o.opacity, [15, 30, 50, 70].map((n) => [n, `${n}%`]), (v) => set('opacity')(Number(v)))),
      );
      break;
    case 'pagenum':
      wrap.append(
        field('wfPos', select(o.pos, opts('wfPos_', ['bc', 'br', 'bl', 'tc', 'tr', 'tl']), set('pos'))),
        field('wfFormat', select(o.format, [['n', '1, 2, 3'], ['nOfTotal', '1 / 10']], set('format'))),
      );
      break;
    case 'rotate':
      wrap.append(field('wfDeg', select(o.deg, [[90, '90° ⟳'], [180, '180°'], [270, '90° ⟲']], (v) => set('deg')(Number(v)))));
      break;
    case 'compress':
      wrap.append(
        field('wfLevel', select(o.level, opts('wfLevel_', ['light', 'medium', 'strong']), set('level'))),
        field('wfLimit', select(o.limit, [[0, tr('wfNoLimit')], [1048576, '≤ 1 MB'], [2097152, '≤ 2 MB'], [5242880, '≤ 5 MB']], (v) => set('limit')(Number(v)))),
      );
      break;
    case 'protect': {
      const pw = input('password', o.password, set('password'), { maxLength: 64, autocomplete: 'new-password', className: 'wf-pw' });
      wrap.append(
        field('wfPassword', pw),
        check('wfAllowPrint', o.print, set('print')),
        check('wfAllowCopy', o.copy, set('copy')),
      );
      break;
    }
    default:
  }
  return wrap;
}

function renderSteps() {
  const ol = $('#stepList');
  ol.textContent = '';
  steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'wf-step';
    li.dataset.type = s.type;
    const head = document.createElement('div');
    head.className = 'wf-step-head';
    const no = document.createElement('span');
    no.className = 'step-no';
    no.textContent = String(i + 1);
    const title = document.createElement('strong');
    title.textContent = tr(`wfStep_${s.type}`);
    const tools = document.createElement('span');
    tools.className = 'wf-tools';
    const pinned = s.type === 'palang' || s.type === 'protect';
    const movable = (to) => !pinned && to >= 0 && to < steps.length && steps[to].type !== 'palang' && steps[to].type !== 'protect';
    tools.append(
      smallButton(`${tr('wfUp')}: ${title.textContent}`, '▲', () => { moveItem(steps, i, i - 1); saveCurrent(); renderSteps(); }, !movable(i - 1)),
      smallButton(`${tr('wfDown')}: ${title.textContent}`, '▼', () => { moveItem(steps, i, i + 1); saveCurrent(); renderSteps(); }, !movable(i + 1)),
      smallButton(`${tr('wfRemove')}: ${title.textContent}`, '✕', () => { steps = steps.filter((x) => x !== s); saveCurrent(); renderSteps(); }),
    );
    head.append(no, title, tools);
    li.appendChild(head);
    if (pinned) {
      const note = document.createElement('p');
      note.className = 'wf-pin';
      note.textContent = tr(s.type === 'palang' ? 'wfPinnedFirst' : 'wfPinnedLast');
      li.appendChild(note);
    }
    li.appendChild(stepForm(s));
    ol.appendChild(li);
  });
  $('#noSteps').hidden = steps.length > 0;
  const sel = $('#addType');
  const keep = sel.value;
  sel.textContent = '';
  for (const type of STEP_TYPES) {
    // Palang and Protect make sense once per workflow.
    const used = (type === 'palang' || type === 'protect') && steps.some((s) => s.type === type);
    if (!used) sel.appendChild(new Option(tr(`wfStep_${type}`), type));
  }
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
}

function renderAll() {
  renderTemplates();
  renderFiles();
  renderSteps();
  if (!$('#runner').hidden) syncPlace();
}

/* ---------- Running ---------- */

function progressItems(list) {
  const ol = $('#progressList');
  ol.textContent = '';
  const labels = [tr('wfInput'), ...list.filter((s) => s.type !== 'palang').map((s) => tr(`wfStep_${s.type}`))];
  if (list.some((s) => s.type === 'palang')) labels[0] = `${tr('wfStep_palang')} + ${tr('wfInput')}`;
  return labels.map((text) => {
    const li = document.createElement('li');
    const mark = document.createElement('span');
    mark.className = 'wf-mark';
    const label = document.createElement('span');
    label.textContent = text;
    const info = document.createElement('small');
    li.append(mark, label, info);
    ol.appendChild(li);
    return { li, info };
  });
}

const setState = (item, state, info = '') => {
  item.li.dataset.state = state;
  item.info.textContent = info;
};

function syncPlace() {
  $('#activeLabel').textContent = placer.views.length ? tr('sigActivePage', { n: placer.active + 1 }) : '';
  placer.views.forEach((v, i) => { v.el.querySelector('.sign-page-no').textContent = tr('sigPage', { n: i + 1 }); });
}

let placeResolve = null;

/** Interactive step: let the user place items, resolve with the new bytes. */
async function placeStep(bytes, token) {
  const doc = await openForRender(bytes);
  try {
    $('#runner').classList.add('placing');
    $('#placeArea').hidden = false;
    $('#placePanel').hidden = false;
    placer.setViews(await renderPages($('#signPages'), doc, { label: (n) => tr('sigPage', { n }) }));
    syncPlace();
    const go = await new Promise((resolve) => { placeResolve = resolve; });
    if (!go || token !== runToken) throw new Error('cancelled');
    if (!placer.items.length) return bytes;
    const L = await loadPdfLib();
    const pdf = await L.PDFDocument.load(bytes, { updateMetadata: false });
    await placer.drawInto(L, pdf);
    return pdf.save();
  } finally {
    placeResolve = null;
    placer.setViews([]);
    $('#signPages').textContent = '';
    $('#placeArea').hidden = true;
    $('#placePanel').hidden = true;
    $('#runner').classList.remove('placing');
    doc.destroy();
  }
}

function errorText(err) {
  const m = err && err.message;
  if (m === 'encrypted') return tr('wfEncrypted', { name: err.file || '' });
  if (m === 'pdf') return `${err.file}: ${tr('pdfOpenError')}`;
  if (m === 'nopassword') return tr('wfNeedPassword');
  return tr('pdfOpenError');
}

/** Run the whole workflow. Resolves when finished (or cancelled). */
export async function run() {
  if (!files.length) { setStatus(tr('wfNeedFiles')); return; }
  steps = normalize(steps);
  const prot = steps.find((s) => s.type === 'protect');
  if (prot && !prot.opts.password) { setStatus(tr('wfNeedPassword')); renderSteps(); $('.wf-pw').focus(); return; }
  const palang = steps.find((s) => s.type === 'palang');
  if (palang && !files.some((f) => isImage(f.file))) { setStatus(tr('wfPalangNoImage')); return; }
  setStatus('');
  const token = ++runToken;
  result = null;
  $('#builder').hidden = true;
  $('.wf-pick').hidden = true;
  $('#runner').hidden = false;
  $('#resultArea').hidden = true;
  $('#runTitle').textContent = tr('wfRunning');
  setStatus2('');
  window.scrollTo({ top: 0 });
  const plan = steps.filter((s) => s.type !== 'palang');
  const items = progressItems(steps);
  let current = items[0];
  try {
    setState(current, 'run');
    let bytes = await buildInput(files.map((f) => f.file), palang ? palang.opts : null);
    if (token !== runToken) return;
    setState(current, 'done', formatSize(bytes.length));
    for (let i = 0; i < plan.length; i++) {
      current = items[i + 1];
      setState(current, 'run');
      if (plan[i].type === 'place') {
        setState(current, 'wait', tr('wfWaiting'));
        bytes = await placeStep(bytes, token);
      } else {
        bytes = await runStep(plan[i], bytes, (f) => setState(current, 'run', `${Math.round(f * 100)}%`));
      }
      if (token !== runToken) return;
      setState(current, 'done', formatSize(bytes.length));
    }
    const name = safeName($('#fileName').value, 'dokumen-siap');
    result = new File([bytes], `${name}.pdf`, { type: 'application/pdf' });
    const doc = await openForRender(bytes).catch(() => null);
    const pages = doc ? doc.numPages : null;
    if (doc) doc.destroy();
    $('#runTitle').textContent = tr('wfDone');
    $('#resultMeta').textContent = pages ? tr('wfResult', { pages, size: formatSize(result.size) }) : formatSize(result.size);
    $('#resultArea').hidden = false;
  } catch (err) {
    if (token !== runToken || (err && err.message === 'cancelled')) return;
    setState(current, 'fail');
    setStatus2(errorText(err));
  }
}

function backToBuilder() {
  runToken++;
  if (placeResolve) placeResolve(false);
  $('#runner').hidden = true;
  $('#builder').hidden = false;
  $('.wf-pick').hidden = false;
  renderAll();
}

/* ---------- Boot ---------- */

$('#addStep').addEventListener('click', () => {
  const type = $('#addType').value;
  if (!type) return;
  steps.push({ id: nextId++, type, opts: clone(DEFAULTS[type]) });
  steps = normalize(steps);
  chosen = null;
  saveCurrent();
  renderAll();
});
$('#saveWf').addEventListener('click', () => {
  const name = $('#wfName').value.trim();
  if (!name) { $('#wfName').focus(); return; }
  const list = savedList().filter((w) => w.name !== name);
  list.push({ name, steps: strip(steps) });
  store.save('wf-saved', list);
  chosen = `saved-${list.length - 1}`;
  saveCurrent();
  setStatus(tr('wfSaved', { name }));
  renderTemplates();
});
$('#runWf').addEventListener('click', run);
$('#backToBuilder').addEventListener('click', backToBuilder);
$('#placeNext').addEventListener('click', () => { if (placeResolve) placeResolve(true); });
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); });
$('#savePdf').addEventListener('click', () => { if (result) download(result); });
$('#sharePdf').addEventListener('click', async () => {
  if (result && (await shareOrDownload(result)) === 'downloaded') setStatus2(tr('shareFallback'));
});

// Placement tools for the date / signature / text step.
$('#dateValue').value = isoDate();
const place = (canvas, widthFrac) => {
  if (!placer.views.length || !canvas) return;
  setStatus2('');
  placer.add(canvas, widthFrac, { allPages: $('#allPages').checked });
};
$('#addSig').addEventListener('click', () => {
  const sig = maker.current();
  if (!sig) { setStatus2(tr('sigEmptyPad')); return; }
  place(sig, 0.28);
});
$('#addDate').addEventListener('click', () => {
  const d = toDMY($('#dateValue').value);
  if (!d) { $('#dateValue').focus(); return; }
  place(textCanvas(d, undefined, maker.ink()), 0.2);
});
$('#addText').addEventListener('click', () => {
  const text = $('#extraText').value.trim();
  if (!text) { $('#extraText').focus(); return; }
  place(textCanvas(text, undefined, maker.ink()), Math.min(0.6, 0.022 * text.length + 0.06));
});
bindFileDrop($('#dropzone'), addFiles);

const last = store.load('wf-current', null);
if (last && Array.isArray(last.steps)) setSteps(last.steps, last.chosen);
else setSteps(TEMPLATES_WF[0].steps, TEMPLATES_WF[0].id);
ready = true;
renderAll();

// Exposed for the automated test only.
window.__wf = {
  run, addFiles, setSteps, backToBuilder,
  get steps() { return steps; }, get files() { return files; }, get result() { return result; },
  get items() { return placer.items; }, get views() { return placer.views; }, setActive: (i) => placer.setActive(i),
};
