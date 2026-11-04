/**
 * Μικρός συγγραφέας εγγράφων Word (.docx, Office Open XML). Δέχεται απλή
 * δομή μπλοκ (παράγραφοι με στυλ, λίστες, πίνακες) και βγάζει το ZIP με τα
 * ελάχιστα απαραίτητα μέρη: [Content_Types].xml, _rels, word/document.xml,
 * word/styles.xml, word/numbering.xml, docProps/core.xml και app.xml.
 * Γλώσσα κειμένου el-GR, σελίδα A4, γραμματοσειρά Calibri (έχει ελληνικά).
 *
 * @typedef {Object} DocxRun
 * @property {string} text  οι αλλαγές γραμμής γίνονται <w:br/>
 * @property {boolean} [bold]
 * @property {boolean} [italic]
 * @property {string} [color]  δεκαεξαδικό χωρίς #, π.χ. '6B7280'
 * @property {number} [sizePt]
 *
 * @typedef {'Title'|'Subtitle'|'Heading1'|'Heading2'|'Heading3'|'Normal'|'Note'} DocxParagraphStyle
 *
 * @typedef {{ kind: 'paragraph', style?: DocxParagraphStyle, runs: DocxRun[] }} DocxParagraph
 * @typedef {{ kind: 'list', ordered: boolean, items: DocxRun[][] }} DocxList
 * @typedef {{ kind: 'table', header: DocxRun[][], rows: DocxRun[][][] }} DocxTable
 * @typedef {DocxParagraph|DocxList|DocxTable} DocxBlock
 *
 * @typedef {Object} DocxMetadata
 * @property {string} title
 * @property {string} creator  π.χ. το όνομα της εφαρμογής
 * @property {Date} createdAt
 * @property {string} [language]  BCP 47, προεπιλογή el-GR
 */
import { createZip } from './zip-store-writer.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const PAGE_TEXT_WIDTH_TWIPS = 9026;

/**
 * @param {DocxBlock[]} blocks
 * @param {DocxMetadata} metadata
 * @returns {Uint8Array}
 */
export function buildDocx(blocks, metadata) {
  const language = metadata.language || 'el-GR';
  const orderedLists = blocks.filter(b => b.kind === 'list' && b.ordered).length;
  const parts = [
    { path: '[Content_Types].xml', data: contentTypesXml() },
    { path: '_rels/.rels', data: packageRelsXml() },
    { path: 'word/_rels/document.xml.rels', data: documentRelsXml() },
    { path: 'word/document.xml', data: documentXml(blocks) },
    { path: 'word/styles.xml', data: stylesXml(language) },
    { path: 'word/numbering.xml', data: numberingXml(orderedLists) },
    { path: 'docProps/core.xml', data: coreXml(metadata) },
    { path: 'docProps/app.xml', data: appXml(metadata.creator) },
  ];
  return createZip(parts, { date: metadata.createdAt });
}

/* ---------------------------------------------------------------- σώμα */

function documentXml(blocks) {
  let orderedIndex = 0;
  const body = blocks.map(block => {
    if (block.kind === 'paragraph') return paragraphXml(block.runs, block.style);
    if (block.kind === 'list') {
      // Αριθμός 1 = κουκκίδες. Κάθε αριθμημένη λίστα έχει δικό της w:num (2, 3, …) ώστε να ξεκινά από το 1.
      const numId = block.ordered ? 2 + orderedIndex++ : 1;
      return block.items.map(item => paragraphXml(item, 'ListParagraph', numId)).join('');
    }
    if (block.kind === 'table') return tableXml(block);
    throw new TypeError(`άγνωστο είδος μπλοκ ${block.kind}`);
  }).join('');
  return `${XML_HEAD}<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${body}`
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
    + '</w:body></w:document>';
}

function paragraphXml(runs, style = 'Normal', numId = null) {
  const props = [];
  if (style && style !== 'Normal') props.push(`<w:pStyle w:val="${style}"/>`);
  if (numId != null) props.push(`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`);
  const pPr = props.length ? `<w:pPr>${props.join('')}</w:pPr>` : '';
  return `<w:p>${pPr}${runs.map(runXml).join('')}</w:p>`;
}

function runXml(run) {
  const props = [];
  if (run.bold) props.push('<w:b/>');
  if (run.italic) props.push('<w:i/>');
  if (run.color && /^[0-9A-Fa-f]{6}$/.test(run.color)) props.push(`<w:color w:val="${run.color.toUpperCase()}"/>`);
  if (Number.isFinite(run.sizePt)) props.push(`<w:sz w:val="${Math.round(run.sizePt * 2)}"/>`);
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  const pieces = String(run.text ?? '').split('\n').map(line => line.split('\t').map(t => `<w:t xml:space="preserve">${escapeXml(t)}</w:t>`).join('<w:tab/>'));
  return `<w:r>${rPr}${pieces.join('<w:br/>')}</w:r>`;
}

function tableXml(table) {
  const columns = Math.max(1, table.header.length, ...table.rows.map(r => r.length));
  const width = Math.floor(PAGE_TEXT_WIDTH_TWIPS / columns);
  const cell = (runs, header) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${paragraphXml(header ? runs.map(r => ({ ...r, bold: true })) : runs)}</w:tc>`;
  const row = (cells, header) => {
    const padded = [...cells, ...Array(columns - cells.length).fill([])];
    return `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${padded.map(c => cell(c, header)).join('')}</w:tr>`;
  };
  const grid = Array(columns).fill(`<w:gridCol w:w="${width}"/>`).join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${width * columns}" w:type="dxa"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`
    + `<w:tblGrid>${grid}</w:tblGrid>${table.header.length ? row(table.header, true) : ''}${table.rows.map(r => row(r, false)).join('')}</w:tbl>`
    + '<w:p/>';
}

/* ---------------------------------------------------------------- στυλ και αρίθμηση */

function stylesXml(language) {
  const lang = escapeXml(language);
  const heading = (id, name, sizePt, color, before) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>`
    + `<w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="80"/><w:outlineLvl w:val="${Number(id.slice(-1)) - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${sizePt * 2}"/></w:rPr></w:style>`;
  return `${XML_HEAD}<w:styles xmlns:w="${W_NS}">`
    + `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="${lang}" w:eastAsia="${lang}" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>`
    + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="160"/></w:pPr><w:rPr><w:b/><w:color w:val="0E3B43"/><w:sz w:val="40"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="4B5563"/><w:sz w:val="22"/></w:rPr></w:style>'
    + heading('Heading1', 'heading 1', 16, '0E3B43', 360)
    + heading('Heading2', 'heading 2', 13, '0E3B43', 240)
    + heading('Heading3', 'heading 3', 12, '374151', 200)
    + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="240"/></w:pPr><w:rPr><w:i/><w:color w:val="6B7280"/><w:sz w:val="18"/></w:rPr></w:style>'
    + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
    + '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders>'
    + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/>`).join('')
    + '</w:tblBorders></w:tblPr></w:style>'
    + '</w:styles>';
}

function numberingXml(orderedLists) {
  const level = (format, text) => `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>`;
  const nums = ['<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'];
  for (let i = 0; i < orderedLists; i++) {
    nums.push(`<w:num w:numId="${2 + i}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`);
  }
  return `${XML_HEAD}<w:numbering xmlns:w="${W_NS}">`
    + `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>${level('bullet', '•')}</w:abstractNum>`
    + `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${level('decimal', '%1.')}</w:abstractNum>`
    + `${nums.join('')}</w:numbering>`;
}

/* ---------------------------------------------------------------- πακέτο */

function contentTypesXml() {
  const override = (part, type) => `<Override PartName="${part}" ContentType="${type}"/>`;
  return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + override('/word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')
    + override('/word/styles.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml')
    + override('/word/numbering.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml')
    + override('/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml')
    + override('/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml')
    + '</Types>';
}

function packageRelsXml() {
  return `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}">`
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
    + '</Relationships>';
}

function documentRelsXml() {
  return `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}">`
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
    + '</Relationships>';
}

function coreXml({ title, creator, createdAt }) {
  const when = createdAt.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${escapeXml(title)}</dc:title><dc:creator>${escapeXml(creator)}</dc:creator><cp:lastModifiedBy>${escapeXml(creator)}</cp:lastModifiedBy>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified>`
    + '</cp:coreProperties>';
}

function appXml(creator) {
  return `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">`
    + `<Application>${escapeXml(creator)}</Application></Properties>`;
}

/** Χαρακτήρες που το XML 1.0 δεν επιτρέπει: έλεγχος (εκτός από tab, LF, CR) και U+FFFE, U+FFFF. */
const INVALID_XML_CHARACTERS = new RegExp(`[\x00-\x08\x0B\x0C\x0E-\x1F${String.fromCharCode(0xfffe, 0xffff)}]`, 'g');

/** Διαφυγή XML και αφαίρεση χαρακτήρων ελέγχου που το XML 1.0 δεν επιτρέπει. */
export function escapeXml(text) {
  return String(text ?? '')
    .replace(INVALID_XML_CHARACTERS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
