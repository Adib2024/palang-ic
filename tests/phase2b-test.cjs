// Browser test for Unlock PDF and Protect PDF.
// Test PDFs are generated in the page with pdf-lib and encrypted by pypdf (no
// real documents); outputs are cross-checked with pdf.js and pypdf.
// Run: NODE_PATH="$(npm root -g)" node tests/phase2b-test.cjs [outDir]
// (needs python3 with pypdf + cryptography)
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));
const py = (code, ...args) => execFileSync('python3', ['-I', '-c', code, ...args], { encoding: 'utf8' }).trim();

/** Encrypt a PDF with pypdf. */
function pyEncrypt(src, dst, user, owner, algorithm, restrict) {
  py([
    'import sys, pypdf',
    'from pypdf.constants import UserAccessPermissions as U',
    'w = pypdf.PdfWriter(clone_from=pypdf.PdfReader(sys.argv[1]))',
    'p = U.all() & ~U.PRINT & ~U.EXTRACT if sys.argv[6] == "1" else U.all()',
    'w.encrypt(sys.argv[3], sys.argv[4], algorithm=sys.argv[5], permissions_flag=p)',
    'w.write(sys.argv[2])',
  ].join('\n'), src, dst, user, owner, algorithm, restrict ? '1' : '0');
}

/** Text of every page via pypdf, after decrypting with `password` ('' allowed). Returns 'LOCKED' if it can't. */
function pyText(file, password) {
  return py([
    'import sys, pypdf',
    'r = pypdf.PdfReader(sys.argv[1])',
    'if r.is_encrypted and r.decrypt(sys.argv[2]) == 0: print("LOCKED"); sys.exit()',
    'print(("ENC " if r.is_encrypted else "") + " | ".join(p.extract_text() for p in r.pages))',
  ].join('\n'), file, password);
}


// ---- in-page helpers ----

async function makeDoc() {
  const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const d = await L.PDFDocument.create();
  const font = await d.embedFont(L.StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) d.addPage([595.28, 841.89]).drawText(`SULIT CONTOH ${i}`, { x: 60, y: 780, size: 20, font });
  d.setTitle('Penyata Contoh');
  return b64(await d.save());
}

/** Try to open with pdf.js; returns text or the error name. */
async function pdfjsOpen({ b64, password }) {
  const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  try {
    const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), password, isEvalSupported: false, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/' }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => it.str).join(' '));
    return out.join(' | ');
  } catch (e) {
    return `ERR:${e.name}`;
  }
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
      const fileOf = (name, p) => ({ name, mimeType: 'application/pdf', buffer: fs.readFileSync(p) });
      const save = async () => {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#savePdf')]);
        const p = path.join(OUT, `${label}-p2b-${dl.suggestedFilename()}`);
        await dl.saveAs(p);
        return { name: dl.suggestedFilename(), path: p, b64: fs.readFileSync(p).toString('base64') };
      };

      /* ---------- Protect PDF ---------- */
      await page.goto(origin + '/lindungi-pdf/');
      const plainPath = path.join(OUT, `${label}-p2b-plain.pdf`);
      fs.writeFileSync(plainPath, Buffer.from(await page.evaluate(makeDoc), 'base64'));
      await page.setInputFiles('#pickFiles', [fileOf('penyata.pdf', plainPath)]);
      await page.waitForFunction(() => !document.querySelector('#toolLayout').classList.contains('is-empty'));
      await page.fill('#pw1', 'abc');
      const weak = await page.getAttribute('#pwMeter', 'data-level');
      check(`${label}: weak password is flagged`, () => assert.strictEqual(weak, '0'));
      await page.fill('#pw1', 'Rahsia#2026x');
      const strong = await page.getAttribute('#pwMeter', 'data-level');
      check(`${label}: strong password is recognised`, () => assert.strictEqual(strong, '2'));
      await page.fill('#pw2', 'Rahsia#2026y');
      const blocked = [await page.isDisabled('#savePdf'), await page.isVisible('#pwMismatch')];
      check(`${label}: mismatched passwords block saving`, () => assert.deepStrictEqual(blocked, [true, true]));
      await page.fill('#pw2', 'Rahsia#2026x');
      assert(!(await page.isDisabled('#savePdf')));
      await page.uncheck('#allowCopy');
      const prot = await save();
      check(`${label}: protected file is named -dilindungi.pdf`, () => assert.strictEqual(prot.name, 'penyata-dilindungi.pdf'));
      const noPw = await page.evaluate(pdfjsOpen, { b64: prot.b64 });
      const wrongPw = await page.evaluate(pdfjsOpen, { b64: prot.b64, password: 'salah' });
      const rightPw = await page.evaluate(pdfjsOpen, { b64: prot.b64, password: 'Rahsia#2026x' });
      check(`${label}: pdf.js needs the password to open it`, () => {
        assert.strictEqual(noPw, 'ERR:PasswordException');
        assert.strictEqual(wrongPw, 'ERR:PasswordException');
        assert.match(rightPw, /SULIT CONTOH 1 \| SULIT CONTOH 2/);
      });
      check(`${label}: pypdf decrypts it with the password only`, () => {
        assert.strictEqual(pyText(prot.path, ''), 'LOCKED');
        assert.match(pyText(prot.path, 'Rahsia#2026x'), /SULIT CONTOH 1.*SULIT CONTOH 2/s);
      });
      check(`${label}: content is not readable without decrypting`, () => {
        assert(!fs.readFileSync(prot.path).includes('SULIT'));
        assert(!fs.readFileSync(prot.path).includes('Penyata Contoh'));
      });
      const perms = Number(py(['import sys, pypdf', 'r = pypdf.PdfReader(sys.argv[1])', 'print(r.trailer["/Encrypt"]["/P"])'].join('\n'), prot.path));
      check(`${label}: copy blocked, print allowed in permissions`, () => {
        assert.strictEqual(perms & 4, 4, 'print');
        assert.strictEqual(perms & 16, 0, 'copy');
      });
      // An already-encrypted file is refused politely.
      await page.setInputFiles('#pickFiles', [fileOf('dah-kunci.pdf', prot.path)]);
      await page.fill('#pw1', 'Rahsia#2026x');
      await page.fill('#pw2', 'Rahsia#2026x');
      await page.click('#savePdf');
      await page.waitForFunction(() => /sudah|already/i.test(document.querySelector('#status').textContent));
      check(`${label}: already-protected PDF is refused with a message`, () => {});

      /* ---------- Unlock PDF ---------- */
      await page.goto(origin + '/buka-kunci-pdf/');
      // Our own protected file, wrong then right password.
      await page.setInputFiles('#pickFiles', [fileOf('penyata-dilindungi.pdf', prot.path)]);
      await page.waitForFunction(() => !document.querySelector('#pwBlock').hidden);
      await page.fill('#password', 'salah');
      await page.click('#unlockBtn');
      await page.waitForFunction(() => /salah|wrong|incorrect/i.test(document.querySelector('#status').textContent));
      check(`${label}: wrong password shows an error`, () => {});
      await page.fill('#password', 'Rahsia#2026x');
      await page.click('#unlockBtn');
      await page.waitForFunction(() => !document.querySelector('#result').hidden);
      const un1 = await save();
      check(`${label}: unlocked file opens without a password`, () => {
        assert.strictEqual(un1.name, 'penyata-dilindungi-dibuka.pdf');
        assert.match(pyText(un1.path, ''), /^SULIT CONTOH 1.*SULIT CONTOH 2/s);
      });
      check(`${label}: unlock is structural (text kept, no raster)`, () => {
        assert.strictEqual(fs.readFileSync(un1.path).includes('/Encrypt'), false);
      });

      // pypdf-encrypted files in several algorithms, using the owner password.
      for (const alg of ['RC4-128', 'AES-128', 'AES-256']) {
        const enc = path.join(OUT, `${label}-p2b-py-${alg}.pdf`);
        pyEncrypt(plainPath, enc, 'pengguna1', 'pemilik1', alg, false);
        await page.setInputFiles('#pickFiles', [fileOf(`py-${alg}.pdf`, enc)]);
        await page.waitForFunction(() => !document.querySelector('#pwBlock').hidden);
        await page.fill('#password', 'pemilik1');
        await page.click('#unlockBtn');
        await page.waitForFunction(() => !document.querySelector('#result').hidden);
        const out = await save();
        check(`${label}: unlocks pypdf ${alg} with the owner password`, () => assert.match(pyText(out.path, ''), /^SULIT CONTOH 1.*SULIT CONTOH 2/s));
      }

      // Restrictions only (empty user password): unlocks automatically.
      const restricted = path.join(OUT, `${label}-p2b-restricted.pdf`);
      pyEncrypt(plainPath, restricted, '', 'pemilik2', 'AES-128', true);
      await page.setInputFiles('#pickFiles', [fileOf('terhad.pdf', restricted)]);
      await page.waitForFunction(() => !document.querySelector('#result').hidden);
      const un2 = await save();
      check(`${label}: print/copy restrictions removed without asking`, () => assert.match(pyText(un2.path, ''), /^SULIT CONTOH 1/));

      // Not encrypted.
      await page.setInputFiles('#pickFiles', [fileOf('biasa.pdf', plainPath)]);
      await page.waitForFunction(() => !document.querySelector('#notLocked').hidden);
      check(`${label}: unencrypted PDF shows a note`, () => {});

      for (const url of ['/', '/buka-kunci-pdf/', '/lindungi-pdf/']) {
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
