// OCR PDF: recognise text in scanned PDFs or photos (Malay + English) with
// tesseract.js, then add an invisible text layer so the PDF can be searched
// and copied, and show the plain text. The engine and models are served by
// this site; the document never leaves the tab.
import { initPage } from './page.js';
import { t } from './i18n.js';
import {
  loadPdfLib, openForRender, renderPage, isPdf, formatSize, safeName, download, shareOrDownload, openErrorKey,
} from './pdf-kit.js';
import { bindFileDrop, displayToUser, displaySize } from './pdf-pages.js';
import { loadPhoto } from './image-loader.js';

const $ = (sel) => document.querySelector(sel);
const LONG_SIDE = 2400; // px of the longest page side given to the OCR engine
const VENDOR = new URL('../vendor/tesseract/', import.meta.url).href;
const isImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name);

/** @type {{name: string, kind: 'pdf'|'images', files: File[], bytes?: Uint8Array, doc?: any, pages: number} | null} */
let input = null;
let output = null; // {pdf: File, text: string}
let ready = false;
let busy = false;

const page = initPage(() => { if (ready) sync(); });
const tr = (key, vars) => t(page.lang(), key, vars);
const setStatus = (msg) => { $('#status').textContent = msg || ''; };
const setProgress = (f) => {
  $('#progress').hidden = f == null;
  $('#progressBar').style.width = `${Math.round((f || 0) * 100)}%`;
};

/* ---------- Engine ---------- */

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
function wordsOf(data) {
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
function addTextLayer(L, pdfPage, font, words, cw, ch) {
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

/** OCR the loaded input; returns {pdf: File, text: string, pages: number, skipped: number}. */
export async function runOcr() {
  const langs = [$('#langMs').checked && 'msa', $('#langEn').checked && 'eng'].filter(Boolean);
  if (!langs.length) throw new Error('nolang');
  const skipText = $('#skipText').checked;
  setStatus(tr('ocrLoadingEngine'));
  setProgress(0);
  const worker = await createOcrWorker(langs.join('+'));
  try {
    const L = await loadPdfLib();
    const out = input.kind === 'pdf'
      ? await L.PDFDocument.load(input.bytes, { updateMetadata: false })
      : await L.PDFDocument.create();
    const font = await out.embedFont(L.StandardFonts.Helvetica);
    const texts = [];
    let skipped = 0;
    for (let i = 0; i < input.pages; i++) {
      setStatus(tr('ocrProgress', { i: i + 1, n: input.pages }));
      setProgress(i / input.pages);
      let canvas;
      let pdfPage;
      if (input.kind === 'pdf') {
        const pg = await input.doc.getPage(i + 1);
        pdfPage = out.getPage(i);
        if (skipText) {
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
        canvas = await loadPhoto(input.files[i], LONG_SIDE);
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
    setProgress(1);
    out.setProducer('DokuJaga');
    out.setCreator('DokuJaga');
    const bytes = await out.save();
    const name = safeName($('#fileName').value, `${safeName(input.name, 'dokumen')}-ocr`);
    const text = texts.map((s, k) => (input.pages > 1 ? `--- ${tr('sigPage', { n: k + 1 })} ---\n${s}` : s)).join('\n\n');
    return { pdf: new File([bytes], `${name}.pdf`, { type: 'application/pdf' }), text, pages: input.pages, skipped };
  } finally {
    await worker.terminate();
  }
}

/* ---------- UI ---------- */

function sync() {
  $('#toolLayout').classList.toggle('is-empty', !input);
  $('#runOcr').disabled = !input || busy;
  if (input) {
    $('#docTitle').textContent = input.name;
    $('#docMeta').textContent = `${tr('pdfPagesN', { n: input.pages })} · ${formatSize(input.files.reduce((n, f) => n + f.size, 0))}`;
  }
  $('#result').hidden = !output;
  if (output) {
    $('#ocrText').value = output.text;
    $('#resultMeta').textContent = tr('ocrDone', { n: output.pages, size: formatSize(output.pdf.size) })
      + (output.skipped ? ` ${tr('ocrSkipped', { n: output.skipped })}` : '');
  }
}

async function openFiles(list) {
  const pdf = list.find(isPdf);
  const images = list.filter(isImage);
  if (!pdf && !images.length) { setStatus(tr('pdfOpenError')); return; }
  setStatus(tr('pdfLoading'));
  output = null;
  try {
    if (input && input.doc) input.doc.destroy();
    if (pdf) {
      const bytes = new Uint8Array(await pdf.arrayBuffer());
      const doc = await openForRender(bytes);
      input = { name: pdf.name, kind: 'pdf', files: [pdf], bytes, doc, pages: doc.numPages };
    } else {
      input = { name: images.length > 1 ? tr('ocrImagesN', { n: images.length }) : images[0].name, kind: 'images', files: images, pages: images.length };
    }
    $('#fileName').value = `${safeName(input.kind === 'pdf' ? input.name : images[0].name, 'dokumen')}-ocr`;
    setStatus('');
  } catch (err) {
    input = null;
    setStatus(tr(openErrorKey(err)));
  }
  sync();
}

async function start() {
  if (!input || busy) return;
  busy = true;
  output = null;
  sync();
  try {
    output = await runOcr();
    setStatus('');
  } catch (err) {
    const m = err && err.message;
    setStatus(m === 'nolang' ? tr('ocrNeedLang') : m === 'engine' ? tr('ocrEngineError') : tr(openErrorKey(err)));
  } finally {
    busy = false;
    setProgress(null);
    sync();
  }
}

$('#runOcr').addEventListener('click', start);
$('#savePdf').addEventListener('click', () => output && download(output.pdf));
$('#sharePdf').addEventListener('click', async () => {
  if (output && (await shareOrDownload(output.pdf)) === 'downloaded') setStatus(tr('shareFallback'));
});
$('#copyText').addEventListener('click', async () => {
  if (!output) return;
  try {
    await navigator.clipboard.writeText(output.text);
    setStatus(tr('ocrCopied'));
  } catch {
    $('#ocrText').select();
    document.execCommand('copy');
    setStatus(tr('ocrCopied'));
  }
});
$('#saveTxt').addEventListener('click', () => {
  if (!output) return;
  download(new File([output.text], output.pdf.name.replace(/\.pdf$/i, '.txt'), { type: 'text/plain;charset=utf-8' }));
});
$('#pickFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; openFiles(f); });
$('#another').addEventListener('click', () => $('#pickFiles').click());
bindFileDrop($('#dropzone'), openFiles);
ready = true;
sync();

// Exposed for the automated test only.
window.__ocr = { openFiles, start, get output() { return output; }, get busy() { return busy; } };
