// Browser test for Merge/Split/Organise PDF and Compress PDF.
// Test PDFs are generated in the page with pdf-lib (no real documents).
// Run: NODE_PATH="$(npm root -g)" node tests/pdf-tools-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));

// Runs in the page: build a text-only PDF (standard, non-embedded font) and
// an image-heavy "scan" PDF. Returns base64 strings.
async function makeSamples() {
  const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  const b64 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  async function textPdf(label, n) {
    const doc = await L.PDFDocument.create();
    const font = await doc.embedFont(L.StandardFonts.HelveticaBold);
    for (let i = 1; i <= n; i++) {
      const p = doc.addPage([595.28, 841.89]);
      p.drawText(`${label}${i}`, { x: 60, y: 700, size: 96, font });
      p.drawText('SAMPLE ONLY - NOT A REAL DOCUMENT', { x: 60, y: 600, size: 18, font });
    }
    return b64(await doc.save());
  }
  async function scanPdf(n) {
    const doc = await L.PDFDocument.create();
    for (let i = 1; i <= n; i++) {
      const c = document.createElement('canvas');
      c.width = 1700; c.height = 2400;
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, c.width, c.height);
      g.addColorStop(0, '#f4efe2'); g.addColorStop(1, '#dfe8f3');
      ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
      // Noise makes it behave like a real photo/scan (hard to compress losslessly).
      const img = ctx.getImageData(0, 0, c.width, c.height);
      for (let k = 0; k < img.data.length; k += 4) {
        const n2 = (Math.random() - 0.5) * 40;
        img.data[k] += n2; img.data[k + 1] += n2; img.data[k + 2] += n2;
      }
      ctx.putImageData(img, 0, 0);
      ctx.fillStyle = '#111'; ctx.font = 'bold 120px sans-serif';
      ctx.fillText(`SCAN ${i}`, 150, 400);
      const png = await new Promise((r) => c.toBlob(async (b) => r(new Uint8Array(await b.arrayBuffer())), 'image/png'));
      const image = await doc.embedPng(png);
      const p = doc.addPage([595.28, 841.89]);
      p.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
    }
    return b64(await doc.save());
  }
  return { a: await textPdf('A', 3), b: await textPdf('B', 2), scan: await scanPdf(2) };
}

// Runs in the page: text of each page of a PDF (via the vendored pdf.js).
async function pageTexts(b64) {
  const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    out.push({ text: tc.items.map((it) => it.str).join(' ').split(' ')[0], rotate: p.rotate });
  }
  return out;
}

// Count entries in a stored ZIP by its local file headers.
function zipEntries(buf) {
  const names = [];
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    names.push(buf.subarray(i + 30, i + 30 + nameLen).toString());
    assert.strictEqual(buf.subarray(i + 30 + nameLen, i + 34 + nameLen).toString(), '%PDF');
    i += 30 + nameLen + size;
  }
  return names;
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
      const cspIssues = [];
      page.on('request', (r) => { if (!/^(data|blob):/.test(r.url()) && !r.url().startsWith(origin)) foreign.push(r.url()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) cspIssues.push(m.text()); });

      /* ---------- Organise ---------- */
      await page.goto(origin + '/susun-pdf/');
      const samples = await page.evaluate(makeSamples);
      const buf = (b) => Buffer.from(b, 'base64');
      await page.setInputFiles('#pickFiles', [
        { name: 'a.pdf', mimeType: 'application/pdf', buffer: buf(samples.a) },
        { name: 'b.pdf', mimeType: 'application/pdf', buffer: buf(samples.b) },
        { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not really a pdf') },
      ]);
      await page.waitForFunction(() => window.__organize.pages.length === 5 && /notes\.pdf/.test(document.querySelector('#status').textContent));
      await page.evaluate(() => window.__organize.whenIdle());
      const status = await page.textContent('#status');
      check(`${label}: organise loads 2 PDFs (5 pages), rejects a fake .pdf`, () => {
        assert.strictEqual(status.includes('notes.pdf'), true, status);
        assert.match(status, /tidak dapat dibuka sebagai PDF/);
      });

      // Thumbnails rendered, with dark text pixels (fonts loaded under CSP).
      const inked = await page.evaluate(async () => Promise.all(window.__organize.pages.map(async (p) => {
        if (!p.thumb) return 0;
        const img = new Image();
        img.src = p.thumb;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let dark = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 80) dark++;
        return dark;
      })));
      check(`${label}: every thumbnail rendered with visible text`, () => inked.forEach((n) => assert(n > 50, JSON.stringify(inked))));

      // Organise: move last page (B2) to front, rotate it, delete A3.
      for (let k = 5; k > 1; k--) await page.click(`.page-card:nth-child(${k}) .page-tools .icon-btn:nth-child(1)`);
      await page.click('.page-card:nth-child(1) .page-tools .icon-btn:nth-child(3)');
      await page.click('.page-card:nth-child(4) .page-tools .icon-btn:nth-child(4)');
      await page.evaluate(() => window.__organize.whenIdle());
      await page.screenshot({ path: path.join(OUT, `organize-${label}.png`), fullPage: true });

      const merged = await page.evaluate(async () => {
        const { file } = await window.__organize.buildOutput();
        const b = new Uint8Array(await file.arrayBuffer());
        let s = '';
        for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
        return btoa(s);
      });
      const order = await page.evaluate(pageTexts, merged);
      check(`${label}: merged PDF has new order, rotation and deletion`, () => {
        assert.deepStrictEqual(order.map((p) => p.text), ['B2', 'A1', 'A2', 'B1']);
        assert.deepStrictEqual(order.map((p) => p.rotate), [90, 0, 0, 0]);
      });

      // Only selected pages.
      await page.click('.page-card:nth-child(2) .page-thumb');
      await page.check('.page-card:nth-child(4) .page-select');
      await page.check('#onlySelected');
      const [dlSel] = await Promise.all([page.waitForEvent('download'), page.click('#savePdf')]);
      const selPath = path.join(OUT, `organize-selected-${label}.pdf`);
      await dlSel.saveAs(selPath);
      const selOrder = await page.evaluate(pageTexts, fs.readFileSync(selPath).toString('base64'));
      check(`${label}: "only selected" saves just the picked pages`, () => {
        assert.deepStrictEqual(selOrder.map((p) => p.text), ['A1', 'B1']);
      });
      await page.uncheck('#onlySelected');

      // Split: every page -> ZIP with 4 PDFs.
      await page.click('input[name="outMode"][value="split"] + span');
      const [dlZip] = await Promise.all([page.waitForEvent('download'), page.click('#savePdf')]);
      const zipPath = path.join(OUT, `organize-split-${label}.zip`);
      await dlZip.saveAs(zipPath);
      check(`${label}: split every page -> ZIP of 4 PDFs`, () => {
        assert.strictEqual(dlZip.suggestedFilename(), 'dokumen.zip');
        assert.deepStrictEqual(zipEntries(fs.readFileSync(zipPath)), ['dokumen-1.pdf', 'dokumen-2.pdf', 'dokumen-3.pdf', 'dokumen-4.pdf']);
      });

      // Split by ranges.
      await page.click('input[name="splitBy"][value="ranges"] + span');
      await page.fill('#ranges', '1-2, 4');
      const [dlR] = await Promise.all([page.waitForEvent('download'), page.click('#savePdf')]);
      const rPath = path.join(OUT, `organize-ranges-${label}.zip`);
      await dlR.saveAs(rPath);
      check(`${label}: split by ranges "1-2, 4"`, () => {
        assert.deepStrictEqual(zipEntries(fs.readFileSync(rPath)), ['dokumen-1-2.pdf', 'dokumen-4.pdf']);
      });
      await page.fill('#ranges', '2, 9');
      await page.click('#savePdf');
      await page.waitForFunction(() => /tidak sah/.test(document.querySelector('#status').textContent));
      check(`${label}: invalid range is reported`, () => {});
      await page.click('input[name="outMode"][value="merge"] + span');

      const overflowOrg = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${label}: organise has no horizontal scroll`, () => assert(overflowOrg <= 0, `${overflowOrg}px`));

      /* ---------- Compress ---------- */
      await page.goto(origin + '/kecilkan-pdf/');
      await page.setInputFiles('#pickFiles', { name: 'imbasan.pdf', mimeType: 'application/pdf', buffer: buf(samples.scan) });
      await page.waitForFunction(() => window.__compress.input);
      const meta = await page.textContent('#fileMeta');
      check(`${label}: compress shows page count and size`, () => assert.match(meta, /^2 muka surat · \d+(\.\d)? MB$/));
      await page.click('#run');
      await page.waitForFunction(() => !document.querySelector('#result').hidden || /sudah kecil/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
      const sizes = await page.evaluate(() => ({ from: window.__compress.input.bytes.length, to: window.__compress.output && window.__compress.output.size }));
      check(`${label}: scanned PDF shrinks by more than half`, () => assert(sizes.to && sizes.to < sizes.from / 2, JSON.stringify(sizes)));
      const [dlC] = await Promise.all([page.waitForEvent('download'), page.click('#savePdf')]);
      const cPath = path.join(OUT, `compressed-${label}.pdf`);
      await dlC.saveAs(cPath);
      const cPages = await page.evaluate(async (b64) => {
        const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
        const d = await L.PDFDocument.load(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
        return d.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);
      }, fs.readFileSync(cPath).toString('base64'));
      check(`${label}: compressed PDF keeps page count and A4 size`, () => {
        assert.strictEqual(dlC.suggestedFilename(), 'imbasan-kecil.pdf');
        assert.deepStrictEqual(cPages, [[595, 842], [595, 842]]);
      });
      await page.screenshot({ path: path.join(OUT, `compress-${label}.png`), fullPage: true });

      // A 500 KB limit forces stronger steps (plus black & white).
      await page.selectOption('#limit', '512000');
      await page.check('#gray');
      await page.click('#run');
      await page.waitForFunction(() => !document.querySelector('#result').hidden && !document.querySelector('#run').disabled, null, { timeout: 60000 });
      const limited = await page.evaluate(() => window.__compress.output.size);
      check(`${label}: "max 500 KB" result fits the limit`, () => assert(limited <= 512000, String(limited)));

      // A tiny text PDF can't be shrunk by rasterising: say so instead of making it bigger.
      await page.selectOption('#limit', '0');
      await page.setInputFiles('#pickFiles', { name: 'teks.pdf', mimeType: 'application/pdf', buffer: buf(samples.a) });
      await page.waitForFunction(() => window.__compress.input && window.__compress.input.name === 'teks.pdf');
      await page.click('#run');
      await page.waitForFunction(() => /sudah kecil/.test(document.querySelector('#status').textContent) || !document.querySelector('#result').hidden, null, { timeout: 60000 });
      const noGain = await page.textContent('#status');
      check(`${label}: already-small PDF is not made bigger`, () => assert.match(noGain, /sudah kecil/));

      const overflowCmp = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${label}: compress has no horizontal scroll`, () => assert(overflowCmp <= 0, `${overflowCmp}px`));
      check(`${label}: no requests to other origins`, () => assert.deepStrictEqual(foreign, []));
      check(`${label}: no CSP violations`, () => assert.deepStrictEqual(cspIssues, []));
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
