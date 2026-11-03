# DokuJaga (repo: palang-ic)

Privacy-first document tools for Malaysians: 31 tools on the dashboard (Palang IC, PDF, image and Office tools), plus Advanced mode (workflows), a share-target page (`kongsi/`) and a privacy page (`privasi/`).
Live: https://adib2024.github.io/palang-ic/ (GitHub Pages from `main`).

## Hard rules (never break)
- **100% client-side.** Files never leave the device: no upload, no backend, no analytics, no external API calls with file data.
- **Static site only:** HTML/CSS/vanilla ES modules, **no build step**. Deployable to GitHub Pages.
- **Strict CSP meta on every page** (`connect-src 'none'`, `script-src 'self'`, `style-src 'self'`): no `fetch()`, no inline scripts/styles in markup, no CDNs. Load data (fonts, manifests) via `import()` of JS modules. Setting `el.style.x` from JS is fine.
- **Mobile-first**, no horizontal scroll at 390 px (tests check `scrollWidth - clientWidth`).
- **No JPN/government logos** or anything that looks like an official site.
- **English is the default language** (owner's decision, Nov 2026), BM one tap away (EN/BM toggle; a chosen language is remembered); light theme default; indigo + Inter design.
- Never commit a real IC/document. Test fixtures are fake (`tests/fixtures/`).

## Layout
- One folder per tool (`kecilkan-pdf/index.html` …) + a JS module in `js/`.
- Shared: `css/style.css` (tokens on `:root`, dark via `[data-theme="dark"]`, `[data-text]` text size, `[data-contrast="high"]`),
  `js/page.js` (`initPage(onLang)`: i18n, language toggle, service worker, inbox hand-off, recent tools, guide),
  `js/guide.js` (steps bar, quick picks `PRESETS`, phone save bar — per-tool config at the top),
  `js/theme.js` (light/dark/auto theme + "Aa" display panel, injected into every header),
  `js/i18n.js` (`STRINGS.en`, the default; Bahasa Melayu lives in `js/i18n-ms.js`, loaded on demand by `loadLang()` — **keep keys equal**, `tests/i18n-test.mjs` checks),
  `js/pdf-kit.js` (vendored pdf.js + pdf-lib loaders, `download()` / `shareOrDownload()` fire `dokujaga:saved`),
  `js/tool-catalog.js` (which tools accept which files, for "Continue to…" and the share page),
  `js/batch.js`, `js/handoff.js`, `js/continue.js`, `js/pdf-stamps.js`, `js/ocr-core.js`, `js/fonts.js`.
- Per-tool scripts worth knowing: `js/imgsmall.js` (live compress, presets, crop/compare dialogs), `js/passport.js`, `js/imgconvert.js`,
  `js/office2pdf.js` + `office-read.js` + `office-layout.js` + `unzip.js` (Word/Excel → PDF), `js/pdf2office.js` (PDF → Office),
  `js/pdf-meta.js` (remove metadata), `js/imgnote.js` (notes/arrows/highlights on a photo), `js/collage.js` (photos per A4 page), `js/pdf-flatten.js`, `js/undo.js` (undo/redo for Sign/Redact/workflows), `js/heic-worker.js` (libheif).
- `vendor/` is filled by `.github/workflows/vendor.yml` (pdf-lib, pdf.js, tesseract, fontkit, libheif, fonts) — don't hand-edit; run it from the Actions tab (workflow_dispatch). No npm access in the cloud sandbox.
- `sw.js`: network-first app cache `dokujaga-vNN` (bump on every release) + `ASSETS` list (**add every new js file / page**).

## Adding a tool
1. Strings: add `toolXTitle`, `toolXDesc`, `xLead`, … to **both** `js/i18n.js` (en) and `js/i18n-ms.js` (ms).
2. Page: `python3 -I tools/gen/new_tool.py spec.json` (see docstring), then edit by hand. Pages are the source of truth.
3. Script: `js/x.js` using `initPage`, `bindFileDrop`, `download`/`shareOrDownload`; expose `window.__x` for tests.
4. Register: `python3 -I tools/gen/register.py '[["x/","cat","tone","icon","toolXTitle","toolXDesc","after/"]]' '["x.js"]'`
   (dashboard, share page, sw.js, deploy copy list). Then add it to `js/tool-catalog.js`, and quick picks/step name in `js/guide.js` if useful.
5. Tests: add `tests/x-test.cjs` (pattern: `tests/phase2d-test.cjs`) to `tests/run-all.sh`; update the dashboard list in `tests/tools-test.cjs`.
6. README rows (BM/EN table + dev structure).

## Tests / CI
- Accessibility: `tests/a11y-test.cjs` runs axe-core (WCAG 2.1 A+AA, vendored in `tests/vendor/axe/`, not deployed) on every page — new pages are picked up automatically; add a tool to its `LOADED` list if most controls appear only after a file is chosen.
- Local: `NODE_PATH="$(npm root -g)" tests/run-all.sh` (Playwright + Chromium; python3 with pypdf, cryptography, python-docx, openpyxl, python-pptx).
- CI (`.github/workflows/deploy.yml`): test job on every push/PR, deploy only from `main` after tests pass. Test job is pinned to `ubuntu-24.04` (Playwright 1.56).
- Release flow used so far: develop on `claude/palangic-watermark-app-zs1bhd`, wait for green CI, then fast-forward `main`.

## Ideas not done yet (user's backlog)
- QR code tool; PDF bookmarks / table of contents. Own domain (on hold).

## Conventions
- Speed on old phones: import code that only runs after a file is chosen or a step runs with `import()` (see `js/workflow-ops.js`, `js/office2pdf.js`); no ES2021+ syntax such as `||=`.
- Comments explain *why*; match the surrounding style. No model names in commits or files.
- User talks in Bahasa Melayu; answer in BM. Before complex work, ask 3–4 short clarifying questions (AskUserQuestion), then build, test, push each item.
