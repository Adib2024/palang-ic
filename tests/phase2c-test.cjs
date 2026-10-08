// Browser test for Compare PDF and OCR PDF.
// Test documents are generated in the page (no real documents). The OCR test
// draws text onto an image ("a scan") and checks it is recognised.
// Run: NODE_PATH="$(npm root -g)" node tests/phase2c-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));

// ---- in-page helpers ----

async function makeDocs() {
  const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const textDoc = async (pages) => {
    const d = await L.PDFDocument.create();
    const f = await d.embedFont(L.StandardFonts.Helvetica);
    for (const lines of pages) {
      const p = d.addPage([595.28, 841.89]);
      lines.forEach((l, i) => p.drawText(l, { x: 60, y: 760 - i * 28, size: 16, font: f }));
    }
    return b64(await d.save());
  };
  const A = await textDoc([
    ['PERJANJIAN SEWA CONTOH', 'Sewa bulanan ialah RM 1200 sebulan.', 'Tempoh sewa dua tahun.'],
    ['Muka surat dua tidak berubah.'],
  ]);
  const B = await textDoc([
    ['PERJANJIAN SEWA CONTOH', 'Sewa bulanan ialah RM 1500 sebulan.', 'Deposit dua bulan diperlukan.', 'Tempoh sewa dua tahun.'],
    ['Muka surat dua tidak berubah.'],
    ['Lampiran baharu.'],
  ]);

  // A "scan": text drawn on a canvas, saved as a JPEG page (no text layer).
  const scanCanvas = (lines) => {
    const c = document.createElement('canvas');
    c.width = 1240; c.height = 1754;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fbfaf7'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = '600 44px Arial, Helvetica, sans-serif';
    lines.forEach((l, i) => ctx.fillText(l, 120, 220 + i * 90));
    return c;
  };
  const jpg = (c) => new Promise((r) => c.toBlob(async (b) => r(new Uint8Array(await b.arrayBuffer())), 'image/jpeg', 0.9));
  const lines = ['SURAT PENGESAHAN MAJIKAN', 'Nama: Ali bin Abu', 'Jawatan: Pegawai Kewangan', 'Gaji bulanan: RM 4500'];
  const scan = await L.PDFDocument.create();
  const img = await scan.embedJpg(await jpg(scanCanvas(lines)));
  scan.addPage([595.28, 841.89]).drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  // Mixed: one real-text page + one scanned page.
  const mixed = await L.PDFDocument.create();
  const f = await mixed.embedFont(L.StandardFonts.Helvetica);
  mixed.addPage([595.28, 841.89]).drawText('Halaman ini sudah ada teks yang boleh dicari oleh sesiapa.', { x: 60, y: 760, size: 14, font: f });
  const img2 = await mixed.embedJpg(await jpg(scanCanvas(['PENYATA BANK CONTOH', 'Baki akhir RM 8800'])));
  mixed.addPage([595.28, 841.89]).drawImage(img2, { x: 0, y: 0, width: 595.28, height: 841.89 });
  const png = await new Promise((r) => scanCanvas(['RESIT BAYARAN', 'Jumlah RM 250']).toBlob(async (b) => r(b64(new Uint8Array(await b.arrayBuffer()))), 'image/png'));
  return { A, B, scan: b64(await scan.save()), mixed: b64(await mixed.save()), png };
}

async function readPdf(b64) {
  const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), isEvalSupported: false, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/' }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const vp = p.getViewport({ scale: 1 });
    const tc = await p.getTextContent();
    pages.push({
      text: tc.items.map((it) => it.str).join(' ').replace(/\s+/g, ' '),
      items: tc.items.filter((it) => it.str.trim()).map((it) => ({ s: it.str, x: it.transform[4] / vp.width, y: 1 - it.transform[5] / vp.height })),
    });
  }
  return pages;
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
      const cores = new Set();
      page.on('request', (r) => {
        if (!/^(data|blob):/.test(r.url()) && !r.url().startsWith(origin)) foreign.push(r.url());
        if (r.url().includes('/vendor/tesseract/core/')) cores.add(r.url().split('/').pop());
      });
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
      const pdf = (name, b64) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(b64, 'base64') });
      const save = async (sel = '#savePdf') => {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
        const p = path.join(OUT, `${label}-p2c-${dl.suggestedFilename()}`);
        await dl.saveAs(p);
        return { name: dl.suggestedFilename(), path: p, b64: fs.readFileSync(p).toString('base64') };
      };

      /* ---------- Compare PDF ---------- */
      await page.goto(origin + '/banding-pdf/');
      const docs = await page.evaluate(makeDocs);
      await page.setInputFiles('#fileA', pdf('sewa-v1.pdf', docs.A));
      await page.setInputFiles('#fileB', pdf('sewa-v2.pdf', docs.B));
      await page.waitForFunction(() => window.__compare.result);
      const r1 = await page.evaluate(() => ({
        ins: window.__compare.result.text.ins, del: window.__compare.result.text.del,
        dels: [...document.querySelectorAll('#diffText del')].map((e) => e.textContent),
        inss: [...document.querySelectorAll('#diffText ins')].map((e) => e.textContent),
        pages: window.__compare.result.visual.map((p) => [p.page, p.changed, p.onlyA, p.onlyB]),
        summary: document.querySelector('#sumPages').textContent,
      }));
      check(`${label}: text diff marks removed and added words`, () => {
        assert.deepStrictEqual(r1.dels, ['1200']);
        assert.deepStrictEqual(r1.inss, ['1500', 'Deposit dua bulan diperlukan.', 'Lampiran baharu.']);
        assert.strictEqual(r1.del, 1);
        assert.strictEqual(r1.ins, 7);
      });
      check(`${label}: visual diff finds changed, same and new pages`, () => {
        assert.deepStrictEqual(r1.pages, [[1, true, false, false], [2, false, false, false], [3, true, false, true]]);
        assert.strictEqual(r1.summary, '2 daripada 3 muka surat berbeza');
      });
      await page.click('input[name="cmpTab"][value="visual"] + span');
      const rows = await page.$$eval('.cmp-row h3', (els) => els.map((e) => e.textContent));
      check(`${label}: visual tab shows only changed pages by default`, () => assert.strictEqual(rows.length, 2));
      await page.screenshot({ path: path.join(OUT, `compare-${label}.png`), fullPage: true });
      const ovCmp = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${label}: compare results fit the screen (no horizontal scroll)`, () => assert(ovCmp <= 0, `${ovCmp}px`));
      await page.click('#swap');
      await page.waitForFunction(() => window.__compare.result && window.__compare.result.text.del === 7);
      check(`${label}: swapping A and B swaps added/removed`, () => {});
      const same = await page.evaluate(async (a) => {
        const f = new File([Uint8Array.from(atob(a), (c) => c.charCodeAt(0))], 'x.pdf', { type: 'application/pdf' });
        await window.__compare.load('A', f);
        await window.__compare.load('B', f);
        return { ins: window.__compare.result.text.ins, del: window.__compare.result.text.del, changed: window.__compare.result.visual.filter((p) => p.changed).length };
      }, docs.A);
      check(`${label}: identical files show no differences`, () => assert.deepStrictEqual(same, { ins: 0, del: 0, changed: 0 }));

      /* ---------- OCR PDF ---------- */
      await page.goto(origin + '/ocr-pdf/');
      await page.setInputFiles('#pickFiles', pdf('surat-imbas.pdf', docs.scan));
      await page.click('#runOcr');
      await page.waitForFunction(() => window.__ocr.output || /tidak|error/i.test(document.querySelector('#status').textContent), null, { timeout: 240000 });
      const txt = await page.inputValue('#ocrText');
      const ocrPdf = await save();
      const op = await page.evaluate(readPdf, ocrPdf.b64);
      await page.screenshot({ path: path.join(OUT, `ocr-${label}.png`), fullPage: true });
      const ovOcr = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${label}: OCR results fit the screen`, () => assert(ovOcr <= 0, `${ovOcr}px`));
      check(`${label}: OCR recognises the scanned text`, () => {
        assert.match(txt, /SURAT PENGESAHAN MAJIKAN/);
        assert.match(txt, /Ali bin Abu/);
        assert.match(txt, /4500/);
      });
      check(`${label}: OCR PDF is searchable (hidden text layer)`, () => {
        assert.strictEqual(ocrPdf.name, 'surat-imbas-ocr.pdf');
        assert.match(op[0].text, /PENGESAHAN/);
        assert.match(op[0].text, /Pegawai/);
      });
      check(`${label}: hidden text sits over the scanned words`, () => {
        const w = op[0].items.find((it) => /PENGESAHAN/.test(it.s));
        // Line 1 was drawn at x=120/1240, baseline 220/1754 of the scan.
        assert(Math.abs(w.x - 120 / 1240) < 0.25 && Math.abs(w.y - 220 / 1754) < 0.03, JSON.stringify(w));
      });
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#saveTxt')]);
      check(`${label}: plain text download`, () => assert.strictEqual(dl.suggestedFilename(), 'surat-imbas-ocr.txt'));

      // Mixed PDF: the page that already has text is kept.
      await page.setInputFiles('#pickFiles', pdf('penyata.pdf', docs.mixed));
      await page.click('#runOcr');
      await page.waitForFunction(() => window.__ocr.output, null, { timeout: 240000 });
      const mixed = await page.evaluate(() => ({ skipped: window.__ocr.output.skipped, text: window.__ocr.output.text }));
      check(`${label}: pages with text are skipped, scanned page recognised`, () => {
        assert.strictEqual(mixed.skipped, 1);
        assert.match(mixed.text, /PENYATA BANK CONTOH/);
        assert.match(mixed.text, /8800/);
      });

      // Photo input.
      await page.setInputFiles('#pickFiles', { name: 'resit.png', mimeType: 'image/png', buffer: Buffer.from(docs.png, 'base64') });
      await page.click('#runOcr');
      await page.waitForFunction(() => window.__ocr.output, null, { timeout: 240000 });
      const photo = await save();
      const pp = await page.evaluate(readPdf, photo.b64);
      check(`${label}: photos become a searchable PDF`, () => {
        assert.strictEqual(pp.length, 1);
        assert.match(pp[0].text, /RESIT BAYARAN/);
      });
      check(`${label}: OCR engine and models load from this site only`, () => {
        assert([...cores].every((f) => /lstm\.wasm\.js$/.test(f)), [...cores].join());
      });

      for (const url of ['/', '/banding-pdf/', '/ocr-pdf/']) {
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
