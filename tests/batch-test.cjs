// Browser test for batch mode: several PDFs through Compress, Watermark,
// Page Numbers, Protect, Unlock and OCR with one set of settings → one ZIP.
// Run: NODE_PATH="$(npm root -g)" node tests/batch-test.cjs [outDir]   (needs python3 + pypdf)
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));
const py = (code, ...args) => execFileSync('python3', ['-I', '-c', code, ...args], { encoding: 'utf8' }).trim();
/** Names and page texts of the PDFs inside a ZIP (pypdf), decrypting with `pw` if given. */
const zipPdfs = (file, pw = '') => JSON.parse(py([
  'import sys, json, zipfile, io, pypdf',
  'z = zipfile.ZipFile(sys.argv[1]); out = []',
  'for n in z.namelist():',
  '    r = pypdf.PdfReader(io.BytesIO(z.read(n)))',
  '    enc = r.is_encrypted',
  '    ok = (not enc) or (sys.argv[2] and r.decrypt(sys.argv[2]) > 0)',
  '    out.append({"name": n, "enc": enc, "text": " ".join(p.extract_text() for p in r.pages) if ok else None})',
  'print(json.dumps(out))',
].join('\n'), file, pw));

async function makeDocs() {
  const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const text = async (label) => {
    const d = await L.PDFDocument.create();
    const f = await d.embedFont(L.StandardFonts.Helvetica);
    for (let i = 1; i <= 2; i++) d.addPage([595.28, 841.89]).drawText(`${label} ${i}`, { x: 60, y: 760, size: 24, font: f });
    return b64(await d.save());
  };
  // A heavy "scan" (noisy image) so compression has something to do.
  const scan = async (label) => {
    const c = document.createElement('canvas');
    c.width = 1600; c.height = 2263;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) { const v = 228 + Math.random() * 27; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = '#111'; ctx.font = '700 84px Arial, sans-serif';
    ctx.fillText(label, 140, 260);
    const jpg = await new Promise((r) => c.toBlob(async (b) => r(new Uint8Array(await b.arrayBuffer())), 'image/jpeg', 0.98));
    const d = await L.PDFDocument.create();
    const e = await d.embedJpg(jpg);
    d.addPage([595.28, 841.89]).drawImage(e, { x: 0, y: 0, width: 595.28, height: 841.89 });
    return b64(await d.save());
  };
  return { a: await text('ALPHA'), b: await text('BETA'), c: await text('GAMMA'), s1: await scan('SURAT SATU'), s2: await scan('SURAT DUA') };
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
      const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, acceptDownloads: true });
      const page = await context.newPage();
      const errors = [];
      const csp = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
      const pdf = (name, b64) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(b64, 'base64') });
      const save = async (sel = '#savePdf') => {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
        const p = path.join(OUT, `${label}-batch-${dl.suggestedFilename()}`);
        await dl.saveAs(p);
        return { name: dl.suggestedFilename(), path: p };
      };
      await page.goto(origin + '/watermark-pdf/');
      const d = await page.evaluate(makeDocs);
      const three = [pdf('alpha.pdf', d.a), pdf('beta.pdf', d.b), pdf('gamma.pdf', d.c)];

      /* Watermark */
      await page.setInputFiles('#pickFiles', three);
      await page.waitForFunction(() => window.__watermark.batch.files.length === 3 && !document.querySelector('#savePdf').disabled);
      const note = await page.textContent('.batch-note strong');
      check(`${label}: picking 3 PDFs shows the batch note`, () => assert.match(note, /^3 fail/));
      await page.fill('#wmText', 'SALINAN');
      let z = await save();
      let inside = zipPdfs(z.path);
      check(`${label}: watermark batch → ZIP with every file stamped`, () => {
        assert.match(z.name, /\.zip$/);
        assert.deepStrictEqual(inside.map((f) => f.name), ['alpha-watermark.pdf', 'beta-watermark.pdf', 'gamma-watermark.pdf']);
        inside.forEach((f) => assert.match(f.text, /SALINAN/));
        assert.match(inside[1].text, /BETA 2/);
      });

      /* Page numbers */
      await page.goto(origin + '/nombor-pdf/');
      await page.setInputFiles('#pickFiles', three);
      await page.waitForFunction(() => window.__pagenum.batch.files.length === 3 && !document.querySelector('#savePdf').disabled);
      await page.selectOption('#pnFormat', 'nOfTotal');
      z = await save();
      inside = zipPdfs(z.path);
      check(`${label}: page-number batch numbers each file from 1`, () => {
        assert.strictEqual(inside.length, 3);
        inside.forEach((f) => { assert.match(f.text, /1 \/ 2/); assert.match(f.text, /2 \/ 2/); });
      });

      /* Protect, then Unlock the protected files */
      await page.goto(origin + '/lindungi-pdf/');
      await page.setInputFiles('#pickFiles', three);
      await page.waitForFunction(() => window.__protect.batch.files.length === 3);
      await page.fill('#pw1', 'Kunci#2026');
      await page.fill('#pw2', 'Kunci#2026');
      const locked = await save();
      inside = zipPdfs(locked.path, 'Kunci#2026');
      check(`${label}: protect batch locks every file with the same password`, () => {
        assert.strictEqual(inside.length, 3);
        inside.forEach((f) => { assert(f.enc); assert(f.text); });
        assert.strictEqual(zipPdfs(locked.path, 'salah').filter((f) => f.text).length, 0);
      });
      const lockedFiles = JSON.parse(py(['import sys, json, zipfile, base64', 'z = zipfile.ZipFile(sys.argv[1])',
        'print(json.dumps([[n, base64.b64encode(z.read(n)).decode()] for n in z.namelist()]))'].join('\n'), locked.path));
      await page.goto(origin + '/buka-kunci-pdf/');
      await page.setInputFiles('#pickFiles', [...lockedFiles.map(([n, b]) => pdf(n, b)), pdf('biasa.pdf', d.a)]);
      await page.waitForFunction(() => window.__unlock.batch.files.length === 4 && !document.querySelector('#pwBlock').hidden);
      await page.fill('#password', 'Kunci#2026');
      await page.click('#unlockBtn');
      await page.waitForFunction(() => !document.querySelector('#result').hidden, null, { timeout: 60000 });
      z = await save();
      inside = zipPdfs(z.path);
      check(`${label}: unlock batch opens all locked files; plain one passes through`, () => {
        assert.strictEqual(inside.length, 4);
        inside.forEach((f) => { assert(!f.enc); assert(f.text); });
        assert(inside.some((f) => f.name === 'biasa.pdf'));
      });
      // Wrong password: files are skipped and reported.
      await page.goto(origin + '/buka-kunci-pdf/');
      await page.setInputFiles('#pickFiles', [...lockedFiles.map(([n, b]) => pdf(n, b)), pdf('biasa.pdf', d.a)]);
      await page.waitForFunction(() => window.__unlock.batch.files.length === 4 && !document.querySelector('#pwBlock').hidden);
      await page.fill('#password', 'salah');
      await page.click('#unlockBtn');
      await page.waitForFunction(() => /dilangkau/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
      const msg = await page.textContent('#status');
      check(`${label}: wrong password skips the locked files and says which`, () => assert.match(msg, /3 fail dilangkau/));

      /* Compress */
      await page.goto(origin + '/kecilkan-pdf/');
      await page.setInputFiles('#pickFiles', [pdf('imbas1.pdf', d.s1), pdf('imbas2.pdf', d.s2)]);
      await page.waitForFunction(() => window.__compress.batch.files.length === 2 && !document.querySelector('#run').disabled);
      await page.click('#run');
      await page.waitForFunction(() => !document.querySelector('#result').hidden, null, { timeout: 120000 });
      z = await save();
      inside = zipPdfs(z.path);
      const total = Buffer.from(d.s1, 'base64').length + Buffer.from(d.s2, 'base64').length;
      check(`${label}: compress batch → smaller PDFs in a ZIP`, () => {
        assert.deepStrictEqual(inside.map((f) => f.name), ['imbas1-kecil.pdf', 'imbas2-kecil.pdf']);
        assert(fs.statSync(z.path).size < total * 0.7, `${fs.statSync(z.path).size} vs ${total}`);
      });

      /* OCR (two scanned PDFs) */
      await page.goto(origin + '/ocr-pdf/');
      await page.setInputFiles('#pickFiles', [pdf('imbas1.pdf', d.s1), pdf('imbas2.pdf', d.s2)]);
      await page.waitForFunction(() => window.__ocr.batch.files.length === 2);
      await page.click('#runOcr');
      await page.waitForFunction(() => window.__ocr.output, null, { timeout: 300000 });
      const txt = await page.inputValue('#ocrText');
      z = await save();
      inside = zipPdfs(z.path);
      check(`${label}: OCR batch → searchable PDFs in a ZIP and all the text`, () => {
        assert.deepStrictEqual(inside.map((f) => f.name), ['imbas1-ocr.pdf', 'imbas2-ocr.pdf']);
        assert.match(inside[0].text, /SURAT\s+SATU/);
        assert.match(inside[1].text, /SURAT\s+DUA/);
        assert.match(txt, /imbas1\.pdf[\s\S]*SURAT\s+SATU[\s\S]*imbas2\.pdf[\s\S]*SURAT\s+DUA/);
      });

      const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${label}: no horizontal scroll`, () => assert(ov <= 0, `${ov}px`));
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
