# PalangIC

**Palang & watermark gambar IC (MyKad) anda sebelum hantar — terus dalam telefon.**
**Mark your IC photo before sending it to a bank, telco, agent or shop — entirely on your phone.**

> Gambar anda diproses dalam telefon anda sahaja. Tiada apa-apa dimuat naik.
> Your photo is processed on your device only. Nothing is uploaded.

[Bahasa Melayu](#bahasa-melayu) · [English](#english)

---

## Bahasa Melayu

### Apa ini?

Bila bank, telco, ejen hartanah atau kedai minta salinan IC, amalan selamat ialah
"palang" gambar itu dengan ayat seperti **UNTUK KEGUNAAN CIMB SAHAJA**. Kalau gambar
itu bocor, ia sukar disalah guna untuk tujuan lain. PalangIC buat kerja ini dengan
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

### What is it?

When a bank, telco, property agent or shop asks for a copy of your IC, the safe habit
is to mark the photo with something like **FOR CIMB USE ONLY**. If the copy leaks, it is
much harder to reuse for anything else. PalangIC does this quickly and neatly.

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

Plain HTML/CSS/JS (ES modules). There is no build step and no dependencies.

```
index.html              UI + CSP
css/style.css           mobile-first styles, light/dark
js/app.js               state, controls, preview, export, share
js/watermark.js         pure renderer: palang / tiled / combined
js/image-loader.js      decode + EXIF orientation fix + size cap
js/pdf.js               tiny A4 PDF writer (JPEG embed)
js/i18n.js              BM/EN strings + templates
js/storage.js           try/catch-wrapped localStorage
sw.js, manifest.webmanifest, icons/   PWA
tests/                  fake sample cards + Playwright test
```

Run locally (a service worker needs `localhost` or HTTPS):

```sh
npx serve .            # or: python3 -m http.server
```

Test with the **fake** sample cards (never commit a real IC):

```sh
python3 tests/make-samples.py                         # regenerate fixtures (Pillow)
NODE_PATH="$(npm root -g)" node tests/render-test.cjs  # needs Playwright + Chromium
```

The test checks the EXIF orientation fix, every mode, JPG/PDF export, that the CSP blocks
outbound `fetch`, that no request leaves the origin, the BM/EN toggle, and that there's
no horizontal scroll at phone width. Screenshots and exports go to `tests/output/`.

Deployment: `.github/workflows/deploy.yml` publishes the static files to GitHub Pages
on every push to `main`. In the repo settings, enable **Pages → Source: GitHub Actions**.

Not an official government site and not affiliated with JPN.

## License

[MIT](LICENSE)
