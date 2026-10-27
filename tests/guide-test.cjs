// Browser test for the shared tool guide: steps bar, quick picks, settings on
// the left (desktop) and the floating save bar (phone).
// Run: NODE_PATH="$(npm root -g)" node tests/guide-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));

async function makePdf() {
  const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  const d = await L.PDFDocument.create();
  const f = await d.embedFont(L.StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) d.addPage([595, 842]).drawText(`Halaman ${i + 1}`, { x: 60, y: 760, size: 24, font: f });
  const b = await d.save();
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const results = [];
  const check = (name, fn) => { fn(); results.push(`ok   ${name}`); };

  try {
    for (const [label, viewport, mobile] of [['desktop', { width: 1366, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
      const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, acceptDownloads: true });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) errors.push(m.text()); });
      await page.goto(origin + '/nombor-pdf/');
      const file = { name: 'surat.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await page.evaluate(makePdf), 'base64') };
      const steps = () => page.$$eval('#stepsBar li', (els) => els.map((l) => `${l.getAttribute('aria-current') ? '>' : ''}${l.classList.contains('done') ? '✓' : ''}${l.textContent}`));

      /* Steps follow progress */
      await page.goto(origin + '/nombor-pdf/');
      await page.waitForSelector('#stepsBar');
      const s1 = await steps();
      await page.setInputFiles('#pickFiles', file);
      await page.waitForFunction(() => !document.querySelector('#toolLayout').classList.contains('is-empty'));
      const s2 = await steps();
      check(`${label}: steps bar starts at 1 and moves to 2 when a PDF is open`, () => {
        assert.deepStrictEqual(s1, ['>1Pilih PDF', '2Pilih tetapan', '3Simpan']);
        assert.deepStrictEqual(s2, ['✓1Pilih PDF', '>2Pilih tetapan', '3Simpan']);
      });

      /* Quick picks */
      await page.click('.quick-picks .preset:has-text("Rasmi")');
      const fmt = await page.evaluate(() => [document.querySelector('#pnFormat').value, document.querySelector('input[name="pnPos"]:checked').value]);
      const on = await page.$$eval('.quick-picks .preset[aria-checked="true"] strong', (els) => els.map((e) => e.textContent));
      check(`${label}: quick pick sets several options at once and is marked`, () => {
        assert.deepStrictEqual(fmt, ['words', 'bc']);
        assert.deepStrictEqual(on, ['Rasmi']);
      });
      await page.selectOption('#pnFormat', 'n');
      await page.check('input[name="pnPos"][value="tl"]', { force: true });
      const none = await page.$$eval('.quick-picks .preset[aria-checked="true"]', (els) => els.length);
      check(`${label}: changing an option by hand clears the quick pick`, () => assert.strictEqual(none, 0));

      /* Layout: settings on the left on desktop */
      const xs = await page.evaluate(() => [document.querySelector('#toolLayout .options').getBoundingClientRect().x, document.querySelector('#toolLayout > section.card').getBoundingClientRect().x]);
      if (!mobile) check(`${label}: settings panel is on the left`, () => assert(xs[0] < xs[1], JSON.stringify(xs)));

      /* Save → step 3 done; on phones via the floating bar */
      let dl;
      if (mobile) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForSelector('.float-bar:not([hidden])');
        const barText = await page.textContent('.float-bar .btn');
        const mainText = await page.textContent('#savePdf');
        check(`${label}: floating save bar mirrors the main button`, () => assert.strictEqual(barText.trim(), mainText.trim()));
        await page.screenshot({ path: path.join(OUT, `guide-floatbar-${label}.png`) });
        [dl] = await Promise.all([page.waitForEvent('download'), page.click('.float-bar .btn')]);
      } else {
        const hidden = await page.$eval('.float-bar', (b) => getComputedStyle(b).display);
        check(`${label}: no floating bar on desktop`, () => assert.strictEqual(hidden, 'none'));
        [dl] = await Promise.all([page.waitForEvent('download'), page.click('#savePdf')]);
      }
      await page.waitForFunction(() => document.querySelector('#stepsBar li[data-step="3"]').classList.contains('done'));
      check(`${label}: saving completes step 3`, () => assert.strictEqual(dl.suggestedFilename().endsWith('.pdf'), true));

      /* Other tools: step names and quick picks */
      await page.goto(origin + '/watermark-pdf/');
      await page.setInputFiles('#pickFiles', file);
      await page.waitForFunction(() => !document.querySelector('#toolLayout').classList.contains('is-empty'));
      await page.click('.quick-picks .preset:has-text("Sulit")');
      const wm = await page.evaluate(() => [document.querySelector('#wmText').value, document.querySelector('#wmTile').checked]);
      check(`${label}: watermark quick pick "Sulit" fills the text and tiles it`, () => assert.deepStrictEqual(wm, ['SULIT', true]));
      await page.screenshot({ path: path.join(OUT, `guide-watermark-${label}.png`) });
      await page.goto(origin + '/tandatangan-pdf/');
      await page.waitForSelector('#stepsBar');
      const sign = await steps();
      check(`${label}: Sign PDF names step 2 "Letak tandatangan"`, () => assert.deepStrictEqual(sign, ['>1Pilih PDF', '2Letak tandatangan', '3Simpan']));
      await page.goto(origin + '/gambar-pdf/');
      await page.waitForSelector('#stepsBar');
      const img = await steps();
      check(`${label}: image tools ask for images`, () => assert.strictEqual(img[0], '>1Pilih gambar'));
      await page.goto(origin + '/banding-pdf/');
      await page.setInputFiles('#fileA', file);
      await page.setInputFiles('#fileB', file);
      await page.waitForFunction(() => !document.querySelector('#results').hidden);
      const cmp = await steps();
      check(`${label}: Compare has two steps`, () => assert.deepStrictEqual(cmp, ['✓1Pilih 2 PDF', '>2Lihat perbezaan']));
      await page.click('[data-lang="en"]');
      const en = await steps();
      check(`${label}: steps follow the language`, () => assert.deepStrictEqual(en, ['✓1Choose 2 PDFs', '>2See the differences']));
      await page.click('[data-lang="ms"]');
      for (const url of ['/', '/palang/', '/kecil-gambar/', '/aliran-kerja/', '/kongsi/']) {
        await page.goto(origin + url);
        await page.waitForTimeout(100);
        const n = await page.$$eval('#stepsBar', (els) => els.length);
        check(`${label}: ${url} has at most its own steps bar`, () => assert(n <= 1));
      }
      check(`${label}: no page errors or CSP violations`, () => assert.deepStrictEqual(errors, []));
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
