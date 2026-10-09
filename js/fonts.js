// Font choice shared by Edit PDF, Sign PDF and workflows: the three standard
// PDF fonts (no download), a self-hosted Google Fonts set (loaded only when
// picked) and fonts the user adds from their device (never uploaded).
// Fonts are served as ES modules because the pages forbid fetch().
import { t } from './i18n.js';

const VENDOR = new URL('../vendor/', import.meta.url).href;

/** @typedef {{id:string, name:string, group:string, weights:number[], css?:string, std?:object, files?:object, bytes?:object}} Font */

/** @type {Font[]} */
const STANDARD = [
  { id: 'helvetica', name: 'Helvetica', group: 'standard', weights: [400, 700], css: 'Helvetica, Arial, "Liberation Sans", sans-serif', std: { 400: 'Helvetica', 700: 'HelveticaBold' } },
  { id: 'times', name: 'Times', group: 'standard', weights: [400, 700], css: '"Times New Roman", Times, "Liberation Serif", serif', std: { 400: 'TimesRoman', 700: 'TimesRomanBold' } },
  { id: 'courier', name: 'Courier', group: 'standard', weights: [400, 700], css: '"Courier New", Courier, "Liberation Mono", monospace', std: { 400: 'Courier', 700: 'CourierBold' } },
];
export const GROUPS = ['standard', 'basic', 'handwriting', 'formal', 'mine'];

let catalog = null;
const user = [];
const loaded = new Map(); // `${id}-${weight}` → Promise<Uint8Array|null>

/** All fonts: standard, bundled (if the font set is present) and the user's. */
export async function fontList() {
  if (!catalog) {
    let bundled = [];
    try {
      bundled = (await import(`${VENDOR}fonts/fonts.js`)).default.map((f) => ({
        ...f, weights: Object.keys(f.files).map(Number),
      }));
    } catch {
      bundled = []; // font set not vendored yet: standard fonts only
    }
    catalog = [...STANDARD, ...bundled];
  }
  return [...catalog, ...user];
}

export async function findFont(id) {
  return (await fontList()).find((f) => f.id === id) || STANDARD[0];
}

/** Nearest available weight. */
const weightOf = (font, bold) => (bold && font.weights.includes(700) ? 700 : font.weights[0]);
const family = (font, w) => `dj-${font.id}-${w}`;

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Raw font file (TTF/OTF) for a bundled or user font; null for standard fonts. */
async function bytesOf(font, w) {
  if (font.std) return null;
  if (font.bytes) return font.bytes[w];
  const key = `${font.id}-${w}`;
  if (!loaded.has(key)) {
    loaded.set(key, import(`${VENDOR}fonts/${font.files[w].replace(/\.ttf$/, '.js')}`).then((m) => b64(m.default)));
  }
  return loaded.get(key);
}

/**
 * Make a font usable in CSS/canvas. Resolves to a CSS font-family list.
 * @param {string} id
 * @param {boolean} [bold]
 */
export async function cssFamily(id, bold = false) {
  const font = await findFont(id);
  if (font.std) return font.css;
  const w = weightOf(font, bold);
  const name = family(font, w);
  if (![...document.fonts].some((f) => f.family === name)) {
    const face = new FontFace(name, await bytesOf(font, w));
    await face.load();
    document.fonts.add(face);
  }
  return `"${name}", ${font.group === 'handwriting' ? 'cursive' : 'sans-serif'}`;
}

/**
 * Embed a font into a pdf-lib document (cached per document).
 * @returns {Promise<{font: any, standard: boolean}>}
 */
export async function pdfFont(PDFLib, doc, id, bold = false) {
  const font = await findFont(id);
  const w = weightOf(font, bold);
  doc.__djFonts = doc.__djFonts || new Map();
  const key = `${font.id}-${w}`;
  if (!doc.__djFonts.has(key)) {
    doc.__djFonts.set(key, (async () => {
      if (font.std) return { font: await doc.embedFont(PDFLib.StandardFonts[font.std[w]]), standard: true };
      doc.registerFontkit(await loadFontkit());
      return { font: await doc.embedFont(await bytesOf(font, w), { subset: true }), standard: false };
    })());
  }
  return doc.__djFonts.get(key);
}

let fontkitPromise = null;
function loadFontkit() {
  if (!fontkitPromise) {
    fontkitPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${VENDOR}fontkit/fontkit.umd.min.js`;
      s.onload = () => resolve(window.fontkit);
      s.onerror = () => { fontkitPromise = null; reject(new Error('fontkit')); };
      document.head.appendChild(s);
    });
  }
  return fontkitPromise;
}

/** Text that a standard PDF font can encode (Latin-1); other fonts keep everything. */
export function encodable(text, standard) {
  return standard ? text.replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?') : text;
}

/**
 * Add a font file from the user's device (TTF/OTF). Stays in this tab.
 * @returns {Promise<Font>}
 */
export async function addUserFont(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = `user-${user.length + 1}`;
  const font = { id, name: file.name.replace(/\.(ttf|otf)$/i, ''), group: 'mine', weights: [400], bytes: { 400: bytes } };
  // Check the browser can read it before offering it.
  const face = new FontFace(family(font, 400), bytes);
  await face.load();
  document.fonts.add(face);
  user.push(font);
  return font;
}

/**
 * Fill a <select> with the font list, grouped, plus "Add a font from your
 * device…". Calls `onChange(id)` when a font is picked or added.
 * @param {HTMLSelectElement} select
 * @param {{lang: () => string, value?: string, groups?: string[], onChange: (id: string) => void}} opts
 */
export async function bindFontSelect(select, opts) {
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.ttf,.otf,font/ttf,font/otf';
  picker.hidden = true;
  select.after(picker);
  let value = opts.value || 'helvetica';
  const fill = async () => {
    const tr = (k) => t(opts.lang(), k);
    const list = await fontList();
    select.textContent = '';
    for (const g of opts.groups || GROUPS) {
      const fonts = list.filter((f) => f.group === g);
      if (!fonts.length) continue;
      const og = document.createElement('optgroup');
      og.label = tr(`fontGroup_${g}`);
      for (const f of fonts) og.appendChild(new Option(f.name, f.id, false, f.id === value));
      select.appendChild(og);
    }
    select.appendChild(new Option(tr('fontAdd'), '__add'));
    select.value = value;
  };
  select.addEventListener('change', () => {
    if (select.value === '__add') { select.value = value; picker.click(); return; }
    value = select.value;
    opts.onChange(value);
  });
  picker.addEventListener('change', async () => {
    const f = picker.files[0];
    picker.value = '';
    if (!f) return;
    try {
      const font = await addUserFont(f);
      value = font.id;
      await fillAll();
      opts.onChange(value);
    } catch {
      if (opts.onError) opts.onError();
    }
  });
  selects.push(fill);
  await fill();
  return { refresh: fill, get value() { return value; }, set value(v) { value = v; select.value = v; } };
}

// Every font <select> on the page, so a font added in one shows in all.
const selects = [];
const fillAll = () => Promise.all(selects.map((f) => f()));
export const refreshFontSelects = fillAll;
