// Browser test for Edit PDF, Redact PDF and Fill PDF Form.
// Test PDFs are generated in the page with pdf-lib (no real documents).
// Run: NODE_PATH="$(npm root -g)" node tests/phase2a-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));
const FRONT = path.join(__dirname, 'fixtures/sample-back.jpg');

// ---- in-page helpers ----

async function makeDocs() {
  const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
  // Two pages, the second rotated 90°.
  const plain = await L.PDFDocument.create();
  const font = await plain.embedFont(L.StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) {
    const p = plain.addPage([595.28, 841.89]);
    p.drawText(`PAGE ${i}`, { x: 60, y: 780, size: 24, font });
    if (i === 2) p.setRotation(L.degrees(90));
  }
  // Statement with private details.
  const st = await L.PDFDocument.create();
  const f2 = await st.embedFont(L.StandardFonts.Helvetica);
  const p1 = st.addPage([595.28, 841.89]);
  p1.drawText('PENYATA CONTOH - SULIT', { x: 60, y: 780, size: 18, font: f2 });
  p1.drawText('No IC: 900101-14-5678', { x: 60, y: 740, size: 14, font: f2 });
  p1.drawText('Telefon: 012-345 6789', { x: 60, y: 710, size: 14, font: f2 });
  p1.drawText('Emel: ali@contoh.my', { x: 60, y: 680, size: 14, font: f2 });
  const p2 = st.addPage([595.28, 841.89]);
  p2.drawText('MUKA SURAT DUA KEKAL', { x: 60, y: 780, size: 18, font: f2 });
  // Form.
  const fd = await L.PDFDocument.create();
  const fp = fd.addPage([595.28, 841.89]);
  const form = fd.getForm();
  const nama = form.createTextField('nama');
  nama.addToPage(fp, { x: 100, y: 700, width: 300, height: 24 });
  const setuju = form.createCheckBox('setuju');
  setuju.addToPage(fp, { x: 100, y: 650, width: 18, height: 18 });
  const negeri = form.createDropdown('negeri');
  negeri.addOptions(['Selangor', 'Johor', 'Kedah']);
  negeri.addToPage(fp, { x: 100, y: 600, width: 200, height: 24 });
  const jantina = form.createRadioGroup('jantina');
  jantina.addOptionToPage('L', fp, { x: 100, y: 550, width: 18, height: 18 });
  jantina.addOptionToPage('P', fp, { x: 140, y: 550, width: 18, height: 18 });
  return { plain: b64(await plain.save()), statement: b64(await st.save()), form: b64(await fd.save()) };
}

async function readPdf(b64) {
  const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), isEvalSupported: false, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/' }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    pages.push({ text: tc.items.map((it) => it.str).join(' ') });
  }
  return pages;
}

async function diffBoxes({ before, after }) {
  const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  const open = (s) => pdfjs.getDocument({ data: Uint8Array.from(atob(s), (c) => c.charCodeAt(0)), isEvalSupported: false, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/' }).promise;
  const [a, b] = await Promise.all([open(before), open(after)]);
  const out = [];
  for (let n = 1; n <= a.numPages; n++) {
    const render = async (doc) => {
      const pg = await doc.getPage(n);
      const vp = pg.getViewport({ scale: 0.6 });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      return ctx.getImageData(0, 0, c.width, c.height);
    };
    const [ia, ib] = [await render(a), await render(b)];
    let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
    for (let y = 0; y < ia.height; y++) {
      for (let x = 0; x < ia.width; x++) {
        const k = (y * ia.width + x) * 4;
        if (Math.abs(ia.data[k] - ib.data[k]) + Math.abs(ia.data[k + 1] - ib.data[k + 1]) + Math.abs(ia.data[k + 2] - ib.data[k + 2]) > 60) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    out.push(x1 < 0 ? null : { x0: x0 / ia.width, y0: y0 / ia.height, x1: x1 / ia.width, y1: y1 / ia.height });
  }
  return out;
}

async function formValues(b64) {
  const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  const doc = await L.PDFDocument.load(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  const form = doc.getForm();
  const fields = form.getFields();
  if (!fields.length) return { count: 0 };
  return {
    count: fields.length,
    nama: form.getTextField('nama').getText(),
    setuju: form.getCheckBox('setuju').isChecked(),
    negeri: form.getDropdown('negeri').getSelected(),
    jantina: form.getRadioGroup('jantina').getSelected(),
  };
}

async function dragOn(page, sel, from, to) {
  const el = page.locator(sel);
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  await page.mouse.move(b.x + b.width * from[0], b.y + b.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * to[0], b.y + b.height * to[1], { steps: 6 });
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
      const foreign = [];
      const errors = [];
      const csp = [];
      page.on('request', (r) => { if (!/^(data|blob):/.test(r.url()) && !r.url().startsWith(origin)) foreign.push(r.url()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
      const pdf = (name, b64) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(b64, 'base64') });
      const save = async (sel = '#savePdf') => {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
        const p = path.join(OUT, `${label}-p2a-${dl.suggestedFilename()}`);
        await dl.saveAs(p);
        return { name: dl.suggestedFilename(), b64: fs.readFileSync(p).toString('base64') };
      };

      /* ---------- Edit PDF ---------- */
      await page.goto(origin + '/edit-pdf/');
      const docs = await page.evaluate(makeDocs);
      await page.setInputFiles('#pickFiles', [pdf('surat.pdf', docs.plain)]);
      await page.waitForFunction(() => window.__edit.views.length === 2);
      // Text on page 1 near (10%, 20%).
      await page.click('[data-tool="text"]');
      const p1 = page.locator('.edit-overlay').first();
      await p1.scrollIntoViewIfNeeded();
      const b1 = await p1.boundingBox();
      await page.mouse.click(b1.x + b1.width * 0.1, b1.y + b1.height * 0.2);
      await page.keyboard.type('HELLO DOKUJAGA');
      // A box on rotated page 2, from (50%,50%) to (70%,60%).
      await page.click('[data-tool="rect"]');
      await dragOn(page, '.doc-page:nth-child(2) .edit-overlay', [0.5, 0.5], [0.7, 0.6]);
      // Freehand + highlight on page 1, then undo the highlight.
      await page.click('[data-tool="pen"]');
      await dragOn(page, '.doc-page:nth-child(1) .edit-overlay', [0.3, 0.5], [0.5, 0.55]);
      await page.click('[data-tool="highlight"]');
      await dragOn(page, '.doc-page:nth-child(1) .edit-overlay', [0.1, 0.7], [0.6, 0.73]);
      const beforeUndo = await page.evaluate(() => window.__edit.views[0].shapes.length);
      await page.click('#undoBtn');
      const afterUndo = await page.evaluate(() => window.__edit.views[0].shapes.length);
      check(`${label}: edit undo removes the last shape`, () => assert.deepStrictEqual([beforeUndo, afterUndo], [2, 1]));
      // Image on page 1.
      await page.evaluate(() => window.__edit.setTool('select'));
      await page.setInputFiles('#imageFile', FRONT);
      await page.waitForFunction(() => window.__edit.items.some((it) => it.kind === 'image'));
      await page.screenshot({ path: path.join(OUT, `p2a-edit-${label}.png`), fullPage: true });
      const edited = await save();
      const et = await page.evaluate(readPdf, edited.b64);
      const ed = await page.evaluate(diffBoxes, { before: docs.plain, after: edited.b64 });
      check(`${label}: edit text is real text at the clicked spot`, () => {
        assert(et[0].text.includes('HELLO DOKUJAGA'), et[0].text);
        assert(ed[0] && ed[0].x0 < 0.12 && ed[0].y0 < 0.22, JSON.stringify(ed[0]));
      });
      check(`${label}: edit box lands in place on a rotated page`, () => {
        const d = ed[1];
        assert(d && Math.abs(d.x0 - 0.5) < 0.02 && Math.abs(d.y0 - 0.5) < 0.02 && Math.abs(d.x1 - 0.7) < 0.02 && Math.abs(d.y1 - 0.6) < 0.02, JSON.stringify(d));
      });

      /* ---------- Redact ---------- */
      await page.goto(origin + '/hitamkan-pdf/');
      await page.setInputFiles('#pickFiles', [pdf('penyata.pdf', docs.statement)]);
      await page.waitForFunction(() => window.__redact.views.length === 2);
      for (const kind of ['ic', 'phone', 'email']) await page.click(`[data-find="${kind}"]`);
      await page.fill('#findText', 'sulit');
      await page.click('[data-find="custom"]');
      await page.waitForFunction(() => window.__redact.boxes.length === 4);
      const status = await page.textContent('#status');
      await dragOn(page, '.doc-page:nth-child(2)', [0.5, 0.5], [0.7, 0.6]);
      const nBoxes = await page.evaluate(() => window.__redact.boxes.length);
      // Each found box must cover its whole match: render the page and check
      // that no dark pixels sit just outside the IC box on that text line.
      const leak = await page.evaluate(async () => {
        const b = window.__redact.boxes[0];
        const v = window.__redact.views[0];
        const c = document.createElement('canvas');
        const k = 3;
        c.width = Math.round(v.vp.width * k); c.height = Math.round(v.vp.height * k);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await v.page.render({ canvasContext: ctx, viewport: v.page.getViewport({ scale: k }) }).promise;
        ctx.fillStyle = '#fff';
        ctx.fillRect(b.x * c.width, b.y * c.height, b.w * c.width, b.h * c.height);
        // Look right next to the box's left and right edges, within its height.
        const strip = (x0, x1) => {
          const d = ctx.getImageData(x0, b.y * c.height, x1 - x0, b.h * c.height).data;
          let dark = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
          return dark;
        };
        const left = b.x * c.width;
        const right = (b.x + b.w) * c.width;
        return { leftOfBox: strip(Math.max(0, left - 4), left), rightOfBox: strip(right, right + 12) };
      });
      check(`${label}: IC box covers every digit (no partial glyph left)`, () => {
        assert.strictEqual(leak.leftOfBox + leak.rightOfBox, 0, JSON.stringify(leak));
      });
      check(`${label}: redact finds IC, phone, email and custom text; manual box too`, () => {
        assert.match(status, /1 tempat ditemui/);
        assert.strictEqual(nBoxes, 5);
      });
      await page.screenshot({ path: path.join(OUT, `p2a-redact-${label}.png`), fullPage: true });
      const red = await save();
      const rt = await page.evaluate(readPdf, red.b64);
      check(`${label}: redacted page has no text left; other text gone too`, () => {
        assert.strictEqual(rt[0].text.trim(), '', rt[0].text);
        assert.strictEqual(rt[1].text.trim(), '', rt[1].text);
      });
      // Only page 1 redacted -> page 2 keeps its real text.
      await page.click('#clearBoxes');
      await page.click('[data-find="ic"]');
      const red2 = await save();
      const rt2 = await page.evaluate(readPdf, red2.b64);
      check(`${label}: pages without boxes keep their text`, () => {
        assert.strictEqual(rt2[0].text.trim(), '');
        assert.match(rt2[1].text, /MUKA SURAT DUA KEKAL/);
      });

      /* ---------- Fill form ---------- */
      await page.goto(origin + '/isi-borang/');
      await page.setInputFiles('#pickFiles', [pdf('borang.pdf', docs.form)]);
      await page.waitForFunction(() => window.__forms.fields.length === 4);
      await page.fill('.form-text', 'Ali bin Abu');
      await page.check('.form-checkbox');
      await page.selectOption('.form-dropdown', 'Johor');
      await page.check('.form-radio[value="P"]');
      await page.screenshot({ path: path.join(OUT, `p2a-form-${label}.png`), fullPage: true });
      const filled = await save();
      const fv = await page.evaluate(formValues, filled.b64);
      check(`${label}: form values are written into the PDF fields`, () => {
        assert.deepStrictEqual(fv, { count: 4, nama: 'Ali bin Abu', setuju: true, negeri: ['Johor'], jantina: 'P' });
      });
      await page.check('#flatten');
      const flat = await save();
      const fv2 = await page.evaluate(formValues, flat.b64);
      const ft = await page.evaluate(readPdf, flat.b64);
      check(`${label}: flattened form keeps the text but no fields`, () => {
        assert.strictEqual(fv2.count, 0);
        assert.match(ft[0].text, /Ali bin Abu/);
      });
      await page.setInputFiles('#pickFiles', [pdf('biasa.pdf', docs.plain)]);
      await page.waitForFunction(() => !document.querySelector('#noFields').hidden);
      check(`${label}: PDF without fields shows a helpful note`, () => {});

      for (const url of ['/', '/edit-pdf/', '/hitamkan-pdf/', '/isi-borang/']) {
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
