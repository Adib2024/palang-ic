// Browser test for Compress PDF.
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

      await page.goto(origin + '/kecilkan-pdf/');
      const samples = await page.evaluate(makeSamples);
      const buf = (b) => Buffer.from(b, 'base64');

      /* ---------- Compress ---------- */
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
