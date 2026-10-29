import { initPage } from './page.js';
import { t } from './i18n.js';
import * as store from './storage.js';

const $ = (sel) => document.querySelector(sel);
const chips = [...document.querySelectorAll('.chip[data-cat]')];
const tools = [...document.querySelectorAll('.tool[data-cat]')];
let cat = 'all';

// Each card is searchable in both languages (plus a few common words).
const EXTRA = {
  'kecil-gambar/': 'resize shrink photo jpg png webp kb mb',
  'kecilkan-pdf/': 'shrink size mb kb',
  'gambar-pdf/': 'jpg png photo convert',
  'pdf-gambar/': 'jpg png convert',
  'palang/': 'ic mykad watermark kad pengenalan identity card',
  'tandatangan-pdf/': 'signature sign tandatangan',
  'imbas/': 'scan camera kamera',
  'ocr-pdf/': 'text teks scan imbas',
};
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const haystack = new Map(tools.map((card) => {
  const keys = [...card.querySelectorAll('[data-i18n]')].map((e) => e.dataset.i18n);
  const words = keys.flatMap((k) => [t('ms', k), t('en', k)]);
  const href = card.getAttribute('href');
  return [card, norm(`${words.join(' ')} ${href.replace(/[/-]/g, ' ')} ${EXTRA[href] || ''}`)];
}));

let ready = false;
const page = initPage(() => { if (ready) { filter(); relabelTips(); } });
const tr = (key, vars) => t(page.lang(), key, vars);

function filter() {
  const q = norm($('#toolSearch').value.trim());
  const terms = q.split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const card of tools) {
    const inCat = cat === 'all' || card.dataset.cat === cat;
    const hit = terms.every((w) => haystack.get(card).includes(w));
    card.hidden = !(inCat && hit);
    if (!card.hidden) shown++;
  }
  $('#noTools').hidden = shown > 0;
  $('#noTools').textContent = shown ? '' : tr('noTools', { q: $('#toolSearch').value.trim() });
  renderRecent();
}

// Category chips filter the tool grid (like iLovePDF's tool filters).
for (const chip of chips) {
  chip.addEventListener('click', () => {
    cat = chip.dataset.cat;
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    filter();
  });
}
$('#toolSearch').addEventListener('input', filter);
$('#toolSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.target.value = ''; filter(); }
  if (e.key === 'Enter') {
    // Enter opens the only (or first) match.
    const first = tools.find((c) => !c.hidden);
    if (first && e.target.value.trim()) first.click();
  }
});
// "/" jumps to the search box (like many sites).
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  e.preventDefault();
  $('#toolSearch').focus();
});

/** Shortcuts to the tools used last on this device (stored only in this browser). */
function renderRecent() {
  const host = $('#recent');
  const recent = store.load('recent', []).filter((h) => tools.some((c) => c.getAttribute('href') === h)).slice(0, 4);
  host.textContent = '';
  host.hidden = !recent.length;
  if (!recent.length) return;
  const label = document.createElement('span');
  label.textContent = tr('recentTools');
  host.appendChild(label);
  for (const href of recent) {
    const card = tools.find((c) => c.getAttribute('href') === href);
    const a = document.createElement('a');
    a.href = href;
    a.className = [...card.classList].filter((c) => c.startsWith('tone-')).join(' ');
    const icon = card.querySelector('.tool-icon').cloneNode(true);
    icon.classList.remove('solid');
    const name = document.createElement('span');
    name.textContent = card.querySelector('.tool-body strong').textContent;
    a.append(icon, name);
    host.appendChild(a);
  }
}

/** Three short tips for first-time visitors; hidden for good once closed. */
function mountTips() {
  if (store.load('tipsSeen', false)) return () => {};
  const box = document.createElement('section');
  box.className = 'first-tips';
  box.setAttribute('aria-labelledby', 'tipsTitle');
  const head = document.createElement('h2');
  head.id = 'tipsTitle';
  const list = document.createElement('ol');
  const items = ['tip1', 'tip2', 'tip3'].map(() => {
    const li = document.createElement('li');
    list.appendChild(li);
    return li;
  });
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn primary';
  close.id = 'tipsClose';
  close.addEventListener('click', () => {
    store.save('tipsSeen', true);
    box.remove();
    $('#toolSearch').focus();
  });
  box.append(head, list, close);
  const tools = $('#tools');
  tools.insertBefore(box, $('.tool-search', tools));
  return () => {
    head.textContent = tr('tipsTitle');
    items.forEach((li, i) => { li.textContent = tr(`tip${i + 1}`); });
    close.textContent = tr('tipsClose');
  };
}
const relabelTips = mountTips();

ready = true;
filter();
relabelTips();
