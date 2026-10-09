// Fill PDF forms: puts real inputs over the PDF's own form fields (text,
// checkbox, radio, dropdown), then writes the values with pdf-lib.
// Optionally flattens the form. Runs in this tab; nothing is uploaded.
import { initPage } from './page.js';
import { t } from './i18n.js';
import { loadPdfLib, formatSize, safeName, download, shareOrDownload, openErrorKey } from './pdf-kit.js';
import { openPdfs, bindFileDrop } from './pdf-pages.js';
import { renderPages, placeFrac } from './page-viewer.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let src = null;
let views = [];
/** @type {{name:string, type:string, inputs:HTMLElement[], options?:string[]}[]} */
let fields = [];
let ready = false;

const page = initPage(() => { if (ready) sync(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };
const latin1 = (s) => s.replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?');

/** Which page (0-based) holds this widget. */
function pageOfWidget(doc, widget) {
  const pages = doc.getPages();
  const p = widget.P();
  if (p) {
    const i = pages.findIndex((pg) => pg.ref === p || String(pg.ref) === String(p));
    if (i >= 0) return i;
  }
  const ref = doc.context.getObjectRef(widget.dict);
  return pages.findIndex((pg) => {
    const annots = pg.node.Annots();
    return annots && annots.asArray().some((a) => String(a) === String(ref));
  });
}

function typeOf(PDFLib, f) {
  if (f instanceof PDFLib.PDFTextField) return 'text';
  if (f instanceof PDFLib.PDFCheckBox) return 'checkbox';
  if (f instanceof PDFLib.PDFRadioGroup) return 'radio';
  if (f instanceof PDFLib.PDFDropdown) return 'dropdown';
  if (f instanceof PDFLib.PDFOptionList) return 'list';
  return null;
}

async function buildOverlay() {
  const PDFLib = await loadPdfLib();
  const doc = await PDFLib.PDFDocument.load(src.bytes, { updateMetadata: false });
  const form = doc.getForm();
  fields = [];
  for (const f of form.getFields()) {
    const type = typeOf(PDFLib, f);
    if (!type) continue;
    const name = f.getName();
    const entry = { name, type, inputs: [] };
    const widgets = f.acroField.getWidgets();
    const options = type === 'radio' || type === 'dropdown' || type === 'list' ? f.getOptions() : null;
    entry.options = options;
    widgets.forEach((w, wi) => {
      const pi = pageOfWidget(doc, w);
      const view = views[pi];
      if (!view) return;
      const r = w.getRectangle();
      const [x1, y1, x2, y2] = view.vp.convertToViewportRectangle([r.x, r.y, r.x + r.width, r.y + r.height]);
      const box = {
        x: Math.min(x1, x2) / view.vp.width, y: Math.min(y1, y2) / view.vp.height,
        w: Math.abs(x2 - x1) / view.vp.width, h: Math.abs(y2 - y1) / view.vp.height,
      };
      let el;
      if (type === 'text') {
        const multi = f.isMultiline();
        el = document.createElement(multi ? 'textarea' : 'input');
        if (!multi) el.type = 'text';
        el.value = f.getText() || '';
        const max = f.getMaxLength();
        if (max) el.maxLength = max;
      } else if (type === 'checkbox') {
        el = document.createElement('input');
        el.type = 'checkbox';
        el.checked = f.isChecked();
      } else if (type === 'radio') {
        el = document.createElement('input');
        el.type = 'radio';
        el.name = `radio-${name}`;
        el.value = options[wi] ?? String(wi);
        el.checked = f.getSelected() === el.value;
      } else {
        el = document.createElement('select');
        if (type === 'list') el.multiple = true;
        if (type === 'dropdown') el.appendChild(new Option('', ''));
        const sel = f.getSelected();
        for (const o of options) el.appendChild(new Option(o, o, false, sel.includes(o)));
      }
      el.className = `form-input form-${type}`;
      el.title = name;
      el.setAttribute('aria-label', name);
      if (type === 'text' || type === 'dropdown' || type === 'list') {
        // Size the text to the field like the PDF would.
        el.style.fontSize = `${Math.max(9, Math.min(16, box.h * view.el.clientHeight * 0.62))}px`;
      }
      view.el.appendChild(el);
      placeFrac(el, box);
      entry.inputs.push(el);
    });
    if (entry.inputs.length) fields.push(entry);
  }
}

/** Write the entered values into the PDF (optionally flattened). */
export async function buildOutput() {
  const PDFLib = await loadPdfLib();
  const doc = await PDFLib.PDFDocument.load(src.bytes, { updateMetadata: false });
  const form = doc.getForm();
  for (const fe of fields) {
    const f = form.getField(fe.name);
    if (fe.type === 'text') f.setText(latin1(fe.inputs[0].value) || undefined);
    else if (fe.type === 'checkbox') { if (fe.inputs[0].checked) f.check(); else f.uncheck(); }
    else if (fe.type === 'radio') {
      const on = fe.inputs.find((i) => i.checked);
      if (on) f.select(on.value); else f.clear();
    } else if (fe.type === 'dropdown') {
      const v = fe.inputs[0].value;
      if (v) f.select(v); else f.clear();
    } else if (fe.type === 'list') {
      const vals = [...fe.inputs[0].selectedOptions].map((o) => o.value);
      if (vals.length) f.select(vals); else f.clear();
    }
  }
  if ($('#flatten').checked) form.flatten();
  const bytes = await doc.save();
  return new File([bytes], `${safeName($('#fileName').value, 'borang')}.pdf`, { type: 'application/pdf' });
}

function sync() {
  $('#toolLayout').classList.toggle('is-empty', !src);
  if (src) {
    $('#docTitle').textContent = src.name;
    $('#docMeta').textContent = `${tr('pdfPagesN', { n: src.pages })} · ${formatSize(src.bytes.length)}`;
  }
  $('#fieldCount').textContent = src ? (fields.length ? tr('formFields', { n: fields.length }) : '') : '';
  $('#noFields').hidden = !src || fields.length > 0;
  $('#savePdf').disabled = !fields.length;
  $('#sharePdf').disabled = !fields.length;
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
  fields = [];
  $('#fileName').value = `${safeName(src.name, 'borang')}-diisi`;
  sync();
  views = await renderPages($('#formPages'), src.doc, { label: (n) => tr('sigPage', { n }) });
  try {
    await buildOverlay();
  } catch (err) {
    setStatus(tr(openErrorKey(err)));
  }
  setStatus('');
  sync();
}

let busy = false;
async function exportPdf(share) {
  if (busy || !fields.length) return;
  busy = true;
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
  }
}

$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; openFile(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
$('#savePdf').addEventListener('click', () => exportPdf(false));
$('#sharePdf').addEventListener('click', () => exportPdf(true));
bindFileDrop($('#dropzone'), openFile);
ready = true;
sync();

// Exposed for the automated test only.
window.__forms = { openFile, buildOutput, get fields() { return fields; } };
