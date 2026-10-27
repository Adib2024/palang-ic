// Shared guidance for every tool page, added at load so the pages stay as
// they are:
//  - a 1-2-3 steps bar (choose file → settings → save) that follows progress,
//  - quick-pick presets at the top of the settings panel (where useful),
//  - on phones, a floating save bar that mirrors the main button while it is
//    scrolled out of view.
import { t } from './i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- Per-tool configuration ---------- */

// Step 2 label for tools where "Settings" isn't the best word.
const STEP2 = {
  'tandatangan-pdf': 'gsSign', 'edit-pdf': 'gsEdit', 'hitamkan-pdf': 'gsRedact', 'isi-borang': 'gsFill',
  'buka-kunci-pdf': 'gsPassword', 'lindungi-pdf': 'gsPassword', 'gabung-pdf': 'gsArrange', 'susun-pdf': 'gsArrange',
  'putar-pdf': 'gsRotate', 'potong-pdf': 'gsCrop', 'pisah-pdf': 'gsSplitWhere', 'ocr-pdf': 'gsLanguage',
};
// Pages that already guide the user their own way.
const SKIP = new Set(['kecil-gambar', 'aliran-kerja', 'kongsi', 'palang']);

/**
 * Quick picks: each sets several controls at once. Keys of `set`:
 * '#id' (value / checkbox state) or 'name=group' (radio value).
 */
export const PRESETS = {
  'kecilkan-pdf': [
    { key: 'psPortal', spec: '≤ 2 MB', set: { 'name=level': 'medium', '#limit': '2097152', '#gray': false } },
    { key: 'psEmail', spec: '≤ 5 MB', set: { 'name=level': 'light', '#limit': '5242880', '#gray': false } },
    { key: 'psSmallest', spec: 'psSmallestSpec', set: { 'name=level': 'strong', '#limit': '0', '#gray': false } },
    { key: 'psBest', spec: 'psBestSpec', set: { 'name=level': 'light', '#limit': '0', '#gray': false } },
  ],
  'watermark-pdf': [
    { key: 'psCopy', spec: 'SALINAN', set: { 'name=wmType': 'text', '#wmText': 'SALINAN', 'name=wmColor': 'red', 'name=wmAngle': '45', 'name=wmPos': 'mc', '#wmTile': false } },
    { key: 'psConfidential', spec: 'SULIT', set: { 'name=wmType': 'text', '#wmText': 'SULIT', 'name=wmColor': 'red', 'name=wmAngle': '45', 'name=wmPos': 'mc', '#wmTile': true } },
    { key: 'psDraft', spec: 'DRAF', set: { 'name=wmType': 'text', '#wmText': 'DRAF', 'name=wmColor': 'gray', 'name=wmAngle': '45', 'name=wmPos': 'mc', '#wmTile': false } },
    { key: 'psSample', spec: 'CONTOH', set: { 'name=wmType': 'text', '#wmText': 'CONTOH', 'name=wmColor': 'blue', 'name=wmAngle': '45', 'name=wmPos': 'mc', '#wmTile': true } },
  ],
  'nombor-pdf': [
    { key: 'psSimple', spec: '1, 2, 3', set: { '#pnFormat': 'n', 'name=pnPos': 'bc' } },
    { key: 'psOfTotal', spec: '1 / 10', set: { '#pnFormat': 'nOfTotal', 'name=pnPos': 'br' } },
    { key: 'psFormal', spec: 'psFormalSpec', set: { '#pnFormat': 'words', 'name=pnPos': 'bc' } },
  ],
  'pdf-gambar': [
    { key: 'psScreen', spec: 'JPG · 150 DPI', set: { 'name=format': 'jpeg', 'name=dpi': '150' } },
    { key: 'psSmall', spec: 'JPG · 96 DPI', set: { 'name=format': 'jpeg', 'name=dpi': '96' } },
    { key: 'psPrint', spec: 'PNG · 220 DPI', set: { 'name=format': 'png', 'name=dpi': '220' } },
  ],
  'gambar-pdf': [
    { key: 'psDocA4', spec: 'A4', set: { 'name=pageSize': 'a4', 'name=orientation': 'auto', 'name=margin': 'small', 'name=quality': 'mid' } },
    { key: 'psFitImage', spec: 'psFitImageSpec', set: { 'name=pageSize': 'fit', 'name=orientation': 'auto', 'name=margin': 'none', 'name=quality': 'high' } },
    { key: 'psEmailSmall', spec: 'psEmailSmallSpec', set: { 'name=pageSize': 'a4', 'name=orientation': 'auto', 'name=margin': 'small', 'name=quality': 'low' } },
  ],
};

/* ---------- Helpers ---------- */

function control(sel) {
  if (sel.startsWith('name=')) return null;
  return $(sel);
}

function current(set) {
  return Object.entries(set).every(([sel, v]) => {
    if (sel.startsWith('name=')) {
      const r = $(`input[name="${sel.slice(5)}"]:checked`);
      return r && r.value === v;
    }
    const el = control(sel);
    if (!el) return false;
    return el.type === 'checkbox' ? el.checked === v : el.value === v;
  });
}

function apply(set) {
  for (const [sel, v] of Object.entries(set)) {
    if (sel.startsWith('name=')) {
      const r = $(`input[name="${sel.slice(5)}"][value="${v}"]`);
      if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
      continue;
    }
    const el = control(sel);
    if (!el) continue;
    if (el.type === 'checkbox') {
      if (el.checked !== v) { el.checked = v; el.dispatchEvent(new Event('change', { bubbles: true })); }
    } else if (el.value !== v) {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}

/* ---------- Mount ---------- */

/** @param {() => string} lang */
export function initGuide(lang) {
  const m = /\/([a-z0-9-]+)\/(?:index\.html)?$/.exec(location.pathname);
  const tool = m && m[1];
  const layout = $('#toolLayout');
  if (!tool || SKIP.has(tool) || !document.querySelector('.tool-hero')) return () => {};
  const tr = (k, v) => t(lang(), k, v);
  const updaters = [];

  /* Steps bar */
  const compare = tool === 'banding-pdf';
  const anchor = layout || (compare && $('main .container.stack > section.card'));
  if (anchor) {
    const fileInput = $('input[type="file"]', layout || anchor);
    const images = fileInput && /^image\//.test(fileInput.accept || '') && !/pdf/.test(fileInput.accept);
    const keys = compare ? ['gsPick2', 'gsDiff'] : [images ? (tool === 'imbas' ? 'gsScan' : 'gsPickImg') : 'gsPickPdf', STEP2[tool] || 'gsSettings', 'gsSave'];
    const bar = document.createElement('ol');
    bar.className = 'steps-bar';
    bar.id = 'stepsBar';
    if (compare) bar.classList.add('two');
    const tone = [...(layout || anchor).classList].find((c) => c.startsWith('tone-'));
    if (tone) bar.classList.add(tone);
    const items = keys.map((k, i) => {
      const li = document.createElement('li');
      li.dataset.step = String(i + 1);
      const n = document.createElement('span');
      n.className = 'step';
      n.textContent = String(i + 1);
      const label = document.createElement('span');
      li.append(n, label);
      bar.appendChild(li);
      return { li, label, key: k };
    });
    anchor.parentNode.insertBefore(bar, anchor);

    let saved = false;
    const visible = (sel) => { const el = $(sel); return !!el && !el.hidden; };
    const update = () => {
      bar.setAttribute('aria-label', tr('isSteps'));
      items.forEach((it) => { it.label.textContent = tr(it.key); });
      let step;
      if (compare) step = visible('#results') ? 2 : 1;
      else if (layout.classList.contains('is-empty')) step = 1;
      else step = saved || visible('#result') ? 3 : 2;
      items.forEach((it, i) => {
        const s = i + 1;
        it.li.classList.toggle('done', s < step || (s === items.length && saved));
        if (s === step) it.li.setAttribute('aria-current', 'step'); else it.li.removeAttribute('aria-current');
      });
    };
    document.addEventListener('dokujaga:saved', () => { saved = true; update(); });
    document.addEventListener('change', (e) => { if (e.target.type === 'file') { saved = false; update(); } }, true);
    const watch = layout || $('main');
    new MutationObserver(() => {
      if (layout && layout.classList.contains('is-empty')) saved = false;
      update();
    }).observe(watch, { attributes: true, subtree: true, attributeFilter: ['class', 'hidden'] });
    updaters.push(update);
    update();
  }

  /* Presets */
  const presets = PRESETS[tool];
  const options = layout && $('.options', layout);
  if (presets && options) {
    const box = document.createElement('div');
    box.className = 'quick-picks';
    const head = document.createElement('p');
    head.className = 'quick-title';
    const group = document.createElement('div');
    group.className = 'presets';
    group.setAttribute('role', 'radiogroup');
    box.append(head, group);
    const title = $('h2', options);
    if (title) title.after(box); else options.prepend(box);
    const buttons = presets.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.setAttribute('role', 'radio');
      const name = document.createElement('strong');
      const spec = document.createElement('span');
      b.append(name, spec);
      b.addEventListener('click', () => { apply(p.set); refresh(); });
      group.appendChild(b);
      return { b, name, spec, p };
    });
    const refresh = () => {
      head.textContent = tr('psTitle');
      group.setAttribute('aria-label', tr('psTitle'));
      let focusable = false;
      buttons.forEach(({ b, name, spec, p }) => {
        const on = current(p.set);
        name.textContent = tr(p.key);
        spec.textContent = /^ps[A-Z]/.test(p.spec) ? tr(p.spec) : p.spec;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
        if (on) focusable = true;
      });
      if (!focusable && buttons[0]) buttons[0].b.tabIndex = 0;
    };
    group.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      const i = buttons.findIndex((x) => x.b === e.target);
      if (!d || i < 0) return;
      e.preventDefault();
      const next = buttons[(i + d + buttons.length) % buttons.length];
      next.b.click();
      next.b.focus();
    });
    options.addEventListener('change', refresh);
    options.addEventListener('click', () => setTimeout(refresh, 0));
    options.addEventListener('input', refresh);
    updaters.push(refresh);
    refresh();
  }

  /* Floating save bar on phones */
  const primary = options && !layout.classList.contains('sign-layout') && $('.buttons .primary', options);
  if (primary && 'IntersectionObserver' in window) {
    const bar = document.createElement('div');
    bar.className = 'float-bar';
    bar.hidden = true;
    const info = document.createElement('span');
    info.className = 'float-info';
    const proxy = document.createElement('button');
    proxy.type = 'button';
    proxy.className = 'btn primary';
    proxy.addEventListener('click', () => primary.click());
    bar.append(info, proxy);
    document.body.appendChild(bar);
    let primaryInView = true;
    const narrow = window.matchMedia('(max-width: 979px)');
    const sync = () => {
      proxy.textContent = primary.textContent;
      proxy.disabled = primary.disabled;
      const status = $('.status', options);
      const meta = $('#docMeta') || $('#count');
      info.textContent = (status && status.textContent.trim()) || (meta && meta.textContent.trim()) || '';
      const show = narrow.matches && !primaryInView && !layout.classList.contains('is-empty');
      bar.hidden = !show;
      document.body.classList.toggle('has-float-bar', show);
    };
    new IntersectionObserver((entries) => {
      primaryInView = entries[entries.length - 1].isIntersecting;
      sync();
    }).observe(primary);
    new MutationObserver(sync).observe(options, { attributes: true, childList: true, characterData: true, subtree: true });
    new MutationObserver(sync).observe(layout, { attributes: true, attributeFilter: ['class'] });
    narrow.addEventListener('change', sync);
    updaters.push(sync);
    sync();
  }

  return () => updaters.forEach((f) => f());
}
