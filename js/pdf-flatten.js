// Flatten a PDF: form fields and comments/stamps become part of the page so
// they can't be edited or removed any more. Optionally every page becomes a
// picture (strongest: nothing left to edit or copy). Pure pdf-lib / pdf.js.
import { loadPdfLib, openForRender, renderPage } from './pdf-kit.js';

const isDict = (o) => o && typeof o.entries === 'function' && typeof o.set === 'function';
const isArray = (o) => o && typeof o.asArray === 'function';
const nums = (a) => (isArray(a) ? a.asArray().map((n) => (typeof n.asNumber === 'function' ? n.asNumber() : Number(n))) : null);
const SKIP = new Set(['/Link', '/Popup', '/Widget']);

async function open(bytes) {
  const L = await loadPdfLib();
  try {
    return { L, doc: await L.PDFDocument.load(bytes, { updateMetadata: false }) };
  } catch (err) {
    if (err && /encrypt/i.test(`${err.name} ${err.message}`)) throw new Error('encrypted');
    throw err;
  }
}

/** How many form fields and comments/stamps the PDF has. */
export async function countFlattenable(bytes) {
  const { L, doc } = await open(bytes);
  const N = (n) => L.PDFName.of(n);
  let fields = 0;
  try { fields = doc.getForm().getFields().length; } catch { /* no form */ }
  let annots = 0;
  for (const p of doc.getPages()) {
    const list = p.node.lookup(N('Annots'));
    if (!isArray(list)) continue;
    for (const ref of list.asArray()) {
      const a = doc.context.lookup(ref);
      if (isDict(a) && !SKIP.has(String(a.lookup(N('Subtype'))))) annots++;
    }
  }
  return { fields, annots, pages: doc.getPageCount() };
}

/** Bounding box of `bbox` after `matrix`. */
function transformBox([x0, y0, x1, y1], m) {
  const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Draw each comment/stamp's appearance into its page, then remove it. */
function flattenAnnots(L, doc, { comments = true, dropWidgets = false } = {}) {
  const N = (n) => L.PDFName.of(n);
  const ctx = doc.context;
  let done = 0;
  for (const page of doc.getPages()) {
    const node = page.node;
    const list = node.lookup(N('Annots'));
    if (!isArray(list)) continue;
    const keep = [];
    const ops = [];
    for (const ref of list.asArray()) {
      const a = ctx.lookup(ref);
      if (!a) continue; // points at a deleted object (e.g. a flattened field's widget)
      const sub = isDict(a) ? String(a.lookup(N('Subtype'))) : '';
      // Widgets of fields that flattening already drew into the page.
      if (dropWidgets && sub === '/Widget') continue;
      if (!isDict(a) || !comments || SKIP.has(sub)) { keep.push(ref); continue; }
      const flags = a.lookup(N('F'));
      const hidden = flags && (flags.asNumber() & 2); // Hidden
      let ap = a.lookup(N('AP'));
      let normal = isDict(ap) ? ap.get(N('N')) : null;
      let stream = normal && ctx.lookup(normal);
      if (stream && !stream.dict && isDict(stream)) {
        // Several states: use the current one (/AS).
        const as = a.lookup(N('AS'));
        normal = as ? stream.get(as) : null;
        stream = normal && ctx.lookup(normal);
      }
      const rect = nums(a.lookup(N('Rect')));
      if (!hidden && stream && stream.dict && rect) {
        const bbox = nums(stream.dict.lookup(N('BBox'))) || [0, 0, 1, 1];
        const matrix = nums(stream.dict.lookup(N('Matrix'))) || [1, 0, 0, 1, 0, 0];
        const [bx0, by0, bx1, by1] = transformBox(bbox, matrix);
        const [rx0, ry0, rx1, ry1] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
        const sx = bx1 > bx0 ? (rx1 - rx0) / (bx1 - bx0) : 1;
        const sy = by1 > by0 ? (ry1 - ry0) / (by1 - by0) : 1;
        if (!stream.dict.get(N('Subtype'))) stream.dict.set(N('Subtype'), N('Form'));
        if (!stream.dict.get(N('Type'))) stream.dict.set(N('Type'), N('XObject'));
        const name = node.newXObject('Flat', normal);
        ops.push(
          L.pushGraphicsState(),
          L.concatTransformationMatrix(sx, 0, 0, sy, rx0 - bx0 * sx, ry0 - by0 * sy),
          L.drawObject(name),
          L.popGraphicsState(),
        );
      }
      done++;
    }
    if (ops.length) {
      // Keep the page's own graphics state from leaking into ours.
      const q = ctx.register(ctx.contentStream([L.pushGraphicsState()]));
      const Q = ctx.register(ctx.contentStream([L.popGraphicsState()]));
      node.wrapContentStreams(q, Q);
      page.pushOperators(...ops);
    }
    node.set(N('Annots'), ctx.obj(keep));
  }
  return done;
}

/**
 * @param {{form?: boolean, annots?: boolean, image?: boolean, dpi?: number}} opts
 * @returns {Promise<Uint8Array>}
 */
export async function flattenPdf(bytes, opts = {}) {
  const o = { form: true, annots: true, image: false, dpi: 150, ...opts };
  const { L, doc } = await open(bytes);
  let flattened = false;
  if (o.form || o.image) {
    try {
      const form = doc.getForm();
      if (form.getFields().length) {
        try { form.updateFieldAppearances(); } catch { /* keep existing appearances */ }
        form.flatten();
        flattened = true;
      }
    } catch { /* no form */ }
  }
  flattenAnnots(L, doc, { comments: o.annots || o.image, dropWidgets: flattened });
  const flat = await doc.save({ updateFieldAppearances: false });
  if (!o.image) return flat;

  // Every page as a picture, at its displayed size.
  const pdf = await openForRender(flat);
  const out = await L.PDFDocument.create();
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const pg = await pdf.getPage(i);
      const vp = pg.getViewport({ scale: 1 });
      const canvas = await renderPage(pg, o.dpi / 72);
      const jpg = await new Promise((r) => canvas.toBlob(async (b) => r(new Uint8Array(await b.arrayBuffer())), 'image/jpeg', 0.9));
      canvas.width = canvas.height = 0;
      const img = await out.embedJpg(jpg);
      out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
      pg.cleanup();
    }
  } finally {
    pdf.destroy();
  }
  return out.save();
}
