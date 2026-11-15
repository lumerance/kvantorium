// Информационная справка о проведении образовательного мастер-класса (Word)
// — по образцу технопарка: A4, Times New Roman 14, заголовок по центру,
// «ОРГАНИЗАТОР», таблица 3114 / 6231 с жирными подписями слева.
import { buildDocx } from '../lib/docx-write.js';
import { xmlEsc } from '../lib/zip-write.js';

const FONT = 'Times New Roman';

function run(text, { b = false, sz = 14, u = false } = {}) {
  return `<w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:eastAsia="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>${b ? '<w:b/><w:bCs/>' : ''}${u ? '<w:u w:val="single"/>' : ''}` +
    `<w:sz w:val="${sz * 2}"/><w:szCs w:val="${sz * 2}"/></w:rPr><w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
}
const br = () => `<w:r><w:br/></w:r>`;
function para(runs, { jc = null, sz = 14, b = false } = {}) {
  return `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>${jc ? `<w:jc w:val="${jc}"/>` : ''}` +
    `<w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>${b ? '<w:b/>' : ''}<w:sz w:val="${sz * 2}"/><w:szCs w:val="${sz * 2}"/></w:rPr></w:pPr>` +
    `${[].concat(runs).join('')}</w:p>`;
}
/** Строки через перенос внутри одного абзаца — как в образце. */
const lines = (arr, opts) => arr.flatMap((t, i) => (i ? [br(), run(t, opts)] : [run(t, opts)]));

function cell(width, paras, { vCenter = false } = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${vCenter ? '<w:vAlign w:val="center"/>' : ''}</w:tcPr>${paras.join('')}</w:tc>`;
}
const B = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(k => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join('');

function row(label, paras) {
  const [l1, l2] = label.split('\n');
  return `<w:tr><w:trPr><w:cantSplit/></w:trPr>` +
    cell(3114, [para(run(l1, { b: true }), { b: true }), ...(l2 ? [para(run(l2, { b: true }), { b: true })] : [])], { vCenter: true }) +
    cell(6231, paras) + `</w:tr>`;
}

/**
 * Группирует проведения по одинаковому времени: «15.10.26, 16.10.26» / «19:00-20:00».
 * @param {Array<{date:string, time:string}>} sessions
 */
export function datesLines(sessions) {
  const short = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;
  const byTime = new Map();
  for (const s of [...sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!byTime.has(s.time)) byTime.set(s.time, []);
    byTime.get(s.time).push(short(s.date));
  }
  return [...byTime.entries()].flatMap(([time, dates]) => [dates.join(', '), time]);
}

/**
 * @param {object} d {organizer, theme, title, goal, sessions:[{date,time}], form, audience, age,
 *                    annotation, author, contacts, extra}
 */
export async function buildMkCertDocx(d) {
  const blocks = [];
  blocks.push(para(run('Информационная справка о проведении ', { b: true }), { jc: 'center', b: true }));
  blocks.push(para(run('образовательного мастер-класса', { b: true }), { jc: 'center', b: true }));
  blocks.push(para([], { jc: 'center' }), para([], { jc: 'center' }));
  blocks.push(para(run('ОРГАНИЗАТОР: ', { b: true }), { b: true }));
  blocks.push(para(run(d.organizer || '', { u: true })));
  blocks.push(para(run('                      (указать полное название образовательной организации)', { sz: 12 }), { sz: 12 }));
  blocks.push(para([], { b: true }));

  const rows = [
    row('Тема', [para(run(d.theme || ''))]),
    row('Цель', [para(run(d.goal || ''))]),
    row('Дата и время\nпроведения', [para([run(`Мастер-класс «${d.title || ''}»`), br(), ...lines(datesLines(d.sessions || []))])]),
    row('Форма проведения\n(очно/дистанционно)', [para(run(d.form || 'очно'))]),
    row('Целевая аудитория', [para(run(d.audience || ''))]),
    row('Возраст участников', [para(run(d.age || ''))]),
    row('Краткая аннотация', [para([run(`Мастер-класс «${d.title || ''}». `, { b: true }), run(d.annotation || '')], { jc: 'both' })]),
    row('Сведения об авторе\n(ФИО, должность)', [para(run(d.author || ''), { jc: 'both' })]),
    row('Контактные данные организаторов\n(email, телефон)', [para(lines(String(d.contacts || '').split('\n')))]),
    row('Дополнительная информация\n(Ссылки на мероприятие в соц.сетях, сайтах)', [para(run(d.extra || '-'))]),
  ];
  blocks.push(`<w:tbl><w:tblPr><w:tblW w:w="9345" w:type="dxa"/><w:tblBorders>${B}</w:tblBorders><w:tblLayout w:type="fixed"/>` +
    `<w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="3114"/><w:gridCol w:w="6231"/></w:tblGrid>${rows.join('')}</w:tbl>`);
  blocks.push(para([], { jc: 'both' }));

  return buildDocx(blocks, {
    page: { w: 11906, h: 16838 },
    margins: { top: 567, right: 850, bottom: 567, left: 1701 },
    defaults: { font: FONT, size: 14, line: 240 },
  });
}
