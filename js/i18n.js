// UI strings. Elements opt in with data-i18n="key" (text) or
// data-i18n-attr="attr:key" (attributes, e.g. placeholder).

export const STRINGS = {
  ms: {
    tagline: 'Palang & watermark IC anda sebelum hantar',
    privacy: 'Gambar anda diproses dalam telefon anda sahaja. Tiada apa-apa dimuat naik.',
    privacyMore: 'Cara semak',
    step1: '1. Pilih gambar',
    step2: '2. Tulis tujuan',
    step3: '3. Simpan / Kongsi',
    front: 'Depan IC',
    back: 'Belakang IC (pilihan)',
    pick: 'Pilih / ambil gambar',
    change: 'Tukar',
    remove: 'Buang',
    template: 'Templat ayat',
    recipient: 'Untuk siapa / tujuan',
    recipientPh: 'cth. CIMB, Maxis, ejen hartanah',
    addDate: 'Tambah tarikh hari ini',
    preview: 'Pratonton',
    mode: 'Jenis tanda',
    modePalang: 'Palang',
    modeTiled: 'Watermark berulang',
    modeGabung: 'Gabung',
    shape: 'Bentuk palang',
    shapeParallel: 'Dua garis selari',
    shapeX: 'Silang (X)',
    lineStyle: 'Gaya garis',
    solid: 'Penuh',
    double: 'Berganda',
    thickness: 'Tebal garis',
    density: 'Kepadatan',
    low: 'Sedikit',
    mid: 'Sederhana',
    high: 'Banyak',
    fontSize: 'Saiz tulisan',
    opacity: 'Kelegapan',
    angle: 'Sudut',
    color: 'Warna',
    black: 'Hitam',
    red: 'Merah',
    blue: 'Biru',
    advanced: 'Tetapan lanjut',
    reset: 'Set semula',
    saveJpg: 'Simpan JPG',
    savePdf: 'Simpan PDF (A4)',
    share: 'Kongsi',
    readableNote: 'Sesetengah bank/agensi mungkin menolak IC yang terlalu banyak tanda. Pastikan nombor IC dan muka masih boleh dibaca.',
    noImage: 'Pilih gambar IC dahulu.',
    noText: 'Tulis untuk siapa gambar ini dahulu.',
    loadError: 'Gambar tidak dapat dibuka. Cuba gambar lain.',
    shareFallback: 'Perkongsian tidak disokong — fail dimuat turun.',
    working: 'Sedang memproses…',
    offlineReady: 'Sedia digunakan tanpa internet.',
    howTitle: 'Bagaimana kami jaga privasi anda',
    how1: 'Semua kerja dibuat oleh pelayar dalam peranti anda (canvas HTML).',
    how2: 'Laman ini disekat daripada membuat sebarang sambungan rangkaian (Content-Security-Policy: connect-src \'none\').',
    how3: 'Tiada analitik, tiada iklan, tiada pelayan. Kod sumber terbuka di GitHub.',
    how4: 'Untuk semak: buka DevTools → Network, kemudian pilih gambar. Tiada permintaan baharu akan muncul. Atau hidupkan mod kapal terbang — aplikasi tetap berfungsi.',
    footer: 'Bukan laman rasmi kerajaan. Sumber terbuka (MIT).',
  },
  en: {
    tagline: 'Mark your IC before you send it',
    privacy: 'Your photo is processed on your phone only. Nothing is uploaded.',
    privacyMore: 'How to verify',
    step1: '1. Choose photo',
    step2: '2. Write purpose',
    step3: '3. Save / Share',
    front: 'IC front',
    back: 'IC back (optional)',
    pick: 'Choose / take photo',
    change: 'Change',
    remove: 'Remove',
    template: 'Wording',
    recipient: 'Who is it for / purpose',
    recipientPh: 'e.g. CIMB, Maxis, property agent',
    addDate: 'Add today\'s date',
    preview: 'Preview',
    mode: 'Mark style',
    modePalang: 'Palang',
    modeTiled: 'Repeating watermark',
    modeGabung: 'Combined',
    shape: 'Palang shape',
    shapeParallel: 'Two parallel lines',
    shapeX: 'Cross (X)',
    lineStyle: 'Line style',
    solid: 'Solid',
    double: 'Double',
    thickness: 'Line thickness',
    density: 'Density',
    low: 'Light',
    mid: 'Medium',
    high: 'Heavy',
    fontSize: 'Text size',
    opacity: 'Opacity',
    angle: 'Angle',
    color: 'Colour',
    black: 'Black',
    red: 'Red',
    blue: 'Blue',
    advanced: 'Advanced settings',
    reset: 'Reset',
    saveJpg: 'Save JPG',
    savePdf: 'Save PDF (A4)',
    share: 'Share',
    readableNote: 'Some banks/agencies may reject a heavily marked IC. Keep the IC number and face readable.',
    noImage: 'Choose an IC photo first.',
    noText: 'Write who this photo is for first.',
    loadError: 'Couldn\'t open that photo. Try another one.',
    shareFallback: 'Sharing isn\'t supported here — the file was downloaded.',
    working: 'Working…',
    offlineReady: 'Ready to use offline.',
    howTitle: 'How we protect your privacy',
    how1: 'All processing is done by the browser on your device (HTML canvas).',
    how2: 'The page is blocked from making any network connection (Content-Security-Policy: connect-src \'none\').',
    how3: 'No analytics, no ads, no server. Open source on GitHub.',
    how4: 'To check: open DevTools → Network, then choose a photo. No new requests appear. Or turn on airplane mode — the app still works.',
    footer: 'Not an official government site. Open source (MIT).',
  },
};

export const TEMPLATES = {
  ms: (who) => `UNTUK KEGUNAAN ${who} SAHAJA`,
  en: (who) => `FOR ${who} USE ONLY`,
};

export function t(lang, key) {
  return (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.ms[key] || key;
}

export function applyI18n(root, lang) {
  root.documentElement.lang = lang === 'en' ? 'en' : 'ms';
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(lang, el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(',').forEach((pair) => {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr.trim(), t(lang, key.trim()));
    });
  });
}

/** DD/MM/YYYY in local time. */
export function todayDMY(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()}`;
}
