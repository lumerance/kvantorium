// Генерация .docx (WordprocessingML) в браузере.
import { makeZip, xmlEsc } from './zip-write.js';

const HALF_PT = (pt) => Math.round(pt * 2);      // размер шрифта в half-points
const TWIP = (cm) => Math.round(cm * 567);        // сантиметры -> twips

/** Абзац. opts: {bold, italic, size(pt), align, spacingAfter(pt), spacingBefore(pt), font} */
export function p(text = '', opts = {}) {
  const runs = String(text).split('\n');
  const rPr = [
    opts.font ? `<w:rFonts w:ascii="${opts.font}" w:hAnsi="${opts.font}"/>` : '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>',
    opts.bold ? '<w:b/>' : '',
    opts.italic ? '<w:i/>' : '',
    `<w:sz w:val="${HALF_PT(opts.size || 12)}"/><w:szCs w:val="${HALF_PT(opts.size || 12)}"/>`,
  ].join('');
  const pPr = `<w:pPr>` +
    `<w:spacing w:before="${Math.round((opts.spacingBefore || 0) * 20)}" w:after="${Math.round((opts.spacingAfter ?? 4) * 20)}" w:line="240" w:lineRule="auto"/>` +
    (opts.align ? `<w:jc w:val="${opts.align}"/>` : '') +
    `<w:rPr>${rPr}</w:rPr></w:pPr>`;
  const body = runs.map((line, i) =>
    `<w:r><w:rPr>${rPr}</w:rPr>${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEsc(line)}</w:t></w:r>`).join('');
  return `<w:p>${pPr}${body}</w:p>`;
}

const border = (sz = 4) => `<w:top w:val="single" w:sz="${sz}" w:color="000000"/><w:left w:val="single" w:sz="${sz}" w:color="000000"/>` +
  `<w:bottom w:val="single" w:sz="${sz}" w:color="000000"/><w:right w:val="single" w:sz="${sz}" w:color="000000"/>`;

const NO_BORDER = '<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/>';

/** Ячейка. {text, bold, align, span, fill, size, valign} */
function tc(cell, widthTwip, noBorders) {
  const c = typeof cell === 'string' ? { text: cell } : (cell || {});
  return `<w:tc><w:tcPr>` +
    `<w:tcW w:w="${widthTwip}" w:type="dxa"/>` +
    (c.span > 1 ? `<w:gridSpan w:val="${c.span}"/>` : '') +
    `<w:tcBorders>${noBorders ? NO_BORDER : border()}</w:tcBorders>` +
    (c.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${c.fill}"/>` : '') +
    `<w:vAlign w:val="${c.valign || 'center'}"/>` +
    `</w:tcPr>` +
    p(c.text ?? '', { bold: c.bold, align: c.align || 'left', size: c.size || 11, spacingAfter: 0 }) +
    `</w:tc>`;
}

/** Таблица. widths — доли ширины (сумма любая), rows — массив массивов ячеек.
 *  opts: {widthCm, noBorders, header: число строк-шапки, повторяемых на каждой странице} */
export function table(widths, rows, opts = {}) {
  const total = TWIP(opts.widthCm || 17);  // рабочая ширина страницы (по умолчанию ~17 см)
  const sum = widths.reduce((a, b) => a + b, 0);
  const w = widths.map(x => Math.round(x / sum * total));
  const grid = `<w:tblGrid>${w.map(x => `<w:gridCol w:w="${x}"/>`).join('')}</w:tblGrid>`;
  const body = rows.map((cells, ri) => {
    let col = 0;
    const tcs = cells.map(cell => {
      const span = (typeof cell === 'object' && cell.span) || 1;
      const width = w.slice(col, col + span).reduce((a, b) => a + b, 0);
      col += span;
      return tc(cell, width, opts.noBorders);
    }).join('');
    const head = opts.header && ri < opts.header ? '<w:tblHeader/>' : '';
    return `<w:tr><w:trPr><w:cantSplit/>${head}</w:trPr>${tcs}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/>` +
    `<w:tblBorders>${opts.noBorders ? NO_BORDER : border()}</w:tblBorders>` +
    `<w:tblLayout w:type="fixed"/></w:tblPr>${grid}${body}</w:tbl>`;
}

/**
 * Собирает .docx из готовых блоков (строк XML, полученных из p() и table()).
 * @param {string[]} blocks
 * @param {{landscape?:boolean}} opts
 */
export async function buildDocx(blocks, opts = {}) {
  const pageW = opts.landscape ? 16838 : 11906;
  const pageH = opts.landscape ? 11906 : 16838;
  const m = { top: 850, right: 850, bottom: 850, left: 1134, ...(opts.margins || {}) };
  const sect = `<w:sectPr><w:pgSz w:w="${pageW}" w:h="${pageH}"${opts.landscape ? ' w:orient="landscape"' : ''}/>` +
    `<w:pgMar w:top="${m.top}" w:right="${m.right}" w:bottom="${m.bottom}" w:left="${m.left}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${blocks.join('')}${sect}</w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const blob = await makeZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: document },
  ]);
  return new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
