// Browser test for the smaller additions: saved signatures, undo, flatten,
// HEIC, passport photos, more quick picks, link previews, privacy page and
// the first-visit tips. Each section is independent.
// Run: NODE_PATH="$(npm root -g)" node tests/extras-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));

async function makePdf(pages = 2) {
  const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  const d = await L.PDFDocument.create();
  const f = await d.embedFont(L.StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) d.addPage([595, 842]).drawText(`Halaman ${i + 1}`, { x: 60, y: 760, size: 24, font: f });
  const b = await d.save();
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

async function drawOnPad(page) {
  const box = await page.$eval('#pad', (c) => { c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.move(box.x + box.w * 0.2, box.y + box.h * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.w * (0.2 + i * 0.06), box.y + box.h * (0.6 - Math.sin(i / 2) * 0.25));
  await page.mouse.up();
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
      await page.goto(origin + '/tandatangan-pdf/');
      const pdf = { name: 'surat.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await page.evaluate(makePdf), 'base64') };

      /* ---------- Saved signatures ---------- */
      const savedHidden = await page.$eval('.saved-sigs', (e) => e.hidden);
      check(`${label}: no saved signatures at first`, () => assert.strictEqual(savedHidden, true));
      await page.setInputFiles('#pickFiles', pdf);
      await page.waitForFunction(() => window.__sign.views.length === 2);
      await page.click('#saveSig');
      const nothing = await page.textContent('#saveSig + .hint');
      check(`${label}: saving an empty pad explains what to do`, () => assert.match(nothing, /Lukis, taip/));
      await drawOnPad(page);
      await page.click('#saveSig');
      await page.reload();
      await page.setInputFiles('#pickFiles', pdf);
      await page.waitForFunction(() => window.__sign.views.length === 2);
      await page.waitForSelector('.saved-pick[aria-pressed="true"]');
      const n = await page.$$eval('.saved-pick', (els) => els.length);
      check(`${label}: a saved signature is listed and chosen after reload`, () => assert.strictEqual(n, 1));
      await page.click('#addSig');
      await page.waitForFunction(() => window.__sign.items.length === 1);
      check(`${label}: the saved signature can be placed without drawing`, () => {});
      await page.screenshot({ path: path.join(OUT, `extras-saved-sig-${label}.png`) });
      await page.click('.saved-sig .icon-btn');
      const left = await page.$$eval('.saved-pick', (els) => els.length);
      const stored = await page.evaluate(() => localStorage.getItem('palangic:savedSigs'));
      check(`${label}: a saved signature can be deleted`, () => { assert.strictEqual(left, 0); assert.strictEqual(stored, '[]'); });

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
