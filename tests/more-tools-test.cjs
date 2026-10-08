// Browser test for PDF -> Images, Compress Images, Sign PDF and Scan Document.
// All inputs are generated in the page (no real documents or photos).
// Run: NODE_PATH="$(npm root -g)" node tests/more-tools-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));
const FRONT = path.join(__dirname, 'fixtures/sample-front-exif6.jpg');

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

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
const isJpeg = (b) => b[0] === 0xff && b[1] === 0xd8;
const isPng = (b) => b.subarray(1, 4).toString() === 'PNG';
const pngSize = (b) => [b.readUInt32BE(16), b.readUInt32BE(20)];

// In-page helpers ------------------------------------------------------------

async function makePdf({ pages, rotateLast }) {
  const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  const doc = await L.PDFDocument.create();
  const font = await doc.embedFont(L.StandardFonts.HelveticaBold);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([595.28, 841.89]);
    p.drawText(`PAGE ${i}`, { x: 60, y: 760, size: 40, font });
    p.drawText('SAMPLE ONLY - NOT A REAL DOCUMENT', { x: 60, y: 720, size: 14, font });
    if (rotateLast && i === pages) p.setRotation(L.degrees(90));
  }
  const bytes = await doc.save();
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Bounding box (as page fractions) of pixels that differ between the
// original and the signed PDF, per page, rendered upright as displayed.
async function signedDiff({ before, after }) {
  const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  const open = (s) => pdfjs.getDocument({ data: Uint8Array.from(atob(s), (c) => c.charCodeAt(0)), isEvalSupported: false, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/' }).promise;
  const [a, b] = await Promise.all([open(before), open(after)]);
  const out = [];
  for (let n = 1; n <= a.numPages; n++) {
    const render = async (doc) => {
      const pg = await doc.getPage(n);
      const vp = pg.getViewport({ scale: 1 });
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
        if (Math.abs(ia.data[k] - ib.data[k]) + Math.abs(ia.data[k + 1] - ib.data[k + 1]) + Math.abs(ia.data[k + 2] - ib.data[k + 2]) > 90) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    out.push(x1 < 0 ? null : { x0: x0 / ia.width, y0: y0 / ia.height, x1: x1 / ia.width, y1: y1 / ia.height });
  }
  return out;
}

// A photo of white "paper" (known corners) on a dark table.
async function makeDocPhoto() {
  const c = document.createElement('canvas');
  c.width = 2000; c.height = 1500;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3b3329'; ctx.fillRect(0, 0, c.width, c.height);
  const corners = [{ x: 520, y: 150 }, { x: 1480, y: 230 }, { x: 1420, y: 1380 }, { x: 470, y: 1320 }];
  ctx.fillStyle = '#ecebe6';
  ctx.beginPath();
  corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#222';
  ctx.font = 'bold 60px sans-serif';
  for (let i = 0; i < 8; i++) ctx.fillText('SAMPLE LINE ' + (i + 1), 620, 340 + i * 120);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { photo: btoa(s), corners };
}

async function makeBigPng() {
  const c = document.createElement('canvas');
  c.width = 3000; c.height = 2000;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = Math.random() * 60;
    img.data[i] = 120 + n; img.data[i + 1] = 160 + n; img.data[i + 2] = 200 - n; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
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
      const save = async (clickSel, name) => {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click(clickSel)]);
        const p = path.join(OUT, `${label}-${name || dl.suggestedFilename()}`);
        await dl.saveAs(p);
        return { name: dl.suggestedFilename(), buf: fs.readFileSync(p) };
      };

      /* ---------- PDF -> Images ---------- */
      await page.goto(origin + '/pdf-gambar/');
      const pdf3 = Buffer.from(await page.evaluate(makePdf, { pages: 3 }), 'base64');
      await page.setInputFiles('#pickFiles', { name: 'surat.pdf', mimeType: 'application/pdf', buffer: pdf3 });
      await page.waitForFunction(() => window.__pdf2img.pages.length === 3);
      await page.evaluate(() => window.__pdf2img.whenIdle());
      const zip = await save('#saveImgs');
      const entries = zipEntries(zip.buf);
      check(`${label}: PDF→Gambar saves all pages as JPG in a ZIP`, () => {
        assert.strictEqual(zip.name, 'surat-gambar.zip');
        assert.deepStrictEqual(entries.map((e) => e.name), ['surat-1.jpg', 'surat-2.jpg', 'surat-3.jpg']);
        entries.forEach((e) => assert(isJpeg(e.data)));
      });
      await page.click('input[name="format"][value="png"] + span');
      await page.click('input[name="which"][value="selected"] + span');
      await page.click('#saveImgs');
      await page.waitForFunction(() => /sekurang-kurangnya/.test(document.querySelector('#status').textContent));
      check(`${label}: PDF→Gambar asks to select pages`, () => {});
      await page.click('.page-card:nth-child(2) .page-thumb');
      const one = await save('#saveImgs');
      check(`${label}: PDF→Gambar saves one selected page as PNG at 150 DPI`, () => {
        assert.strictEqual(one.name, 'surat-2.png');
        assert(isPng(one.buf));
        const [w, h] = pngSize(one.buf);
        assert(Math.abs(w - 1240) <= 2 && Math.abs(h - 1754) <= 2, `${w}x${h}`);
      });

      /* ---------- Compress images ---------- */
      await page.goto(origin + '/kecil-gambar/');
      const bigPng = Buffer.from(await page.evaluate(makeBigPng), 'base64');
      await page.setInputFiles('#pickFiles', [
        { name: 'besar.png', mimeType: 'image/png', buffer: bigPng },
        { name: 'sample-front-exif6.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(FRONT) },
      ]);
      await page.waitForFunction(() => window.__imgsmall.items.length === 2);
      await page.selectOption('#limit', '204800');
      await page.click('#run');
      await page.waitForFunction(() => window.__imgsmall.items.every((it) => it.out) && !document.querySelector('#run').disabled, null, { timeout: 60000 });
      const outs = await page.evaluate(async () => Promise.all(window.__imgsmall.items.map(async (it) => {
        const b = new Uint8Array(await it.out.arrayBuffer());
        return { size: it.out.size, w: it.outW, h: it.outH, over: it.over, exif: new TextDecoder('latin1').decode(b.subarray(0, 64 * 1024)).includes('Exif') };
      })));
      check(`${label}: Kecilkan Gambar fits the 200 KB limit`, () => outs.forEach((o) => assert(o.size <= 204800 && !o.over, JSON.stringify(o))));
      check(`${label}: Kecilkan Gambar strips EXIF and keeps photo upright`, () => {
        assert.strictEqual(outs[1].exif, false);
        assert(outs[1].w > outs[1].h, JSON.stringify(outs[1]));
      });
      const all = await save('#saveAll');
      check(`${label}: Kecilkan Gambar saves all as ZIP`, () => {
        assert.deepStrictEqual(zipEntries(all.buf).map((e) => e.name), ['besar-kecil.jpg', 'sample-front-exif6-kecil.jpg']);
      });
      await page.selectOption('#limit', '0');
      await page.selectOption('#maxDim', '800');
      await page.click('#run');
      await page.waitForFunction(() => window.__imgsmall.items.every((it) => it.out) && !document.querySelector('#run').disabled, null, { timeout: 60000 });
      const dims = await page.evaluate(() => window.__imgsmall.items.map((it) => Math.max(it.outW, it.outH)));
      check(`${label}: Kecilkan Gambar resizes to max 800 px`, () => assert.deepStrictEqual(dims, [800, 800]));
      await page.screenshot({ path: path.join(OUT, `imgsmall-${label}.png`), fullPage: true });

      /* ---------- Sign PDF ---------- */
      await page.goto(origin + '/tandatangan-pdf/');
      const pdf2 = await page.evaluate(makePdf, { pages: 2, rotateLast: true });
      await page.setInputFiles('#pickFiles', { name: 'tawaran.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf2, 'base64') });
      await page.waitForFunction(() => window.__sign.views.length === 2);
      await page.click('#addSig');
      const emptyMsg = await page.textContent('#status');
      check(`${label}: Tandatangan rejects an empty pad`, () => assert.match(emptyMsg, /Lukis, taip atau pilih/));

      // Draw a squiggle on the pad.
      await page.locator('#pad').scrollIntoViewIfNeeded();
      const pad = await page.locator('#pad').boundingBox();
      await page.mouse.move(pad.x + pad.width * 0.15, pad.y + pad.height * 0.6);
      await page.mouse.down();
      for (let k = 1; k <= 12; k++) await page.mouse.move(pad.x + pad.width * (0.15 + k * 0.055), pad.y + pad.height * (0.6 + 0.25 * Math.sin(k)), { steps: 2 });
      await page.mouse.up();
      await page.click('#addSig');
      await page.waitForFunction(() => window.__sign.items.length === 1);

      // Drag the signature towards the bottom-right of page 1.
      const item = page.locator('.sig-item').first();
      await item.scrollIntoViewIfNeeded();
      const ib = await item.boundingBox();
      const pageBox = await page.locator('.sign-page').first().boundingBox();
      await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
      await page.mouse.down();
      await page.mouse.move(pageBox.x + pageBox.width * 0.7, pageBox.y + pageBox.height * 0.8, { steps: 8 });
      await page.mouse.up();

      // Typed name + date on the rotated page 2.
      await page.click('input[name="sigTab"][value="type"] + span');
      await page.fill('#typedName', 'Contoh Nama');
      await page.evaluate(() => window.__sign.setActive(1));
      await page.click('#addSig');
      await page.click('#addDate');
      await page.waitForFunction(() => window.__sign.items.length === 3);
      await page.screenshot({ path: path.join(OUT, `sign-${label}.png`), fullPage: true });

      const placed = await page.evaluate(() => window.__sign.items.map((it) => ({ page: it.page, fx: it.fx, fy: it.fy, fw: it.fw, fh: it.fh })));
      const signed = await save('#savePdf');
      check(`${label}: Tandatangan saves a new PDF`, () => {
        assert.strictEqual(signed.name, 'tawaran-ditandatangan.pdf');
        assert.strictEqual(signed.buf.subarray(0, 5).toString(), '%PDF-');
      });
      const diff = await page.evaluate(signedDiff, { before: pdf2, after: signed.buf.toString('base64') });
      check(`${label}: signature lands exactly where it was placed (incl. rotated page)`, () => {
        for (const pg of [0, 1]) {
          const its = placed.filter((p) => p.page === pg);
          const box = {
            x0: Math.min(...its.map((p) => p.fx)), y0: Math.min(...its.map((p) => p.fy)),
            x1: Math.max(...its.map((p) => p.fx + p.fw)), y1: Math.max(...its.map((p) => p.fy + p.fh)),
          };
          const d = diff[pg];
          assert(d, `no change on page ${pg + 1}`);
          // Ink sits inside the placed boxes (2% tolerance) and isn't tiny.
          assert(d.x0 >= box.x0 - 0.02 && d.y0 >= box.y0 - 0.02 && d.x1 <= box.x1 + 0.02 && d.y1 <= box.y1 + 0.02,
            `page ${pg + 1}: ink ${JSON.stringify(d)} vs box ${JSON.stringify(box)}`);
          assert(d.x1 - d.x0 > (box.x1 - box.x0) * 0.4, `page ${pg + 1}: too small ${JSON.stringify(d)}`);
        }
        assert(placed[0].fx > 0.4 && placed[0].fy > 0.6, `drag didn't move: ${JSON.stringify(placed[0])}`);
      });

      /* ---------- Scan document ---------- */
      await page.goto(origin + '/imbas/');
      const { photo, corners } = await page.evaluate(makeDocPhoto);
      await page.setInputFiles('#pickFiles', { name: 'dokumen.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(photo, 'base64') });
      await page.waitForFunction(() => window.__scan.pages.length === 1 && window.__scan.editing);
      const found = await page.evaluate(() => window.__scan.pages[0].corners);
      check(`${label}: Imbas finds the paper corners automatically`, () => {
        found.forEach((c, i) => assert(Math.hypot(c.x - corners[i].x, c.y - corners[i].y) < 2000 * 0.03, `corner ${i}: ${JSON.stringify(c)} vs ${JSON.stringify(corners[i])}`));
      });
      // Nudge one handle, pick black & white, apply.
      const h0 = page.locator('.crop-handle').first();
      await h0.scrollIntoViewIfNeeded();
      const hb = await h0.boundingBox();
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(hb.x + hb.width / 2 + 6, hb.y + hb.height / 2 + 6, { steps: 3 });
      await page.mouse.up();
      const moved = await page.evaluate(() => window.__scan.editing.corners[0]);
      check(`${label}: Imbas corner handle can be dragged`, () => assert(Math.hypot(moved.x - found[0].x, moved.y - found[0].y) > 2, JSON.stringify(moved)));
      await page.click('input[name="filter"][value="bw"] + span');
      await page.screenshot({ path: path.join(OUT, `scan-editor-${label}.png`), fullPage: true });
      await page.click('#applyBtn');
      await page.waitForFunction(() => !window.__scan.editing);
      const res = await page.evaluate(() => {
        const r = window.__scan.pages[0].result;
        const d = r.getContext('2d').getImageData(0, 0, r.width, r.height).data;
        let black = 0; let white = 0; let other = 0;
        for (let i = 0; i < d.length; i += 4) { if (d[i] === 0) black++; else if (d[i] === 255) white++; else other++; }
        return { w: r.width, h: r.height, black, white, other };
      });
      check(`${label}: Imbas straightens and filters to black & white`, () => {
        const ratio = res.h / res.w;
        assert(Math.abs(ratio - 1180 / 960) < 0.08, `ratio ${ratio}`);
        assert.strictEqual(res.other, 0);
        assert(res.white > res.black * 4 && res.black > 1000, JSON.stringify(res));
      });
      const scanned = await save('#makePdf');
      check(`${label}: Imbas saves a 1-page PDF`, () => {
        assert.strictEqual(scanned.name, 'imbasan.pdf');
        assert.strictEqual((scanned.buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1);
      });
      await page.screenshot({ path: path.join(OUT, `scan-${label}.png`), fullPage: true });

      for (const url of ['/pdf-gambar/', '/kecil-gambar/', '/tandatangan-pdf/', '/imbas/']) {
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
