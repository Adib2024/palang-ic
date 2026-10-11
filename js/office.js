// Minimal Office Open XML writers (DOCX, XLSX, PPTX) for the PDF → Office
// tools. Each file is a ZIP of XML parts; only what Word, Excel, PowerPoint,
// LibreOffice and Google Docs need is written. No libraries, no uploads.
import { makeZip } from './zip.js';
import { paragraphs, bodySize, tableRows } from './pdf-layout.js';

const enc = new TextEncoder();
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
// XML 1.0 forbids most control characters; PDFs sometimes contain them.
const esc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const part = (name, text) => ({ name, data: enc.encode(text) });
const zip = (parts, type) => new Blob([makeZip(parts)], { type });

const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const rels = (list) => `${XML}<Relationships xmlns="${PKG_REL}">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;

/* =========================== DOCX =========================== */

const EMU_PER_PT = 12700;
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="' + NS_R + '" '
  + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
  + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

function wRun(text, { bold = false, size = 0 } = {}) {
  const pr = `${bold ? '<w:b/>' : ''}${size ? `<w:sz w:val="${Math.round(size * 2)}"/>` : ''}`;
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function wTable(rows) {
  const n = Math.max(...rows.map((r) => r.length));
  const width = Math.floor(9000 / n);
  const border = '<w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/>';
  return `<w:tbl><w:tblPr><w:tblW w:w="${width * n}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders></w:tblPr>`
    + `<w:tblGrid>${`<w:gridCol w:w="${width}"/>`.repeat(n)}</w:tblGrid>`
    + rows.map((r) => `<w:tr>${Array.from({ length: n }, (_, i) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr><w:p>${r[i] ? wRun(r[i]) : ''}</w:p></w:tc>`).join('')}</w:tr>`).join('')
    + '</w:tbl><w:p/>';
}

function wImage(rid, id, img) {
  const cx = 6 * 914400; // 6 inch wide
  const cy = Math.round((cx * img.height) / img.width);
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Page ${id}"/>`
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="page${id}.jpg"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
    + '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}

/**
 * @param {import('./pdf-layout.js').PageLayout[]} pages
 * @param {Map<number, {bytes: Uint8Array, width: number, height: number}>} images page index → picture (scanned pages)
 */
export function buildDocx(pages, images = new Map(), title = '') {
  const body = bodySize(pages);
  const media = [];
  const out = [];
  pages.forEach((p, pi) => {
    if (pi > 0) out.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    if (images.has(pi)) {
      const rid = `rIdImg${pi + 1}`;
      media.push({ rid, file: `media/page${pi + 1}.jpg`, bytes: images.get(pi).bytes });
      out.push(wImage(rid, pi + 1, images.get(pi)));
    }
    const paras = paragraphs(p.lines, body);
    for (let i = 0; i < paras.length; i++) {
      const para = paras[i];
      if (para.cells) {
        // Consecutive multi-column lines become one table.
        const group = [];
        while (i < paras.length && paras[i].cells) group.push({ cells: paras[i++].cells });
        i--;
        out.push(wTable(tableRows(group)));
        continue;
      }
      const style = para.heading ? `<w:pPr><w:pStyle w:val="${para.size >= body * 1.6 ? 'Heading1' : 'Heading2'}"/></w:pPr>` : '';
      out.push(`<w:p>${style}${wRun(para.text, { bold: para.bold && !para.heading, size: para.heading ? 0 : Math.abs(para.size - body) > 1 ? para.size : 0 })}</w:p>`);
    }
  });
  const doc = `${XML}<w:document ${W_NS}><w:body>${out.join('')}`
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
    + '</w:body></w:document>';
  const styles = `${XML}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
    + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>'
    + '</w:styles>';
  const core = `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title><dc:creator>DokuJaga</dc:creator></cp:coreProperties>`;
  const parts = [
    part('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'),
    part('_rels/.rels', rels([['rId1', 'officeDocument', 'word/document.xml'], ['rId2', 'metadata/core-properties', 'docProps/core.xml']])
      .replace(`${REL}/metadata/core-properties`, 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties')),
    part('docProps/core.xml', core),
    part('word/document.xml', doc),
    part('word/styles.xml', styles),
    part('word/_rels/document.xml.rels', rels([['rIdStyles', 'styles', 'styles.xml'], ...media.map((m) => [m.rid, 'image', m.file])])),
    ...media.map((m) => ({ name: `word/${m.file}`, data: m.bytes })),
  ];
  return zip(parts, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

/* =========================== XLSX =========================== */

const colName = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/** "RM 1,234.50" → 1234.5; anything else → null. */
export function asNumber(text) {
  // Leading zeros (account, phone, IC numbers) must stay text.
  if (/^0\d/.test(text.trim())) return null;
  const m = /^\(?-?(?:RM|USD|\$)?\s*-?[\d]{1,3}(?:,\d{3})*(?:\.\d+)?\)?$|^-?\d+(?:\.\d+)?$/.exec(text.trim());
  if (!m) return null;
  const neg = /^\(.*\)$/.test(text.trim()) || /-/.test(text);
  const v = Number(text.replace(/[^\d.]/g, ''));
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}

/** @param {import('./pdf-layout.js').PageLayout[]} pages */
export function buildXlsx(pages, sheetName = (i) => `Page ${i + 1}`) {
  const sheets = [];
  pages.forEach((p, pi) => {
    const rows = tableRows(p.lines);
    const widths = [];
    const xmlRows = rows.map((r, ri) => {
      const bold = p.lines[ri].bold;
      return `<row r="${ri + 1}">${r.map((v, ci) => {
        widths[ci] = Math.max(widths[ci] || 8, Math.min(60, v.length + 2));
        if (!v) return '';
        const ref = `${colName(ci)}${ri + 1}`;
        const s = bold ? ' s="1"' : '';
        const n = asNumber(v);
        return n !== null ? `<c r="${ref}"${s}><v>${n}</v></c>` : `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }).join('')}</row>`;
    });
    const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    sheets.push(`${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${xmlRows.join('')}</sheetData></worksheet>`);
  });
  if (!sheets.length) sheets.push(`${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`);
  const names = sheets.map((_, i) => esc(sheetName(i).slice(0, 31)));
  const parts = [
    part('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>'),
    part('_rels/.rels', rels([['rId1', 'officeDocument', 'xl/workbook.xml']])),
    part('xl/workbook.xml', `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_R}"><sheets>`
      + names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'),
    part('xl/_rels/workbook.xml.rels', rels([...sheets.map((_, i) => [`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`]), [`rId${sheets.length + 1}`, 'styles', 'styles.xml']])),
    part('xl/styles.xml', `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + '</styleSheet>'),
    ...sheets.map((s, i) => part(`xl/worksheets/sheet${i + 1}.xml`, s)),
  ];
  return zip(parts, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

/* =========================== PPTX =========================== */

const P_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' + NS_R + '" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const EMPTY_TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

const THEME = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="DokuJaga"><a:themeElements>`
  + '<a:clrScheme name="DokuJaga"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="0F172A"/></a:dk2><a:lt2><a:srgbClr val="F6F7FB"/></a:lt2>'
  + '<a:accent1><a:srgbClr val="4F46E5"/></a:accent1><a:accent2><a:srgbClr val="059669"/></a:accent2><a:accent3><a:srgbClr val="D97706"/></a:accent3><a:accent4><a:srgbClr val="E11D48"/></a:accent4>'
  + '<a:accent5><a:srgbClr val="7C3AED"/></a:accent5><a:accent6><a:srgbClr val="0284C7"/></a:accent6><a:hlink><a:srgbClr val="4F46E5"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>'
  + '<a:fontScheme name="DokuJaga"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
  + '<a:fmtScheme name="DokuJaga"><a:fillStyleLst>' + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3) + '</a:fillStyleLst>'
  + '<a:lnStyleLst>' + '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'.repeat(3) + '</a:lnStyleLst>'
  + '<a:effectStyleLst>' + '<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3) + '</a:effectStyleLst>'
  + '<a:bgFillStyleLst>' + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3) + '</a:bgFillStyleLst></a:fmtScheme>'
  + '</a:themeElements></a:theme>';

function pTextBox(id, l, emu) {
  const x = Math.round(l.x * emu);
  const y = Math.round((l.y - l.size * 0.95) * emu);
  const cx = Math.max(Math.round((l.x1 - l.x + l.size) * emu), 12700);
  const cy = Math.round(l.size * 1.4 * emu);
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
    + '<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>'
    + `<a:p><a:r><a:rPr lang="ms-MY" sz="${Math.max(100, Math.round(l.size * 100))}"${l.bold ? ' b="1"' : ''} dirty="0"><a:latin typeface="Calibri"/></a:rPr><a:t>${esc(l.text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

/**
 * @param {import('./pdf-layout.js').PageLayout[]} pages
 * @param {'image'|'text'} mode picture of each page, or editable text boxes
 * @param {Map<number, {bytes: Uint8Array}>} images page pictures (image mode, or scanned pages)
 */
export function buildPptx(pages, mode = 'image', images = new Map()) {
  const first = pages[0] || { width: 595, height: 842 };
  // Slide size from the first page (PowerPoint allows 1-56 inches).
  const emu = EMU_PER_PT;
  const cx = Math.min(51206400, Math.max(914400, Math.round(first.width * emu)));
  const cy = Math.min(51206400, Math.max(914400, Math.round(first.height * emu)));
  const slides = pages.map((p, i) => {
    const sx = cx / (p.width * emu);
    const sy = cy / (p.height * emu);
    const s = Math.min(sx, sy);
    let tree = '';
    let rel = [['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']];
    const pic = images.get(i);
    if (pic && (mode === 'image' || !p.hasText)) {
      rel.push(['rId2', 'image', `../media/slide${i + 1}.jpg`]);
      tree += `<p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ${i + 1}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
        + '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
        + `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(p.width * emu * s)}" cy="${Math.round(p.height * emu * s)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    }
    if (mode === 'text') p.lines.forEach((l, k) => { tree += pTextBox(k + 3, l, emu * s); });
    return {
      xml: `${XML}<p:sld ${P_NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${EMPTY_TREE}${tree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
      rels: rels(rel),
      media: rel.length > 1 ? pic.bytes : null,
    };
  });
  const parts = [
    part('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/>'
      + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
      + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
      + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
      + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
      + slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')
      + '</Types>'),
    part('_rels/.rels', rels([['rId1', 'officeDocument', 'ppt/presentation.xml']])),
    part('ppt/presentation.xml', `${XML}<p:presentation ${P_NS} saveSubsetFonts="1">`
      + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
      + `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst>`
      + `<p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`),
    part('ppt/_rels/presentation.xml.rels', rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'], ...slides.map((_, i) => [`rId${i + 3}`, 'slide', `slides/slide${i + 1}.xml`])])),
    part('ppt/slideMasters/slideMaster1.xml', `${XML}<p:sldMaster ${P_NS}><p:cSld><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>`
      + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
      + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>'),
    part('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']])),
    part('ppt/slideLayouts/slideLayout1.xml', `${XML}<p:sldLayout ${P_NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`),
    part('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']])),
    part('ppt/theme/theme1.xml', THEME),
    ...slides.flatMap((s, i) => [
      part(`ppt/slides/slide${i + 1}.xml`, s.xml),
      part(`ppt/slides/_rels/slide${i + 1}.xml.rels`, s.rels),
      ...(s.media ? [{ name: `ppt/media/slide${i + 1}.jpg`, data: s.media }] : []),
    ]),
  ];
  return zip(parts, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
}
