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
  // Phones: a big "send to WhatsApp / other apps" button (the system share
  // sheet). Computers can't hand a file to WhatsApp, so it isn't shown there.
  let share = null;
  const touch = navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
  const phone = touch && window.matchMedia('(max-width: 1024px)').matches;
  if (phone && navigator.canShare && navigator.canShare({ files: [file] })) {
    share = document.createElement('button');
    share.type = 'button';
    share.className = 'btn primary next-share';
    share.id = 'shareWhatsapp';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', 'M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z');
    icon.appendChild(path);
    const text = document.createElement('span');
    text.textContent = tr('nextWhatsapp');
    share.append(icon, text);
    share.addEventListener('click', async () => {
      try { await navigator.share({ files: [file], title: file.name }); } catch { /* cancelled */ }
    });
  }
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
  bar.append(head, ...(share ? [share] : []), chips, close);
  document.body.appendChild(bar);
}
