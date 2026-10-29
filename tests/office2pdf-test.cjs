// Browser test for Word/Excel → PDF. The .docx/.xlsx files are made with
// python-docx/openpyxl (tests/make-office.py); the PDFs are read back with
// pypdf.
// Run: NODE_PATH="$(npm root -g)" node tests/office2pdf-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));
const SRC = path.join(OUT, 'office-src');
const PY = `
import sys, json
from pypdf import PdfReader
r = PdfReader(sys.argv[1])
pages = []
for p in r.pages:
    pages.append({'text': p.extract_text(), 'w': float(p.mediabox.width), 'h': float(p.mediabox.height), 'images': len(p.images)})
print(json.dumps(pages))
`;
const readPdf = (f) => JSON.parse(execFileSync('python3', ['-I', '-c', PY, f], { encoding: 'utf8' }));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  execFileSync('python3', ['-I', path.join(__dirname, 'make-office.py'), SRC]);
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const results = [];
  const check = (name, fn) => { fn(); results.push(`ok   ${name}`); };

  try {
    for (const [label, viewport, mobile] of [['desktop', { width: 1366, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
      const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, acceptDownloads: true });
      const page = await context.newPage();
      const errors = [];
      const foreign = [];
      page.on('request', (r) => { if (!/^(data|blob):/.test(r.url()) && !r.url().startsWith(origin)) foreign.push(r.url()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(m.text())) errors.push(m.text()); });
      const convert = async (file) => {
        await page.setInputFiles('#pickFiles', path.join(SRC, file));
        await page.waitForFunction(() => window.__o2p.input);
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#savePdf')]);
        const p = path.join(OUT, `${label}-o2p-${dl.suggestedFilename()}`);
        await dl.saveAs(p);
        return { name: dl.suggestedFilename(), pages: readPdf(p), status: await page.textContent('#status') };
      };

      await page.goto(origin + '/word-pdf/');
      const w = await convert('tawaran.docx');
      const all = w.pages.map((p) => p.text).join('\n');
      check(`${label}: Word → PDF: name, the document's paper size (Letter), page break`, () => {
        assert.strictEqual(w.name, 'tawaran.pdf');
        assert(w.pages.length >= 2, String(w.pages.length));
        assert.deepStrictEqual([w.pages[0].w, w.pages[0].h], [612, 792]);
        // (Justified lines are drawn word by word; pypdf then reports line breaks.)
        assert.match(w.pages[1].text.replace(/\s+/g, ' '), /^Halaman dua\./);
        assert.match(w.status, /Siap: \d+ muka surat/);
      });
      check(`${label}: Word → PDF: headings, styled text, Unicode punctuation`, () => {
        for (const s of ['Surat Tawaran Kerja', 'Pegawai Kewangan', 'Café — “petikan”', 'Teks condong merah', 'Faedah']) assert(all.replace(/\s+/g, ' ').includes(s), `${s} missing`);
      });
      check(`${label}: Word → PDF: bullet and numbered lists`, () => {
        assert.match(all, /Cuti tahunan 20 hari/);
        assert.match(all, /1\.\s*Lapor diri/);
        assert.match(all, /2\.\s*Isi borang/);
      });
      check(`${label}: Word → PDF: table cells and the picture`, () => {
        for (const s of ['Perkara', 'Jumlah', 'RM 4,500', 'Bulanan', 'Elaun']) assert(all.includes(s), `${s} missing`);
        assert.strictEqual(w.pages[0].images, 1);
      });
      check(`${label}: Word → PDF: long paragraph wraps (not cut off)`, () => assert((w.pages[1].text.replace(/\s+/g, ' ').match(/balutan baris/g) || []).length === 40));
      await page.screenshot({ path: path.join(OUT, `o2p-${label}.png`), fullPage: true });

      const x = await convert('belanja.xlsx');
      const xt = x.pages.map((p) => p.text);
      check(`${label}: Excel → PDF: one section per sheet, values formatted`, () => {
        assert.strictEqual(x.name, 'belanja.pdf');
        assert.match(xt[0], /Belanja/);
        assert.match(xt[0], /1,200\.50/);
        assert.match(xt[0], /31\/01\/2024/);
        assert.match(xt[0], /007/);
        assert(xt.some((s) => /Ringkasan[\s\S]*Jumlah besar[\s\S]*1550\.5/.test(s)), JSON.stringify(xt));
      });
      const wide = x.pages.find((p) => /Lebar/.test(p.text));
      check(`${label}: Excel → PDF: a wide sheet turns landscape`, () => assert(wide && wide.w > wide.h && /Lajur 30/.test(wide.text), JSON.stringify(wide && [wide.w, wide.h])));

      // Not an Office file.
      await page.setInputFiles('#pickFiles', { name: 'lama.doc', mimeType: 'application/msword', buffer: Buffer.from('not a docx') });
      const bad = await page.textContent('#status');
      check(`${label}: old .doc files get a clear message`, () => assert.match(bad, /\.docx/));

      const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${label}: fits the screen`, () => assert(ov <= 0, `${ov}px`));
      check(`${label}: no requests to other sites`, () => assert.deepStrictEqual(foreign, []));
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
