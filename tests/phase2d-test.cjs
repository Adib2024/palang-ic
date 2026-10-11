// Browser test for PDF → Word, PDF → Excel and PDF → PowerPoint.
// Test documents are generated in the page; the Office files are checked with
// python-docx / openpyxl / python-pptx (tests/check-office.py) and, when
// LibreOffice is installed, opened by it too.
// Run: NODE_PATH="$(npm root -g)" node tests/phase2d-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
const { chromium } = require('playwright');
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));
const inspect = (file) => JSON.parse(execFileSync('python3', ['-I', path.join(__dirname, 'check-office.py'), file], { encoding: 'utf8' }));
const hasSoffice = spawnSync('soffice', ['--version'], { stdio: 'ignore' }).status === 0;

// ---- in-page helper ----

async function makeDocs() {
  const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const d = await L.PDFDocument.create();
  const reg = await d.embedFont(L.StandardFonts.Helvetica);
  const bold = await d.embedFont(L.StandardFonts.HelveticaBold);
  // Page 1: heading, a two-line paragraph, a sub-heading and a table.
  const p1 = d.addPage([595.28, 841.89]);
  p1.drawText('LAPORAN KEWANGAN', { x: 60, y: 770, size: 22, font: bold });
  p1.drawText('Laporan ini menerangkan perbelanjaan bulanan rumah sewa', { x: 60, y: 730, size: 11, font: reg });
  p1.drawText('untuk tahun semasa dan baki yang tinggal.', { x: 60, y: 716, size: 11, font: reg });
  p1.drawText('Ringkasan', { x: 60, y: 680, size: 15, font: bold });
  const table = [['Perkara', 'Jumlah', 'Kod'], ['Sewa', 'RM 1,200.50', '007'], ['Elektrik', '350', '012']];
  table.forEach((row, r) => row.forEach((c, k) => p1.drawText(c, { x: 60 + k * 170, y: 640 - r * 20, size: 11, font: r === 0 ? bold : reg })));
  p1.drawText('Dokumen ini dijana untuk ujian.', { x: 60, y: 560, size: 11, font: reg });
  // Page 2: landscape page shown rotated (text must still read in order).
  const p2 = d.addPage([595.28, 841.89]);
  p2.setRotation(L.degrees(90));
  p2.drawText('Halaman berputar', { x: 100, y: 500, size: 14, font: reg, rotate: L.degrees(90) });
  // Page 3: a "scan" (picture only).
  const c = document.createElement('canvas');
  c.width = 620; c.height = 877;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#222'; ctx.font = '600 30px Arial'; ctx.fillText('IMBASAN', 60, 120);
  const jpg = await new Promise((r) => c.toBlob(async (bl) => r(new Uint8Array(await bl.arrayBuffer())), 'image/jpeg', 0.9));
  const img = await d.embedJpg(jpg);
  d.addPage([595.28, 841.89]).drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  return b64(await d.save());
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

      let docB64 = null;
      const convert = async (url, setup = async () => {}) => {
        await page.goto(origin + url);
        if (!docB64) docB64 = await page.evaluate(makeDocs);
        await page.setInputFiles('#pickFiles', { name: 'laporan.pdf', mimeType: 'application/pdf', buffer: Buffer.from(docB64, 'base64') });
        await page.waitForFunction(() => !document.querySelector('#convert').disabled);
        await setup();
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#convert')]);
        const p = path.join(OUT, `${label}-p2d-${dl.suggestedFilename()}`);
        await dl.saveAs(p);
        await page.waitForFunction(() => !document.querySelector('#result').hidden);
        const status = await page.textContent('#status');
        const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        await page.screenshot({ path: path.join(OUT, `${url.replace(/\W/g, '')}-${label}.png`), fullPage: true });
        return { name: dl.suggestedFilename(), path: p, status, ov };
      };

      /* ---------- Word ---------- */
      const w = await convert('/pdf-word/');
      const wd = inspect(w.path);
      const texts = wd.paras.map((p) => p.text);
      check(`${label}: Word file name and status`, () => {
        assert.strictEqual(w.name, 'laporan.docx');
        assert.match(w.status, /3 muka surat/);
        assert.match(w.status, /1 muka surat.*imbasan|imbas/i);
      });
      check(`${label}: Word headings get heading styles`, () => {
        assert.strictEqual(wd.paras.find((p) => p.text === 'LAPORAN KEWANGAN').style, 'Heading 1');
        assert.match(wd.paras.find((p) => p.text === 'Ringkasan').style, /^Heading [12]$/);
      });
      check(`${label}: Word joins wrapped lines into one paragraph`, () => {
        assert(texts.includes('Laporan ini menerangkan perbelanjaan bulanan rumah sewa untuk tahun semasa dan baki yang tinggal.'), JSON.stringify(texts));
        assert(texts.includes('Dokumen ini dijana untuk ujian.'));
      });
      check(`${label}: Word rebuilds the table`, () => {
        assert.strictEqual(wd.tables.length, 1);
        assert.deepStrictEqual(wd.tables[0], [['Perkara', 'Jumlah', 'Kod'], ['Sewa', 'RM 1,200.50', '007'], ['Elektrik', '350', '012']]);
      });
      check(`${label}: Word keeps rotated page text and the scan as a picture`, () => {
        assert(texts.includes('Halaman berputar'), JSON.stringify(texts));
        assert.strictEqual(wd.pictures, 1);
      });
      check(`${label}: Word page fits the screen`, () => assert(w.ov <= 0, `${w.ov}px`));

      /* ---------- Excel ---------- */
      const x = await convert('/pdf-excel/');
      const xd = inspect(x.path);
      const s1 = xd.sheets[0];
      const row = (first) => s1.rows.find((r) => r[0] === first);
      check(`${label}: Excel has one sheet per page`, () => {
        assert.strictEqual(x.name, 'laporan.xlsx');
        assert.deepStrictEqual(xd.sheets.map((s) => s.name), ['Muka 1', 'Muka 2', 'Muka 3']);
      });
      check(`${label}: Excel puts table cells in columns, numbers as numbers`, () => {
        assert.deepStrictEqual(row('Perkara'), ['Perkara', 'Jumlah', 'Kod']);
        assert.deepStrictEqual(row('Sewa'), ['Sewa', 1200.5, '007']);
        assert.deepStrictEqual(row('Elektrik'), ['Elektrik', 350, '012']);
      });
      check(`${label}: Excel marks bold lines`, () => assert(s1.bold.includes('A1'), JSON.stringify(s1.bold)));
      check(`${label}: Excel keeps the rotated page; scan sheet is empty`, () => {
        assert.strictEqual(xd.sheets[1].rows[0][0], 'Halaman berputar');
        assert.strictEqual(xd.sheets[2].rows.length, 0);
        assert.match(x.status, /imbas/i);
      });
      check(`${label}: Excel page fits the screen`, () => assert(x.ov <= 0, `${x.ov}px`));

      /* ---------- PowerPoint ---------- */
      const pi = await convert('/pdf-powerpoint/');
      const pd = inspect(pi.path);
      check(`${label}: PowerPoint picture mode makes one picture slide per page`, () => {
        assert.strictEqual(pi.name, 'laporan.pptx');
        assert.strictEqual(pd.slides.length, 3);
        assert(pd.slides.every((s) => s.pictures === 1 && s.text.length === 0));
        // Slide size follows the first page (A4 portrait, in EMU).
        assert.strictEqual(pd.width, Math.round(595.28 * 12700));
        assert.strictEqual(pd.height, Math.round(841.89 * 12700));
      });
      const pt = await convert('/pdf-powerpoint/', () => page.check('input[name="pptMode"][value="text"]', { force: true }));
      const td = inspect(pt.path);
      check(`${label}: PowerPoint text mode makes editable text boxes`, () => {
        assert.strictEqual(td.slides.length, 3);
        const all = td.slides[0].text.join('\n');
        assert.match(all, /LAPORAN KEWANGAN/);
        assert.match(all, /RM 1,200\.50/);
        assert.strictEqual(td.slides[0].pictures, 0);
        assert.match(td.slides[1].text.join('\n'), /Halaman berputar/);
        assert.strictEqual(td.slides[2].pictures, 1, 'scanned page stays a picture');
      });
      check(`${label}: PowerPoint page fits the screen`, () => assert(pt.ov <= 0, `${pt.ov}px`));

      if (label === 'desktop' && hasSoffice) {
        const dir = path.join(OUT, 'p2d-lo');
        fs.mkdirSync(dir, { recursive: true });
        // (Both PowerPoint runs save to the same name; the text-mode file is checked.)
        for (const f of [w.path, x.path, pt.path]) {
          const out = path.join(dir, path.basename(f).replace(/\.\w+$/, '.pdf'));
          fs.rmSync(out, { force: true });
          execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', dir, f], { stdio: 'ignore', timeout: 120000 });
          check(`LibreOffice opens ${path.basename(f)}`, () => assert(fs.existsSync(out) && fs.statSync(out).size > 500));
        }
      }

      check(`${label}: no requests to other sites`, () => assert.deepStrictEqual(foreign, []));
      check(`${label}: no page errors or CSP violations`, () => assert.deepStrictEqual([...errors, ...csp], []));
      await context.close();
    }
    console.log(results.join('\n'));
    console.log(`\n${results.length} checks passed${hasSoffice ? '' : ' (LibreOffice not installed: skipped open check)'}.`);
  } catch (err) {
    console.log(results.join('\n'));
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
