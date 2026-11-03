// Browser test for the "Aa" panel's "Follow device setting" (auto dark mode)
// and for loading heavy modules only when needed (English strings, Office
// converters, workflow steps).
// Run: NODE_PATH="$(npm root -g)" node tests/display-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
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

      /* ---------- Modules loaded only when needed ---------- */
      loaded.length = 0;
      await page.goto(`${origin}/word-pdf/`);
      await page.waitForSelector('#stepsBar');
      check(`${label}: BM page does not load the English strings or the Office reader`, () => {
        assert(!loaded.includes('/js/i18n-en.js'), loaded.join(' '));
        assert(!loaded.some((p) => /office-(read|layout)\.js$/.test(p)), loaded.join(' '));
      });
      loaded.length = 0;
      await page.goto(`${origin}/aliran-kerja/`);
      await page.waitForTimeout(300);
      check(`${label}: workflow page skips OCR, encryption and stamp code until a step runs`, () => {
        assert(!loaded.some((p) => /(ocr-core|pdf-security|pdf-crypto|pdf-stamps|watermark)\.js$/.test(p)), loaded.join(' '));
      });
      // English on demand: the page and the tool's own text switch over.
      await page.goto(`${origin}/nota-gambar/`);
      await page.click('[data-lang="en"]');
      await page.waitForFunction(() => document.querySelector('h1').textContent === 'Image Notes');
      const en = await page.evaluate(() => ({ hint: document.querySelector('#ntHint').textContent, step: document.querySelector('#stepsBar li:nth-child(2)').textContent, lang: document.documentElement.lang }));
      check(`${label}: English loads when chosen and the tool redraws its text`, () => {
        assert.strictEqual(en.lang, 'en');
        assert.match(en.hint, /^Tap the photo/);
        assert.match(en.step, /Write notes/);
      });
      loaded.length = 0;
      await page.goto(`${origin}/palang/`);
      await page.waitForFunction(() => document.querySelector('[data-i18n="navTools"]').textContent === 'Tools');
      check(`${label}: an English visitor gets English straight away on the next page`, () => assert(loaded.includes('/js/i18n-en.js')));
      await page.click('[data-lang="ms"]');

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
