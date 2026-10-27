// Find and remove hidden information in a PDF: the document info (title,
// author, software, dates), XMP metadata, document ID, embedded files,
// JavaScript and the author names on comments. Objects left unreferenced
// (e.g. older revisions of the info) are dropped too. Pure pdf-lib.
import { loadPdfLib } from './pdf-kit.js';

const INFO_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped'];

function text(obj) {
  if (!obj) return '';
  if (typeof obj.decodeText === 'function') {
    try { return obj.decodeText(); } catch { /* fall through */ }
  }
  if (typeof obj.asString === 'function') return obj.asString();
  return String(obj).replace(/^\//, '');
}

/** "D:20240131093000+08'00'" → "31/01/2024 09:30" */
export function pdfDate(s) {
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(s || '');
  if (!m) return s;
  const [, y, mo = '01', d = '01', h, mi] = m;
  return `${d}/${mo}/${y}${h ? ` ${h}:${mi || '00'}` : ''}`;
}

const isDict = (o) => o && typeof o.entries === 'function' && typeof o.set === 'function';
const isArray = (o) => o && typeof o.asArray === 'function';
const isRef = (o) => o && typeof o.objectNumber === 'number';
const dictOf = (o) => (isDict(o) ? o : o && isDict(o.dict) ? o.dict : null);

async function open(bytes) {
  const L = await loadPdfLib();
  try {
    const doc = await L.PDFDocument.load(bytes, { updateMetadata: false });
    return { L, doc };
  } catch (err) {
    if (err && /encrypt/i.test(`${err.name} ${err.message}`)) throw new Error('encrypted');
    throw err;
  }
}

function pages(doc) {
  return doc.getPages().map((p) => p.node);
}

function annots(L, node) {
  const a = node.lookup(L.PDFName.of('Annots'));
  return isArray(a) ? a.asArray().map((r) => node.context.lookup(r)).filter(isDict) : [];
}

/** What hidden information does this PDF carry? */
export async function readMeta(bytes) {
  const { L, doc } = await open(bytes);
  const N = (n) => L.PDFName.of(n);
  const ctx = doc.context;
  const info = [];
  const infoDict = ctx.lookup(ctx.trailerInfo.Info);
  if (isDict(infoDict)) {
    for (const [k, v] of infoDict.entries()) {
      const key = k.asString().slice(1);
      let value = text(ctx.lookup(v)).trim();
      if (/Date$/.test(key)) value = pdfDate(value);
      if (value) info.push({ key, value, known: INFO_KEYS.includes(key) });
    }
  }
  const cat = doc.catalog;
  const names = cat.lookup(N('Names'));
  let xmp = !!cat.get(N('Metadata'));
  let files = 0;
  const ef = isDict(names) ? names.lookup(N('EmbeddedFiles')) : null;
  if (isDict(ef)) {
    const arr = ef.lookup(N('Names'));
    if (isArray(arr)) files += Math.floor(arr.size() / 2);
    const kids = ef.lookup(N('Kids'));
    if (isArray(kids)) files += kids.size();
  }
  let js = !!(isDict(names) && names.get(N('JavaScript'))) || !!cat.get(N('OpenAction')) || !!cat.get(N('AA'));
  const authors = new Set();
  for (const node of pages(doc)) {
    if (node.get(N('Metadata'))) xmp = true;
    if (node.get(N('AA'))) js = true;
    for (const a of annots(L, node)) {
      const sub = a.lookup(N('Subtype'));
      if (sub === N('FileAttachment')) files++;
      if (sub !== N('Widget')) {
        const t = text(a.lookup(N('T'))).trim();
        if (t) authors.add(t);
      }
      if (a.get(N('AA'))) js = true;
      const act = a.lookup(N('A'));
      if (isDict(act) && act.lookup(N('S')) === N('JavaScript')) js = true;
    }
  }
  return { info, xmp, files, js, authors: [...authors], id: !!ctx.trailerInfo.ID, pages: doc.getPageCount() };
}

/** Drop every object no longer reachable from the trailer. */
function prune(ctx) {
  const seen = new Set();
  const stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter(Boolean);
  while (stack.length) {
    let o = stack.pop();
    if (isRef(o)) {
      const k = o.toString();
      if (seen.has(k)) continue;
      seen.add(k);
      o = ctx.lookup(o);
    }
    if (!o) continue;
    const d = dictOf(o);
    if (d) for (const [, v] of d.entries()) stack.push(v);
    if (isArray(o)) stack.push(...o.asArray());
  }
  let dropped = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref.toString())) { ctx.delete(ref); dropped++; }
  }
  return dropped;
}

/**
 * Remove hidden information.
 * @param {{info?: boolean, xmp?: boolean, files?: boolean, js?: boolean, authors?: boolean, title?: string}} opts
 * @returns {Promise<Uint8Array>}
 */
export async function cleanPdf(bytes, opts = {}) {
  const o = { info: true, xmp: true, files: true, js: true, authors: true, ...opts };
  const { L, doc } = await open(bytes);
  const N = (n) => L.PDFName.of(n);
  const ctx = doc.context;
  const cat = doc.catalog;
  if (o.info) {
    const infoDict = ctx.lookup(ctx.trailerInfo.Info);
    if (isDict(infoDict)) for (const [k] of infoDict.entries()) infoDict.delete(k);
    ctx.trailerInfo.ID = undefined;
    for (const d of [cat, ...pages(doc)]) { d.delete(N('PieceInfo')); d.delete(N('LastModified')); }
  }
  if (o.title && o.title.trim()) doc.setTitle(o.title.trim());
  if (o.xmp) {
    // XMP can sit on the catalog, pages, images and fonts.
    for (const [, obj] of ctx.enumerateIndirectObjects()) {
      const d = dictOf(obj);
      if (d && d.get(N('Metadata'))) d.delete(N('Metadata'));
    }
    cat.delete(N('Metadata'));
  }
  const names = cat.lookup(N('Names'));
  if (o.files) {
    if (isDict(names)) names.delete(N('EmbeddedFiles'));
    cat.delete(N('AF'));
  }
  if (o.js) {
    if (isDict(names)) names.delete(N('JavaScript'));
    cat.delete(N('OpenAction'));
    cat.delete(N('AA'));
  }
  for (const node of pages(doc)) {
    if (o.js) node.delete(N('AA'));
    const list = node.lookup(N('Annots'));
    if (!isArray(list)) continue;
    const keep = [];
    for (const ref of list.asArray()) {
      const a = ctx.lookup(ref);
      if (!isDict(a)) { keep.push(ref); continue; }
      const sub = a.lookup(N('Subtype'));
      if (o.files && sub === N('FileAttachment')) continue;
      if (o.js) {
        a.delete(N('AA'));
        const act = a.lookup(N('A'));
        if (isDict(act) && act.lookup(N('S')) === N('JavaScript')) a.delete(N('A'));
      }
      if (o.authors && sub !== N('Widget')) {
        // Comment author and timestamps (a form field's T is its name: keep it).
        a.delete(N('T'));
        a.delete(N('M'));
        a.delete(N('CreationDate'));
      }
      keep.push(ref);
    }
    node.set(N('Annots'), ctx.obj(keep));
  }
  if (isDict(names) && !names.entries().length) cat.delete(N('Names'));
  prune(ctx);
  // Plain objects (no object streams) so nothing hides in compressed blocks.
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}
