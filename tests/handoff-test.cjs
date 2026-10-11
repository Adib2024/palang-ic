// Browser test for handing files on, all on the device:
//  - Web Share Target: a POST to kongsi/ (as Android does) lands in the inbox
//    and the tool picker offers the right tools,
//  - "Teruskan ke…" after saving passes the result to the next tool.
// Run: NODE_PATH="$(npm root -g)" node tests/handoff-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));
const IC = fs.readFileSync(path.join(__dirname, 'fixtures/sample-front-exif6.jpg'));

async function makePdf(label) {
  const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  const d = await L.PDFDocument.create();
  const f = await d.embedFont(L.StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) d.addPage([595.28, 841.89]).drawText(`${label} ${i}`, { x: 60, y: 760, size: 24, font: f });
  const bytes = await d.save();
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** What Android does for a share: POST multipart to the share_target action. */
async function postShare({ files }) {
  const fd = new FormData();
  for (const f of files) fd.append('files', new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
  const res = await fetch('/kongsi/', { method: 'POST', body: fd });
  return { status: res.status, url: res.url, redirected: res.redirected };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const origin = `http://localhost:${server.address().port}`; // service workers need https or localhost
  const browser = await chromium.launch();
  const results = [];
  const check = (name, fn) => { fn(); results.push(`ok   ${name}`); };
  try {
    for (const [label, viewport, mobile] of [['desktop', { width: 1280, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
      const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, acceptDownloads: true });
      const page = await context.newPage();
      const errors = [];
      const csp = [];
      const foreign = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
      page.on('request', (r) => { if (!/^(data|blob):/.test(r.url()) && !r.url().startsWith(origin)) foreign.push(r.url()); });

      const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.webmanifest'), 'utf8'));
      check(`${label}: manifest declares a share target for PDFs and images`, () => {
        assert.strictEqual(manifest.share_target.action, 'kongsi/');
        assert.strictEqual(manifest.share_target.method, 'POST');
        assert(manifest.share_target.params.files[0].accept.includes('application/pdf'));
        assert(manifest.share_target.params.files[0].accept.includes('image/*'));
      });

      // Install the service worker.
      await page.goto(origin + '/');
      await page.evaluate(() => navigator.serviceWorker.ready);
      const pdfA = await page.evaluate(makePdf, 'SURAT');
      const pdfB = await page.evaluate(makePdf, 'SURAT BARU');

      /* ---------- Share an IC photo → Palang IC ---------- */
      // POST from a page without the app's CSP (the OS posts directly too).
      await page.goto(origin + '/icons/icon.svg');
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      const r1 = await page.evaluate(postShare, { files: [{ name: 'ic.jpg', type: 'image/jpeg', b64: IC.toString('base64') }] });
      check(`${label}: share POST is answered by the service worker with the picker`, () => {
        assert(/\/kongsi\/\?shared=1$/.test(r1.url) && r1.status === 200, JSON.stringify(r1));
      });
      await page.goto(origin + '/kongsi/?shared=1');
      await page.waitForFunction(() => window.__share && window.__share.files.length === 1);
      const shown = await page.$$eval('[data-href]:not([hidden])', (els) => els.map((e) => e.dataset.href));
      check(`${label}: a photo is offered to the photo tools`, () => {
        assert(shown.includes('palang/') && shown.includes('gambar-pdf/') && shown.includes('ocr-pdf/'));
        assert(!shown.includes('kecilkan-pdf/'));
      });
      await page.screenshot({ path: path.join(OUT, `share-picker-${label}.png`), fullPage: true });
      await page.click('[data-href="palang/"]');
      await page.waitForURL(/\/palang\/$/);
      await page.waitForFunction(() => window.__palangic && window.__palangic.state.photos.front);
      const inboxAfter = await page.evaluate(() => new Promise((res) => {
        const r = indexedDB.open('dokujaga-handoff', 1);
        r.onsuccess = () => { const g = r.result.transaction('inbox').objectStore('inbox').get('current'); g.onsuccess = () => res(!!g.result); };
      }));
      check(`${label}: Palang IC opens with the shared photo; inbox is emptied`, () => assert.strictEqual(inboxAfter, false));

      /* ---------- Share two PDFs → Compare fills A and B ---------- */
      await page.goto(origin + '/icons/icon.svg');
      await page.evaluate(postShare, { files: [{ name: 'v1.pdf', type: 'application/pdf', b64: pdfA }, { name: 'v2.pdf', type: 'application/pdf', b64: pdfB }] });
      await page.goto(origin + '/kongsi/?shared=1');
      await page.waitForFunction(() => window.__share && window.__share.files.length === 2);
      const two = await page.$$eval('[data-href]:not([hidden])', (els) => els.map((e) => e.dataset.href));
      check(`${label}: two PDFs are offered to PDF tools only`, () => {
        assert(two.includes('banding-pdf/') && two.includes('gabung-pdf/'));
        assert(!two.includes('palang/') && !two.includes('kecilkan-pdf/'));
      });
      await page.click('[data-href="banding-pdf/"]');
      await page.waitForFunction(() => window.__compare && window.__compare.result, null, { timeout: 60000 });
      const cmp = await page.evaluate(() => [window.__compare.docs.A.name, window.__compare.docs.B.name]);
      check(`${label}: Compare gets the two shared PDFs as A and B`, () => assert.deepStrictEqual(cmp, ['v1.pdf', 'v2.pdf']));

      /* ---------- "Teruskan ke…" from Merge to Sign ---------- */
      await page.goto(origin + '/gabung-pdf/');
      const pdf = (name, b64) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(b64, 'base64') });
      await page.setInputFiles('#pickFiles', [pdf('a.pdf', pdfA), pdf('b.pdf', pdfB)]);
      await page.waitForFunction(() => window.__merge.files.length === 2);
      await page.fill('#fileName', 'gabungan');
      await Promise.all([page.waitForEvent('download'), page.click('#savePdf')]);
      await page.waitForSelector('.next-bar');
      const chips = await page.$$eval('.next-chip', (els) => els.map((e) => e.dataset.next));
      check(`${label}: after saving, "Continue to" offers next tools (not Merge itself)`, () => {
        assert(chips.includes('tandatangan-pdf/') && chips.includes('kecilkan-pdf/') && chips.includes('kongsi/'));
        assert(!chips.includes('gabung-pdf/'));
      });
      await page.waitForTimeout(300); // entry animation
      const fit = await page.evaluate(() => {
        const r = document.querySelector('.next-bar').getBoundingClientRect();
        const de = document.documentElement;
        return { inside: r.left >= 0 && r.right <= de.clientWidth && r.bottom <= de.clientHeight, overflow: de.scrollWidth - de.clientWidth };
      });
      check(`${label}: the bar fits on screen`, () => assert.deepStrictEqual(fit, { inside: true, overflow: 0 }));
      await page.screenshot({ path: path.join(OUT, `next-bar-${label}.png`) });
      await page.click('.next-chip[data-next="tandatangan-pdf/"]');
      await page.waitForURL(/\/tandatangan-pdf\/$/);
      await page.waitForFunction(() => window.__sign && window.__sign.views.length === 4);
      const fname = await page.textContent('#docTitle');
      check(`${label}: Sign PDF opens the merged file (4 pages)`, () => assert.strictEqual(fname, 'gabungan.pdf'));

      // "Other tools…" keeps the file for the picker.
      await page.goto(origin + '/watermark-pdf/');
      await page.setInputFiles('#pickFiles', pdf('surat.pdf', pdfA));
      await page.waitForFunction(() => !document.querySelector('#savePdf').disabled);
      await Promise.all([page.waitForEvent('download'), page.click('#savePdf')]);
      await page.waitForSelector('.next-bar');
      await page.click('.next-chip.more');
      await page.waitForURL(/\/kongsi\/$/);
      await page.waitForFunction(() => window.__share && window.__share.files.length === 1);
      const picked = await page.evaluate(() => window.__share.files[0].name);
      check(`${label}: "Other tools…" opens the picker with the result`, () => assert.match(picked, /\.pdf$/));

      check(`${label}: no requests to other origins`, () => assert.deepStrictEqual(foreign, []));
      check(`${label}: no CSP violations`, () => assert.deepStrictEqual(csp, []));
      check(`${label}: no page errors`, () => assert.deepStrictEqual(errors, []));
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(results.join('\n'));
  console.log(`\nAll ${results.length} checks passed. Output in ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
