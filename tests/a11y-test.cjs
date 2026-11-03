// Automated accessibility checks with axe-core (WCAG 2.1 A + AA) on every
// page: light and dark theme on a computer, light on a phone, with the "Aa"
// panel open, and with a file loaded in the main tools (most controls only
// appear then). axe-core is vendored for the tests only (tests/vendor/axe/,
// filled by .github/workflows/vendor.yml) and loaded from this site, so the
// pages' strict CSP stays as it is.
// Run: NODE_PATH="$(npm root -g)" node tests/a11y-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
require('./bm.cjs'); // suites check BM wording; the site's default is English
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));
const ROOT = path.resolve(__dirname, '..');
const AXE = path.join(__dirname, 'vendor/axe/axe.min.js');
const FRONT = path.join(__dirname, 'fixtures/sample-front-exif6.jpg');
const BACK = path.join(__dirname, 'fixtures/sample-back.jpg');
const PAGES = ['', ...fs.readdirSync(ROOT).filter((d) => fs.existsSync(path.join(ROOT, d, 'index.html')) && d !== 'tests').sort()];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function makePdf() {
  const L = await import('/vendor/pdf-lib/pdf-lib.esm.min.js');
  const d = await L.PDFDocument.create();
  const f = await d.embedFont(L.StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) d.addPage([595, 842]).drawText(`Halaman ${i + 1}`, { x: 60, y: 760, size: 24, font: f });
  const b = await d.save();
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

/** Pages checked again with a file loaded: [page, input, files]. */
const LOADED = [
  ['palang/', '[data-input="front"]', [FRONT]],
  ['gambar-pdf/', '#pickFiles', [FRONT, BACK]],
  ['kecil-gambar/', '#pickFiles', [BACK]],
  ['tukar-gambar/', '#pickFiles', [BACK]],
  ['gambar-pasport/', '#pickFiles', [FRONT]],
  ['nota-gambar/', '#pickFiles', [BACK]],
  ['kolaj-gambar/', '#pickFiles', [FRONT, BACK]],
  ['imbas/', '#pickFiles', [BACK]],
  ['kecilkan-pdf/', '#pickFiles', 'pdf'],
  ['gabung-pdf/', '#pickFiles', 'pdf2'],
  ['pisah-pdf/', '#pickFiles', 'pdf'],
  ['tandatangan-pdf/', '#pickFiles', 'pdf'],
  ['hitamkan-pdf/', '#pickFiles', 'pdf'],
  ['watermark-pdf/', '#pickFiles', 'pdf'],
  ['nombor-pdf/', '#pickFiles', 'pdf'],
  ['susun-pdf/', '#pickFiles', 'pdf'],
  ['edit-pdf/', '#pickFiles', 'pdf'],
  ['lindungi-pdf/', '#pickFiles', 'pdf'],
  ['pdf-word/', '#pickFiles', 'pdf'],
];

(async () => {
  if (!fs.existsSync(AXE)) {
    console.error('tests/vendor/axe/axe.min.js is missing: run the "Vendor PDF libraries" workflow (vendor.yml).');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const results = [];
  const problems = [];
  const check = (name, fn) => { fn(); results.push(`ok   ${name}`); };

  /** Run axe on the page as it is now; collect every violation. */
  const audit = async (page, where) => {
    if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ url: '/tests/vendor/axe/axe.min.js' });
    const res = await page.evaluate((tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), TAGS);
    for (const v of res.violations) {
      problems.push(`${where}: [${v.impact}] ${v.id} — ${v.help}\n      ${v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')}${n.failureSummary ? `  (${n.failureSummary.split('\n').slice(1, 2).join('').trim()})` : ''}`).join('\n      ')}`);
    }
    return res.violations.length;
  };

  try {
    let pdfB64 = null;
    for (const [label, opts] of [
      ['desktop light', { viewport: { width: 1366, height: 900 }, colorScheme: 'light' }],
      ['desktop dark', { viewport: { width: 1366, height: 900 }, theme: 'dark' }],
      ['desktop high contrast', { viewport: { width: 1366, height: 900 }, contrast: true }],
      ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
    ]) {
      const context = await browser.newContext({ viewport: opts.viewport, isMobile: !!opts.isMobile, hasTouch: !!opts.hasTouch, reducedMotion: 'reduce' });
      await context.addInitScript(({ theme, contrast }) => {
        // First-visit tips cover the page; they're checked on their own below.
        localStorage.setItem('palangic:tipsSeen', 'true');
        if (theme) localStorage.setItem('palangic:theme', JSON.stringify(theme));
        if (contrast) localStorage.setItem('palangic:contrast', JSON.stringify('high'));
      }, { theme: opts.theme || null, contrast: !!opts.contrast });
      const page = await context.newPage();
      let count = 0;
      for (const p of PAGES) {
        await page.goto(`${origin}/${p ? `${p}/` : ''}`);
        await page.waitForLoadState('load');
        await page.waitForTimeout(150); // steps bar and quick picks are added just after load
        count += await audit(page, `${label} /${p}`);
      }
      // The "Aa" panel open.
      await page.goto(`${origin}/`);
      await page.click('#a11yBtn');
      count += await audit(page, `${label} / ("Aa" panel open)`);
      if (label !== 'desktop high contrast') {
        for (const [p, input, files] of LOADED) {
          await page.goto(`${origin}/${p}`);
          if (!pdfB64) pdfB64 = await page.evaluate(makePdf);
          const pdf = (name) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(pdfB64, 'base64') });
          const list = files === 'pdf' ? [pdf('surat.pdf')] : files === 'pdf2' ? [pdf('a.pdf'), pdf('b.pdf')] : files;
          await page.setInputFiles(input, list);
          await page.waitForFunction(() => { const l = document.querySelector('#toolLayout'); return !l || !l.classList.contains('is-empty'); }, null, { timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(600);
          count += await audit(page, `${label} /${p} (file loaded)`);
        }
      }
      results.push(`${count ? 'FAIL' : 'ok  '} ${label}: ${count} accessibility violations`);
      await context.close();
    }
    console.log(results.join('\n'));
    check('no WCAG 2.1 A/AA violations', () => assert.strictEqual(problems.length, 0, `\n${problems.join('\n')}`));
    console.log(`\nAll ${PAGES.length} pages passed axe-core (WCAG 2.1 A + AA).`);
  } catch (err) {
    console.error(err.message || err);
    fs.writeFileSync(path.join(OUT, 'a11y-problems.txt'), problems.join('\n'));
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
