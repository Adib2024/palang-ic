// Browser test for Merge, Split, Organise, Rotate, Watermark, Page Numbers
// and Crop PDF. Test PDFs are generated in the page with pdf-lib.
// Run: NODE_PATH="$(npm root -g)" node tests/phase1-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));

// Occurrences of `word` per page, via pypdf (pdf.js merges overlapping rotated text).
function countWord(file, word) {
  const out = execFileSync('python3', ['-I', '-c', [
    'import sys, json, pypdf',
    'r = pypdf.PdfReader(sys.argv[1])',
    'print(json.dumps([p.extract_text().count(sys.argv[2]) for p in r.pages]))',
  ].join('\n'), file, word], { encoding: 'utf8' });
  return JSON.parse(out);
}

function zipEntries(buf) {
  const out = [];
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    out.push({ name: buf.subarray(i + 30, i + 30 + nameLen).toString(), data: buf.subarray(i + 30 + nameLen, i + 30 + nameLen + size) });
    i += 30 + nameLen + size;
  }
  return out;
}

// ---- in-page helpers ----
async function makePdf({ label, pages, rotate }) {
  const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  const doc = await L.PDFDocument.create();
  const font = await doc.embedFont(L.StandardFonts.HelveticaBold);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([595.28, 841.89]);
    p.drawText(`${label}${i}`, { x: 60, y: 760, size: 40, font });
    if (rotate && rotate[i - 1]) p.setRotation(L.degrees(rotate[i - 1]));
  }
  const bytes = await doc.save();
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function inspect(b64) {
  const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), isEvalSupported: false, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/' }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    const strs = tc.items.map((it) => it.str).filter((s) => s.trim());
    // Where is the ink, as displayed? (bounding box of dark-ish pixels, fractions)
    const vp = p.getViewport({ scale: 0.5 });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await p.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push({ first: strs[0] || '', strs, rotate: p.rotate, view: p.view, w: vp.width * 2, h: vp.height * 2 });
  }
  return out;
}

// Bounding box (display fractions) of pixels that changed between two PDFs, per page.
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
        if (Math.abs(ia.data[k] - ib.data[k]) + Math.abs(ia.data[k + 1] - ib.data[k + 1]) + Math.abs(ia.data[k + 2] - ib.data[k + 2]) > 40) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    out.push(x1 < 0 ? null : { x0: x0 / ia.width, y0: y0 / ia.height, x1: x1 / ia.width, y1: y1 / ia.height });
  }
  return out;
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
      const save = async (sel) => {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
        const p = path.join(OUT, `${label}-p1-${dl.suggestedFilename()}`);
        await dl.saveAs(p);
        return { name: dl.suggestedFilename(), buf: fs.readFileSync(p) };
      };
      const texts = (buf) => page.evaluate(inspect, buf.toString('base64'));

      await page.goto(origin + '/gabung-pdf/');
      const A = await page.evaluate(makePdf, { label: 'A', pages: 2 });
      const B = await page.evaluate(makePdf, { label: 'B', pages: 1 });
      const C = await page.evaluate(makePdf, { label: 'C', pages: 2 });
      const S = await page.evaluate(makePdf, { label: 'S', pages: 6 });
      const R = await page.evaluate(makePdf, { label: 'R', pages: 2, rotate: [0, 90] });

      /* ---------- Merge ---------- */
      const hintVisible = await page.isVisible('.hint-top');
      check(`${label}: empty tool hides list hints (regression)`, () => assert.strictEqual(hintVisible, false));
      await page.setInputFiles('#pickFiles', [pdf('a.pdf', A)]);
      await page.waitForFunction(() => window.__merge.files.length === 1);
      const oneOnly = await page.evaluate(() => ({ disabled: document.querySelector('#savePdf').disabled, hint: !document.querySelector('#needTwo').hidden }));
      check(`${label}: merge needs at least 2 files`, () => assert.deepStrictEqual(oneOnly, { disabled: true, hint: true }));
      await page.setInputFiles('#pickFiles', [pdf('b.pdf', B), pdf('c.pdf', C)]);
      await page.waitForFunction(() => window.__merge.files.length === 3);
      await page.evaluate(() => window.__merge.whenIdle());
      await page.click('.page-card:nth-child(3) .page-tools .icon-btn:nth-child(1)');
      await page.click('.page-card:nth-child(2) .page-tools .icon-btn:nth-child(1)');
      await page.click('.page-card:nth-child(3) .page-tools .icon-btn:nth-child(3)'); // remove b.pdf
      const summary = await page.textContent('#mergeSummary');
      await page.screenshot({ path: path.join(OUT, `p1-merge-${label}.png`), fullPage: true });
      const merged = await save('#savePdf');
      const mt = await texts(merged.buf);
      check(`${label}: merge joins files in the chosen order`, () => {
        assert.strictEqual(summary, '2 fail · 4 muka surat');
        assert.deepStrictEqual(mt.map((p) => p.first), ['C1', 'C2', 'A1', 'A2']);
      });

      /* ---------- Split ---------- */
      await page.goto(origin + '/pisah-pdf/');
      await page.setInputFiles('#pickFiles', [pdf('laporan.pdf', S)]);
      await page.waitForFunction(() => window.__split.pages.length === 6);
      await page.fill('#ranges', '1-2, 5');
      const captions = await page.$$eval('.page-card .card-caption', (els) => els.map((e) => e.textContent));
      check(`${label}: split shows which file each page goes to`, () => assert.deepStrictEqual(captions, ['Fail 1', 'Fail 1', 'Fail 2']));
      let out = await save('#savePdf');
      check(`${label}: split by ranges -> ZIP`, () => assert.deepStrictEqual(zipEntries(out.buf).map((e) => e.name), ['laporan-1-2.pdf', 'laporan-5.pdf']));
      await page.check('#rangesMerge');
      out = await save('#savePdf');
      const rm = await texts(out.buf);
      check(`${label}: merged ranges keep pages 1,2,5`, () => assert.deepStrictEqual(rm.map((p) => p.first), ['S1', 'S2', 'S5']));
      await page.click('input[name="splitMode"][value="every"] + span');
      await page.fill('#every', '4');
      out = await save('#savePdf');
      check(`${label}: split every 4 pages`, () => assert.deepStrictEqual(zipEntries(out.buf).map((e) => e.name), ['laporan-1-4.pdf', 'laporan-5-6.pdf']));
      await page.click('input[name="splitMode"][value="pick"] + span');
      await page.click('.page-card:nth-child(2) .page-thumb');
      await page.click('.page-card:nth-child(4) .page-thumb');
      out = await save('#savePdf');
      const picked = await texts(out.buf);
      check(`${label}: split picked pages into one PDF`, () => assert.deepStrictEqual(picked.map((p) => p.first), ['S2', 'S4']));
      await page.check('#pickSeparate');
      out = await save('#savePdf');
      check(`${label}: split picked pages separately`, () => assert.deepStrictEqual(zipEntries(out.buf).map((e) => e.name), ['laporan-2.pdf', 'laporan-4.pdf']));
      await page.screenshot({ path: path.join(OUT, `p1-split-${label}.png`), fullPage: true });

      /* ---------- Organise ---------- */
      await page.goto(origin + '/susun-pdf/');
      await page.setInputFiles('#pickFiles', [pdf('a.pdf', A), pdf('c.pdf', C)]);
      await page.waitForFunction(() => window.__organize.pages.length === 4);
      await page.evaluate(() => window.__organize.whenIdle());
      for (let k = 4; k > 1; k--) await page.click(`.page-card:nth-child(${k}) .page-tools .icon-btn:nth-child(1)`);
      await page.click('.page-card:nth-child(1) .page-tools .icon-btn:nth-child(3)');
      await page.click('.page-card:nth-child(3) .page-tools .icon-btn:nth-child(4)');
      out = await save('#savePdf');
      const org = await texts(out.buf);
      check(`${label}: organise reorders, rotates and deletes`, () => {
        assert.deepStrictEqual(org.map((p) => p.first), ['C2', 'A1', 'C1']);
        assert.deepStrictEqual(org.map((p) => p.rotate), [90, 0, 0]);
      });

      /* ---------- Rotate ---------- */
      await page.goto(origin + '/putar-pdf/');
      await page.setInputFiles('#pickFiles', [pdf('s.pdf', S)]);
      await page.waitForFunction(() => window.__rotate.pages.length === 6);
      const disabledBefore = await page.evaluate(() => document.querySelector('#savePdf').disabled);
      await page.click('.page-card:nth-child(2) .page-tools .icon-btn:nth-child(2)');
      await page.click('#rotAllLeft');
      out = await save('#savePdf');
      const rot = await texts(out.buf);
      check(`${label}: rotate single page and all pages`, () => {
        assert.strictEqual(disabledBefore, true);
        assert.strictEqual(out.name, 's-putar.pdf');
        assert.deepStrictEqual(rot.map((p) => p.rotate), [270, 0, 270, 270, 270, 270]);
      });
      await page.setInputFiles('#pickFiles', [pdf('a.pdf', A)]);
      await page.waitForFunction(() => window.__rotate.pages.length === 8);
      out = await save('#savePdf');
      check(`${label}: rotate several files -> ZIP of each`, () => assert.deepStrictEqual(zipEntries(out.buf).map((e) => e.name), ['s-putar.pdf', 'a-putar.pdf']));

      /* ---------- Watermark ---------- */
      await page.goto(origin + '/watermark-pdf/');
      await page.setInputFiles('#pickFiles', [pdf('surat.pdf', R)]);
      await page.waitForFunction(() => document.querySelector('#preview').width > 100, null, { timeout: 15000 });
      out = await save('#savePdf');
      const wm = await texts(out.buf);
      const wmBox = await page.evaluate(diffBoxes, { before: R, after: out.buf.toString('base64') });
      check(`${label}: watermark text on every page, centred (incl. rotated page)`, () => {
        wm.forEach((p) => assert(p.strs.includes('SALINAN'), JSON.stringify(p.strs)));
        wmBox.forEach((b) => {
          assert(b, 'no watermark ink');
          const cx = (b.x0 + b.x1) / 2;
          const cy = (b.y0 + b.y1) / 2;
          assert(Math.abs(cx - 0.5) < 0.04 && Math.abs(cy - 0.5) < 0.04, JSON.stringify(b));
        });
      });
      await page.check('#wmTile');
      await page.click('input[name="wmPages"][value="range"] + span');
      await page.fill('#pageRange', '2');
      out = await save('#savePdf');
      const tiled = await texts(out.buf);
      check(`${label}: watermark mosaic on selected pages only`, () => {
        assert.strictEqual(tiled[0].strs.includes('SALINAN'), false);
        const copies = countWord(path.join(OUT, `${label}-p1-${out.name}`), 'SALINAN');
        assert(copies[0] === 0 && copies[1] >= 12, JSON.stringify(copies));
      });
      await page.screenshot({ path: path.join(OUT, `p1-watermark-${label}.png`), fullPage: true });

      /* ---------- Page numbers ---------- */
      await page.goto(origin + '/nombor-pdf/');
      await page.setInputFiles('#pickFiles', [pdf('buku.pdf', R)]);
      await page.waitForFunction(() => document.querySelector('#preview').width > 100, null, { timeout: 15000 });
      await page.selectOption('#pnFormat', 'words');
      out = await save('#savePdf');
      const pn = await texts(out.buf);
      const pnBox = await page.evaluate(diffBoxes, { before: R, after: out.buf.toString('base64') });
      check(`${label}: page numbers in words at bottom centre (incl. rotated page)`, () => {
        assert(pn[0].strs.join(' ').includes('Muka surat 1 daripada 2'), JSON.stringify(pn[0].strs));
        assert(pn[1].strs.join(' ').includes('Muka surat 2 daripada 2'), JSON.stringify(pn[1].strs));
        pnBox.forEach((b) => {
          assert(b && b.y0 > 0.9 && Math.abs((b.x0 + b.x1) / 2 - 0.5) < 0.05, JSON.stringify(b));
        });
      });
      await page.check('#pnSkip');
      await page.selectOption('#pnFormat', 'n');
      out = await save('#savePdf');
      const pn2 = await texts(out.buf);
      check(`${label}: page numbers can skip the cover`, () => {
        assert.deepStrictEqual(pn2[0].strs, ['R1']);
        assert(pn2[1].strs.includes('1'), JSON.stringify(pn2[1].strs));
      });
      await page.screenshot({ path: path.join(OUT, `p1-pagenum-${label}.png`), fullPage: true });

      /* ---------- Crop ---------- */
      await page.goto(origin + '/potong-pdf/');
      await page.setInputFiles('#pickFiles', [pdf('a.pdf', A)]);
      await page.waitForFunction(() => document.querySelector('#cropCanvas').width > 100);
      // Drag the bottom-right handle inwards.
      const h = page.locator('.crop-rect [data-h="br"]');
      await h.scrollIntoViewIfNeeded();
      const hb = await h.boundingBox();
      const stage = await page.locator('#cropStage').boundingBox();
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(stage.x + stage.width * 0.6, stage.y + stage.height * 0.5, { steps: 6 });
      await page.mouse.up();
      const r = await page.evaluate(() => window.__crop.rect);
      check(`${label}: crop handle resizes the box`, () => assert(Math.abs(r.x + r.w - 0.6) < 0.02 && Math.abs(r.y + r.h - 0.5) < 0.02, JSON.stringify(r)));
      await page.evaluate(() => window.__crop.setRect({ x: 0.1, y: 0.2, w: 0.5, h: 0.3 }));
      out = await save('#savePdf');
      const cr = await texts(out.buf);
      check(`${label}: crop sets the page box on all pages`, () => {
        cr.forEach((p) => {
          const [x0, y0, x1, y1] = p.view;
          assert(Math.abs(x0 - 59.5) < 1 && Math.abs(x1 - 357.2) < 1, JSON.stringify(p.view));
          assert(Math.abs(y1 - 673.5) < 1 && Math.abs(y0 - 420.9) < 1, JSON.stringify(p.view));
        });
      });
      await page.screenshot({ path: path.join(OUT, `p1-crop-${label}.png`), fullPage: true });

      for (const url of ['/', '/gabung-pdf/', '/pisah-pdf/', '/susun-pdf/', '/putar-pdf/', '/watermark-pdf/', '/nombor-pdf/', '/potong-pdf/']) {
        await page.goto(origin + url);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check(`${label}: ${url} has no horizontal scroll`, () => assert(overflow <= 0, `${overflow}px`));
      }
      await page.goto(origin + '/');
      await page.screenshot({ path: path.join(OUT, `p1-home-${label}.png`), fullPage: true });
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
