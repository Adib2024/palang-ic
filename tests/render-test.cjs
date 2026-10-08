// End-to-end render test using the FAKE sample cards in tests/fixtures.
// Run: NODE_PATH="$(npm root -g)" node tests/render-test.cjs [outDir]
// Writes preview screenshots + exported JPG/PDF to outDir (default tests/output).
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
    for (const scheme of ['light', 'dark']) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true,
      });
      const page = await context.newPage();
      const foreign = [];
      const errors = [];
      page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreign.push(r.url()); });
      page.on('pageerror', (e) => errors.push(String(e)));

      await page.goto(origin + '/palang/');
      await page.setInputFiles('[data-input="front"]', path.join(__dirname, 'fixtures/sample-front-exif6.jpg'));
      await page.setInputFiles('[data-input="back"]', path.join(__dirname, 'fixtures/sample-back.jpg'));
      await page.waitForSelector('[data-preview="back"]:not([hidden])');
      await page.fill('#recipient', 'cimb');
      await page.check('#addDate');
      await page.waitForTimeout(100);

      if (scheme === 'light') {
        const dims = await page.evaluate(() => {
          const p = window.__palangic.state.photos.front;
          return { w: p.width, h: p.height };
        });
        check('EXIF orientation 6 photo is upright (landscape)', () => assert(dims.w > dims.h, JSON.stringify(dims)));

        const mode = await page.evaluate(() => window.__palangic.state.mode);
        check('default mode is palang', () => assert.strictEqual(mode, 'palang'));

        const text = await page.evaluate(() => window.__palangic.options().text);
        check('BM template + date', () => assert.match(text, /^UNTUK KEGUNAAN CIMB SAHAJA · \d{2}\/\d{2}\/\d{4}$/));

        // Every mode / sub-option, screenshotted from the full-size render.
        const variants = [
          ['palang-corner', {}], ['palang-corner-br', { stampAt: { corner: 'br' } }],
          ['palang-full', { palangShape: 'parallel' }], ['palang-x', { palangShape: 'x' }],
          ['palang-double', { palangShape: 'parallel', lineStyle: 'double' }],
          ['tiled', {}], ['tiled-high', { density: 'high' }], ['gabung', {}],
        ];
        for (const [name, extra] of variants) {
          const mode = name.split('-')[0];
          await page.click(`input[name="mode"][value="${mode}"] + span`);
          const b64 = await page.evaluate(async ({ extra }) => {
            const app = window.__palangic;
            const o = { ...app.options(), ...extra };
            const photo = app.state.photos.front;
            const c = document.createElement('canvas');
            c.width = photo.width; c.height = photo.height;
            const ctx = c.getContext('2d');
            ctx.drawImage(photo, 0, 0);
            app.renderWatermark(ctx, c.width, c.height, o);
            return c.toDataURL('image/jpeg', 0.85).split(',')[1];
          }, { extra });
          fs.writeFileSync(path.join(OUT, `mode-${name}.jpg`), Buffer.from(b64, 'base64'));
        }

        // Corner stamp is the default palang; picking a corner and dragging move it.
        await page.click('input[name="mode"][value="palang"] + span');
        const shape = await page.evaluate(() => window.__palangic.state.palangShape);
        check('default palang shape is corner stamp', () => assert.strictEqual(shape, 'corner'));
        await page.click('input[name="corner"][value="br"] + span');
        const preset = await page.evaluate(() => window.__palangic.state.stamp.back.corner);
        check('corner picker applies to both sides', () => assert.strictEqual(preset, 'br'));
        await page.locator('[data-preview="front"] canvas').evaluate((el) => el.scrollIntoView({ block: 'center' }));
        const box = await page.locator('[data-preview="front"] canvas').boundingBox();
        await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 5 });
        await page.mouse.up();
        const dragged = await page.evaluate(() => window.__palangic.state.stamp);
        check('dragging moves only that side\'s stamp', () => {
          assert.strictEqual(dragged.front.corner, 'custom');
          assert(Math.abs(dragged.front.x - 0.5) < 0.02 && Math.abs(dragged.front.y - 0.6) < 0.02, JSON.stringify(dragged.front));
          assert.strictEqual(dragged.back.corner, 'br');
        });
        await page.locator('[data-preview="front"] canvas').screenshot({ path: path.join(OUT, 'dragged-preview.png') });

        // Stamp bars match the text length and the stamp never leaves the
        // image, even on a wide, short photo (regression: clipped stamp).
        const geo = await page.evaluate(async () => {
          const wm = await import('/js/watermark.js');
          const out = [];
          for (const [w, h] of [[2400, 700], [700, 2400], [1712, 1080]]) {
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const ctx = c.getContext('2d');
            for (const corner of ['tl', 'tr', 'bl', 'br']) {
              for (const stampSize of [20, 40, 54, 80]) {
                const o = { ...wm.DEFAULTS, text: 'UNTUK KEGUNAAN ASNB SAHAJA', stampSize, stampAt: { corner } };
                const g = wm.stampGeometry(ctx, w, h, o);
                ctx.font = `700 ${Math.round(g.fontPx)}px "Helvetica Neue", Arial, "Segoe UI", Roboto, sans-serif`;
                out.push({ w, h, corner, stampSize, textW: ctx.measureText(o.text).width, ...g });
              }
            }
          }
          return out;
        });
        check('corner stamp stays fully inside the image', () => {
          for (const g of geo) {
            assert(g.cx - g.ex >= -0.5 && g.cx + g.ex <= g.w + 0.5 && g.cy - g.ey >= -0.5 && g.cy + g.ey <= g.h + 0.5,
              `out of bounds: ${JSON.stringify(g)}`);
          }
        });
        check('stamp bars are as long as the text (+ small padding)', () => {
          for (const g of geo) {
            // Bars = rendered text width + 0.5·font padding at each end.
            const err = Math.abs(g.len - g.fontPx - g.textW) / g.textW;
            assert(err < 0.03, `bars ${g.len.toFixed(1)} vs text ${g.textW.toFixed(1)} (+${g.fontPx.toFixed(1)})`);
          }
        });
        check('stamp size slider changes stamp size', () => {
          const wide = geo.filter((g) => g.w === 2400 && g.corner === 'tl');
          for (let i = 1; i < wide.length; i++) assert(wide[i].len > wide[i - 1].len, JSON.stringify(wide.map((g) => g.len)));
        });
        const wideShot = await page.evaluate(async () => {
          const wm = await import('/js/watermark.js');
          const c = document.createElement('canvas');
          c.width = 2400; c.height = 700;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#e8eef7'; ctx.fillRect(0, 0, c.width, c.height);
          for (const corner of ['tl', 'br']) {
            wm.renderWatermark(ctx, c.width, c.height, { mode: 'palang', text: 'UNTUK KEGUNAAN ASNB SAHAJA', stampSize: 54, stampAt: { corner } });
          }
          return c.toDataURL('image/png').split(',')[1];
        });
        fs.writeFileSync(path.join(OUT, 'stamp-wide.png'), Buffer.from(wideShot, 'base64'));

        // Mode is remembered across reloads.
        await page.click('input[name="mode"][value="tiled"] + span');
        await page.reload();
        const remembered = await page.evaluate(() => window.__palangic.state.mode);
        check('last mode remembered in localStorage', () => assert.strictEqual(remembered, 'tiled'));
        await page.click('input[name="mode"][value="palang"] + span');
        await page.setInputFiles('[data-input="front"]', path.join(__dirname, 'fixtures/sample-front-exif6.jpg'));
        await page.setInputFiles('[data-input="back"]', path.join(__dirname, 'fixtures/sample-back.jpg'));
        await page.waitForSelector('[data-preview="back"]:not([hidden])');
        await page.fill('#recipient', 'cimb');

        // Exports.
        const exported = await page.evaluate(async () => {
          const app = window.__palangic;
          const enc = async (f) => {
            const b = new Uint8Array(await f.arrayBuffer());
            let s = '';
            for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
            return { name: f.name, type: f.type, b64: btoa(s) };
          };
          const jpgs = await app.jpgFiles();
          return { jpgs: await Promise.all(jpgs.map(enc)), pdf: await enc(await app.pdfFile()) };
        });
        for (const f of [...exported.jpgs, exported.pdf]) fs.writeFileSync(path.join(OUT, f.name), Buffer.from(f.b64, 'base64'));
        check('exports 2 JPGs (front+back)', () => assert.deepStrictEqual(exported.jpgs.map((f) => f.name), ['ic-cimb-depan.jpg', 'ic-cimb-belakang.jpg']));
        const pdf = Buffer.from(exported.pdf.b64, 'base64');
        check('PDF has header, 2 images, EOF', () => {
          assert.strictEqual(pdf.subarray(0, 8).toString(), '%PDF-1.4');
          assert.strictEqual((pdf.toString('latin1').match(/\/Subtype \/Image/g) || []).length, 2);
          assert(pdf.toString('latin1').trimEnd().endsWith('%%EOF'));
        });

        // CSP blocks any outbound connection from the page.
        const blocked = await page.evaluate(async () => {
          try { await fetch('https://example.com/upload', { method: 'POST', body: 'x' }); return false; } catch { return true; }
        });
        check('CSP blocks fetch() to other hosts', () => assert(blocked));

        // Theme toggle flips light/dark and is remembered.
        await page.click('#themeToggle');
        const flipped = await page.evaluate(() => document.documentElement.dataset.theme);
        check('theme toggle switches to dark', () => assert.strictEqual(flipped, 'dark'));
        await page.screenshot({ path: path.join(OUT, 'page-toggled-dark.png'), fullPage: true });
        await page.reload();
        const kept = await page.evaluate(() => document.documentElement.dataset.theme);
        check('theme choice remembered', () => assert.strictEqual(kept, 'dark'));
        await page.click('#themeToggle');
        await page.setInputFiles('[data-input="front"]', path.join(__dirname, 'fixtures/sample-front-exif6.jpg'));
        await page.setInputFiles('[data-input="back"]', path.join(__dirname, 'fixtures/sample-back.jpg'));
        await page.waitForSelector('[data-preview="back"]:not([hidden])');
        await page.fill('#recipient', 'cimb');

        // English toggle.
        await page.click('[data-lang="en"]');
        const banner = await page.textContent('.privacy strong');
        const enText = await page.evaluate(() => window.__palangic.options().text);
        check('EN toggle switches UI + wording', () => {
          assert.match(banner, /Nothing is uploaded/);
          assert.match(enText, /^FOR CIMB USE ONLY/);
        });
        await page.click('[data-lang="ms"]');
      }

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${scheme}: no horizontal scroll at 390px`, () => assert(overflow <= 0, `overflow ${overflow}px`));
      await page.screenshot({ path: path.join(OUT, `page-${scheme}.png`), fullPage: true });

      check(`${scheme}: no requests to other origins`, () => assert.deepStrictEqual(foreign, []));
      check(`${scheme}: no page errors`, () => assert.deepStrictEqual(errors, []));
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(results.join('\n'));
  console.log(`\nAll ${results.length} checks passed. Output in ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
