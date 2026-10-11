// OCR engine shared by the OCR PDF tool and workflows: tesseract.js (served by
// this site) recognises Malay/English text, which is laid over each page as an
// invisible text layer so the PDF can be searched and copied.
import { loadPdfLib, renderPage } from './pdf-kit.js';
import { displayToUser, displaySize } from './pdf-pages.js';
import { loadPhoto } from './image-loader.js';

const LONG_SIDE = 2400; // px of the longest page side given to the OCR engine
const VENDOR = new URL('../vendor/tesseract/', import.meta.url).href;

let tessPromise = null;
function loadTesseract() {
  if (!tessPromise) {
    tessPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${VENDOR}tesseract.min.js`;
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => { tessPromise = null; reject(new Error('engine')); };
      document.head.appendChild(s);
    });
  }
  return tessPromise;
}

/** A tesseract worker for `langs` (e.g. 'msa+eng'), loading everything from this site. */
export async function createOcrWorker(langs, logger = () => {}) {
  const T = await loadTesseract();
  return T.createWorker(langs, 1, {
    workerPath: `${VENDOR}worker.min.js`,
    corePath: `${VENDOR}core/`,
    langPath: `${VENDOR}lang`,
    workerBlobURL: false,
    gzip: true,
    cacheMethod: 'none',
    logger,
  });
}

/** Words with pixel boxes from a tesseract result. */
export function wordsOf(data) {
  const out = [];
  for (const b of data.blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        for (const w of l.words || []) {
          if (w.text && w.text.trim() && w.confidence > 20) out.push({ text: w.text.trim(), ...w.bbox, line: l.bbox });
        }
      }
    }
  }
  return out;
}

/* ---------- Text layer ---------- */

const latin1 = (s) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');

/**
 * Draw `words` (pixel boxes on a `cw`×`ch` render of the displayed page) as
 * invisible text on a pdf-lib page, sized and squeezed to cover each word.
 */
export function addTextLayer(L, pdfPage, font, words, cw, ch) {
  const { width: Dw, height: Dh } = displaySize(pdfPage);
  const sx = Dw / cw;
  const sy = Dh / ch;
  for (const w of words) {
    const text = latin1(w.text);
    // Use the line's height so every word in a line gets the same size.
    const hPt = Math.max(2, (w.line.y1 - w.line.y0) * sy);
    const size = hPt * 0.82;
    const target = (w.x1 - w.x0) * sx;
    const natural = font.widthOfTextAtSize(text, size) || 1;
    const baseline = w.line.y1 * sy - hPt * 0.18;
    const p = displayToUser(pdfPage, w.x0 * sx, baseline);
    pdfPage.pushOperators(
      L.pushGraphicsState(),
      L.setTextRenderingMode(L.TextRenderingMode.Invisible),
      L.setCharacterSqueeze(Math.max(10, Math.min(400, (target / natural) * 100))),
    );
    pdfPage.drawText(text, { x: p.x, y: p.y, size, font, rotate: L.degrees(p.angle) });
    pdfPage.pushOperators(L.popGraphicsState());
  }
}

/* ---------- Run ---------- */

const jpeg = (canvas, q) => new Promise((resolve) => canvas.toBlob(async (b) => resolve(new Uint8Array(await b.arrayBuffer())), 'image/jpeg', q));

/**
 * OCR a document.
 * @param {{kind: 'pdf'|'images', bytes?: Uint8Array, doc?: any, files?: File[], pages: number}} inp
 *   a PDF (bytes + pdf.js doc) or photos (files, one page each)
 * @param {{langs: string[], skipText?: boolean, worker?: any, onPage?: (i: number, n: number) => void}} o
 * @returns {Promise<{bytes: Uint8Array, texts: string[], skipped: number}>}
 */
export async function ocrDocument(inp, o) {
  if (!o.langs.length) throw new Error('nolang');
  const own = !o.worker;
  const worker = o.worker || await createOcrWorker(o.langs.join('+'));
  try {
    const L = await loadPdfLib();
    const out = inp.kind === 'pdf'
      ? await L.PDFDocument.load(inp.bytes, { updateMetadata: false })
      : await L.PDFDocument.create();
    const font = await out.embedFont(L.StandardFonts.Helvetica);
    const texts = [];
    let skipped = 0;
    for (let i = 0; i < inp.pages; i++) {
      if (o.onPage) o.onPage(i, inp.pages);
      let canvas;
      let pdfPage;
      if (inp.kind === 'pdf') {
        const pg = await inp.doc.getPage(i + 1);
        pdfPage = out.getPage(i);
        if (o.skipText) {
          const tc = await pg.getTextContent();
          const existing = tc.items.map((it) => it.str).join(' ').trim();
          if (existing.length >= 30) {
            texts.push(existing);
            skipped++;
            continue;
          }
        }
        const vp = pg.getViewport({ scale: 1 });
        canvas = await renderPage(pg, LONG_SIDE / Math.max(vp.width, vp.height));
        pg.cleanup();
      } else {
        canvas = await loadPhoto(inp.files[i], LONG_SIDE);
        // Page: the photo at its aspect ratio, long side = A4 long side.
        const s = 841.89 / Math.max(canvas.width, canvas.height);
        const img = await out.embedJpg(await jpeg(canvas, 0.88));
        pdfPage = out.addPage([canvas.width * s, canvas.height * s]);
        pdfPage.drawImage(img, { x: 0, y: 0, width: canvas.width * s, height: canvas.height * s });
      }
      const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
      addTextLayer(L, pdfPage, font, wordsOf(data), canvas.width, canvas.height);
      texts.push((data.text || '').trim());
      canvas.width = canvas.height = 0;
    }
    out.setProducer('DokuJaga');
    out.setCreator('DokuJaga');
    return { bytes: await out.save(), texts, skipped };
  } finally {
    if (own) await worker.terminate();
  }
}
