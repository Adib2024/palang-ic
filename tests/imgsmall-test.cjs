// Browser test for the interactive Compress Images tool (presets, custom
// settings, rotate/crop, before/after compare, paste), the display settings
// (text size, high contrast) and the dashboard search / recent tools.
// Run: NODE_PATH="$(npm root -g)" node tests/imgsmall-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));
const FRONT = path.join(__dirname, 'fixtures', 'sample-front-exif6.jpg'); // 1712×1080 after EXIF fix
const BACK = path.join(__dirname, 'fixtures', 'sample-back.jpg');

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
      const csp = [];
      page.on('request', (r) => { if (!/^(data|blob):/.test(r.url()) && !r.url().startsWith(origin)) foreign.push(r.url()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
      const idle = () => page.waitForFunction(() => !window.__imgsmall.pending && window.__imgsmall.items.every((it) => it.out), null, { timeout: 60000 });
      const outs = () => page.evaluate(() => window.__imgsmall.items.map((it) => ({ w: it.outW, h: it.outH, size: it.out.size, type: it.out.type, name: it.out.name, over: it.over })));
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

      /* ---------- Compress Images ---------- */
      await page.goto(origin + '/kecil-gambar/');
      const step0 = await page.getAttribute('#stepsBar li[aria-current="step"]', 'data-step');
      await page.setInputFiles('#pickFiles', [FRONT, BACK]);
      await page.waitForFunction(() => window.__imgsmall.items.length === 2);
      await idle();
      const step3 = await page.getAttribute('#stepsBar li[aria-current="step"]', 'data-step');
      check(`${label}: steps guide moves from 1 to 3`, () => assert.deepStrictEqual([step0, step3], ['1', '3']));
      const first = await outs();
      check(`${label}: default preset "Forms & portals" compresses live (≤ 200 KB, ≤ 1600 px)`, () => {
        first.forEach((o) => assert(o.size <= 204800 && Math.max(o.w, o.h) <= 1600 && !o.over, JSON.stringify(o)));
      });
      const sum = await page.textContent('#sumText');
      check(`${label}: summary shows total savings`, () => assert.match(sum, /^2 gambar · .+ → .+ \(jimat \d+%\)$/));

      await page.click('.preset[data-preset="profile"]');
      await idle();
      const prof = await outs();
      check(`${label}: preset "Profile & passport" gives ≤ 100 KB and ≤ 800 px`, () => {
        prof.forEach((o) => assert(o.size <= 102400 && Math.max(o.w, o.h) <= 800, JSON.stringify(o)));
        assert.strictEqual(prof[0].w, 800);
      });

      // Custom: WebP, 50% size, quality slider → no preset matches.
      await page.click('#custom summary');
      await page.selectOption('#limit', '0');
      await page.selectOption('#maxDim', 'p50');
      await page.check('input[name="format"][value="webp"]', { force: true });
      await page.fill('#quality', '60');
      await page.dispatchEvent('#quality', 'input');
      await idle();
      const web = await outs();
      const preset = await page.evaluate(() => window.__imgsmall.preset);
      check(`${label}: custom WebP at 50% size`, () => {
        assert.strictEqual(preset, 'custom');
        assert.deepStrictEqual([web[0].w, web[0].h, web[0].type, web[0].name], [856, 540, 'image/webp', 'sample-front-exif6-kecil.webp']);
      });
      // Custom size limit in KB.
      await page.selectOption('#limit', 'custom');
      await page.fill('#limitCustom', '30');
      await page.check('input[name="format"][value="jpeg"]', { force: true });
      await idle();
      const tiny = await outs();
      check(`${label}: custom size limit (30 KB) is respected`, () => tiny.forEach((o) => assert(o.size <= 30 * 1024 && !o.over, JSON.stringify(o))));

      // Rotate right + square crop through the dialog (High quality: no resizing).
      await page.click('.preset[data-preset="best"]');
      await idle();
      await page.click('.img-item >> nth=0 >> button:has-text("Edit")');
      await page.waitForSelector('#editDlg[open]');
      await page.click('#rotR');
      await page.click('#aspectSet label:has-text("1:1") span');
      await page.screenshot({ path: path.join(OUT, `imgsmall-edit-${label}.png`) });
      await page.click('#editApply');
      await idle();
      const sq = (await outs())[0];
      const meta = await page.textContent('.img-item >> nth=0 >> .img-meta');
      check(`${label}: rotate + 1:1 crop gives a square portrait crop`, () => {
        assert.deepStrictEqual([sq.w, sq.h], [1080, 1080]);
        assert.match(meta, /diedit/);
      });
      // Drag the crop corner (free ratio): the box follows the pointer.
      await page.click('.img-item >> nth=1 >> button:has-text("Edit")');
      await page.waitForSelector('#editDlg[open]');
      await page.waitForTimeout(300);
      const cv = await page.$eval('#cropCanvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      const h = await page.$eval('.crop-h[data-h="se"]', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width - 8, y: r.y + r.height - 8 }; });
      await page.mouse.move(h.x, h.y);
      await page.mouse.down();
      await page.mouse.move(cv.x + cv.w * 0.5, cv.y + cv.h * 0.5, { steps: 6 });
      await page.mouse.up();
      const boxSize = await page.$eval('#cropBox', (b) => [b.style.width, b.style.height]);
      await page.click('#editApply');
      await idle();
      const half = (await outs())[1];
      check(`${label}: dragging the crop corner crops to that point`, () => {
        assert(Math.abs(half.w - 856) <= 20 && Math.abs(half.h - 540) <= 20, JSON.stringify([half, boxSize]));
      });

      // Before/after compare.
      await page.click('.img-item >> nth=0 >> button:has-text("Banding")');
      await page.waitForSelector('#cmpDlg[open]');
      await page.fill('#cmpRange', '30');
      await page.dispatchEvent('#cmpRange', 'input');
      const clip = await page.$eval('#cmpAfter', (e) => e.style.clipPath);
      const labels = await page.textContent('.cmp-labels');
      await page.screenshot({ path: path.join(OUT, `imgsmall-compare-${label}.png`) });
      check(`${label}: compare slider reveals the result`, () => {
        assert.strictEqual(clip, 'inset(0px 0px 0px 30%)');
        assert.match(labels, /asal .*selepas/i);
      });
      await page.keyboard.press('Escape');

      // Paste an image from the clipboard.
      await page.evaluate(async () => {
        const c = document.createElement('canvas');
        c.width = 300; c.height = 200;
        c.getContext('2d').fillRect(0, 0, 150, 100);
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        const dt = new DataTransfer();
        dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
      });
      await page.waitForFunction(() => window.__imgsmall.items.length === 3);
      await idle();
      const pasted = await page.evaluate(() => window.__imgsmall.items[2].out.name);
      check(`${label}: pasting an image adds it`, () => assert.strictEqual(pasted, 'tampal-1-kecil.jpg'));
      const ov = await overflow();
      check(`${label}: no horizontal scroll with images loaded`, () => assert(ov <= 0, `${ov}px`));
      await page.screenshot({ path: path.join(OUT, `imgsmall-live-${label}.png`), fullPage: true });

      /* ---------- Display settings ---------- */
      await page.click('#a11yBtn');
      const popBox = await page.$eval('#a11yPop', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; });
      check(`${label}: display panel is fully on screen`, () => assert(popBox.l >= 0 && popBox.r <= viewport.width, JSON.stringify(popBox)));
      await page.click('[data-size="xl"]');
      await page.click('#a11yContrast');
      await page.reload();
      const attrs = await page.evaluate(() => [document.documentElement.dataset.text, document.documentElement.dataset.contrast, getComputedStyle(document.documentElement).fontSize]);
      check(`${label}: text size and high contrast are remembered`, () => assert.deepStrictEqual(attrs, ['xl', 'high', '20px']));
      for (const url of ['/kecil-gambar/', '/', '/palang/', '/tandatangan-pdf/']) {
        await page.goto(origin + url);
        const o = await overflow();
        check(`${label}: ${url} fits the screen at the largest text size`, () => assert(o <= 0, `${o}px`));
      }
      await page.screenshot({ path: path.join(OUT, `dashboard-xl-${label}.png`) });
      await page.click('#a11yBtn');
      await page.click('[data-size="md"]');
      await page.click('#a11yContrast');
      await page.keyboard.press('Escape');

      /* ---------- Dashboard search + recent ---------- */
      await page.goto(origin + '/');
      const visible = () => page.$$eval('.tool:not([hidden])', (els) => els.map((e) => e.getAttribute('href')));
      const recent = await page.$$eval('#recent a', (els) => els.map((e) => e.getAttribute('href')));
      check(`${label}: recently used tools are listed (newest first)`, () => assert.deepStrictEqual(recent.slice(0, 3), ['tandatangan-pdf/', 'palang/', 'kecil-gambar/']));
      await page.fill('#toolSearch', 'tandatangan');
      const ms = await visible();
      check(`${label}: search finds a tool by its Malay name`, () => assert.deepStrictEqual(ms, ['tandatangan-pdf/']));
      await page.fill('#toolSearch', 'signature');
      const en = await visible();
      check(`${label}: search also matches English words`, () => assert.deepStrictEqual(en, ['tandatangan-pdf/']));
      await page.fill('#toolSearch', 'word');
      const words = await visible();
      check(`${label}: search "word" finds PDF → Word`, () => assert(words.includes('pdf-word/'), JSON.stringify(words)));
      await page.click('.chip[data-cat="security"]');
      await page.fill('#toolSearch', 'pdf');
      const sec = await visible();
      check(`${label}: search combines with the category chip`, () => assert.deepStrictEqual(sec, ['tandatangan-pdf/', 'hitamkan-pdf/', 'buka-kunci-pdf/', 'lindungi-pdf/']));
      await page.click('.chip[data-cat="all"]');
      await page.fill('#toolSearch', 'zzzz');
      const none = await page.textContent('#noTools');
      check(`${label}: no-match message`, () => assert.strictEqual(none, 'Tiada alat sepadan dengan "zzzz".'));
      await page.fill('#toolSearch', 'kecil gambar');
      await Promise.all([page.waitForURL(/kecil-gambar/), page.press('#toolSearch', 'Enter')]);
      check(`${label}: Enter opens the first match`, () => assert.match(page.url(), /\/kecil-gambar\/$/));
      if (!mobile) {
        await page.goto(origin + '/');
        await page.keyboard.press('/');
        const focused = await page.evaluate(() => document.activeElement.id);
        check(`${label}: "/" focuses the search box`, () => assert.strictEqual(focused, 'toolSearch'));
      }

      check(`${label}: no requests to other sites`, () => assert.deepStrictEqual(foreign, []));
      check(`${label}: no page errors or CSP violations`, () => assert.deepStrictEqual([...errors, ...csp], []));
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
