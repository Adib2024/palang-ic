// Renders every page of a PDF (pdf.js) as a stacked, full-width view with
// room for overlays. Shared by Edit, Redact and Fill Form.
import { renderPage } from './pdf-kit.js';

/**
 * @param {HTMLElement} host container; emptied first
 * @param {*} doc pdf.js document
 * @param {{maxWidth?: number, label?: (n:number) => string}} [opts]
 * @returns {Promise<{el: HTMLElement, canvas: HTMLCanvasElement, vp: any, page: any, index: number}[]>}
 *   `vp` is the pdf.js viewport at scale 1 (PDF points, page rotation applied).
 */
export async function renderPages(host, doc, opts = {}) {
  host.textContent = '';
  const width = Math.min(opts.maxWidth || 1000, Math.max(300, host.clientWidth || 600));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const views = [];
  for (let i = 0; i < doc.numPages; i++) {
    const page = await doc.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    const wrap = document.createElement('div');
    wrap.className = 'sign-page doc-page';
    wrap.dataset.page = String(i);
    wrap.style.aspectRatio = `${vp.width} / ${vp.height}`;
    const canvas = await renderPage(page, (width * dpr) / vp.width);
    canvas.className = 'sign-canvas';
    wrap.appendChild(canvas);
    if (opts.label) {
      const no = document.createElement('span');
      no.className = 'sign-page-no';
      no.textContent = opts.label(i + 1);
      wrap.appendChild(no);
    }
    host.appendChild(wrap);
    views.push({ el: wrap, canvas, vp, page, index: i });
  }
  return views;
}

/** Pointer position inside `el` as fractions (0..1) of its box. */
export function fracPoint(el, e) {
  const r = el.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
    y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
  };
}

/** Position an absolutely placed element by page fractions. */
export function placeFrac(el, { x, y, w, h }) {
  el.style.left = `${x * 100}%`;
  el.style.top = `${y * 100}%`;
  if (w != null) el.style.width = `${w * 100}%`;
  if (h != null) el.style.height = `${h * 100}%`;
}
