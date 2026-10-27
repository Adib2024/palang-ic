// Browser test for the smaller additions: saved signatures, undo, flatten,
// HEIC, passport photos, more quick picks, link previews, privacy page and
// the first-visit tips. Each section is independent.
// Run: NODE_PATH="$(npm root -g)" node tests/extras-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
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

async function makeForm() {
  const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  const d = await L.PDFDocument.create();
  const p = d.addPage([595, 842]);
  const form = d.getForm();
  const tf = form.createTextField('nama');
  tf.addToPage(p, { x: 60, y: 700, width: 220, height: 26 });
  tf.setText('Ali bin Abu');
  const cb = form.createCheckBox('setuju');
  cb.addToPage(p, { x: 60, y: 650, width: 18, height: 18 });
  cb.check();
  // A stamp-like comment whose appearance is a red box.
  const ap = d.context.formXObject([L.setFillingRgbColor(0.9, 0.1, 0.1), L.rectangle(0, 0, 100, 40), L.fill()], { BBox: [0, 0, 100, 40] });
  const apRef = d.context.register(ap);
  const annot = d.context.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [300, 500, 400, 540], AP: { N: apRef }, T: L.PDFHexString.fromText('Penyemak') });
  p.node.addAnnot(d.context.register(annot));
  const b = await d.save();
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

async function redAt({ b64, fx, fy }) {
  const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), isEvalSupported: false }).promise;
  const pg = await doc.getPage(1);
  const vp = pg.getViewport({ scale: 1 });
  const c = document.createElement('canvas');
  c.width = vp.width; c.height = vp.height;
  const ctx = c.getContext('2d');
  await pg.render({ canvasContext: ctx, viewport: vp }).promise;
  const [r, g, b] = ctx.getImageData(Math.round(fx * vp.width), Math.round(fy * vp.height), 1, 1).data;
  return r > 180 && g < 80 && b < 80;
}

const PYFLAT = `
import sys, json
from pypdf import PdfReader
r = PdfReader(sys.argv[1])
p = r.pages[0]
print(json.dumps({'fields': len(r.get_fields() or {}), 'annots': len(p.get('/Annots', []) or []),
  'text': p.extract_text(), 'images': len(p.images)}))
`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const results = [];
  const check = (name, fn) => { fn(); results.push(`ok   ${name}`); };

  try {
    /* Link previews: every page names the share image, which is 1200×630. */
    const pages = ['index.html', ...fs.readdirSync(path.join(__dirname, '..')).filter((d) => fs.existsSync(path.join(__dirname, '..', d, 'index.html'))).map((d) => `${d}/index.html`)];
    const missing = pages.filter((f) => !/<meta property="og:image" content="https:\/\/[^"]+\/icons\/og\.png">/.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')));
    const og = fs.readFileSync(path.join(__dirname, '..', 'icons', 'og.png'));
    check('every page has link-preview tags', () => assert.deepStrictEqual(missing, []));
    check('share image is 1200×630 PNG', () => assert.deepStrictEqual([og.readUInt32BE(16), og.readUInt32BE(20)], [1200, 630]));

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

      /* ---------- Undo / redo ---------- */
      // Sign PDF: placing a signature can be undone and redone.
      await page.goto(origin + '/tandatangan-pdf/');
      await page.setInputFiles('#pickFiles', pdf);
      await page.waitForFunction(() => window.__sign.views.length === 2);
      await drawOnPad(page);
      await page.click('#addSig');
      await page.waitForFunction(() => window.__sign.items.length === 1);
      await page.click('#undoStep');
      const afterUndo = await page.evaluate(() => window.__sign.items.length);
      await page.click('#redoStep');
      const afterRedo = await page.evaluate(() => window.__sign.items.length);
      await page.click('.sig-item .sig-del');
      await page.click('#undoStep');
      const restored = await page.evaluate(() => window.__sign.items.length);
      check(`${label}: Sign PDF: undo / redo placing and deleting`, () => assert.deepStrictEqual([afterUndo, afterRedo, restored], [0, 1, 1]));

      // Redact: "find" adds a group of boxes that one undo removes; Ctrl+Z works.
      await page.goto(origin + '/hitamkan-pdf/');
      await page.setInputFiles('#pickFiles', pdf);
      await page.waitForFunction(() => window.__redact.views.length === 2);
      await page.evaluate(() => { document.querySelector('#findText').value = 'Halaman'; });
      await page.evaluate(() => window.__redact.findAll('custom'));
      const found = await page.evaluate(() => window.__redact.boxes.length);
      await page.click('#undoStep');
      const none = await page.evaluate(() => window.__redact.boxes.length);
      await page.click('#redoStep');
      const back = await page.evaluate(() => window.__redact.boxes.length);
      if (!mobile) {
        await page.click('#optTitle');
        await page.keyboard.press('Control+z');
      } else {
        await page.click('#undoStep');
      }
      const key = await page.evaluate(() => window.__redact.boxes.length);
      check(`${label}: Redact: one undo removes a whole search, redo brings it back`, () => assert.deepStrictEqual([found, none, back, key], [2, 0, 2, 0]));
      await page.screenshot({ path: path.join(OUT, `extras-undo-${label}.png`) });

      /* ---------- Flatten PDF ---------- */
      await page.goto(origin + '/ratakan-pdf/');
      const formPdf = Buffer.from(await page.evaluate(makeForm), 'base64');
      await page.setInputFiles('#pickFiles', { name: 'borang.pdf', mimeType: 'application/pdf', buffer: formPdf });
      await page.waitForFunction(() => window.__flatten.input);
      const foundFlat = await page.textContent('#flatFound');
      check(`${label}: Flatten counts fields and comments`, () => assert.strictEqual(foundFlat, 'Dijumpai: 2 medan borang, 1 komen/cop.'));
      const [fd] = await Promise.all([page.waitForEvent('download'), page.click('#savePdf')]);
      const flatPath = path.join(OUT, `${label}-${fd.suggestedFilename()}`);
      await fd.saveAs(flatPath);
      const fr = JSON.parse(execFileSync('python3', ['-I', '-c', PYFLAT, flatPath], { encoding: 'utf8' }));
      const red = await page.evaluate(redAt, { b64: fs.readFileSync(flatPath).toString('base64'), fx: 350 / 595, fy: 1 - 520 / 842 });
      check(`${label}: Flatten: no fields or comments left, values and stamp drawn on the page`, () => {
        assert.strictEqual(fd.suggestedFilename(), 'borang-rata.pdf');
        assert.deepStrictEqual([fr.fields, fr.annots], [0, 0]);
        assert.match(fr.text, /Ali bin Abu/);
        assert.strictEqual(red, true);
      });
      await page.check('#flatImage');
      const [fi] = await Promise.all([page.waitForEvent('download'), page.click('#savePdf')]);
      const imgPath = path.join(OUT, `${label}-flat-image.pdf`);
      await fi.saveAs(imgPath);
      const fimg = JSON.parse(execFileSync('python3', ['-I', '-c', PYFLAT, imgPath], { encoding: 'utf8' }));
      check(`${label}: Flatten to pictures leaves no text`, () => assert.deepStrictEqual([fimg.fields, fimg.annots, fimg.text.trim(), fimg.images], [0, 0, '', 1]));

      /* ---------- HEIC (iPhone photos) ---------- */
      // Chromium can't show HEIC itself, so this exercises the libheif worker.
      if (fs.existsSync(path.join(__dirname, '..', 'vendor', 'libheif', 'libheif-bundle.js'))) {
        await page.goto(origin + '/kecil-gambar/');
        await page.setInputFiles('#pickFiles', { name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.heic')) });
        await page.waitForFunction(() => window.__imgsmall.items.length === 1 || /tidak|dilangkau/i.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
        const heic = await page.evaluate(() => {
          const it = window.__imgsmall.items[0];
          if (!it) return null;
          const px = it.canvas.getContext('2d').getImageData(10, 10, 1, 1).data;
          return { w: it.canvas.width, h: it.canvas.height, nonBlank: px[3] === 255 && (px[0] + px[1] + px[2]) > 0 };
        });
        check(`${label}: HEIC photos open (decoded on the device)`, () => assert.deepStrictEqual(heic, { w: 320, h: 240, nonBlank: true }));
      } else {
        results.push(`skip ${label}: HEIC (vendor/libheif not present yet)`);
      }

      /* ---------- Passport photo ---------- */
      await page.goto(origin + '/gambar-pasport/');
      await page.setInputFiles('#pickFiles', path.join(__dirname, 'fixtures', 'sample-front-exif6.jpg'));
      await page.waitForFunction(() => window.__passport.photo);
      const imgSize = (b64) => page.evaluate(async (d) => { const im = new Image(); im.src = d; await im.decode(); return [im.naturalWidth, im.naturalHeight]; }, b64);
      const fileInfo = (fn) => page.evaluate(async (name) => {
        const f = await window.__passport[name]();
        const b = new Uint8Array(await f.arrayBuffer());
        let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
        return { name: f.name, type: f.type, url: `data:${f.type};base64,${btoa(s)}`, head: s.slice(0, 5) };
      }, fn);
      const one = await fileInfo('photoFile');
      const oneSize = await imgSize(one.url);
      check(`${label}: Malaysian passport photo is 35×50 mm at 600 DPI`, () => assert.deepStrictEqual([one.name, ...oneSize], ['gambar-pasport-35x50mm.jpg', 827, 1181]));
      const copies = await page.textContent('#ppCopies');
      const sheet = await fileInfo('sheetFile');
      const sheetSize = await imgSize(sheet.url);
      check(`${label}: 4R sheet holds 4 photos at real size`, () => {
        assert.match(copies, /^4 keping 35×50 mm pada kertas 4R/);
        assert.deepStrictEqual([sheet.name, ...sheetSize], ['helaian-pasport-4R.jpg', 1205, 1795]);
      });
      await page.click('label:has(> input[name="ppSize"][value="intl"]) span');
      await page.click('label:has(> input[name="ppPaper"][value="a4"]) span');
      const a4 = await fileInfo('sheetFile');
      const copiesA4 = await page.textContent('#ppCopies');
      check(`${label}: 35×45 mm on A4 → PDF with 25+ photos`, () => {
        assert.strictEqual(a4.name, 'helaian-pasport-A4.pdf');
        assert.strictEqual(a4.head, '%PDF-');
        assert.match(copiesA4, /^30 keping 35×45 mm pada kertas A4/);
      });
      await page.click('label:has(> input[name="ppSize"][value="custom"]) span');
      await page.fill('#ppW', '40');
      await page.fill('#ppH', '60');
      const custom = await fileInfo('photoFile');
      const customSize = await imgSize(custom.url);
      check(`${label}: custom size (40×60 mm)`, () => assert.deepStrictEqual(customSize, [945, 1417]));
      // Zoom and drag move the photo in the frame.
      const v0 = await page.evaluate(() => ({ ...window.__passport.view }));
      await page.fill('#ppZoom', '200');
      await page.dispatchEvent('#ppZoom', 'input');
      const box = await page.$eval('#ppCanvas', (c) => { c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.mouse.move(box.x, box.y);
      await page.mouse.down();
      await page.mouse.move(box.x + 40, box.y + 20, { steps: 4 });
      await page.mouse.up();
      const v1 = await page.evaluate(() => ({ ...window.__passport.view }));
      check(`${label}: zoom and drag move the photo`, () => { assert.strictEqual(v1.zoom, 2); assert(v1.cx < v0.cx, JSON.stringify([v0, v1])); });
      await page.fill('#ppWhite', '60');
      await page.dispatchEvent('#ppWhite', 'input');
      await page.screenshot({ path: path.join(OUT, `extras-passport-${label}.png`), fullPage: true });
      const ovP = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${label}: passport page fits the screen`, () => assert(ovP <= 0, `${ovP}px`));

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
