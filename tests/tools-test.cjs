// Browser test for the DokuJaga dashboard and the Images -> PDF tool,
// using the FAKE sample cards in tests/fixtures.
// Run: NODE_PATH="$(npm root -g)" node tests/tools-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));
const FRONT = path.join(__dirname, 'fixtures/sample-front-exif6.jpg');
const BACK = path.join(__dirname, 'fixtures/sample-back.jpg');

// Count pages and read each page's MediaBox with pypdf when it's available.
function inspectPdf(file) {
  try {
    const out = execFileSync('python3', ['-I', '-c', [
      'import sys, json, pypdf',
      'r = pypdf.PdfReader(sys.argv[1])',
      'print(json.dumps([[float(v) for v in p.mediabox] for p in r.pages]))',
    ].join('\n'), file], { encoding: 'utf8' });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const results = [];
  const check = (name, fn) => { fn(); results.push(`ok   ${name}`); };

  try {
    for (const [label, viewport, mobile] of [['desktop', { width: 1280, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, acceptDownloads: true });
      const page = await context.newPage();
      const foreign = [];
      const errors = [];
      page.on('request', (r) => { if (!/^(data|blob):/.test(r.url()) && !r.url().startsWith(origin)) foreign.push(r.url()); });
      page.on('pageerror', (e) => errors.push(String(e)));

      // Dashboard
      await page.goto(origin + '/');
      const cards = await page.$$eval('.tool', (els) => els.map((e) => ({ href: e.getAttribute('href'), soon: e.classList.contains('soon') })));
      check(`${label}: dashboard lists 19 tools`, () => {
        assert.deepStrictEqual(cards.map((c) => c.href), [
          'palang/', 'gabung-pdf/', 'pisah-pdf/', 'kecilkan-pdf/', 'gambar-pdf/', 'pdf-gambar/', 'tandatangan-pdf/', 'edit-pdf/', 'hitamkan-pdf/', 'buka-kunci-pdf/', 'lindungi-pdf/', 'imbas/', 'watermark-pdf/', 'putar-pdf/', 'nombor-pdf/', 'potong-pdf/', 'isi-borang/', 'susun-pdf/', 'kecil-gambar/',
        ]);
        assert(cards.every((c) => !c.soon));
      });
      const pops = await page.$$eval('.tool.popular', (els) => els.map((e) => e.getAttribute('href')));
      const hero = await page.$$eval('.tool.hero-tool', (els) => els.map((e) => e.getAttribute('href')));
      check(`${label}: Palang IC, Merge and Sign are highlighted as Popular`, () => {
        assert.deepStrictEqual(pops, ['palang/', 'gabung-pdf/', 'tandatangan-pdf/']);
        assert.deepStrictEqual(hero, ['palang/']);
      });
      await page.click('.chip[data-cat="edit"]');
      const shown = await page.$$eval('.tool', (els) => els.filter((e) => !e.hidden).map((e) => e.getAttribute('href')));
      check(`${label}: category chip filters the tools`, () => {
        assert.deepStrictEqual(shown, ['edit-pdf/', 'watermark-pdf/', 'putar-pdf/', 'nombor-pdf/', 'potong-pdf/', 'isi-borang/']);
      });
      await page.click('.chip[data-cat="security"]');
      const secure = await page.$$eval('.tool', (els) => els.filter((e) => !e.hidden).map((e) => e.getAttribute('href')));
      check(`${label}: security chip shows the security tools`, () => {
        assert.deepStrictEqual(secure, ['palang/', 'tandatangan-pdf/', 'hitamkan-pdf/', 'buka-kunci-pdf/', 'lindungi-pdf/']);
      });
      await page.click('.chip[data-cat="all"]');
      const overflowHome = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${label}: dashboard has no horizontal scroll`, () => assert(overflowHome <= 0, `${overflowHome}px`));
      await page.screenshot({ path: path.join(OUT, `dashboard-${label}.png`), fullPage: true });

      await page.click('a.tool[href="palang/"]');
      await page.waitForURL('**/palang/');
      check(`${label}: Palang IC opens from dashboard`, () => assert.match(page.url(), /\/palang\/$/));
      await page.goto(origin + '/');
      await page.click('a.tool[href="gambar-pdf/"]');
      await page.waitForURL('**/gambar-pdf/');

      // Images -> PDF
      const txt = path.join(OUT, 'not-an-image.txt');
      fs.writeFileSync(txt, 'hello');
      await page.setInputFiles('#pickFiles', [FRONT, BACK, txt]);
      await page.waitForFunction(() => window.__img2pdf.items.length === 2);
      const status = await page.textContent('#status');
      check(`${label}: adds images, skips non-images`, () => {
        assert.match(status, /2 gambar ditambah/);
        assert.match(status, /1 fail bukan gambar dilangkau/);
      });
      const upright = await page.evaluate(() => window.__img2pdf.items.map((it) => it.canvas.width > it.canvas.height));
      check(`${label}: EXIF-rotated photo is upright`, () => assert.deepStrictEqual(upright, [true, true]));

      // Reorder with the ▶ button, rotate the (new) second page.
      const firstId = await page.evaluate(() => window.__img2pdf.items[0].id);
      await page.click('.page-card:nth-child(1) .icon-btn:nth-child(2)');
      const afterMove = await page.evaluate(() => window.__img2pdf.items.map((it) => it.id));
      check(`${label}: ▶ moves a page right`, () => assert.strictEqual(afterMove[1], firstId));
      await page.click('.page-card:nth-child(2) .icon-btn:nth-child(3)');
      await page.waitForFunction(() => window.__img2pdf.items[1].rotation === 90);

      if (!mobile) {
        // Desktop drag-and-drop reorder: drag card 2 onto card 1.
        await page.dragAndDrop('.page-card:nth-child(2)', '.page-card:nth-child(1)');
        const afterDrag = await page.evaluate(() => window.__img2pdf.items.map((it) => it.id));
        check('desktop: drag-and-drop reorders pages', () => assert.strictEqual(afterDrag[0], firstId));
        await page.dragAndDrop('.page-card:nth-child(1)', '.page-card:nth-child(2)');
      }

      await page.screenshot({ path: path.join(OUT, `img2pdf-${label}.png`), fullPage: true });

      // Save PDF via the real button and catch the download.
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('#makePdf')]);
      const pdfPath = path.join(OUT, `img2pdf-${label}.pdf`);
      await download.saveAs(pdfPath);
      const bytes = fs.readFileSync(pdfPath);
      check(`${label}: PDF downloaded as dokumen.pdf`, () => {
        assert.strictEqual(download.suggestedFilename(), 'dokumen.pdf');
        assert.strictEqual(bytes.subarray(0, 8).toString(), '%PDF-1.4');
      });
      const boxes = inspectPdf(pdfPath);
      if (boxes) {
        check(`${label}: 2 A4 pages, auto orientation follows each image`, () => {
          assert.strictEqual(boxes.length, 2);
          // Page 1: landscape back card; page 2: front card rotated 90° → portrait.
          assert.deepStrictEqual(boxes[0].map(Math.round), [0, 0, 842, 595]);
          assert.deepStrictEqual(boxes[1].map(Math.round), [0, 0, 595, 842]);
        });
      }
      const doneMsg = await page.textContent('#status');
      check(`${label}: status shows page count and size`, () => assert.match(doneMsg, /Siap: 2 muka surat, \d+(\.\d)? (KB|MB)\./));

      // "Fit image" pages match the image's aspect ratio.
      await page.click('input[name="pageSize"][value="fit"] + span');
      const fitBoxes = await page.evaluate(async () => {
        const f = await window.__img2pdf.buildPdfFile();
        const txt = new TextDecoder('latin1').decode(new Uint8Array(await f.arrayBuffer()));
        return [...txt.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
      });
      const ratios = await page.evaluate(() => window.__img2pdf.items.map((it) => {
        const swap = it.rotation % 180 !== 0;
        return swap ? it.canvas.height / it.canvas.width : it.canvas.width / it.canvas.height;
      }));
      check(`${label}: "fit image" page sizes follow image aspect`, () => {
        // Margin "small" (24pt each side) is added around the image.
        fitBoxes.forEach(([w, h], i) => assert(Math.abs((w - 48) / (h - 48) - ratios[i]) < 0.01, `${w}x${h} vs ${ratios[i]}`));
      });
      await page.click('input[name="pageSize"][value="a4"] + span');

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${label}: tool page has no horizontal scroll`, () => assert(overflow <= 0, `${overflow}px`));
      check(`${label}: no requests to other origins`, () => assert.deepStrictEqual(foreign, []));
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
