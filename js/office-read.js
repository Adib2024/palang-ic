// Read .docx and .xlsx into a simple model for office2pdf.js: paragraphs with
// styled runs, lists, tables and pictures (Word); cell grids (Excel).
// "Simple and honest": text, emphasis, lists, tables and pictures come
// across; floating shapes, text boxes, headers/footers and charts don't.
import { readZip, zipText } from './unzip.js';

const parse = (xml) => new DOMParser().parseFromString(xml || '<x/>', 'application/xml');
const kids = (el, name) => (el ? [...el.children].filter((c) => !name || c.localName === name) : []);
const kid = (el, name) => kids(el, name)[0] || null;
const attr = (el, name) => (el ? el.getAttribute(`w:${name}`) ?? el.getAttribute(name) : null);
const num = (v, d = 0) => (v == null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const twip = (v) => num(v) / 20; // twentieths of a point → pt
const EMU = 12700; // per pt

/** Resolve a relationship file into id → target path (relative to word/ or xl/). */
async function rels(zip, path) {
  const doc = parse(await zipText(zip, path));
  const map = new Map();
  for (const r of doc.getElementsByTagName('Relationship')) map.set(r.getAttribute('Id'), r.getAttribute('Target'));
  return map;
}

/* =========================== Word =========================== */

function runProps(rPr, base = {}) {
  const o = { ...base };
  if (!rPr) return o;
  const on = (n) => { const e = kid(rPr, n); return e ? !['0', 'false', 'off'].includes(attr(e, 'val') || '') : null; };
  const b = on('b'); if (b !== null) o.bold = b;
  const i = on('i'); if (i !== null) o.italic = i;
  const u = kid(rPr, 'u'); if (u) o.underline = attr(u, 'val') !== 'none';
  const st = on('strike'); if (st !== null) o.strike = st;
  const sz = kid(rPr, 'sz'); if (sz) o.size = num(attr(sz, 'val'), 22) / 2;
  const c = kid(rPr, 'color'); if (c && /^[0-9a-f]{6}$/i.test(attr(c, 'val') || '')) o.color = attr(c, 'val');
  const f = kid(rPr, 'rFonts'); if (f && (attr(f, 'ascii') || attr(f, 'hAnsi'))) o.font = attr(f, 'ascii') || attr(f, 'hAnsi');
  const va = kid(rPr, 'vertAlign'); if (va) o.vert = attr(va, 'val');
  const caps = on('caps'); if (caps !== null) o.caps = caps;
  return o;
}

function paraProps(pPr, base = {}) {
  const o = { ...base };
  if (!pPr) return o;
  const jc = kid(pPr, 'jc'); if (jc) o.align = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[attr(jc, 'val')] || 'left';
  const sp = kid(pPr, 'spacing');
  if (sp) {
    if (attr(sp, 'before') != null) o.before = twip(attr(sp, 'before'));
    if (attr(sp, 'after') != null) o.after = twip(attr(sp, 'after'));
    if (attr(sp, 'line') != null && (attr(sp, 'lineRule') || 'auto') === 'auto') o.line = num(attr(sp, 'line'), 240) / 240;
  }
  const ind = kid(pPr, 'ind');
  if (ind) {
    if (attr(ind, 'left') != null || attr(ind, 'start') != null) o.indent = twip(attr(ind, 'left') ?? attr(ind, 'start'));
    if (attr(ind, 'firstLine') != null) o.first = twip(attr(ind, 'firstLine'));
    if (attr(ind, 'hanging') != null) o.first = -twip(attr(ind, 'hanging'));
  }
  if (kid(pPr, 'pageBreakBefore')) o.breakBefore = true;
  const np = kid(pPr, 'numPr');
  if (np) o.num = { id: attr(kid(np, 'numId'), 'val') ?? (o.num && o.num.id), lvl: num(attr(kid(np, 'ilvl'), 'val'), o.num ? o.num.lvl : 0) };
  return o;
}

/** styles.xml → styleId → {p: paragraph props, r: run props, heading}. */
function readStyles(xml) {
  const doc = parse(xml);
  const defaults = { r: { size: 11 }, p: { after: 8, line: 1.08 } };
  const dd = doc.getElementsByTagName('w:docDefaults')[0];
  if (dd) {
    defaults.r = runProps(dd.getElementsByTagName('w:rPr')[0], defaults.r);
    defaults.p = paraProps(dd.getElementsByTagName('w:pPr')[0], defaults.p);
  }
  const raw = new Map();
  for (const s of doc.getElementsByTagName('w:style')) {
    const id = attr(s, 'styleId');
    const name = (attr(kid(s, 'name'), 'val') || '').toLowerCase();
    raw.set(id, { s, based: attr(kid(s, 'basedOn'), 'val'), name, def: attr(s, 'default') === '1', type: attr(s, 'type') });
  }
  const done = new Map();
  const resolve = (id, depth = 0) => {
    if (!id || !raw.has(id) || depth > 20) return { p: { ...defaults.p }, r: { ...defaults.r } };
    if (done.has(id)) return done.get(id);
    const { s, based, name } = raw.get(id);
    const base = resolve(based, depth + 1);
    const out = { p: paraProps(kid(s, 'pPr'), base.p), r: runProps(kid(s, 'rPr'), base.r), name };
    const h = /^heading (\d)$/.exec(name);
    if (h) out.heading = Number(h[1]);
    if (name === 'title') out.heading = 0;
    done.set(id, out);
    return out;
  };
  let normal = null;
  for (const [id, v] of raw) {
    resolve(id);
    if (v.def && v.type === 'paragraph') normal = id;
  }
  return { get: (id) => resolve(id || normal), normal: resolve(normal) };
}

/** numbering.xml → (numId, level) → {bullet, fmt, start}. */
function readNumbering(xml) {
  const doc = parse(xml);
  const abstract = new Map();
  for (const a of doc.getElementsByTagName('w:abstractNum')) {
    const levels = new Map();
    for (const l of kids(a, 'lvl')) {
      levels.set(num(attr(l, 'ilvl')), {
        fmt: attr(kid(l, 'numFmt'), 'val') || 'decimal',
        text: attr(kid(l, 'lvlText'), 'val') || '',
        start: num(attr(kid(l, 'start'), 'val'), 1),
      });
    }
    abstract.set(attr(a, 'abstractNumId'), levels);
  }
  const nums = new Map();
  for (const n of doc.getElementsByTagName('w:num')) nums.set(attr(n, 'numId'), abstract.get(attr(kid(n, 'abstractNumId'), 'val')));
  return (numId, lvl) => (nums.get(numId) && nums.get(numId).get(lvl)) || { fmt: 'bullet', text: '•', start: 1 };
}

function roman(n) {
  const r = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = '';
  for (const [v, k] of r) while (n >= v) { s += k; n -= v; }
  return s;
}

function counterText(fmt, n) {
  if (fmt === 'lowerLetter') return String.fromCharCode(96 + ((n - 1) % 26) + 1);
  if (fmt === 'upperLetter') return String.fromCharCode(64 + ((n - 1) % 26) + 1);
  if (fmt === 'lowerRoman') return roman(n);
  if (fmt === 'upperRoman') return roman(n).toUpperCase();
  return String(n);
}

/**
 * @returns {Promise<{kind: 'docx', page: {w: number, h: number, top: number, right: number, bottom: number, left: number}, blocks: any[]}>}
 */
export async function readDocx(bytes) {
  const zip = readZip(bytes);
  const xml = await zipText(zip, 'word/document.xml');
  if (!xml) throw new Error('notdocx');
  const doc = parse(xml);
  const styles = readStyles(await zipText(zip, 'word/styles.xml'));
  const numbering = readNumbering(await zipText(zip, 'word/numbering.xml'));
  const relMap = await rels(zip, 'word/_rels/document.xml.rels');
  const counters = new Map();
  const images = new Map();

  async function image(rid) {
    const target = relMap.get(rid);
    if (!target) return null;
    const path = target.startsWith('/') ? target.slice(1) : `word/${target}`;
    if (!images.has(path)) {
      const get = zip.get(path.replace(/\/\.\//g, '/'));
      images.set(path, get ? get() : Promise.resolve(null));
    }
    const data = await images.get(path);
    if (!data) return null;
    const isPng = data[0] === 0x89 && data[1] === 0x50;
    const isJpg = data[0] === 0xff && data[1] === 0xd8;
    return isPng || isJpg ? { bytes: data, mime: isPng ? 'png' : 'jpg' } : null;
  }

  async function paragraph(p, out) {
    const pPr = kid(p, 'pPr');
    const st = styles.get(attr(kid(pPr, 'pStyle'), 'val'));
    const pp = paraProps(pPr, st.p);
    const block = { type: 'p', ...pp, heading: st.heading, runs: [] };
    if (block.breakBefore) out.push({ type: 'pagebreak' });
    // Lists
    // Lists come from the paragraph or its style (e.g. "List Bullet").
    if (pp.num && pp.num.id && pp.num.id !== '0') {
      const { id, lvl } = pp.num;
      const def = numbering(id, lvl);
      const key = `${id}:${lvl}`;
      for (const k of counters.keys()) if (k.startsWith(`${id}:`) && Number(k.split(':')[1]) > lvl) counters.delete(k);
      const n = (counters.get(key) ?? def.start - 1) + 1;
      counters.set(key, n);
      block.list = { level: lvl, label: def.fmt === 'bullet' ? '•' : def.fmt === 'none' ? '' : (def.text || '%1.').replace(/%\d/g, counterText(def.fmt, n)) };
      if (block.indent == null) block.indent = 18 * (lvl + 1);
    }
    const walk = async (el, rp) => {
      for (const c of el.children) {
        const n = c.localName;
        if (n === 'r') {
          // A character style adds only what differs from normal text.
          const rStyle = attr(kid(kid(c, 'rPr'), 'rStyle'), 'val');
          const extra = rStyle ? Object.fromEntries(Object.entries(styles.get(rStyle).r).filter(([k, v]) => styles.normal.r[k] !== v)) : {};
          const r = runProps(kid(c, 'rPr'), { ...rp, ...extra });
          for (const t of c.children) {
            if (t.localName === 't') block.runs.push({ ...r, text: r.caps ? t.textContent.toUpperCase() : t.textContent });
            else if (t.localName === 'tab') block.runs.push({ ...r, text: '    ' });
            else if (t.localName === 'br') {
              if (attr(t, 'type') === 'page') { out.push({ ...block, runs: [...block.runs] }); block.runs = []; out.push({ type: 'pagebreak' }); } else block.runs.push({ ...r, text: '\n' });
            } else if (t.localName === 'drawing' || t.localName === 'pict') {
              const blip = t.getElementsByTagName('a:blip')[0] || t.getElementsByTagName('v:imagedata')[0];
              const rid = blip && (blip.getAttribute('r:embed') || blip.getAttribute('r:id'));
              const ext = t.getElementsByTagName('wp:extent')[0];
              const img = rid && await image(rid);
              if (img) {
                if (block.runs.length) { out.push({ ...block, runs: [...block.runs] }); block.runs = []; }
                out.push({ type: 'image', ...img, w: ext ? num(ext.getAttribute('cx')) / EMU : 0, h: ext ? num(ext.getAttribute('cy')) / EMU : 0, align: block.align });
              }
            }
          }
        } else if (['hyperlink', 'smartTag', 'ins', 'fldSimple', 'sdt', 'sdtContent'].includes(n)) {
          await walk(c, rp);
        }
      }
    };
    await walk(p, st.r);
    if (block.runs.length || !out.length || out[out.length - 1].type !== 'image') out.push(block);
  }

  async function table(tbl) {
    const grid = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => twip(attr(g, 'w')));
    const rows = [];
    for (const tr of kids(tbl, 'tr')) {
      const row = [];
      for (const tc of kids(tr, 'tc')) {
        const span = num(attr(kid(kid(tc, 'tcPr'), 'gridSpan'), 'val'), 1);
        const vm = kid(kid(tc, 'tcPr'), 'vMerge');
        const blocks = [];
        await body(tc, blocks);
        row.push({ span, blocks, merged: vm && attr(vm, 'val') !== 'restart' });
      }
      rows.push(row);
    }
    return { type: 'table', grid, rows };
  }

  async function body(el, out) {
    for (const c of el.children) {
      if (c.localName === 'p') await paragraph(c, out);
      else if (c.localName === 'tbl') out.push(await table(c));
      else if (c.localName === 'sdt') await body(kid(c, 'sdtContent') || c, out);
    }
  }

  const bodyEl = doc.getElementsByTagName('w:body')[0];
  const blocks = [];
  await body(bodyEl, blocks);
  const sect = kid(bodyEl, 'sectPr');
  const sz = kid(sect, 'pgSz');
  const mar = kid(sect, 'pgMar');
  const page = {
    w: sz ? twip(attr(sz, 'w')) : 595.28,
    h: sz ? twip(attr(sz, 'h')) : 841.89,
    top: mar ? twip(attr(mar, 'top')) : 72,
    right: mar ? twip(attr(mar, 'right')) : 72,
    bottom: mar ? twip(attr(mar, 'bottom')) : 72,
    left: mar ? twip(attr(mar, 'left')) : 72,
  };
  if (!(page.w > 100 && page.h > 100)) Object.assign(page, { w: 595.28, h: 841.89 });
  return { kind: 'docx', page, blocks, base: styles.normal.r.size || 11 };
}

/* =========================== Excel =========================== */

const DATE_FMTS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 50, 57]);

function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function excelDate(v) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000));
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function shownNumber(v, fmtId, fmtCode) {
  if (DATE_FMTS.has(fmtId) || (fmtCode && /[dmy]/i.test(fmtCode.replace(/"[^"]*"|\[[^\]]*\]/g, '')) && !/0/.test(fmtCode))) return excelDate(v);
  if (fmtId === 9 || fmtId === 10 || (fmtCode && /%$/.test(fmtCode))) return `${Math.round(v * 10000) / 100}%`;
  const dp = fmtCode && /0\.(0+)/.exec(fmtCode);
  if (dp) {
    const s = v.toFixed(dp[1].length);
    return /,/.test(fmtCode) ? Number(s).toLocaleString('en-US', { minimumFractionDigits: dp[1].length }) : s;
  }
  if (fmtId === 2) return v.toFixed(2);
  if (fmtId === 4) return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (fmtId === 3) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (fmtCode && /#,##0/.test(fmtCode)) return v.toLocaleString('en-US', { maximumFractionDigits: 10 });
  return String(Number(v.toPrecision(12)));
}

/**
 * @returns {Promise<{kind: 'xlsx', sheets: {name: string, cols: number[], rows: {cells: {text: string, bold: boolean, num: boolean}[]}[]}[]}>}
 */
export async function readXlsx(bytes) {
  const zip = readZip(bytes);
  const wb = parse(await zipText(zip, 'xl/workbook.xml'));
  if (!wb.getElementsByTagName('sheet').length) throw new Error('notxlsx');
  const relMap = await rels(zip, 'xl/_rels/workbook.xml.rels');
  const shared = [...parse(await zipText(zip, 'xl/sharedStrings.xml')).getElementsByTagName('si')]
    .map((si) => [...si.getElementsByTagName('t')].filter((t) => t.parentNode.localName !== 'rPh').map((t) => t.textContent).join(''));
  const st = parse(await zipText(zip, 'xl/styles.xml'));
  const fmts = new Map([...st.getElementsByTagName('numFmt')].map((f) => [num(f.getAttribute('numFmtId')), f.getAttribute('formatCode')]));
  const fonts = [...(st.getElementsByTagName('fonts')[0]?.children || [])].map((f) => !!kid(f, 'b') && kid(f, 'b').getAttribute('val') !== '0');
  const xfs = [...(st.getElementsByTagName('cellXfs')[0]?.children || [])].map((x) => ({ fmt: num(x.getAttribute('numFmtId')), bold: fonts[num(x.getAttribute('fontId'))] || false }));
  const sheets = [];
  for (const s of wb.getElementsByTagName('sheet')) {
    if (s.getAttribute('state') === 'hidden') continue;
    const target = relMap.get(s.getAttribute('r:id'));
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const doc = parse(await zipText(zip, path));
    const colsW = [];
    for (const c of doc.getElementsByTagName('col')) {
      if (c.getAttribute('hidden') === '1') continue;
      for (let i = num(c.getAttribute('min')) - 1; i < num(c.getAttribute('max')) && i < 200; i++) colsW[i] = num(c.getAttribute('width'), 8.43);
    }
    const rows = [];
    let maxCol = -1;
    for (const r of doc.getElementsByTagName('row')) {
      const idx = num(r.getAttribute('r'), rows.length + 1) - 1;
      if (idx > 5000) break;
      const cells = [];
      for (const c of kids(r, 'c')) {
        const col = colIndex(c.getAttribute('r'));
        if (col > 200) continue;
        const t = c.getAttribute('t');
        const v = kid(c, 'v') ? kid(c, 'v').textContent : '';
        const xf = xfs[num(c.getAttribute('s'))] || { fmt: 0, bold: false };
        let text = '';
        let isNum = false;
        if (t === 's') text = shared[num(v)] || '';
        else if (t === 'inlineStr') text = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('');
        else if (t === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'str' || t === 'e') text = v;
        else if (v !== '') { text = shownNumber(Number(v), xf.fmt, fmts.get(xf.fmt)); isNum = true; }
        if (text !== '') {
          cells[col] = { text, bold: xf.bold, num: isNum };
          maxCol = Math.max(maxCol, col);
        }
      }
      rows[idx] = { cells };
    }
    let last = rows.length - 1;
    while (last >= 0 && !(rows[last] && rows[last].cells.some(Boolean))) last--;
    const used = [];
    for (let i = 0; i <= last; i++) used.push(rows[i] || { cells: [] });
    // Columns without a set width grow to fit their text (up to ~40 characters),
    // so a PDF doesn't cut off what Excel would let you widen on screen.
    const longest = [];
    for (const r of used) r.cells.forEach((c, i) => { if (c) longest[i] = Math.max(longest[i] || 0, c.text.length); });
    const cols = Array.from({ length: maxCol + 1 }, (_, i) => colsW[i] || Math.max(8.43, Math.min(40, (longest[i] || 0) * 1.1 + 1)));
    sheets.push({ name: s.getAttribute('name') || `Sheet${sheets.length + 1}`, cols, rows: used });
  }
  return { kind: 'xlsx', sheets };
}

/** Read either kind by looking inside the file. */
export async function readOffice(bytes) {
  const zip = readZip(bytes);
  if (zip.has('word/document.xml')) return readDocx(bytes);
  if (zip.has('xl/workbook.xml')) return readXlsx(bytes);
  throw new Error('notoffice');
}
