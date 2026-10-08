// Shared boot for simple pages: language toggle, i18n and offline support.
import { applyI18n } from './i18n.js';
import * as store from './storage.js';
import { registerServiceWorker } from './pwa.js';

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
  };
  document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
    lang = b.dataset.lang === 'en' ? 'en' : 'ms';
    store.save('lang', lang);
    sync();
  }));
  sync();
  registerServiceWorker();
  return { lang: () => lang };
}
