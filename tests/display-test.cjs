// Browser test for the "Aa" panel's "Follow device setting" (auto dark mode),
// English as the default language, and loading heavy modules only when
// needed (BM strings, Office converters, workflow steps).
// Run: NODE_PATH="$(npm root -g)" node tests/display-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
require('./bm.cjs'); // suites check BM wording; the site's default is English
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const results = [];
  const check = (name, fn) => { fn(); results.push(`ok   ${name}`); };

  try {
    for (const [label, viewport, mobile] of [['desktop', { width: 1366, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
      const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, colorScheme: 'light' });
      const page = await context.newPage();
      const errors = [];
      const loaded = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) errors.push(m.text()); });
      page.on('request', (r) => { const u = new URL(r.url()); if (u.origin === origin) loaded.push(u.pathname); });
      const theme = () => page.evaluate(() => document.documentElement.dataset.theme || 'light');
      const openPanel = async () => { await page.click('#a11yBtn'); await page.waitForSelector('#a11yPop:not([hidden])'); };

      /* ---------- Auto dark mode ---------- */
      await page.goto(`${origin}/`);
      await page.emulateMedia({ colorScheme: 'dark' });
      const t0 = await theme();
      check(`${label}: light by default, even on a dark device (until "Follow device" is on)`, () => assert.strictEqual(t0, 'light'));
      await openPanel();
      await page.click('#a11yAuto');
      const autoState = await page.$eval('#a11yAuto', (b) => b.getAttribute('aria-pressed'));
      const t1 = await theme();
      const darkRow = await page.$eval('#a11yDark', (b) => b.getAttribute('aria-pressed'));
      check(`${label}: "Follow device" turns dark on a dark device`, () => assert.deepStrictEqual([autoState, t1, darkRow], ['true', 'dark', 'true']));
      await page.keyboard.press('Escape');
      await page.emulateMedia({ colorScheme: 'light' });
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
      const meta = await page.$eval('meta[name="theme-color"]', (m) => m.content);
      check(`${label}: follows the device when it switches back to light`, () => assert.strictEqual(meta, '#ffffff'));
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto(`${origin}/nota-gambar/`);
      const t2 = await theme();
      check(`${label}: the choice is remembered on other pages (no flash: set before paint)`, () => assert.strictEqual(t2, 'dark'));
      await page.screenshot({ path: path.join(OUT, `display-auto-dark-${label}.png`) });
      // A manual switch leaves auto; turning auto off keeps the current theme.
      await openPanel();
      await page.click('#a11yDark');
      const afterManual = [await theme(), await page.evaluate(() => JSON.parse(localStorage.getItem('palangic:theme')))];
      check(`${label}: switching the theme by hand stops following the device`, () => assert.deepStrictEqual(afterManual, ['light', 'light']));
      await page.click('#a11yAuto');
      await page.click('#a11yAuto');
      const afterOff = [await theme(), await page.evaluate(() => JSON.parse(localStorage.getItem('palangic:theme')))];
      check(`${label}: turning "Follow device" off keeps the theme shown`, () => assert.deepStrictEqual(afterOff, ['dark', 'dark']));
      await page.evaluate(() => localStorage.removeItem('palangic:theme'));
      await page.emulateMedia({ colorScheme: 'light' });

      /* ---------- Default language and modules loaded only when needed ---------- */
      // A first-time visitor (no language chosen yet).
      const fresh = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, dokujagaLang: null });
      const fp = await fresh.newPage();
      const got = [];
      fp.on('pageerror', (e) => errors.push(String(e)));
      fp.on('request', (r) => { const u = new URL(r.url()); if (u.origin === origin) got.push(u.pathname); });
      await fp.goto(`${origin}/`);
      const first = await fp.evaluate(() => ({
        lang: document.documentElement.lang,
        nav: document.querySelector('[data-i18n="navTools"]').textContent,
        en: document.querySelector('[data-lang="en"]').getAttribute('aria-pressed'),
      }));
      check(`${label}: a first-time visitor gets English, EN pressed`, () => assert.deepStrictEqual(first, { lang: 'en', nav: 'Tools', en: 'true' }));
      got.length = 0;
      await fp.goto(`${origin}/word-pdf/`);
      await fp.waitForSelector('#stepsBar');
      check(`${label}: an English page loads neither the BM strings nor the Office reader`, () => {
        assert(!got.includes('/js/i18n-ms.js'), got.join(' '));
        assert(!got.some((x) => /office-(read|layout)\.js$/.test(x)), got.join(' '));
      });
      got.length = 0;
      await fp.goto(`${origin}/aliran-kerja/`);
      await fp.waitForTimeout(300);
      check(`${label}: workflow page skips OCR, encryption and stamp code until a step runs`, () => {
        assert(!got.some((x) => /(ocr-core|pdf-security|pdf-crypto|pdf-stamps|watermark)\.js$/.test(x)), got.join(' '));
      });
      // Search finds tools by their name in the other language too.
      await fp.goto(`${origin}/`);
      await fp.fill('#toolSearch', 'gabung');
      await fp.waitForFunction(() => document.querySelector('a.tool[href="pisah-pdf/"]').hidden, null, { timeout: 5000 }).catch(() => {});
      const found = await fp.$$eval('a.tool', (els) => els.filter((e) => !e.hidden).map((e) => e.getAttribute('href')));
      check(`${label}: dashboard search matches BM words on the English page`, () => { assert(found.includes('gabung-pdf/'), found.join(' ')); assert(!found.includes('pisah-pdf/')); });
      // BM on demand: the page and the tool's own text switch over.
      await fp.goto(`${origin}/nota-gambar/`);
      await fp.click('[data-lang="ms"]');
      await fp.waitForFunction(() => document.querySelector('h1').textContent === 'Nota Gambar');
      const ms = await fp.evaluate(() => ({ hint: document.querySelector('#ntHint').textContent, step: document.querySelector('#stepsBar li:nth-child(2)').textContent, lang: document.documentElement.lang }));
      check(`${label}: BM loads when chosen and the tool redraws its text`, () => {
        assert.strictEqual(ms.lang, 'ms');
        assert.match(ms.hint, /^Ketik pada gambar/);
        assert.match(ms.step, /Tulis nota/);
      });
      got.length = 0;
      await fp.goto(`${origin}/palang/`);
      await fp.waitForFunction(() => document.querySelector('[data-i18n="navTools"]').textContent === 'Alat');
      check(`${label}: the BM choice is remembered on the next page`, () => assert(got.includes('/js/i18n-ms.js')));
      await fresh.close();

      check(`${label}: no page errors or CSP violations`, () => assert.deepStrictEqual(errors, [], JSON.stringify(errors)));
      await context.close();
    }
    console.log(results.join('\n'));
    console.log(`\nAll ${results.length} checks passed.`);
  } catch (err) {
    console.log(results.join('\n'));
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
