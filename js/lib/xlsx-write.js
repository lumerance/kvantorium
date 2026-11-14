// Генерация .xlsx (SpreadsheetML) в браузере: несколько листов, рамки, объединения,
// вертикальный текст в шапке — чтобы выгрузка совпадала по виду с бланком плана.
import { makeZip, xmlEsc } from './zip-write.js';

export const colName = (i) => {
  let s = ''; i++;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
};

/* Стили (индекс = значение поля s у ячейки) */
export const S = {
  PLAIN: 0,        // обычный текст
  TITLE: 1,        // крупный жирный заголовок
  BOLD: 2,         // жирный без рамки
  HEAD: 3,         // шапка таблицы: жирный, по центру, рамка, перенос
  HEAD_V: 4,       // шапка с вертикальным текстом
  CELL: 5,         // ячейка с рамкой, перенос, слева
  CELL_C: 6,       // ячейка с рамкой, по центру
  NUM: 7,          // число с рамкой, по центру
  TOTAL: 8,        // итог: жирный, рамка, по центру, заливка
  TOTAL_L: 9,      // итог-подпись: жирный, рамка, слева, заливка
  NUM2: 10,        // число с рамкой, два знака после запятой
  HEAD_V10: 11,    // шапка с вертикальным текстом, шрифт 10
  TEXT12: 12,      // обычный текст 12 pt
  BOLD12: 13,      // жирный 12 pt
  TITLE16: 14,     // заголовок 16 pt по центру
  NUM1: 15,        // число без рамки, один знак после запятой
};

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>
<fonts count="7">
 <font><sz val="10"/><name val="Times New Roman"/></font>
 <font><b/><sz val="14"/><name val="Times New Roman"/></font>
 <font><b/><sz val="10"/><name val="Times New Roman"/></font>
 <font><sz val="8"/><name val="Times New Roman"/></font>
 <font><sz val="12"/><name val="Times New Roman"/></font>
 <font><b/><sz val="12"/><name val="Times New Roman"/></font>
 <font><b/><sz val="16"/><name val="Times New Roman"/></font>
</fonts>
<fills count="3">
 <fill><patternFill patternType="none"/></fill>
 <fill><patternFill patternType="gray125"/></fill>
 <fill><patternFill patternType="solid"><fgColor rgb="FFE8F2E0"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
 <border><left/><right/><top/><bottom/><diagonal/></border>
 <border>
  <left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right>
  <top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/>
 </border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="16">
 <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
 <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
 <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
 <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
 <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="bottom" wrapText="1" textRotation="90"/></xf>
 <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
 <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
 <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
 <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
 <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
 <xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
 <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" textRotation="90"/></xf>
 <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
 <xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
 <xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
 <xf numFmtId="164" fontId="4" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cellXml(ref, cell) {
  if (cell === null || cell === undefined || cell === '') return '';
  const c = (typeof cell === 'object' && !Array.isArray(cell)) ? cell : { v: cell };
  const s = c.s ? ` s="${c.s}"` : '';
  if (c.f) {
    const f = `<f>${xmlEsc(c.f)}</f>`;
    if (typeof c.v === 'number' && isFinite(c.v)) return `<c r="${ref}"${s}>${f}<v>${c.v}</v></c>`;
    if (c.v !== undefined && c.v !== null && c.v !== '') return `<c r="${ref}"${s} t="str">${f}<v>${xmlEsc(c.v)}</v></c>`;
    return `<c r="${ref}"${s}>${f}</c>`;
  }
  if (c.v === null || c.v === undefined || c.v === '') return `<c r="${ref}"${s}/>`;
  if (typeof c.v === 'number' && isFinite(c.v)) return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(c.v)}</t></is></c>`;
}

function sheetXml(sheet) {
  const maxCols = Math.max(1, ...(sheet.rows || []).map(r => ((r && (r.cells || r)) || []).length));
  const lastRef = `${colName(maxCols - 1)}${Math.max(1, (sheet.rows || []).length)}`;
  const cols = (sheet.cols || []).map((w, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const rows = (sheet.rows || []).map((row, ri) => {
    if (!row) return '';
    const cells = (row.cells || row);
    const hAttr = row.h ? ` ht="${row.h}" customHeight="1"` : '';
    const body = cells.map((c, ci) => cellXml(`${colName(ci)}${ri + 1}`, c)).join('');
    if (!body) return `<row r="${ri + 1}"${hAttr}/>`;
    return `<row r="${ri + 1}"${hAttr}>${body}</row>`;
  }).join('');
  const merges = (sheet.merges || []).length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${lastRef}"/>
<sheetViews><sheetView workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${cols ? `<cols>${cols}</cols>` : ''}
<sheetData>${rows}</sheetData>
${merges}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup orientation="${sheet.portrait ? 'portrait' : 'landscape'}" paperSize="9" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

/** @param {Array<{name:string, cols?:number[], rows:Array, merges?:string[]}>} sheets */
export async function buildXlsx(sheets) {
  const files = [
    {
      name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
    },
    {
      name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
    },
    {
      name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
<calcPr fullCalcOnLoad="1"/>
</workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    },
    { name: 'xl/styles.xml', data: STYLES_XML },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  const blob = await makeZip(files);
  return new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
