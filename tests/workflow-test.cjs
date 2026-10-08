// Browser test for Advanced mode (workflows): templates, custom steps, the
// interactive date/signature/text step, password, saved workflows.
// Inputs are generated in the page or are sample (not real) IC photos.
// Run: NODE_PATH="$(npm root -g)" node tests/workflow-test.cjs [outDir]   (needs python3 + pypdf)
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));
const IC = { name: 'ic-depan.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(path.join(__dirname, 'fixtures/sample-front-exif6.jpg')) };
const py = (code, ...args) => execFileSync('python3', ['-I', '-c', code, ...args], { encoding: 'utf8' }).trim();

async function makePdf({ label, pages }) {
  const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  const doc = await L.PDFDocument.create();
  const font = await doc.embedFont(L.StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) doc.addPage([595.28, 841.89]).drawText(`${label} ${i}`, { x: 60, y: 760, size: 24, font });
  const bytes = await doc.save();
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function inspect({ b64, password }) {
  const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  try {
    const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), password, isEvalSupported: false, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/' }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const vp = p.getViewport({ scale: 1 });
      pages.push({ text: (await p.getTextContent()).items.map((it) => it.str).join(' '), w: vp.width, h: vp.height });
    }
    return { pages };
  } catch (e) {
    return { error: e.name };
  }
}


async function pixelDiff({ a, b }) {
  const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  const render = async (s) => {
    const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(s), (c) => c.charCodeAt(0)), isEvalSupported: false }).promise;
    const p = await doc.getPage(1);
    const vp = p.getViewport({ scale: 0.5 });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await p.render({ canvasContext: ctx, viewport: vp }).promise;
    return ctx.getImageData(0, 0, c.width, c.height);
  };
  const [x, y] = [await render(a), await render(b)];
  let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1; let n = 0;
  for (let j = 0; j < x.height; j++) {
    for (let i = 0; i < x.width; i++) {
      const k = (j * x.width + i) * 4;
      if (Math.abs(x.data[k] - y.data[k]) + Math.abs(x.data[k + 1] - y.data[k + 1]) + Math.abs(x.data[k + 2] - y.data[k + 2]) > 60) {
        n++; if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j;
      }
    }
  }
  return n ? { n, x0: x0 / x.width, y0: y0 / x.height, x1: x1 / x.width, y1: y1 / x.height } : null;
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
      const pdf = (name, b64) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(b64, 'base64') });
      const save = async () => {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#savePdf')]);
        const p = path.join(OUT, `${label}-wf-${dl.suggestedFilename()}`);
        await dl.saveAs(p);
        return { name: dl.suggestedFilename(), path: p, b64: fs.readFileSync(p).toString('base64') };
      };
      const runAndWait = async () => {
        await page.click('#runWf');
        await page.waitForFunction(() => !document.querySelector('#resultArea').hidden || /./.test(document.querySelector('#status2').textContent), null, { timeout: 120000 });
      };
      const reset = async () => {
        await page.goto(origin + '/aliran-kerja/');
        await page.waitForFunction(() => window.__wf);
      };

      /* ---------- Header button ---------- */
      await page.goto(origin + '/palang/');
      const linkVisible = await page.isVisible('.adv-link');
      await page.click('.adv-link');
      await page.waitForURL(/aliran-kerja\/$/);
      check(`${label}: "Mod Lanjutan" header button opens workflows`, () => assert(linkVisible));
      await page.evaluate(() => localStorage.clear());
      await reset();
      const def = await page.evaluate(() => ({ steps: window.__wf.steps.map((s) => s.type), on: document.querySelector('.wf-tpl.on .wf-tpl-btn').dataset.tpl }));
      check(`${label}: loan template is the default`, () => assert.deepStrictEqual(def, { steps: ['palang', 'pagenum', 'compress'], on: 'loan' }));

      /* ---------- Loan pack: IC photo + payslips → stamped, numbered, ≤ 2 MB ---------- */
      const slips = await page.evaluate(makePdf, { label: 'SLIP GAJI', pages: 2 });
      await page.setInputFiles('#pickFiles', [IC, pdf('slip.pdf', slips)]);
      await page.fill('.wf-step[data-type="palang"] input[type="text"]', 'CIMB');
      await page.fill('#fileName', 'pakej-pinjaman');
      await page.screenshot({ path: path.join(OUT, `wf-builder-${label}.png`), fullPage: true });
      await runAndWait();
      await page.screenshot({ path: path.join(OUT, `wf-done-${label}.png`), fullPage: true });
      const loan = await save();
      const li = await page.evaluate(inspect, { b64: loan.b64 });
      const marks = await page.$$eval('.wf-progress li', (els) => els.map((e) => e.dataset.state));
      check(`${label}: loan pack runs every step and joins photo + PDF`, () => {
        assert.strictEqual(loan.name, 'pakej-pinjaman.pdf');
        assert.deepStrictEqual(marks, ['done', 'done', 'done']);
        assert.strictEqual(li.pages.length, 3);
        assert(fs.statSync(loan.path).size <= 2 * 1024 * 1024);
      });

      /* ---------- Palang really stamps the photo ---------- */
      await reset();
      await page.evaluate(() => window.__wf.setSteps([{ type: 'palang', opts: { who: 'CIMB', corner: 'tl' } }], 'x'));
      await page.setInputFiles('#pickFiles', [IC]);
      await runAndWait();
      const stamped = await save();
      await reset();
      await page.evaluate(() => window.__wf.setSteps([], 'blank'));
      await page.setInputFiles('#pickFiles', [IC]);
      await runAndWait();
      const plain = await save();
      const pd = await page.evaluate(pixelDiff, { a: plain.b64, b: stamped.b64 });
      check(`${label}: IC stamp lands in the chosen (top-left) corner of the photo`, () => {
        assert(pd && pd.n > 200, 'no stamp');
        assert(pd.x0 < 0.5 && pd.y0 < 0.5, JSON.stringify(pd));
      });

      /* ---------- Custom: watermark + page numbers + rotate (text kept) ---------- */
      await reset();
      await page.click('[data-tpl="blank"]');
      for (const type of ['watermark', 'pagenum']) {
        await page.selectOption('#addType', type);
        await page.click('#addStep');
      }
      const doc2 = await page.evaluate(makePdf, { label: 'SURAT', pages: 2 });
      await page.setInputFiles('#pickFiles', [pdf('surat.pdf', doc2)]);
      await runAndWait();
      const custom = await save();
      const ci = await page.evaluate(inspect, { b64: custom.b64 });
      check(`${label}: custom workflow adds watermark and "1 / 2" numbers`, () => {
        assert.strictEqual(ci.pages.length, 2);
        assert.match(ci.pages[0].text, /SURAT 1/);
        assert.match(ci.pages[0].text, /SALINAN/);
        assert.match(ci.pages[0].text, /1 \/ 2/);
        assert.match(ci.pages[1].text, /2 \/ 2/);
      });

      /* ---------- Sign & lock: interactive step + password ---------- */
      await reset();
      await page.click('[data-tpl="signed"]');
      await page.setInputFiles('#pickFiles', [pdf('surat.pdf', doc2)]);
      await page.click('#runWf');
      const needPw = await page.textContent('#status');
      check(`${label}: password step asks for a password first`, () => assert.match(needPw, /kata laluan/i));
      await page.fill('.wf-pw', 'Rahsia#2026');
      await page.click('#runWf');
      await page.waitForFunction(() => window.__wf.views.length === 2);
      await page.fill('#dateValue', '2026-12-31');
      await page.check('#allPages');
      await page.click('#addDate');
      await page.uncheck('#allPages');
      await page.click('input[name="sigTab"][value="type"] + span');
      await page.fill('#typedName', 'Contoh Nama');
      await page.click('#addSig');
      await page.waitForFunction(() => window.__wf.items.length === 3);
      const placed = await page.evaluate(() => window.__wf.items.map((it) => it.page));
      await page.screenshot({ path: path.join(OUT, `wf-place-${label}.png`), fullPage: true });
      await page.click('#placeNext');
      await page.waitForFunction(() => !document.querySelector('#resultArea').hidden, null, { timeout: 60000 });
      const locked = await save();
      const noPw = await page.evaluate(inspect, { b64: locked.b64 });
      const withPw = await page.evaluate(inspect, { b64: locked.b64, password: 'Rahsia#2026' });
      check(`${label}: date on every page + signature, then locked`, () => {
        assert.deepStrictEqual(placed, [0, 1, 0]);
        assert.strictEqual(noPw.error, 'PasswordException');
        assert.strictEqual(withPw.pages.length, 2);
        assert.match(withPw.pages[1].text, /SURAT 2/);
      });
      check(`${label}: pypdf opens the result with the password`, () => {
        assert.strictEqual(py('import sys,pypdf\nr=pypdf.PdfReader(sys.argv[1])\nprint(r.decrypt(sys.argv[2])>0, len(r.pages))', locked.path, 'Rahsia#2026'), 'True 2');
      });

      /* ---------- Back during the interactive step ---------- */
      await page.click('#backToBuilder');
      await page.click('#runWf');
      await page.waitForFunction(() => window.__wf.views.length === 2);
      await page.click('#backToBuilder');
      const backState = await page.evaluate(() => ({ builder: !document.querySelector('#builder').hidden, files: window.__wf.files.length }));
      check(`${label}: back returns to the builder with files kept`, () => assert.deepStrictEqual(backState, { builder: true, files: 1 }));

      /* ---------- Save my workflow (no password stored) ---------- */
      await page.click('.wf-save summary');
      await page.fill('#wfName', 'Ujian saya');
      await page.click('#saveWf');
      await reset();
      const saved = await page.evaluate(() => ({
        cards: [...document.querySelectorAll('.wf-tpl-btn strong')].map((e) => e.textContent),
        stored: localStorage.getItem(Object.keys(localStorage).find((k) => k.includes('wf-saved'))),
      }));
      check(`${label}: saved workflow is listed, password not stored`, () => {
        assert(saved.cards.includes('Ujian saya'));
        assert(!saved.stored.includes('Rahsia'));
      });

      /* ---------- English UI ---------- */
      await page.click('.lang [data-lang="en"]');
      const en = await page.textContent('#runWf');
      check(`${label}: English labels`, () => assert.match(en, /Run workflow/));
      await page.click('.lang [data-lang="ms"]');

      for (const url of ['/', '/aliran-kerja/', '/gabung-pdf/']) {
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
