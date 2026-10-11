// "Teruskan ke…" bar: after a result is saved or shared, offer to open it in
// another tool right away (the file is handed over on this device only).
import { t } from './i18n.js';
import { putInbox } from './handoff.js';
import { CATALOG, isPdfFile, isImageFile } from './tool-catalog.js';

const ROOT = new URL('../', import.meta.url);
const NEXT = {
  pdf: ['kecilkan-pdf/', 'tandatangan-pdf/', 'lindungi-pdf/', 'gabung-pdf/', 'watermark-pdf/', 'nombor-pdf/'],
  image: ['palang/', 'gambar-pdf/', 'kecil-gambar/', 'ocr-pdf/'],
};

const here = () => location.pathname.replace(ROOT.pathname, '');
const lang = () => (document.documentElement.lang === 'en' ? 'en' : 'ms');

async function go(file, href) {
  await putInbox([file], here());
  location.href = new URL(`${href}?from=inbox`, ROOT).href;
}

/** Show the bar for `file` (a PDF or an image). */
export function offerContinue(file) {
  const kind = isPdfFile(file) ? 'pdf' : isImageFile(file) ? 'image' : null;
  if (!kind) return;
  document.querySelector('.next-bar')?.remove();
  const tr = (k, v) => t(lang(), k, v);
  const bar = document.createElement('div');
  bar.className = 'next-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', tr('nextTitle'));
  const head = document.createElement('p');
  head.className = 'next-head';
  const ok = document.createElement('strong');
  ok.textContent = `✓ ${file.name}`;
  const label = document.createElement('span');
  label.textContent = tr('nextTitle');
  head.append(ok, label);
  const chips = document.createElement('div');
  chips.className = 'next-chips';
  const current = here();
  NEXT[kind].filter((h) => h !== current).slice(0, 4).forEach((href) => {
    const tool = CATALOG.find((c) => c.href === href);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'next-chip';
    b.dataset.next = href;
    b.textContent = tr(tool.key);
    b.addEventListener('click', () => go(file, href));
    chips.appendChild(b);
  });
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'next-chip more';
  more.dataset.next = 'kongsi/';
  more.textContent = tr('nextAll');
  more.addEventListener('click', () => go(file, 'kongsi/'));
  chips.appendChild(more);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'next-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', tr('nextClose'));
  close.addEventListener('click', () => bar.remove());
  bar.append(head, chips, close);
  document.body.appendChild(bar);
}
