# DokuJaga

**Alat dokumen yang jaga privasi anda: palang IC, gambar → PDF dan lain-lain, terus dalam pelayar.**
**Document tools that keep your files private: IC watermarking, images → PDF and more, right in your browser.**

> Fail anda diproses dalam peranti anda sahaja. Tiada apa-apa dimuat naik.
> Your files are processed on your device only. Nothing is uploaded.

| Alat / Tool | Status |
| --- | --- |
| **Palang IC**: cop "UNTUK KEGUNAAN … SAHAJA" pada gambar IC / stamp your IC photo | ✅ `palang/` |
| **Gambar → PDF / Images → PDF**: gabung gambar atau imbasan jadi satu PDF / combine photos and scans into one PDF | ✅ `gambar-pdf/` |
| **Gabung PDF / Merge PDF**: susun fail ikut urutan, gabung jadi satu / order files, join into one | ✅ `gabung-pdf/` |
| **Pisah PDF / Split PDF**: ikut julat, setiap N muka surat, atau pilih muka surat / by ranges, every N pages, or picked pages | ✅ `pisah-pdf/` |
| **Susun PDF / Organise PDF**: susun semula, putar, buang muka surat / reorder, rotate, delete pages | ✅ `susun-pdf/` |
| **Putar PDF / Rotate PDF** | ✅ `putar-pdf/` |
| **Watermark PDF**: teks atau gambar, 9 kedudukan atau mozaik / text or image, 9 positions or mosaic | ✅ `watermark-pdf/` |
| **Nombor Muka Surat / Page Numbers** | ✅ `nombor-pdf/` |
| **Potong PDF / Crop PDF** | ✅ `potong-pdf/` |
| **Edit PDF**: teks, gambar, kotak, bulatan, garis, lukisan, highlight / text, images, shapes, drawing, highlight | ✅ `edit-pdf/` |
| **Hitamkan PDF / Redact PDF**: cari No. IC, telefon, e-mel, No. akaun atau teks lain; muka surat dihitamkan jadi gambar supaya teks betul-betul hilang / find IC, phone, email, account numbers or any text; redacted pages are flattened so the text is really gone | ✅ `hitamkan-pdf/` |
| **Isi Borang PDF / Fill PDF Form**: kotak teks, tanda, pilihan, senarai; boleh diratakan / text, checkbox, radio, dropdown; optional flatten | ✅ `isi-borang/` |
| **Ratakan PDF / Flatten PDF**: kunci isian borang, komen & cop ke dalam muka surat, atau jadikan setiap muka surat gambar / lock form entries, comments & stamps into the page, or turn pages into pictures | ✅ `ratakan-pdf/` |
| **Buka Kunci PDF / Unlock PDF**: buang kata laluan atau sekatan cetak/salin (anda mesti tahu kata laluan) / remove a password or print/copy restrictions (you must know the password) | ✅ `buka-kunci-pdf/` |
| **Lindungi PDF / Protect PDF**: kunci dengan kata laluan AES-256, sekat cetak/salin / lock with an AES-256 password, block printing/copying | ✅ `lindungi-pdf/` |
| **Buang Metadata PDF / Remove PDF Metadata**: lihat & buang pengarang, perisian, tarikh, XMP, ID, lampiran, JavaScript, nama pada komen / see & remove author, software, dates, XMP, ID, attachments, JavaScript, comment authors | ✅ `buang-metadata/` |
| **Banding PDF / Compare PDF**: perkataan ditambah/dibuang + kawasan berubah setiap muka surat / added/removed words + changed areas per page | ✅ `banding-pdf/` |
| **OCR PDF**: imbasan/gambar → PDF boleh dicari & disalin + teks (.txt); BM & English, enjin dihos sendiri / scans/photos → searchable, copyable PDF + text; Malay & English, self-hosted engine | ✅ `ocr-pdf/` |
| **Kecilkan PDF / Compress PDF**: tahap atau had saiz (cth. ≤ 2 MB) / level or size limit (e.g. ≤ 2 MB) | ✅ `kecilkan-pdf/` |
| **Imbas Dokumen / Scan Document**: kamera → luruskan tepi (auto) → penapis → PDF / camera → auto edge straightening → filters → PDF | ✅ `imbas/` |
| **Gambar Pasport / Passport Photo**: 35×50 mm (Malaysia), 35×45 mm atau saiz sendiri; zum, alih, cerahkan latar; helaian cetak 4R (JPG) / A4 (PDF) / custom size; zoom, move, whiten background; 4R (JPG) / A4 (PDF) print sheets | ✅ `gambar-pasport/` |
| **Tandatangan PDF / Sign PDF**: lukis, taip atau gambar tandatangan; letak, alih, ubah saiz; teks & tarikh / draw, type or upload; place, move, resize; text & date | ✅ `tandatangan-pdf/` |
| **PDF → Gambar / PDF → Images**: JPG/PNG, pilih resolusi & muka surat / pick resolution & pages | ✅ `pdf-gambar/` |
| **PDF → Word / Excel / PowerPoint** (ringkas / simple): teks, perenggan, tajuk, jadual mudah; imbasan jadi gambar / text, paragraphs, headings, simple tables; scans become pictures | ✅ `pdf-word/` `pdf-excel/` `pdf-powerpoint/` |
| **Word/Excel → PDF** (ringkas / simple): .docx (teks, tajuk, senarai, jadual, gambar) dan .xlsx (setiap helaian sebagai jadual) / .docx (text, headings, lists, tables, pictures) and .xlsx (each sheet as a grid) | ✅ `word-pdf/` |
| **Kecilkan Gambar / Compress Images**: preset (borang ≤ 200 KB, WhatsApp, e-mel, pasport, laman web), had saiz/dimensi/kualiti sendiri, JPG/PNG/WebP, putar & potong, banding sebelum/selepas, tampal, buang EXIF / presets, custom size/dimension/quality, JPG/PNG/WebP, rotate & crop, before/after compare, paste, strips EXIF | ✅ `kecil-gambar/` |
| **Tukar Gambar / Convert Images**: JPG / PNG / WebP pada saiz penuh, termasuk HEIC iPhone, banyak sekali gus (ZIP) / at full size, incl. iPhone HEIC, many at once (ZIP) | ✅ `tukar-gambar/` |

[Bahasa Melayu](#bahasa-melayu) · [English](#english)

---

## Bahasa Melayu

### Mod Lanjutan: Aliran Kerja (`aliran-kerja/`)

Butang **Mod Lanjutan** di header membuka aliran kerja: jalankan beberapa langkah sekali gus pada PDF dan gambar.

- **Templat**: *Pakej Permohonan Pinjaman* (palang gambar IC → gabung → nombor muka surat → kecilkan ≤ 2 MB), *Gabung, teks, tandatangan & tarikh*, *Tandatangan & kunci*, *Salinan sulit*.
- **Bina sendiri**: pilih langkah — Palang IC (gambar), tarikh/tandatangan/teks, watermark, nombor muka surat, putar, kecilkan, kunci dengan kata laluan — dan susun ikut urutan.
- Langkah tarikh/tandatangan/teks berhenti seketika supaya anda boleh letak item (pada satu atau semua muka surat), kemudian teruskan.
- Aliran sendiri boleh disimpan dalam pelayar (kata laluan tidak disimpan).

### Paparan & carian

- Butang **Aa** di header: saiz teks (A / A+ / A++), kontras tinggi dan tema gelap — diingati dalam pelayar ini.
- Dashboard: **cari alat** (BM atau English, tekan `/`), dan baris **Baru digunakan**.
- Setiap alat: panduan **1-2-3** (pilih fail → tetapan → simpan), **pilihan pantas** (Kecilkan PDF, Watermark, Nombor muka surat, PDF → Gambar, Gambar → PDF), tetapan di kiri pada desktop, dan bar **Simpan** terapung di telefon.

### Banyak fail, kongsi & teruskan

- **Banyak fail sekali gus**: Kecilkan PDF, Watermark, Nombor muka surat, Lindungi, Buka kunci dan OCR boleh terima beberapa PDF; tetapan sama digunakan pada semua dan hasilnya disimpan sebagai satu ZIP.
- **Kongsi ke DokuJaga**: selepas dipasang (PWA, Android), kongsi PDF/gambar dari app lain → halaman *Pilih alat*.
- **Teruskan ke…**: selepas simpan, hantar hasil terus ke alat lain (cth. Gabung → Tandatangan → Kunci) tanpa pilih fail semula.
- **OCR dalam aliran kerja** dan enjin OCR disimpan untuk guna luar talian selepas kali pertama.

### PDF → Word / Excel / PowerPoint (ringkas & jujur)

Teks, perenggan, tajuk dan jadual mudah dibina semula daripada teks dalam PDF. Susun atur yang rumit (lajur, kotak teks, fon asal) **tidak** disalin tepat. Muka surat imbasan jadi gambar (Word/PowerPoint) — guna **OCR PDF** dahulu jika mahu teksnya. PowerPoint: pilih *Sama seperti PDF* (gambar, tepat) atau *Teks boleh edit*.

### Pilihan font

Edit PDF, Tandatangan PDF dan Mod Lanjutan (tandatangan ditaip, teks, tarikh) boleh guna: font standard PDF (Helvetica, Times, Courier), 11 font yang dihos sendiri (asas, tulisan tangan, rasmi) atau font .ttf/.otf anda sendiri — fail font kekal dalam peranti anda.

### Gambar → PDF

Tambah satu atau lebih gambar (seret ke halaman di komputer, atau pilih/ambil gambar di telefon).
Susun semula dengan seret atau butang ◀ ▶, putar dan buang muka surat, kemudian pilih saiz kertas
(A4 / Letter / ikut gambar), orientasi, margin dan kualiti. Klik **Simpan PDF** atau **Kongsi PDF**.

### Palang IC: apa ini?

Bila bank, telco, ejen hartanah atau kedai minta salinan IC, amalan selamat ialah
"palang" gambar itu dengan ayat seperti **UNTUK KEGUNAAN CIMB SAHAJA**. Kalau gambar
itu bocor, ia sukar disalah guna untuk tujuan lain. Palang IC buat kerja ini dengan
cepat dan kemas.

### Cara guna

1. **Pilih gambar.** Ambil gambar atau pilih dari galeri. Depan wajib, belakang pilihan.
2. **Tulis tujuan.** Contohnya `CIMB`, `Maxis` atau `ejen hartanah`. Pilih templat
   (`UNTUK KEGUNAAN … SAHAJA` atau `FOR … USE ONLY`) dan tambah tarikh jika mahu.
3. **Simpan / Kongsi.** Kongsi terus ke WhatsApp/e-mel (Web Share API), simpan sebagai
   JPG, atau simpan sebagai PDF A4 (depan + belakang pada satu muka).

### Jenis tanda

| Mod | Penerangan |
| --- | --- |
| **Palang** (lalai) | **Cop sudut** (lalai): dua garis pendek dengan ayat di tengah, dicop pada penjuru kad. Pilih penjuru, laraskan saiz, atau sentuh/seret pada pratonton untuk alih. Juga ada gaya **merentas** penuh dan **silang (X)**. Boleh ubah tebal garis, gaya (penuh/berganda), warna dan kelegapan. |
| **Watermark berulang** | Ayat diulang menyerong ke seluruh gambar (sedikit / sederhana / banyak). Ia meliputi gambar muka, nama dan nombor IC, jadi tidak boleh dipotong keluar. |
| **Gabung** | Palang dan watermark berulang serentak, untuk perlindungan maksimum. |

Tetapan lalai setiap mod dipilih supaya nombor IC dan muka masih boleh dibaca.
Mod terakhir yang anda guna diingat dalam pelayar ini.

> ⚠️ Sesetengah bank/agensi mungkin menolak IC yang terlalu banyak tanda.
> Pastikan nombor IC dan muka masih boleh dibaca.

### Privasi

- Semua pemprosesan dibuat dengan `<canvas>` dalam pelayar anda. Tiada pelayan dan tiada backend.
- Tiada analitik, tiada iklan, tiada kuki, tiada skrip pihak ketiga.
- Laman ini ada **Content-Security-Policy** yang ketat (`connect-src 'none'`). Pelayar
  sendiri menyekat sebarang `fetch`/XHR/WebSocket/beacon, walaupun kodnya cuba menghantar data.
- Service worker hanya menyimpan fail aplikasi (HTML/CSS/JS/ikon) untuk kegunaan luar talian.
  Gambar anda tidak pernah disimpan.
- Hanya pilihan seperti bahasa dan mod disimpan dalam `localStorage`. Nama penerima dan gambar tidak disimpan.

### Cara semak sendiri bahawa tiada apa-apa dimuat naik

1. Buka laman ini di komputer, tekan **F12** dan buka tab **Network**.
2. Muat semula laman, kemudian pilih gambar, tukar tetapan dan simpan.
3. Anda hanya akan nampak fail laman ini sendiri (`index.html`, `app.js`, …) dimuat
   ketika mula dibuka. Tiada permintaan baharu muncul semasa memproses gambar.
4. Atau buka aplikasi sekali, hidupkan **mod kapal terbang**, dan guna seperti biasa.
   Ia tetap berfungsi.
5. Kod sumber kecil dan boleh dibaca: lihat `js/`.

### Pasang di skrin utama

Buka laman dalam Chrome/Safari, kemudian pilih **Tambah ke Skrin Utama**. Aplikasi akan berfungsi tanpa internet.

---

## English

### Advanced mode: Workflows (`aliran-kerja/`)

The **Advanced mode** button in the header opens workflows: run several steps in one go on PDFs and photos.

- **Templates**: *Loan application pack* (stamp IC photos → merge → page numbers → compress ≤ 2 MB), *Merge, text, sign & date*, *Sign & lock*, *Confidential copy*.
- **Build your own**: pick steps — IC stamp (photos), date/signature/text, watermark, page numbers, rotate, compress, password — and order them.
- The date/signature/text step pauses so you can place items (on one or every page), then continues.
- Your own workflows can be saved in the browser (passwords are never saved).

### Display & search

- The **Aa** button in the header: text size (A / A+ / A++), high contrast and dark theme — remembered in this browser.
- Dashboard: **search tools** (Malay or English, press `/`), and a **Recently used** row.
- Every tool: a **1-2-3 guide** (choose file → settings → save), **quick picks** (Compress PDF, Watermark, Page numbers, PDF → Images, Images → PDF), settings on the left on desktop, and a floating **Save** bar on phones.

### Many files, sharing & continue

- **Batch**: Compress PDF, Watermark, Page numbers, Protect, Unlock and OCR accept several PDFs; the same settings apply to each and the results are saved as one ZIP.
- **Share to DokuJaga**: once installed (PWA, Android), share PDFs/photos from other apps → the *Pick a tool* page.
- **Continue to…**: after saving, send the result straight to another tool (e.g. Merge → Sign → Protect) without picking the file again.
- **OCR as a workflow step**, and the OCR engine is cached for offline use after the first run.

### PDF → Word / Excel / PowerPoint (simple & honest)

Text, paragraphs, headings and simple tables are rebuilt from the PDF's own text. Complex layouts (columns, text boxes, original fonts) are **not** copied exactly. Scanned pages become pictures (Word/PowerPoint) — run **OCR PDF** first if you need their text. PowerPoint: choose *Same as PDF* (pictures, exact) or *Editable text*.

### Font choice

Edit PDF, Sign PDF and Advanced mode (typed signatures, text, dates) can use the standard PDF fonts (Helvetica, Times, Courier), 11 self-hosted fonts (basic, handwriting, formal) or your own .ttf/.otf — font files stay on your device.

### Images → PDF

Add one or more images (drag them onto the page on desktop, or choose/take photos on a phone).
Reorder by dragging or with the ◀ ▶ buttons, rotate or remove pages, then pick paper size
(A4 / Letter / fit image), orientation, margin and quality. Click **Save PDF** or **Share PDF**.

### Palang IC: what is it?

When a bank, telco, property agent or shop asks for a copy of your IC, the safe habit
is to mark the photo with something like **FOR CIMB USE ONLY**. If the copy leaks, it is
much harder to reuse for anything else. Palang IC does this quickly and neatly.

### How to use

1. **Choose photo.** Take a photo or pick one from your gallery. Front is required, back is optional.
2. **Write purpose.** For example `CIMB`, `Maxis` or `property agent`. Pick the wording
   (`UNTUK KEGUNAAN … SAHAJA` or `FOR … USE ONLY`) and optionally add today's date (DD/MM/YYYY).
3. **Save / Share.** Share straight to WhatsApp/e-mail (Web Share API, with a download
   fallback), save as JPG, or save as an A4 PDF with front and back on one page.

### Mark styles

| Mode | Description |
| --- | --- |
| **Palang** (default) | **Corner stamp** (default): a short double bar with the text between the lines, stamped across a corner of the card. Pick the corner, set the size, or tap/drag on the preview to move it. **Full-width** bars and an **X cross** are also available. Adjust line thickness, style (solid/double), colour and opacity. |
| **Repeating watermark** | The text tiles diagonally over the whole image (light / medium / heavy). It covers the face, name and IC number, so it can't be cropped out. |
| **Combined** | Palang plus repeating watermark, for maximum protection. |

Each mode's defaults keep the IC number and face readable. Your last mode is remembered in this browser.

> ⚠️ Some banks/agencies may reject a heavily marked IC. Keep the IC number and face readable.

### Privacy model

- All processing happens in your browser with `<canvas>`. There is no server and no backend.
- No analytics, ads, cookies or third-party scripts.
- A strict **Content-Security-Policy** (`connect-src 'none'`) means the browser itself
  blocks any `fetch`/XHR/WebSocket/beacon, even if code tried to send data.
- The service worker only caches the app's own files for offline use. Photos are never stored.
- Only preferences such as language and mode go into `localStorage`. The recipient and photos are not stored.

### Verify it yourself

1. Open the site on a computer, press **F12** and open the **Network** tab.
2. Reload, then choose a photo, change settings and save.
3. You'll only see the site's own files load at startup. No new requests appear while
   the photo is processed or exported.
4. Or open the app once, turn on **airplane mode**, and use it normally. It still works.
5. The code is small and readable: see `js/`.

### Add to home screen

Open the site in Chrome/Safari and choose **Add to Home Screen**. It works offline.

---

## Development

Plain HTML/CSS/JS (ES modules), no build step. The PDF tools use pdf-lib and pdf.js,
vendored into `vendor/` by `.github/workflows/vendor.yml` (pinned versions, npm
integrity hashes recorded) so the site never loads code from a CDN.
The Inter web font (SIL OFL 1.1) is self-hosted: the deploy workflow subsets it to
WOFF2 under `fonts/`. Locally, pages fall back to the system UI font.

```
index.html              DokuJaga dashboard (tool grid)
palang/index.html       Palang IC tool
gambar-pdf/index.html   Images -> PDF tool
css/style.css           shared mobile-first styles, light/dark
js/home.js, js/page.js  dashboard + shared page boot (language, offline)
js/palang.js            Palang IC: state, controls, preview, export, share
js/img2pdf.js           Images -> PDF: page grid, reorder, export
js/pdf-pages.js         shared: open PDFs, thumbnails, page cards, reorder, coordinate mapping, live preview
js/merge.js, split.js, organize.js, rotate.js   page/file tools
js/watermark-pdf.js, pagenum.js, crop.js        page editing tools
js/page-viewer.js       stacked page view for overlay tools
js/edit.js, redact.js, forms.js                 Edit PDF, Redact PDF, Fill PDF Form
js/pdf-crypto.js, pdf-security.js               PDF encryption (RC4/AES, R2–R6), unlock/protect
js/workflow.js, workflow-ops.js                 Advanced mode: workflow builder/runner and its steps
js/compare.js, diff.js                          Compare PDF (Myers word diff + pixel diff)
js/ocr.js                                       OCR PDF (tesseract.js, invisible text layer)
js/fonts.js                                     font choice: standard PDF fonts, bundled set, user fonts
js/pdf2office.js, pdf-layout.js, office.js      PDF -> Word/Excel/PowerPoint: text layout, minimal OOXML writers
js/batch.js, handoff.js, continue.js, share.js  batch ZIP, file handoff between tools, "Continue to…", share target page (kongsi/)
js/metadata.js, pdf-meta.js                     Remove PDF Metadata (read + clean, drops unreferenced objects)
js/passport.js                                  Passport Photo (frame, adjust, print sheets)
js/flatten.js, pdf-flatten.js                   Flatten PDF (form fields, annotation appearances, picture mode)
js/undo.js                                      undo/redo steps + buttons for the page editors
js/office2pdf.js, office-read.js, office-layout.js, unzip.js   Word/Excel → PDF (read OOXML, lay out with pdf-lib)
js/guide.js                                     steps bar, quick picks and phone save bar for every tool page
js/ocr-core.js, pdf-stamps.js                   shared OCR engine + text layer; shared watermark/page-number stamps
vendor/fonts/                                   Google Fonts (OFL/Apache), static + Latin subset (tools/build-fonts.py); licences in vendor/fonts/licenses/
vendor/fontkit/                                 @pdf-lib/fontkit 1.1.1 (embeds custom fonts)
vendor/tesseract/                               tesseract.js 5.1.1 + core + eng/msa models (vendor workflow)
vendor/libheif/                                 libheif-js (LGPL-3.0, unmodified) for HEIC photos, loaded only when needed (js/heic-worker.js)
js/sig-maker.js, placer.js                      signature maker + item placement (workflow date/sign/text step)
js/unlock.js, protect.js                        Unlock PDF, Protect PDF
js/compress.js          Compress PDF (re-render pages as JPEG)
js/pdf-kit.js           loads vendored pdf.js + pdf-lib, render/save helpers
js/zip.js               tiny ZIP writer for split output
js/pdf2img.js           PDF -> images
js/imgsmall.js          compress / resize images (EXIF stripped)
js/sign.js              sign PDF (draw / type / upload, place, pdf-lib export)
js/scan.js, scan-core.js   document scanner: edge detection, perspective warp, filters
vendor/                 pdf-lib 1.17.1 (MIT), pdf.js 4.10.38 (Apache-2.0); see vendor/VERSIONS.txt
js/watermark.js         pure renderer: palang / tiled / combined
js/image-loader.js      decode + EXIF orientation fix + size cap
js/pdf.js               tiny multi-page PDF writer (JPEG embed)
js/i18n.js              BM/EN strings + templates
js/theme.js             light/dark toggle (runs before first paint)
js/storage.js, js/pwa.js   localStorage wrapper, service worker registration
sw.js, manifest.webmanifest, icons/   PWA
tests/                  fake sample cards + Playwright tests
```

Run locally (a service worker needs `localhost` or HTTPS):

```sh
npx serve .            # or: python3 -m http.server
```

Test with the **fake** sample cards (never commit a real IC):

```sh
python3 tests/make-samples.py                         # regenerate fixtures (Pillow)
NODE_PATH="$(npm root -g)" node tests/render-test.cjs  # Palang IC (needs Playwright + Chromium)
NODE_PATH="$(npm root -g)" node tests/tools-test.cjs   # dashboard + Images -> PDF
NODE_PATH="$(npm root -g)" node tests/pdf-tools-test.cjs # compress PDF
NODE_PATH="$(npm root -g)" node tests/more-tools-test.cjs # PDF->images, compress images, sign, scan
NODE_PATH="$(npm root -g)" node tests/phase1-test.cjs    # merge, split, organise, rotate, watermark, page numbers, crop
NODE_PATH="$(npm root -g)" node tests/phase2a-test.cjs   # edit, redact, fill form
NODE_PATH="$(npm root -g)" node tests/phase2b-test.cjs   # unlock, protect (needs python3 + pypdf)
node tests/crypto-test.mjs                                # encryption vs pypdf (needs python3 + pypdf)
NODE_PATH="$(npm root -g)" node tests/workflow-test.cjs  # advanced mode / workflows (needs python3 + pypdf)
NODE_PATH="$(npm root -g)" node tests/phase2c-test.cjs   # compare, OCR
NODE_PATH="$(npm root -g)" node tests/fonts-test.cjs     # font choice (needs python3 + pypdf)
NODE_PATH="$(npm root -g)" node tests/imgsmall-test.cjs   # compress images (presets, crop, compare), display settings, dashboard search
NODE_PATH="$(npm root -g)" node tests/guide-test.cjs     # steps bar, quick picks, settings left, phone save bar
NODE_PATH="$(npm root -g)" node tests/metadata-test.cjs  # remove PDF metadata (needs python3 + pypdf)
NODE_PATH="$(npm root -g)" node tests/office2pdf-test.cjs # Word/Excel → PDF (needs python-docx, openpyxl, pypdf)
NODE_PATH="$(npm root -g)" node tests/phase2d-test.cjs   # PDF -> Word/Excel/PowerPoint (needs python-docx, openpyxl, python-pptx)
tests/run-all.sh                                          # every suite (what CI runs)
```

The test checks the EXIF orientation fix, every mode, JPG/PDF export, that the CSP blocks
outbound `fetch`, that no request leaves the origin, the BM/EN toggle, and that there's
no horizontal scroll at phone width. Screenshots and exports go to `tests/output/`.

Deployment: `.github/workflows/deploy.yml` publishes the static files to GitHub Pages
on every push to `main`, only after every test suite passes (the same job runs on pull requests). In the repo settings, enable **Pages → Source: GitHub Actions**.

Not an official government site and not affiliated with JPN.

## License

[MIT](LICENSE)
