// Выгрузка расписания заезда в Word — по эталонному образцу технопарка
// («Расписание … 3 заезд.docx»), вплоть до размеров:
//  • альбомный A4 16834×11909, поля 1440 (снизу 851), Times New Roman;
//  • шапка — таблица без рамок в две колонки по 7393: слева «СОГЛАСОВАНО»
//    директора школы, справа — руководителя технопарка (выровнено вправо), 12 pt;
//  • заголовок 12 pt жирный по центру, межстрочный одинарный;
//  • таблицы недель начинаются со второго листа, каждая неделя — с новой
//    страницы; ширина 14790 со сдвигом −216 (шире полей, как в образце),
//    первая колонка 2112, дни — поровну; текст 11 pt, отступы ячеек 108/0;
//  • в шапке недели: «№ урока/время», дни жирным, даты обычным под ними;
//    в строках уроков номер жирный, время и группы — обычным.
import { buildDocx } from '../lib/docx-write.js';
import { xmlEsc } from '../lib/zip-write.js';
import { weeksOf } from '../lib/schedule-build.js';

const short = (iso) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y.slice(2)}`; };
const dm = (iso) => { const [, m, d] = iso.split('-'); return `${d}.${m}`; };

const FONT = 'Times New Roman';
const TABLE_W = 14790;
const FIRST_COL = 2112;
const INDENT = -216;

/** Фрагмент текста. sz — кегль в pt (по умолчанию — документа, 11). */
function run(text, { b = false, sz = null } = {}) {
  const rPr = `<w:rPr><w:rFonts w:ascii="${FONT}" w:eastAsia="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>${b ? '<w:b/>' : ''}` +
    `<w:color w:val="000000"/>${sz ? `<w:sz w:val="${sz * 2}"/><w:szCs w:val="${sz * 2}"/>` : ''}</w:rPr>`;
  return `<w:r>${rPr}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
}

/** Абзац из фрагментов. jc — выравнивание, line — межстрочный (240 = одинарный). */
function para(runs, { jc = null, line = 240, sz = null, b = false } = {}) {
  const mark = `<w:rPr><w:rFonts w:ascii="${FONT}" w:eastAsia="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>${b ? '<w:b/>' : ''}` +
    `<w:color w:val="000000"/>${sz ? `<w:sz w:val="${sz * 2}"/><w:szCs w:val="${sz * 2}"/>` : ''}</w:rPr>`;
  return `<w:p><w:pPr><w:spacing w:after="0" w:line="${line}" w:lineRule="auto"/>${jc ? `<w:jc w:val="${jc}"/>` : ''}${mark}</w:pPr>${[].concat(runs).join('')}</w:p>`;
}

const pageBreak = () => `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>`;

function cell(width, paras, { span = 1 } = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}</w:tcPr>` +
    `${paras.length ? paras.join('') : para([])}</w:tc>`;
}

function row(cells, { height = null, header = false } = {}) {
  return `<w:tr><w:trPr><w:cantSplit/>${height ? `<w:trHeight w:val="${height}"/>` : ''}${header ? '<w:tblHeader/>' : ''}</w:trPr>${cells.join('')}</w:tr>`;
}

function tbl(grid, rows, { borders = true } = {}) {
  const b = borders
    ? ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(k => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join('')
    : ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(k => `<w:${k} w:val="nil"/>`).join('');
  const total = grid.reduce((a, x) => a + x, 0);
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblInd w:w="${INDENT}" w:type="dxa"/>` +
    `<w:tblBorders>${b}</w:tblBorders><w:tblLayout w:type="fixed"/>` +
    `<w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${grid.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;
}

/**
 * @param {object} o
 *  {school:{name, locality, director}, kv:{title, head}, yearLabel, place, shift,
 *   direction, days, fiveDay, grid, times, comment,
 *   second:{enabled, direction, first, grid?} — блок второго педагога
 *   (grid — его уроки, если подтянуты по ссылке коллеги; иначе пустой)}
 */
export async function buildScheduleDocx(o) {
  const blocks = [];
  const year = (o.days[0] || '').slice(0, 4);

  /* --- шапка «СОГЛАСОВАНО» --- */
  const L = (t) => para(run(t, { sz: 12 }), { line: 276, sz: 12 });
  const R = (t) => para(run(t, { sz: 12 }), { line: 276, sz: 12, jc: 'right' });
  const schoolName = String(o.school.name || '').trim();
  blocks.push(tbl([7393, 7393], [row([
    cell(7393, [
      L('СОГЛАСОВАНО'),
      L(schoolName ? `Директор школы ${schoolName.replace(/^школы\s+/i, '')}` : 'Директор школы ______________________'),
      L(o.school.locality || ''),
      L(`${o.school.director ? o.school.director + ' ' : ''}______________`),
      L(` _______________${year} г.`),
      L(''),
    ]),
    cell(7393, [
      R('СОГЛАСОВАНО'),
      R(o.kv.title || ''),
      R(`______________ ${o.kv.head || ''}`),
      R(`______________${year} г.`),
    ]),
  ])], { borders: false }));

  /* --- заголовок --- */
  const T = (t) => para(t ? run(t, { b: true, sz: 12 }) : [], { jc: 'center', sz: 12, b: true });
  blocks.push(T(''), T('РАСПИСАНИЕ ЗАНЯТИЙ'), T('МТ «Кванториум-28»'), T(`на ${o.yearLabel} уч. год`),
    T(`${o.place ? o.place + ', ' : ''}${o.shift} заезд`), T(''));

  /* --- недели: каждая с нового листа --- */
  const weeks = weeksOf(o.days, o.fiveDay);
  const n = o.fiveDay ? 5 : 6;
  const dayW = Math.floor((TABLE_W - FIRST_COL) / n);
  const grid = [FIRST_COL, ...Array.from({ length: n }, (_, i) => (i === n - 1 ? TABLE_W - FIRST_COL - dayW * (n - 1) : dayW))];
  const restW = TABLE_W - FIRST_COL;

  weeks.forEach((w, wi) => {
    blocks.push(pageBreak());
    const rows = [];
    rows.push(row([
      cell(FIRST_COL, [para(run('№ урока/', { b: true }), { jc: 'center', line: 276, b: true }), para(run('время', { b: true }), { jc: 'center', line: 276, b: true })]),
      cell(restW, [para(run('Направление/Педагог/Дни недели/Даты', { b: true }), { jc: 'center', line: 276, b: true })], { span: n }),
    ], { height: 539, header: true }));
    rows.push(row([
      cell(FIRST_COL, [para(run(`${w.no} неделя`, { b: true }), { b: true }), para(run(`${dm(w.from)}-${short(w.to)}`, { b: true }), { b: true })]),
      ...w.days.map((d, i) => cell(grid[i + 1], [
        para(run(d.weekday, { b: true }), { b: true }),
        ...(d.date ? [para(run(short(d.date)))] : []),
      ])),
    ], { header: true }));

    const section = (direction, cells) => {
      rows.push(row([cell(TABLE_W, [para(run(direction || '', { b: true }), { jc: 'center', b: true })], { span: n + 1 })]));
      o.times.forEach((t, i) => {
        rows.push(row([
          cell(FIRST_COL, [para([run(`${i + 1}`, { b: true }), run(`. ${t}`)])]),
          ...w.days.map((d, k) => cell(grid[k + 1], [para(cells && d.date && cells[d.date]?.[i] ? run(cells[d.date][i]) : [])])),
        ]));
      });
    };
    const mine = () => section(o.direction, o.grid);
    const other = () => section(o.second.direction || 'Направление (Педагог)', o.second.grid || null);
    if (o.second?.enabled && o.second.first) { other(); mine(); } else { mine(); if (o.second?.enabled) other(); }
    blocks.push(tbl(grid, rows));
    if (wi === weeks.length - 1) {
      for (const line of String(o.comment || '').split('\n')) blocks.push(para(line ? run(line) : [], { line: 276 }));
    }
  });

  return buildDocx(blocks, {
    page: { w: 16834, h: 11909 }, landscape: true,
    margins: { top: 1440, right: 1440, bottom: 851, left: 1440 },
    defaults: { font: FONT, size: 11, line: 276 },
  });
}
