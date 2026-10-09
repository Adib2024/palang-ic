// Unit test for the PDF security handler, cross-checked against pypdf:
//  - pypdf encrypts (RC4-40, RC4-128, AES-128, AES-256-R5, AES-256) -> we unlock
//  - we protect (AES-256 R6) -> pypdf opens with user/owner password
// Run: node tests/crypto-test.mjs   (needs python3 with pypdf + cryptography)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const L = await import(path.join(ROOT, 'vendor/pdf-lib/pdf-lib.esm.min.js'));
const { unlockPdf, protectPdf } = await import(path.join(ROOT, 'js/pdf-security.js'));
const { md5, permissions } = await import(path.join(ROOT, 'js/pdf-crypto.js'));
const dir = mkdtempSync(path.join(tmpdir(), 'dj-crypto-'));
const results = [];
const check = async (name, fn) => { await fn(); results.push(`ok   ${name}`); };

const py = (code, ...args) => execFileSync('python3', ['-I', '-c', code, ...args], { encoding: 'utf8' }).trim();
const textOf = (file, pw = '') => py([
  'import sys, pypdf',
  'r = pypdf.PdfReader(sys.argv[1])',
  'if r.is_encrypted:',
  '    d = int(r.decrypt(sys.argv[2]))',
  '    print("DECRYPT", d)',
  '    if d == 0: sys.exit(0)',
  'print(" | ".join(p.extract_text() for p in r.pages))',
  'print("TITLE", (r.metadata or {}).get("/Title"))',
].join('\n'), file, pw);

// MD5 sanity (RFC 1321 test vectors).
const hex = (b) => Buffer.from(b).toString('hex');
await check('md5 test vectors', () => {
  assert.strictEqual(hex(md5(new TextEncoder().encode(''))), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.strictEqual(hex(md5(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))), '9e107d9d372bb6826bd81d3542a419d6');
  assert.strictEqual(hex(md5(new Uint8Array(1000).fill(97))), 'cabe45dcc9ae5b66ba86600cca6b8ba8');
});

// Base document (with object streams, as pdf-lib saves by default).
const doc = await L.PDFDocument.create();
doc.setTitle('Penyata Rahsia');
const font = await doc.embedFont(L.StandardFonts.Helvetica);
for (let i = 1; i <= 2; i++) doc.addPage([400, 400]).drawText(`RAHSIA DOKUJAGA ${i}`, { x: 40, y: 300, size: 18, font });
const base = await doc.save();
const basePath = path.join(dir, 'base.pdf');
writeFileSync(basePath, base);

for (const alg of ['RC4-40', 'RC4-128', 'AES-128', 'AES-256-R5', 'AES-256']) {
  const enc = path.join(dir, `enc-${alg}.pdf`);
  py(['import sys, pypdf', 'r = pypdf.PdfReader(sys.argv[1])', 'w = pypdf.PdfWriter(clone_from=r)',
    'w.encrypt(user_password="abc", owner_password="own", algorithm=sys.argv[3])', 'w.write(sys.argv[2])'].join('\n'), basePath, enc, alg);
  const bytes = new Uint8Array(readFileSync(enc));
  for (const pw of ['abc', 'own']) {
    await check(`unlock ${alg} with ${pw === 'abc' ? 'user' : 'owner'} password`, async () => {
      const out = path.join(dir, `un-${alg}-${pw}.pdf`);
      writeFileSync(out, await unlockPdf(bytes, pw));
      const t = textOf(out);
      assert(!t.includes('DECRYPT'), 'still encrypted');
      assert(t.includes('RAHSIA DOKUJAGA 1') && t.includes('RAHSIA DOKUJAGA 2'), t);
      assert(t.includes('TITLE Penyata Rahsia'), t);
    });
  }
  await check(`unlock ${alg} rejects a wrong password`, async () => {
    await assert.rejects(unlockPdf(bytes, 'salah'), /password/);
  });
}

await check('unlock reports an unencrypted file', async () => {
  await assert.rejects(unlockPdf(base, ''), /not-encrypted/);
});

const P = permissions({ print: true, copy: false });
const prot = await protectPdf(base, 'rahsia123', 'pemilik!', P);
const protPath = path.join(dir, 'protected.pdf');
writeFileSync(protPath, prot);
await check('protect: pypdf opens with the user password', () => {
  const t = textOf(protPath, 'rahsia123');
  assert(t.startsWith('DECRYPT 1'), t);
  assert(t.includes('RAHSIA DOKUJAGA 2') && t.includes('TITLE Penyata Rahsia'), t);
});
await check('protect: pypdf opens with the owner password', () => {
  assert(textOf(protPath, 'pemilik!').startsWith('DECRYPT 2'));
});
await check('protect: wrong password does not open', () => {
  assert(textOf(protPath, 'x').startsWith('DECRYPT 0'));
});
await check('protect: AES-256 R6 with chosen permissions', () => {
  const info = py(['import sys, pypdf', 'r = pypdf.PdfReader(sys.argv[1])', 'e = r.trailer["/Encrypt"]',
    'print(e["/V"], e["/R"], e["/CF"]["/StdCF"]["/CFM"], int(e["/P"]))'].join('\n'), protPath);
  assert.strictEqual(info, `5 6 /AESV3 ${P}`);
});
await check('protect -> unlock round trip', async () => {
  const back = path.join(dir, 'back.pdf');
  writeFileSync(back, await unlockPdf(prot, 'rahsia123'));
  assert(textOf(back).includes('RAHSIA DOKUJAGA 1'));
});
await check('protect refuses an already encrypted file', async () => {
  await assert.rejects(protectPdf(prot, 'a', 'b', P), /encrypted/);
});

console.log(results.join('\n'));
console.log(`\nAll ${results.length} checks passed.`);
