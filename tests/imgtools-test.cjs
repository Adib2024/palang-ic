// Browser test for Image Notes (nota-gambar/) and Photo Collage
// (kolaj-gambar/), using the FAKE sample cards in tests/fixtures.
// Run: NODE_PATH="$(npm root -g)" node tests/imgtools-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
require('./bm.cjs'); // suites check BM wording; the site's default is English
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));
const FRONT = path.join(__dirname, 'fixtures/sample-front-exif6.jpg');
const BACK = path.join(__dirname, 'fixtures/sample-back.jpg');

const pdfBoxes = (file) => JSON.parse(execFileSync('python3', ['-I', '-c', [
  'import sys, json, pypdf',
  'r = pypdf.PdfReader(sys.argv[1])',
  'print(json.dumps([[round(float(v)) for v in p.mediabox] for p in r.pages]))',
].join('\n'), file], { encoding: 'utf8' }));

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
      const foreign = [];
      const errors = [];
      page.on('request', (r) => { if (!/^(data|blob):/.test(r.url()) && !r.url().startsWith(origin)) foreign.push(r.url()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) errors.push(m.text()); });
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

      /* ---------- Image Notes ---------- */
      await page.goto(`${origin}/nota-gambar/`);
      await page.setInputFiles('#pickFiles', BACK);
      await page.waitForFunction(() => window.__imgnote.photo);
      const cv = async () => page.$eval('#ntCanvas', (c) => { c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      let b = await cv();
      // Tap → a text note where tapped; typing changes it.
      await page.mouse.click(b.x + b.w * 0.3, b.y + b.h * 0.3);
      await page.fill('#ntText', 'SUDAH DIBAYAR');
      await page.dispatchEvent('#ntText', 'change');
      let items = await page.evaluate(() => window.__imgnote.items);
      check(`${label}: tap places a text note, typing edits it`, () => {
        assert.strictEqual(items.length, 1);
        assert.strictEqual(items[0].kind, 'text');
        assert.strictEqual(items[0].text, 'SUDAH DIBAYAR');
        assert(Math.abs(items[0].x1 - 0.3) < 0.02 && Math.abs(items[0].y1 - 0.3) < 0.02, JSON.stringify(items[0]));
      });
      // Drag → arrow, then a highlight from the quick pick.
      await page.click('label:has(> input[name="ntTool"][value="arrow"]) span');
      b = await cv();
      await page.mouse.move(b.x + b.w * 0.6, b.y + b.h * 0.8);
      await page.mouse.down();
      await page.mouse.move(b.x + b.w * 0.75, b.y + b.h * 0.6, { steps: 5 });
      await page.mouse.up();
      await page.click('.preset:has-text("Sorot")');
      b = await cv();
      await page.mouse.move(b.x + b.w * 0.1, b.y + b.h * 0.85);
      await page.mouse.down();
      await page.mouse.move(b.x + b.w * 0.45, b.y + b.h * 0.92, { steps: 5 });
      await page.mouse.up();
      items = await page.evaluate(() => window.__imgnote.items);
      check(`${label}: drag draws an arrow and a yellow highlight`, () => {
        assert.deepStrictEqual(items.map((i) => i.kind), ['text', 'arrow', 'mark']);
        assert(items[1].x2 > items[1].x1 && items[1].y2 < items[1].y1);
        assert.strictEqual(items[2].color, 'yellow');
      });
      await page.click('#undoStep');
      const afterUndo = await page.evaluate(() => window.__imgnote.items.length);
      await page.click('#redoStep');
      const afterRedo = await page.evaluate(() => window.__imgnote.items.length);
      check(`${label}: undo / redo`, () => assert.deepStrictEqual([afterUndo, afterRedo], [2, 3]));
      // Drag the text note to move it; Delete removes the selected arrow.
      b = await cv();
      await page.mouse.move(b.x + b.w * 0.3, b.y + b.h * 0.3);
      await page.mouse.down();
      await page.mouse.move(b.x + b.w * 0.4, b.y + b.h * 0.2, { steps: 5 });
      await page.mouse.up();
      const moved = await page.evaluate(() => window.__imgnote.items[0]);
      check(`${label}: dragging a note moves it`, () => assert(Math.abs(moved.x1 - 0.4) < 0.02 && Math.abs(moved.y1 - 0.2) < 0.02, JSON.stringify(moved)));
      await page.mouse.click(b.x + b.w * 0.675, b.y + b.h * 0.7);
      const selKind = await page.evaluate(() => window.__imgnote.items.find((i) => i.id === window.__imgnote.selected).kind);
      await page.click('#ntDelete');
      items = await page.evaluate(() => window.__imgnote.items);
      check(`${label}: tap selects the arrow, "Remove" deletes it`, () => { assert.strictEqual(selKind, 'arrow'); assert.deepStrictEqual(items.map((i) => i.kind), ['text', 'mark']); });
      // Keyboard: focus the photo, Enter adds a note, arrows move it.
      await page.click('label:has(> input[name="ntTool"][value="box"]) span');
      await page.focus('#ntCanvas');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Shift+ArrowRight');
      const kb = await page.evaluate(() => window.__imgnote.items.at(-1));
      check(`${label}: keyboard adds a box in the middle and moves it`, () => { assert.strictEqual(kb.kind, 'box'); assert(Math.abs((kb.x1 + kb.x2) / 2 - 0.55) < 0.001, JSON.stringify(kb)); });
      // The saved JPG: full size, the highlight tints the photo.
      const out = await page.evaluate(async () => {
        const f = await window.__imgnote.noteFile();
        const bmp = await createImageBitmap(f);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        const m = window.__imgnote.items.find((i) => i.kind === 'mark');
        const x = Math.round(((m.x1 + m.x2) / 2) * c.width); const y = Math.round(((m.y1 + m.y2) / 2) * c.height);
        const o = window.__imgnote.photo.canvas.getContext('2d').getImageData(x, y, 1, 1).data;
        return { name: f.name, type: f.type, w: bmp.width, h: bmp.height, px: [...ctx.getImageData(x, y, 1, 1).data], orig: [...o] };
      });
      check(`${label}: saved JPG keeps full size and shows the highlight`, () => {
        assert.deepStrictEqual([out.name, out.type, out.w, out.h], ['sample-back-nota.jpg', 'image/jpeg', 1712, 1080]);
        assert(out.orig[2] - out.px[2] > 40, JSON.stringify(out)); // yellow: less blue
      });
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#saveNote')]);
      check(`${label}: "Save" downloads the photo`, () => assert.strictEqual(dl.suggestedFilename(), 'sample-back-nota.jpg'));
      await page.screenshot({ path: path.join(OUT, `imgnote-${label}.png`), fullPage: true });
      const ovN = await overflow();
      check(`${label}: Image Notes fits the screen`, () => assert(ovN <= 0, `${ovN}px`));

      /* ---------- Photo Collage ---------- */
      await page.goto(`${origin}/kolaj-gambar/`);
      await page.setInputFiles('#pickFiles', [FRONT, BACK, BACK]);
      await page.waitForFunction(() => window.__collage.items.length === 3);
      await page.waitForFunction(() => document.querySelectorAll('#clPreview canvas').length === 2);
      const shown = await page.$$eval('#photoGrid .page-card', (els) => els.length);
      check(`${label}: 3 photos, 2 per page → 2 pages previewed`, () => assert.strictEqual(shown, 3));
      const [pdf] = await Promise.all([page.waitForEvent('download'), page.click('#saveCollage')]);
      const pdfPath = path.join(OUT, `collage-${label}.pdf`);
      await pdf.saveAs(pdfPath);
      check(`${label}: collage PDF has 2 A4 pages`, () => {
        assert.strictEqual(pdf.suggestedFilename(), 'kolaj.pdf');
        assert.deepStrictEqual(pdfBoxes(pdfPath), [[0, 0, 595, 842], [0, 0, 595, 842]]);
      });
      await page.click('label:has(> input[name="clGrid"][value="4"]) span');
      await page.click('label:has(> input[name="clFormat"][value="jpeg"]) span');
      await page.click('#photoGrid .page-card >> nth=0 >> .icon-btn >> nth=2');
      const jpg = await page.evaluate(async () => {
        const [f] = await window.__collage.buildFiles();
        const bmp = await createImageBitmap(f);
        return { n: (await window.__collage.buildFiles()).length, name: f.name, w: bmp.width, h: bmp.height, rot: window.__collage.items[0].rotation };
      });
      check(`${label}: 4 per page → one A4 JPG at 200 DPI, photo rotated`, () => assert.deepStrictEqual(jpg, { n: 1, name: 'kolaj.jpg', w: 1654, h: 2339, rot: 90 }));
      await page.click('label:has(> input[name="clPaper"][value="landscape"]) span');
      const land = await page.evaluate(async () => { const [f] = await window.__collage.buildFiles(); const bmp = await createImageBitmap(f); return [bmp.width, bmp.height]; });
      check(`${label}: landscape A4`, () => assert.deepStrictEqual(land, [2339, 1654]));
      // Whole photo leaves white beside the (now upright) card in a wide cell; "fill" doesn't.
      const edge = await page.evaluate(async () => {
        const s = window.__collage.settings;
        Object.assign(s, { grid: '2', paper: 'portrait' });
        const probe = () => { const c = window.__collage.renderPage(0, 0.5); return [...c.getContext('2d').getImageData(Math.round(c.width * 0.08), Math.round(c.height * 0.25), 1, 1).data]; };
        s.fit = 'contain'; const whole = probe();
        s.fit = 'cover'; const fill = probe();
        return { whole, fill };
      });
      check(`${label}: "Whole photo" never crops; "Fill" fills the box`, () => {
        assert(edge.whole.slice(0, 3).every((v) => v > 245), JSON.stringify(edge));
        assert(!edge.fill.slice(0, 3).every((v) => v > 245), JSON.stringify(edge));
      });
      await page.screenshot({ path: path.join(OUT, `collage-${label}.png`), fullPage: true });
      const ovC = await overflow();
      check(`${label}: Photo Collage fits the screen`, () => assert(ovC <= 0, `${ovC}px`));

      check(`${label}: no requests to other origins`, () => assert.deepStrictEqual(foreign, []));
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
