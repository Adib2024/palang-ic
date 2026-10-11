// Which tools can take which files: used by the "Pilih alat" page (files
// shared to DokuJaga) and the "Teruskan ke…" bar after saving a result.
// accepts: 'pdf' | 'image' | 'both'; max: how many files the tool takes.
export const CATALOG = [
  { href: 'palang/', key: 'toolPalangTitle', accepts: 'image', max: 2 },
  { href: 'gabung-pdf/', key: 'toolMergeTitle', accepts: 'pdf', max: 99 },
  { href: 'kecilkan-pdf/', key: 'toolCompressTitle', accepts: 'pdf', max: 1 },
  { href: 'tandatangan-pdf/', key: 'toolSignTitle', accepts: 'pdf', max: 1 },
  { href: 'lindungi-pdf/', key: 'toolProtectTitle', accepts: 'pdf', max: 1 },
  { href: 'watermark-pdf/', key: 'toolWmTitle', accepts: 'pdf', max: 1 },
  { href: 'nombor-pdf/', key: 'toolPnTitle', accepts: 'pdf', max: 1 },
  { href: 'ocr-pdf/', key: 'toolOcrTitle', accepts: 'both', max: 99 },
  { href: 'gambar-pdf/', key: 'toolImgPdfTitle', accepts: 'image', max: 99 },
  { href: 'kecil-gambar/', key: 'toolImgSmallTitle', accepts: 'image', max: 99 },
  { href: 'imbas/', key: 'toolScanTitle', accepts: 'image', max: 99 },
  { href: 'pisah-pdf/', key: 'toolSplitTitle', accepts: 'pdf', max: 1 },
  { href: 'susun-pdf/', key: 'toolOrganizeTitle', accepts: 'pdf', max: 99 },
  { href: 'putar-pdf/', key: 'toolRotateTitle', accepts: 'pdf', max: 99 },
  { href: 'potong-pdf/', key: 'toolCropTitle', accepts: 'pdf', max: 1 },
  { href: 'edit-pdf/', key: 'toolEditTitle', accepts: 'pdf', max: 1 },
  { href: 'hitamkan-pdf/', key: 'toolRedactTitle', accepts: 'pdf', max: 1 },
  { href: 'isi-borang/', key: 'toolFormsTitle', accepts: 'pdf', max: 1 },
  { href: 'buka-kunci-pdf/', key: 'toolUnlockTitle', accepts: 'pdf', max: 1 },
  { href: 'pdf-gambar/', key: 'toolPdfImgTitle', accepts: 'pdf', max: 1 },
  { href: 'pdf-word/', key: 'toolWordTitle', accepts: 'pdf', max: 1 },
  { href: 'pdf-excel/', key: 'toolExcelTitle', accepts: 'pdf', max: 1 },
  { href: 'pdf-powerpoint/', key: 'toolPptTitle', accepts: 'pdf', max: 1 },
  { href: 'banding-pdf/', key: 'toolCompareTitle', accepts: 'pdf', max: 2 },
  { href: 'aliran-kerja/', key: 'wfTitle', accepts: 'both', max: 99 },
];

export const isPdfFile = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
export const isImageFile = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|gif|bmp)$/i.test(f.name);

/** Tools that can take all of `files`. */
export function toolsFor(files) {
  const pdfs = files.filter(isPdfFile).length;
  const imgs = files.filter(isImageFile).length;
  if (!files.length || pdfs + imgs < files.length) return [];
  const kind = pdfs && imgs ? 'both' : pdfs ? 'pdf' : 'image';
  return CATALOG.filter((t) => (t.accepts === 'both' || t.accepts === kind) && files.length <= t.max);
}
