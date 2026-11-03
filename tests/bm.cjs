// The site opens in English by default; most suites check Bahasa Melayu
// wording, so every browser context starts in BM unless a test says otherwise
// with newContext({ ..., dokujagaLang: null }) (fresh visitor) or 'en'.
// A test that switches language with the EN/BM buttons still can: this only
// fills in a language when none has been chosen yet.
const pw = require('playwright');

const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (...args) => {
  const browser = await launch(...args);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (opts = {}) => {
    const { dokujagaLang = 'ms', ...rest } = opts;
    const context = await newContext(rest);
    if (dokujagaLang) {
      await context.addInitScript((lang) => {
        try { if (localStorage.getItem('palangic:lang') === null) localStorage.setItem('palangic:lang', JSON.stringify(lang)); } catch { /* opaque origin */ }
      }, dokujagaLang);
    }
    return context;
  };
  browser.newPage = async (opts) => (await browser.newContext(opts)).newPage();
  return browser;
};
