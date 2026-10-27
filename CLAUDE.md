# DokuJaga (repo: palang-ic)

Privacy-first document tools for Malaysians (Palang IC + 24 PDF/image tools).
Live: https://adib2024.github.io/palang-ic/ (GitHub Pages from `main`).

## Hard rules (never break)
- **100% client-side.** Files never leave the device: no upload, no backend, no analytics, no external API calls with file data.
- **Static site only:** HTML/CSS/vanilla ES modules, **no build step**. Deployable to GitHub Pages.
- **Strict CSP meta on every page** (`connect-src 'none'`, `script-src 'self'`, `style-src 'self'`): no `fetch()`, no inline scripts/styles in markup, no CDNs. Load data (fonts, manifests) via `import()` of JS modules. Setting `el.style.x` from JS is fine.
- **Mobile-first**, no horizontal scroll at 390 px (tests check `scrollWidth - clientWidth`).
- **No JPN/government logos** or anything that looks like an official site.
- **BM is the default language**, BM/EN toggle; light theme default; indigo + Inter design.
- Never commit a real IC/document. Test fixtures are fake (`tests/fixtures/`).

## Layout
- One folder per tool (`kecilkan-pdf/index.html` …) + a JS module in `js/`.
- Shared: `css/style.css` (tokens on `:root`, dark via `[data-theme="dark"]`, `[data-text]` text size, `[data-contrast="high"]`),
  `js/page.js` (`initPage(onLang)`: i18n, language toggle, service worker, inbox hand-off, recent tools, guide),
  `js/guide.js` (steps bar, quick picks `PRESETS`, phone save bar — per-tool config at the top),
  `js/theme.js` (theme + "Aa" display panel, injected into every header),
  `js/i18n.js` (`STRINGS.ms` / `STRINGS.en` — **keep key counts equal**),
  `js/pdf-kit.js` (vendored pdf.js + pdf-lib loaders, `download()` / `shareOrDownload()` fire `dokujaga:saved`),
  `js/tool-catalog.js` (which tools accept which files, for "Continue to…" and the share page),
  `js/batch.js`, `js/handoff.js`, `js/continue.js`, `js/pdf-stamps.js`, `js/ocr-core.js`, `js/fonts.js`.
- `vendor/` is filled by `.github/workflows/vendor.yml` (pdf-lib, pdf.js, tesseract, fontkit, libheif, fonts) — don't hand-edit; run it from the Actions tab (workflow_dispatch). No npm access in the cloud sandbox.
- `sw.js`: network-first app cache `dokujaga-vNN` (bump on every release) + `ASSETS` list (**add every new js file / page**).

## Adding a tool
1. Strings: add `toolXTitle`, `toolXDesc`, `xLead`, … to **both** `ms` and `en` in `js/i18n.js`.
2. Page: `python3 -I tools/gen/new_tool.py spec.json` (see docstring), then edit by hand. Pages are the source of truth.
3. Script: `js/x.js` using `initPage`, `bindFileDrop`, `download`/`shareOrDownload`; expose `window.__x` for tests.
4. Register: `python3 -I tools/gen/register.py '[["x/","cat","tone","icon","toolXTitle","toolXDesc","after/"]]' '["x.js"]'`
   (dashboard, share page, sw.js, deploy copy list). Then add it to `js/tool-catalog.js`, and quick picks/step name in `js/guide.js` if useful.
5. Tests: add `tests/x-test.cjs` (pattern: `tests/phase2d-test.cjs`) to `tests/run-all.sh`; update the dashboard list in `tests/tools-test.cjs`.
6. README rows (BM/EN table + dev structure).

## Tests / CI
- Local: `NODE_PATH="$(npm root -g)" tests/run-all.sh` (Playwright + Chromium; python3 with pypdf, cryptography, python-docx, openpyxl, python-pptx).
- CI (`.github/workflows/deploy.yml`): test job on every push/PR, deploy only from `main` after tests pass. Test job is pinned to `ubuntu-24.04` (Playwright 1.56).
- Release flow used so far: develop on `claude/palangic-watermark-app-zs1bhd`, wait for green CI, then fast-forward `main`.

## Conventions
- Comments explain *why*; match the surrounding style. No model names in commits or files.
- User talks in Bahasa Melayu; answer in BM.
