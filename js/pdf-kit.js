// Shared helpers for the PDF tools: loading the vendored libraries (served
// from this site, never a CDN), rendering pages, and saving/sharing files.

const VENDOR = new URL('../vendor/', import.meta.url);

let pdfjsPromise;
/** pdf.js (Mozilla), for reading and rendering pages. */
export function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(new URL('pdfjs/pdf.min.mjs', VENDOR).href).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs/pdf.worker.min.mjs', VENDOR).href;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

let pdfLibPromise;
/** pdf-lib, for building new PDFs from existing pages. */
export function loadPdfLib() {
  if (!pdfLibPromise) pdfLibPromise = import(new URL('pdf-lib/pdf-lib.esm.min.js', VENDOR).href);
  return pdfLibPromise;
}

/** Open a PDF for rendering. `bytes` is copied because pdf.js takes ownership. */
export async function openForRender(bytes) {
  const pdfjs = await loadPdfJs();
  return pdfjs.getDocument({
    data: bytes.slice(),
    cMapUrl: new URL('pdfjs/cmaps/', VENDOR).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('pdfjs/standard_fonts/', VENDOR).href,
    isEvalSupported: false, // keep within our CSP (no eval)
  }).promise;
}

/**
 * Render one page to a canvas.
 * @param {*} page pdf.js page
 * @param {number} scale CSS-pixel scale (1 = 72 DPI)
 * @param {number} [extraRotation] degrees to add to the page's own rotation
 */
export async function renderPage(page, scale, extraRotation = 0) {
  const viewport = page.getViewport({ scale, rotation: (page.rotate + extraRotation) % 360 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

export function isPdf(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function formatSize(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function safeName(name, fallback) {
  const base = (name || '').trim().replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-');
  return base || fallback;
}

export function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Share via the Web Share API when possible, otherwise download.
 * @returns {Promise<'shared'|'cancelled'|'downloaded'>}
 */
export async function shareOrDownload(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
    }
  }
  download(file);
  return 'downloaded';
}

/**
 * Share several files at once (e.g. images to WhatsApp) if the browser can.
 * @returns {Promise<'shared'|'cancelled'|'unsupported'>}
 */
export async function shareFiles(files, title) {
  if (!(navigator.canShare && navigator.canShare({ files }))) return 'unsupported';
  try {
    await navigator.share({ files, title });
    return 'shared';
  } catch (err) {
    return err && err.name === 'AbortError' ? 'cancelled' : 'unsupported';
  }
}

/** Friendly message key for a PDF that couldn't be opened. */
export function openErrorKey(err) {
  const msg = String((err && (err.name || err.message)) || '');
  return /password|encrypt/i.test(msg) ? 'pdfEncrypted' : 'pdfOpenError';
}
