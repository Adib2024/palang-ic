// Browser test for font choice: Edit PDF (embedded fonts, standard fonts,
// a font added from the device), Sign PDF and the workflow sign step.
// Run: NODE_PATH="$(npm root -g)" node tests/fonts-test.cjs [outDir]   (needs python3 + pypdf)
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));
const USER_FONT = path.join(__dirname, '..', 'vendor/fonts/caveat-400.ttf');
const py = (code, ...args) => execFileSync('python3', ['-I', '-c', code, ...args], { encoding: 'utf8' }).trim();
const fontsOf = (file) => JSON.parse(py([
  'import sys, json, pypdf',
  'r = pypdf.PdfReader(sys.argv[1])',
  'out = []',
  'for p in r.pages:',
  '    fs = p.get("/Resources", {}).get("/Font", {})',
  '    out.append(sorted(str(f.get_object()["/BaseFont"]) for f in fs.values()))',
  'print(json.dumps(out))',
].join('\n'), file));

async function makePdf() {
  const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  const d = await L.PDFDocument.create();
  d.addPage([595.28, 841.89]);
  const bytes = await d.save();
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function readPdf(b64) {
  const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), isEvalSupported: false, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/' }).promise;
  const p = await doc.getPage(1);
  const vp = p.getViewport({ scale: 1 });
  const tc = await p.getTextContent();
  return tc.items.filter((it) => it.str.trim()).map((it) => ({ s: it.str, x: it.transform[4] / vp.width, y: 1 - it.transform[5] / vp.height, h: it.transform[3] }));
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
      const foreign = [];
      const errors = [];
      const csp = [];
      page.on('request', (r) => { if (!/^(data|blob):/.test(r.url()) && !r.url().startsWith(origin)) foreign.push(r.url()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
      const save = async () => {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#savePdf')]);
        const p = path.join(OUT, `${label}-fonts-${dl.suggestedFilename()}`);
        await dl.saveAs(p);
        return { path: p, b64: fs.readFileSync(p).toString('base64') };
      };
      const textAt = async (x, y, text) => {
        await page.click('[data-tool="text"]');
        const ov = page.locator('.edit-overlay').first();
        await ov.scrollIntoViewIfNeeded();
        const b = await ov.boundingBox();
        await page.mouse.click(b.x + b.width * x, b.y + b.height * y);
        await page.keyboard.type(text);
        await page.click('[data-tool="select"]');
      };

      /* ---------- Edit PDF ---------- */
      await page.goto(origin + '/edit-pdf/');
      const groups = await page.$$eval('#fontFamily optgroup', (els) => els.map((g) => [g.label, g.children.length]));
      check(`${label}: font list has standard, basic, handwriting and formal groups`, () => {
        assert.deepStrictEqual(groups.map((g) => g[0]), ['Standard PDF (tiada muat turun)', 'Asas', 'Tulisan tangan', 'Rasmi & klasik']);
        assert.deepStrictEqual(groups.map((g) => g[1]), [3, 5, 3, 3]);
      });
      const pdf = await page.evaluate(makePdf);
      await page.setInputFiles('#pickFiles', { name: 'kosong.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf, 'base64') });
      await page.waitForFunction(() => window.__edit.views.length === 1);
      await page.selectOption('#fontFamily', 'roboto');
      await page.check('#fontBold');
      await textAt(0.1, 0.1, 'Roboto Tebal');
      await page.uncheck('#fontBold');
      await page.selectOption('#fontFamily', 'times');
      await textAt(0.1, 0.3, 'Times Biasa');
      await page.selectOption('#fontFamily', 'greatvibes');
      await textAt(0.1, 0.5, 'Tulisan Tangan');
      // A font from the device.
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.selectOption('#fontFamily', '__add')]);
      await chooser.setFiles({ name: 'FontSaya.ttf', mimeType: 'font/ttf', buffer: fs.readFileSync(USER_FONT) });
      await page.waitForFunction(() => [...document.querySelectorAll('#fontFamily option')].some((o) => o.textContent === 'FontSaya' && o.selected));
      check(`${label}: a font added from the device is listed and selected`, () => {});
      await textAt(0.1, 0.7, 'Font Sendiri');
      const placed = await page.evaluate(() => window.__edit.items.map((it) => ({ x: it.x, y: it.y, font: it.font, bold: it.bold })));
      await page.screenshot({ path: path.join(OUT, `fonts-edit-${label}.png`), fullPage: true });
      const out = await save();
      const fonts = fontsOf(out.path)[0];
      const items = await page.evaluate(readPdf, out.b64);
      check(`${label}: PDF embeds the chosen fonts (and uses Times as a standard font)`, () => {
        assert(fonts.some((f) => /Roboto.*Bold/i.test(f)), fonts.join());
        assert(fonts.includes('/Times-Roman'), fonts.join());
        assert(fonts.some((f) => /GreatVibes/i.test(f)), fonts.join());
        assert(fonts.some((f) => /Caveat/i.test(f)), fonts.join());
      });
      check(`${label}: text stays selectable and sits where it was typed`, () => {
        const want = { 'Roboto Tebal': 0, 'Times Biasa': 1, 'Tulisan Tangan': 2, 'Font Sendiri': 3 };
        for (const [s, i] of Object.entries(want)) {
          const it = items.find((x) => x.s === s);
          assert(it, `missing ${s} in ${JSON.stringify(items)}`);
          assert(Math.abs(it.x - placed[i].x) < 0.01, `${s} x ${it.x} vs ${placed[i].x}`);
          // Baseline a little below the top of the box.
          assert(it.y > placed[i].y && it.y - placed[i].y < 0.04, `${s} y ${it.y} vs ${placed[i].y}`);
        }
      });
      await page.setInputFiles('#fontFamily + input[type=file]', { name: 'rosak.ttf', mimeType: 'font/ttf', buffer: Buffer.from('bukan font') });
      await page.waitForFunction(() => /tidak dapat dibaca/.test(document.querySelector('#status').textContent));
      check(`${label}: a broken font file shows a message`, () => {});

      /* ---------- Sign PDF ---------- */
      await page.goto(origin + '/tandatangan-pdf/');
      await page.click('input[name="sigTab"][value="type"] + span');
      await page.selectOption('#sigFont', 'greatvibes');
      await page.fill('#typedName', 'Ali Abu');
      await page.waitForFunction(() => [...document.fonts].some((f) => f.family === 'dj-greatvibes-400' && f.status === 'loaded'));
      const ink = await page.evaluate(() => {
        const c = document.querySelector('#typedPreview');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 100) n++;
        return n;
      });
      const firstSig = await page.$eval('#sigFont optgroup', (g) => g.label);
      check(`${label}: typed signature uses the chosen handwriting font`, () => {
        assert(ink > 500, `ink ${ink}`);
        assert.strictEqual(firstSig, 'Tulisan tangan');
      });
      const textFonts = await page.$$eval('#textFont option', (els) => els.length);
      check(`${label}: text & date have their own font list`, () => assert(textFonts >= 14));

      /* ---------- Workflow sign step ---------- */
      await page.goto(origin + '/aliran-kerja/');
      const wf = await page.evaluate(() => ({ sig: document.querySelectorAll('#sigFont option').length, text: document.querySelectorAll('#textFont option').length }));
      check(`${label}: workflow sign step offers the fonts too`, () => assert(wf.sig >= 14 && wf.text >= 14));

      for (const url of ['/edit-pdf/', '/tandatangan-pdf/', '/aliran-kerja/']) {
        await page.goto(origin + url);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check(`${label}: ${url} has no horizontal scroll`, () => assert(overflow <= 0, `${overflow}px`));
      }
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
