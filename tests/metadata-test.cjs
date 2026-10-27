// Browser test for Remove PDF Metadata. A PDF full of hidden information is
// made in the page; the cleaned file is checked with pypdf and by searching
// the raw bytes for the secret strings.
// Run: NODE_PATH="$(npm root -g)" node tests/metadata-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));
const PY = `
import sys, json
from pypdf import PdfReader
r = PdfReader(sys.argv[1])
info = {k: str(v) for k, v in (r.metadata or {}).items()}
root = r.trailer['/Root']
names = root.get('/Names', {})
annots = []
for p in r.pages:
    for a in p.get('/Annots', []) or []:
        a = a.get_object()
        annots.append({'sub': str(a.get('/Subtype')), 'T': str(a.get('/T')) if a.get('/T') is not None else None})
print(json.dumps({'info': info, 'xmp': '/Metadata' in root, 'names': list(names.keys()) if names else [],
  'open': '/OpenAction' in root, 'id': '/ID' in r.trailer, 'pages': len(r.pages), 'annots': annots,
  'fields': sorted((r.get_fields() or {}).keys()), 'text': r.pages[0].extract_text()}))
`;
const inspect = (file) => JSON.parse(execFileSync('python3', ['-I', '-c', PY, file], { encoding: 'utf8' }));

async function makeDirty() {
  const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  const d = await L.PDFDocument.create();
  const f = await d.embedFont(L.StandardFonts.Helvetica);
  const p = d.addPage([595, 842]);
  p.drawText('Surat tawaran kerja', { x: 60, y: 760, size: 20, font: f });
  d.addPage([595, 842]);
  d.setTitle('Draf Rahsia Syarikat');
  d.setAuthor('Ali Rahsia');
  d.setSubject('Gaji');
  d.setKeywords(['sulit', 'hr']);
  d.setCreator('Microsoft Word RahsiaCorp');
  d.setProducer('RahsiaPDF 9');
  d.setCreationDate(new Date(2024, 0, 31, 9, 30));
  d.setModificationDate(new Date(2024, 1, 2, 10, 0));
  d.getInfoDict().set(L.PDFName.of('Company'), L.PDFHexString.fromText('RahsiaCorp Sdn Bhd'));
  // XMP stream with the author's name.
  const xmp = d.context.stream('<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:creator>Ali Rahsia XMP</dc:creator></x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' });
  d.catalog.set(L.PDFName.of('Metadata'), d.context.register(xmp));
  // Attachment, JavaScript, a comment with an author, and a form field.
  await d.attach(new TextEncoder().encode('gaji: 9000'), 'gaji-rahsia.txt', { mimeType: 'text/plain' });
  d.addJavaScript('hello', 'app.alert("hi")');
  const note = d.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [50, 50, 70, 70], Contents: L.PDFHexString.fromText('Semak'), T: L.PDFHexString.fromText('Ali Rahsia Komen') });
  p.node.addAnnot(d.context.register(note));
  const form = d.getForm();
  const tf = form.createTextField('nama_penuh');
  tf.addToPage(p, { x: 60, y: 600, width: 200, height: 24 });
  tf.setText('Isi');
  const bytes = await d.save({ useObjectStreams: false });
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
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
      const errors = [];
      const foreign = [];
      page.on('request', (r) => { if (!/^(data|blob):/.test(r.url()) && !r.url().startsWith(origin)) foreign.push(r.url()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) errors.push(m.text()); });
      await page.goto(origin + '/buang-metadata/');
      const dirty = Buffer.from(await page.evaluate(makeDirty), 'base64');
      const before = path.join(OUT, `${label}-meta-dirty.pdf`);
      fs.writeFileSync(before, dirty);
      await page.setInputFiles('#pickFiles', { name: 'tawaran.pdf', mimeType: 'application/pdf', buffer: dirty });
      await page.waitForFunction(() => window.__meta.input);
      const found = await page.$$eval('#metaFound > div', (els) => els.map((e) => e.textContent));
      check(`${label}: shows the hidden information`, () => {
        const all = found.join('\n');
        for (const s of ['PengarangAli Rahsia', 'TajukDraf Rahsia Syarikat', 'Perisian PDFRahsiaPDF 9', 'Tarikh dicipta31/01/2024 09:30', 'CompanyRahsiaCorp Sdn Bhd', 'Metadata XMPAda', 'Fail lampiran1', 'JavaScriptAda', 'Nama pada komenAli Rahsia Komen']) {
          assert(all.includes(s), `${s} not in ${all}`);
        }
      });
      await page.screenshot({ path: path.join(OUT, `metadata-${label}.png`), fullPage: true });

      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#savePdf')]);
      const outPath = path.join(OUT, `${label}-${dl.suggestedFilename()}`);
      await dl.saveAs(outPath);
      const res = inspect(outPath);
      const raw = fs.readFileSync(outPath).toString('latin1');
      check(`${label}: file name`, () => assert.strictEqual(dl.suggestedFilename(), 'tawaran-bersih.pdf'));
      check(`${label}: document info, XMP and ID are gone`, () => {
        assert.deepStrictEqual(res.info, {});
        assert.strictEqual(res.xmp, false);
        assert.strictEqual(res.id, false);
      });
      check(`${label}: attachments, JavaScript and comment authors are gone`, () => {
        assert(!res.names.includes('/EmbeddedFiles') && !res.names.includes('/JavaScript'), JSON.stringify(res.names));
        assert.strictEqual(res.open, false);
        const note = res.annots.find((a) => a.sub === '/Text');
        assert(note && note.T === null, JSON.stringify(res.annots));
      });
      check(`${label}: form field names and page content are kept`, () => {
        assert.deepStrictEqual(res.fields, ['nama_penuh']);
        assert.strictEqual(res.pages, 2);
        assert.match(res.text, /Surat tawaran kerja/);
      });
      check(`${label}: no trace of the secrets left in the file`, () => {
        for (const s of ['Rahsia', 'gaji', 'app.alert', 'Microsoft']) assert(!raw.includes(s), `found ${s}`);
      });
      const afterRows = await page.$$eval('#metaAfter > div', (els) => els.map((e) => e.textContent));
      check(`${label}: shows the clean result`, () => assert.deepStrictEqual(afterRows, ['✓ Tiada maklumat tersembunyi dijumpai.']));

      // Keep some things; set a new title.
      await page.uncheck('#rmXmp');
      await page.fill('#newTitle', 'Surat Tawaran');
      const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#savePdf')]);
      const p2 = path.join(OUT, `${label}-meta-2.pdf`);
      await dl2.saveAs(p2);
      const r2 = inspect(p2);
      check(`${label}: options: keep XMP, set a new title`, () => {
        assert.deepStrictEqual(r2.info, { '/Title': 'Surat Tawaran' });
        assert.strictEqual(r2.xmp, true);
      });

      // Batch of two PDFs → ZIP.
      await page.setInputFiles('#pickFiles', [
        { name: 'a.pdf', mimeType: 'application/pdf', buffer: dirty },
        { name: 'b.pdf', mimeType: 'application/pdf', buffer: dirty },
      ]);
      await page.waitForFunction(() => window.__meta.batch.active);
      const [z] = await Promise.all([page.waitForEvent('download'), page.click('#savePdf')]);
      check(`${label}: several PDFs are cleaned into one ZIP`, () => assert.strictEqual(z.suggestedFilename(), 'a-bersih.zip'));

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
