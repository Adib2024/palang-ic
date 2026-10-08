// Place pictures (signatures, text, dates) on rendered PDF pages, move and
// resize them, then draw them into the PDF with pdf-lib. Shared by Sign PDF
// and Merge PDF.

const pngBytes = (canvas) => new Promise((resolve) => canvas.toBlob(async (b) => resolve(new Uint8Array(await b.arrayBuffer())), 'image/png'));

/**
 * @param {{tr: (key: string) => string, onChange?: () => void}} opts
 */
export function createPlacer({ tr, onChange = () => {} }) {
  /** @type {{el: HTMLElement, vp: any}[]} one per page; vp = pdf.js viewport at scale 1 */
  let views = [];
  /** @type {{id: number, page: number, fx: number, fy: number, fw: number, fh: number, aspect: number, canvas: HTMLCanvasElement, el: HTMLElement}[]} */
  let items = [];
  let active = 0;
  let nextId = 1;

  const place = (it) => {
    Object.assign(it.el.style, {
      left: `${it.fx * 100}%`, top: `${it.fy * 100}%`, width: `${it.fw * 100}%`, height: `${it.fh * 100}%`,
    });
  };
  const select = (it) => items.forEach((x) => x.el.classList.toggle('selected', x === it));

  function setActive(i) {
    active = i;
    views.forEach((v, k) => v.el.classList.toggle('active', k === i));
    onChange();
  }

  function remove(it) {
    it.el.remove();
    items = items.filter((x) => x !== it);
    onChange();
  }

  function bind(it, view) {
    const { el } = it;
    let mode = null;
    let start = null;
    el.querySelector('.sig-del').addEventListener('click', (e) => { e.stopPropagation(); remove(it); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Delete' || e.key === 'Backspace') remove(it); });
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.sig-del')) return;
      e.preventDefault();
      e.stopPropagation();
      select(it);
      setActive(it.page);
      mode = e.target.closest('.sig-handle') ? 'resize' : 'move';
      start = { x: e.clientX, y: e.clientY, fx: it.fx, fy: it.fy, fw: it.fw };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!mode) return;
      const r = view.el.getBoundingClientRect();
      const dx = (e.clientX - start.x) / r.width;
      const dy = (e.clientY - start.y) / r.height;
      if (mode === 'move') {
        it.fx = Math.min(1 - it.fw, Math.max(0, start.fx + dx));
        it.fy = Math.min(1 - it.fh, Math.max(0, start.fy + dy));
      } else {
        const ratio = (view.vp.width * it.aspect) / view.vp.height; // fh per fw
        const maxW = Math.min(1 - it.fx, (1 - it.fy) / ratio);
        it.fw = Math.min(maxW, Math.max(0.03, start.fw + dx));
        it.fh = it.fw * ratio;
      }
      place(it);
    });
    const end = () => { mode = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  function addOne(pageIndex, canvas, src, fx, fy, fw) {
    const view = views[pageIndex];
    const aspect = canvas.height / canvas.width;
    const fh = Math.min(0.9, (fw * view.vp.width * aspect) / view.vp.height);
    const it = {
      id: nextId++, page: pageIndex, fx: Math.min(1 - fw, fx), fy: Math.min(1 - fh, Math.max(0, fy)), fw, fh, aspect, canvas, el: null,
    };
    const el = document.createElement('div');
    el.className = 'sig-item';
    el.tabIndex = 0;
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.src = src;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sig-del';
    del.textContent = '✕';
    del.setAttribute('aria-label', tr('sigDelete'));
    const handle = document.createElement('span');
    handle.className = 'sig-handle';
    handle.setAttribute('aria-hidden', 'true');
    el.append(img, del, handle);
    it.el = el;
    view.el.appendChild(el);
    place(it);
    items.push(it);
    bind(it, view);
    return it;
  }

  return {
    get items() { return items; },
    get views() { return views; },
    get active() { return active; },
    setActive,

    /** Use these rendered pages (clears placed items). Tapping a page makes it active. */
    setViews(list) {
      items.forEach((it) => it.el.remove());
      items = [];
      views = list;
      views.forEach((v, i) => {
        v.el.addEventListener('pointerdown', (e) => {
          if (!e.target.closest('.sig-item')) { setActive(i); select(null); }
        });
      });
      setActive(0);
    },

    /**
     * Place `canvas` on the active page (or on every page at the same spot),
     * `widthFrac` of the page width. Returns the new items.
     */
    add(canvas, widthFrac, { allPages = false } = {}) {
      if (!views.length || !canvas) return [];
      const view = views[active];
      const aspect = canvas.height / canvas.width;
      const fw = Math.min(0.9, widthFrac);
      const fh = Math.min(0.9, (fw * view.vp.width * aspect) / view.vp.height);
      // Stagger new items on the same page so they don't land on top of each other.
      const k = items.filter((x) => x.page === active).length;
      const fx = (1 - fw) / 2;
      const fy = Math.min(1 - fh, Math.max(0, (1 - fh) / 2 + ((k % 5) - 1) * 0.08));
      const src = canvas.toDataURL('image/png');
      const pages = allPages ? views.map((_, i) => i) : [active];
      const added = pages.map((p) => addOne(p, canvas, src, fx, fy, fw));
      const mine = added.find((it) => it.page === active);
      select(mine);
      mine.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      onChange();
      return added;
    },

    remove,
    clear() { [...items].forEach(remove); },

    /** Draw every placed item into `doc` (pdf-lib; page i = view i). */
    async drawInto(PDFLib, doc) {
      const embedded = new Map();
      for (const it of items) {
        let img = embedded.get(it.canvas);
        if (!img) {
          img = await doc.embedPng(await pngBytes(it.canvas));
          embedded.set(it.canvas, img);
        }
        const { vp } = views[it.page];
        const dw = it.fw * vp.width;
        const dh = it.fh * vp.height;
        // Bottom-left of the box on screen, in PDF user space. Rotating by the
        // page's /Rotate keeps the image upright on rotated pages.
        const [x, y] = vp.convertToPdfPoint(it.fx * vp.width, it.fy * vp.height + dh);
        doc.getPage(it.page).drawImage(img, { x, y, width: dw, height: dh, rotate: PDFLib.degrees(vp.rotation) });
      }
    },
  };
}
