// Offline test: after one online visit, the app and the OCR engine keep
// working with the network switched off (service worker caches).
// Run: NODE_PATH="$(npm root -g)" node tests/offline-test.cjs [outDir]
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const serve = require('./serve.cjs');

async function makeScan() {
  const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  const c = document.createElement('canvas');
  c.width = 1240; c.height = 1754;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#111'; ctx.font = '600 48px Arial, sans-serif';
  ['SURAT TAWARAN KERJA', 'Gaji pokok RM 3800'].forEach((l, i) => ctx.fillText(l, 120, 220 + i * 100));
  const jpg = await new Promise((r) => c.toBlob(async (b) => r(new Uint8Array(await b.arrayBuffer())), 'image/jpeg', 0.9));
  const d = await L.PDFDocument.create();
  const img = await d.embedJpg(jpg);
  d.addPage([595.28, 841.89]).drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  const bytes = await d.save();
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

(async () => {
  const server = await serve();
  const origin = `http://localhost:${server.address().port}`; // service workers need https or localhost
  const browser = await chromium.launch();
  const results = [];
  const check = (name, fn) => { fn(); results.push(`ok   ${name}`); };
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const runOcr = async (b64) => {
      await page.setInputFiles('#pickFiles', { name: 'imbas.pdf', mimeType: 'application/pdf', buffer: Buffer.from(b64, 'base64') });
      await page.click('#runOcr');
      await page.waitForFunction(() => window.__ocr.output || /tidak|error/i.test(document.querySelector('#status').textContent), null, { timeout: 240000 });
      return page.inputValue('#ocrText').catch(() => '');
    };

    // Online: first visit installs the service worker; use OCR once.
    await page.goto(origin + '/ocr-pdf/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // now controlled by the service worker
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const scan = await page.evaluate(makeScan);
    const online = await runOcr(scan);
    check('OCR works online (first use)', () => assert.match(online, /SURAT TAWARAN KERJA/));
    await page.goto(origin + '/');
    await page.goto(origin + '/gabung-pdf/');

    // Offline.
    await context.setOffline(true);
    await page.goto(origin + '/ocr-pdf/');
    const offline = await runOcr(scan);
    check('OCR still works with the network off', () => assert.match(offline, /SURAT TAWARAN KERJA/));
    const ocrPdf = await page.evaluate(() => window.__ocr.output && window.__ocr.output.pdf.size);
    check('offline OCR produces a searchable PDF', () => assert(ocrPdf > 1000));
    await page.goto(origin + '/');
    const tools = await page.$$eval('.tool', (els) => els.length);
    check('dashboard opens offline', () => assert(tools >= 21));
    await page.goto(origin + '/gabung-pdf/');
    const mergeReady = await page.isVisible('#dropzone');
    check('a visited tool opens offline', () => assert(mergeReady));
    check('no page errors', () => assert.deepStrictEqual(errors, []));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(results.join('\n'));
  console.log(`\nAll ${results.length} checks passed.`);
})().catch((e) => { console.error(e); process.exit(1); });
