// No sideways scrolling on any page, from the smallest phones (320 px) to a
// desktop, in English and BM, with the largest "Aa" text size, and with a
// photo loaded in the image editors.
// Run: NODE_PATH="$(npm root -g)" node tests/responsive-test.cjs [outDir]
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
require('./bm.cjs'); // suites check BM wording; the site's default is English
const serve = require('./serve.cjs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'output'));
const ROOT = path.resolve(__dirname, '..');
const PAGES = ['', ...fs.readdirSync(ROOT).filter((d) => fs.existsSync(path.join(ROOT, d, 'index.html')) && d !== 'tests').sort()];
const BACK = path.join(__dirname, 'fixtures/sample-back.jpg');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const results = [];
  const bad = [];
  /** How far the page (and which elements) stick out to the right. */
  const overflow = (page) => page.evaluate(() => {
    const d = document.documentElement;
    const ov = d.scrollWidth - d.clientWidth;
    const wide = [];
    if (ov > 0) {
      document.querySelectorAll('body *').forEach((e) => {
        const r = e.getBoundingClientRect();
        if (r.width && r.right > d.clientWidth + 1 && wide.length < 3) wide.push(e.id ? `#${e.id}` : `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`);
      });
    }
    return { ov, wide };
  });

  try {
    for (const [width, height, mobile, lang, text] of [
      [320, 640, true, null, null], [320, 640, true, 'ms', 'xl'], [360, 740, true, 'ms', null],
      [390, 844, true, null, 'lg'], [768, 1024, true, 'ms', null], [1366, 900, false, null, null],
    ]) {
      const label = `${width}px ${lang || 'en'}${text ? ` text ${text}` : ''}`;
      const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, dokujagaLang: lang });
      if (text) await context.addInitScript((t) => localStorage.setItem('palangic:textSize', JSON.stringify(t)), text);
      const page = await context.newPage();
      for (const p of PAGES) {
        await page.goto(`${origin}/${p ? `${p}/` : ''}`);
        await page.waitForTimeout(80);
        const r = await overflow(page);
        if (r.ov > 0) bad.push(`${label} /${p}: +${r.ov}px ${r.wide.join(', ')}`);
      }
      if (width <= 390) {
        for (const p of ['nota-gambar/', 'kolaj-gambar/', 'gambar-pasport/', 'kecil-gambar/']) {
          await page.goto(`${origin}/${p}`);
          await page.setInputFiles('#pickFiles', BACK);
          await page.waitForFunction(() => !document.querySelector('#toolLayout').classList.contains('is-empty'));
          await page.waitForTimeout(300);
          const r = await overflow(page);
          if (r.ov > 0) bad.push(`${label} /${p} (photo loaded): +${r.ov}px ${r.wide.join(', ')}`);
        }
        if (width === 320) await page.screenshot({ path: path.join(OUT, `responsive-${label.replace(/\W+/g, '-')}.png`), fullPage: true });
      }
      results.push(`ok   ${label}: ${PAGES.length} pages checked`);
      await context.close();
    }
    console.log(results.join('\n'));
    assert.deepStrictEqual(bad, [], `\n${bad.join('\n')}`);
    console.log('\nAll checks passed: no horizontal scroll anywhere.');
  } catch (err) {
    console.error(err.message || err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
