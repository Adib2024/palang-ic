// Shared building blocks for the page-based PDF tools (merge, split,
// organise, rotate...): loading PDFs, thumbnail rendering, page cards,
// drag-to-reorder, file drop, and rebuilding PDFs from pages with pdf-lib.
import { loadPdfLib, openForRender, renderPage, isPdf } from './pdf-kit.js';

// Distinct, readable hues for telling source files apart.
const HUES = [152, 222, 28, 330, 262, 190, 4, 88];
let nextId = 1;
export const newId = () => nextId++;

/**
 * Open PDFs for rendering.
 * @returns {Promise<{sources: {id:number,name:string,bytes:Uint8Array,doc:any,pages:number,hue:number}[], failed: {name:string, err:any}[], skipped: number}>}
 */
export async function openPdfs(fileList, startIndex = 0) {
  const files = [...fileList];
  const sources = [];
  const failed = [];
  let k = startIndex;
  for (const file of files.filter(isPdf)) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await openForRender(bytes);
      sources.push({ id: newId(), name: file.name, bytes, doc, pages: doc.numPages, hue: HUES[k++ % HUES.length] });
    } catch (err) {
      failed.push({ name: file.name, err });
    }
  }
  return { sources, failed, skipped: files.filter((f) => !isPdf(f)).length };
}

/**
 * Renders thumbnails one at a time so big documents don't freeze the tab.
 * `render(doc, index, rotation)` resolves to an object URL ('' on failure).
 */
export function createThumbQueue(width = 220) {
  let queue = Promise.resolve();
  const render = async (doc, index, rotation = 0) => {
    const pg = await doc.getPage(index + 1);
    const vp = pg.getViewport({ scale: 1, rotation: (pg.rotate + rotation) % 360 });
    const canvas = await renderPage(pg, width / vp.width, rotation);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : ''), 'image/jpeg', 0.8));
  };
  return {
    /** Queue a render; `done(url)` is called when ready. */
    add(doc, index, rotation, done) {
      queue = queue.then(() => render(doc, index, rotation).catch(() => '')).then(done);
      return queue;
    },
    idle: () => queue,
  };
}

/** Small icon button used on cards. */
export function iconButton(label, text, onClick, { disabled = false, danger = false } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `icon-btn${danger ? ' danger' : ''}`;
  b.textContent = text;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

/**
 * A page/file card for the grid.
 * @param {{index:number, thumb:string, number:string, title?:string, hue?:number,
 *          selected?:boolean, onToggle?:() => void, selectLabel?:string,
 *          tools?:HTMLElement[], caption?:string, draggable?:boolean}} o
 */
export function card(o) {
  const li = document.createElement('li');
  li.className = `page-card${o.selected ? ' selected' : ''}`;
  li.dataset.index = String(o.index);
  li.draggable = !!o.draggable;
  if (o.hue != null) li.style.setProperty('--hue', o.hue);
  if (o.onToggle) {
    const sel = document.createElement('input');
    sel.type = 'checkbox';
    sel.className = 'page-select';
    sel.checked = !!o.selected;
    sel.setAttribute('aria-label', o.selectLabel || '');
    sel.addEventListener('change', o.onToggle);
    li.appendChild(sel);
  }
  const thumb = document.createElement(o.onToggle ? 'button' : 'div');
  thumb.className = 'page-thumb';
  if (o.onToggle) {
    thumb.type = 'button';
    thumb.setAttribute('aria-label', o.selectLabel || '');
    thumb.addEventListener('click', o.onToggle);
  }
  const img = document.createElement('img');
  img.alt = '';
  if (o.thumb) img.src = o.thumb;
  thumb.appendChild(img);
  li.appendChild(thumb);
  if (o.caption) {
    const cap = document.createElement('span');
    cap.className = 'card-caption';
    cap.textContent = o.caption;
    cap.title = o.caption;
    li.appendChild(cap);
  }
  const meta = document.createElement('div');
  meta.className = 'page-meta';
  const no = document.createElement('span');
  no.className = 'page-no';
  no.textContent = o.number;
  if (o.title) no.title = o.title;
  const tools = document.createElement('span');
  tools.className = 'page-tools';
  (o.tools || []).forEach((t) => tools.appendChild(t));
  meta.append(no, tools);
  li.appendChild(meta);
  return li;
}

/** Desktop drag-and-drop reordering of `.page-card`s inside `grid`. */
export function bindReorder(grid, move, getLength) {
  let from = -1;
  const cardOf = (e) => e.target.closest && e.target.closest('.page-card');
  const clear = () => grid.querySelectorAll('.page-card').forEach((c) => c.classList.remove('dragging', 'drop-target'));
  grid.addEventListener('dragstart', (e) => {
    const c = cardOf(e);
    if (!c) return;
    from = Number(c.dataset.index);
    c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(from));
  });
  grid.addEventListener('dragover', (e) => {
    if (from < 0) return;
    e.preventDefault();
    grid.querySelectorAll('.drop-target').forEach((c) => c.classList.remove('drop-target'));
    const c = cardOf(e);
    if (c) c.classList.add('drop-target');
  });
  grid.addEventListener('drop', (e) => {
    if (from < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const c = cardOf(e);
    const to = c ? Number(c.dataset.index) : getLength() - 1;
    const f = from;
    from = -1;
    clear();
    move(f, to);
  });
  grid.addEventListener('dragend', () => { from = -1; clear(); });
}

/** Dropping files anywhere on the page calls `onFiles(files)`. */
export function bindFileDrop(zone, onFiles) {
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
    onFiles([...e.dataTransfer.files]);
  });
}

/** Move an array item in place. Returns true if anything moved. */
export function moveItem(arr, from, to) {
  if (to < 0 || to >= arr.length || from === to) return false;
  const [x] = arr.splice(from, 1);
  arr.splice(to, 0, x);
  return true;
}

/** Parse "1-3, 5, 7-9" into 0-based index groups (max = page count); null if invalid. */
export function parseRanges(text, max) {
  const groups = [];
  for (const part of String(text).split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) {
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

/**
 * Build a PDF from pages of loaded sources.
 * @param {{src:number, index:number, rotation?:number}[]} list
 * @param {Map<number, Uint8Array>} bytesById source id -> PDF bytes
 * @param {Map<number, any>} [cache] reuse parsed pdf-lib docs across calls
 */
export async function buildFromPages(list, bytesById, cache = new Map()) {
  const PDFLib = await loadPdfLib();
  const out = await PDFLib.PDFDocument.create();
  for (const p of list) {
    let doc = cache.get(p.src);
    if (!doc) {
      doc = await PDFLib.PDFDocument.load(bytesById.get(p.src), { updateMetadata: false });
      cache.set(p.src, doc);
    }
    const [copy] = await out.copyPages(doc, [p.index]);
    if (p.rotation) copy.setRotation(PDFLib.degrees((copy.getRotation().angle + p.rotation) % 360));
    out.addPage(copy);
  }
  return out.save();
}

/**
 * Map a point given in on-screen page coordinates (origin top-left, page as
 * displayed after its /Rotate) to PDF user space for a pdf-lib page.
 * Returns the point plus the angle (degrees, counter-clockwise) to rotate
 * drawings by so they appear upright on screen.
 */
export function displayToUser(pdfLibPage, u, v) {
  const { x: x0, y: y0, width: W, height: H } = pdfLibPage.getMediaBox();
  const r = ((pdfLibPage.getRotation().angle % 360) + 360) % 360;
  let x;
  let y;
  if (r === 90) { x = v; y = u; }
  else if (r === 180) { x = W - u; y = v; }
  else if (r === 270) { x = W - v; y = H - u; }
  else { x = u; y = H - v; }
  return { x: x0 + x, y: y0 + y, angle: r };
}

/** Size of a pdf-lib page as displayed (after /Rotate). */
export function displaySize(pdfLibPage) {
  const { width, height } = pdfLibPage.getMediaBox();
  const r = ((pdfLibPage.getRotation().angle % 360) + 360) % 360;
  return r === 90 || r === 270 ? { width: height, height: width } : { width, height };
}

/**
 * Live preview of an edit: copies page `index` of `bytes` into a one-page
 * PDF, lets `apply(doc, page, PDFLib)` modify it, renders the result into
 * `canvas` at `cssWidth`. Calls are debounced; only the latest one renders.
 */
export function createPreview(canvas) {
  let token = 0;
  let timer = 0;
  return function update(bytes, index, apply, cssWidth, delay = 200) {
    clearTimeout(timer);
    const my = ++token;
    timer = setTimeout(async () => {
      try {
        const PDFLib = await loadPdfLib();
        const src = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
        const doc = await PDFLib.PDFDocument.create();
        const [p] = await doc.copyPages(src, [index]);
        doc.addPage(p);
        await apply(doc, p, PDFLib);
        const out = await doc.save();
        if (my !== token) return;
        const rdoc = await openForRender(out);
        const pg = await rdoc.getPage(1);
        const vp = pg.getViewport({ scale: 1 });
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const rendered = await renderPage(pg, (cssWidth * dpr) / vp.width);
        rdoc.destroy();
        if (my !== token) return;
        canvas.width = rendered.width;
        canvas.height = rendered.height;
        canvas.getContext('2d').drawImage(rendered, 0, 0);
        canvas.dispatchEvent(new Event('rendered'));
      } catch {
        /* keep the previous preview */
      }
    }, delay);
  };
}
