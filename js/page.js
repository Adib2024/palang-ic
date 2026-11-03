// Shared boot for simple pages: language toggle, i18n and offline support.
import { applyI18n, loadLang } from './i18n.js';
import * as store from './storage.js';
import { registerServiceWorker } from './pwa.js';
import { deliverInbox } from './handoff.js';

/**
 * @param {(lang: string) => void} [onLang] called after every language change
 * @returns {{ lang: () => string }}
 */
export function initPage(onLang) {
  let lang = store.load('lang', 'ms') === 'en' ? 'en' : 'ms';
  const sync = () => {
    applyI18n(document, lang);
    document.querySelectorAll('[data-lang]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    });
    if (onLang) onLang(lang);
    refreshGuide();
  };
  let refreshGuide = () => {};
  document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
    const next = b.dataset.lang === 'en' ? 'en' : 'ms';
    store.save('lang', next);
    // Switch in one go once the strings are here (English loads on demand).
    loadLang(next).then(() => { lang = next; sync(); });
  }));
  // Fetch English as soon as someone reaches for the button.
  document.querySelectorAll('[data-lang="en"]').forEach((b) => ['pointerenter', 'focus', 'touchstart'].forEach((ev) => b.addEventListener(ev, () => loadLang('en'), { passive: true })));
  // English is loaded on demand (js/i18n-en.js): redraw the tool's own text
  // once it has arrived.
  document.addEventListener('dokujaga:i18n', () => { if (onLang) onLang(lang); refreshGuide(); });
  sync();
  rememberTool();
  registerServiceWorker();
  // Files handed over from another tool or app: give them to this tool once
  // its own setup (which runs right after initPage) is done.
  setTimeout(() => { deliverInbox().catch(() => {}); }, 0);
  // Steps bar, quick picks and the phone save bar, once the tool has set its
  // controls up.
  // Loaded separately so the tool itself is ready first (helps older phones).
  setTimeout(() => { import('./guide.js').then((m) => { refreshGuide = m.initGuide(() => lang); }).catch(() => {}); }, 0);
  return { lang: () => lang };
}

/** Remember this tool for the dashboard's "Recently used" row (this browser only). */
export function rememberTool() {
  const m = /\/([a-z0-9-]+)\/(?:index\.html)?$/.exec(location.pathname);
  if (!m || m[1] === 'kongsi' || m[1] === 'privasi' || !document.querySelector('.tool-hero')) return;
  const href = `${m[1]}/`;
  store.save('recent', [href, ...store.load('recent', []).filter((h) => h !== href)].slice(0, 6));
}
