// Справка о проведении мастер-классов для школы (письмо от школы ректору).
// Слева сверху — пустое место под фирменную шапку школы (у каждой своя),
// справа — адресат. Текст: период, возраст, часы каждого педагога, число детей.
import { buildDocx } from '../lib/docx-write.js';
import { xmlEsc } from '../lib/zip-write.js';

const FONT = 'Times New Roman';
const run = (t, { b = false } = {}) => `<w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:eastAsia="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>${b ? '<w:b/>' : ''}<w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r>`;
const tab = () => `<w:r><w:tab/></w:r>`;
function para(runs, { jc = null, firstLine = 0, left = 0, tabs = '' } = {}) {
  return `<w:p><w:pPr>${tabs}<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>` +
    `${left || firstLine ? `<w:ind w:left="${left}" w:firstLine="${firstLine}"/>` : ''}${jc ? `<w:jc w:val="${jc}"/>` : ''}` +
    `<w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:pPr>${[].concat(runs).join('')}</w:p>`;
}
const empty = (n = 1) => Array.from({ length: n }, () => para([]));
const NIL = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(k => `<w:${k} w:val="nil"/>`).join('');

export const hoursWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'часа' : 'часов');
export const peopleWord = (n) => { const a = n % 100, b = n % 10; return a > 10 && a < 20 ? 'человек' : b > 1 && b < 5 ? 'человека' : 'человек'; };

/**
 * @param {object} d {to:[строки адресата], greeting, school, period, ageFrom, ageTo, mtNo,
 *   teachers:[{name, hours}], children, pages, directorName, executor}
 */
export async function buildMkSchoolDocx(d) {
  const blocks = [];
  // шапка: слева — место под бланк школы, справа — адресат
  const left = `<w:tc><w:tcPr><w:tcW w:w="4560" w:type="dxa"/></w:tcPr>${para([])}</w:tc>`;
  const right = `<w:tc><w:tcPr><w:tcW w:w="4785" w:type="dxa"/></w:tcPr>${(d.to || []).map(t => para(run(t), { left: 900 })).join('') || para([])}</w:tc>`;
  blocks.push(`<w:tbl><w:tblPr><w:tblW w:w="9345" w:type="dxa"/><w:tblBorders>${NIL}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="4560"/><w:gridCol w:w="4785"/></w:tblGrid>` +
    `<w:tr><w:trPr><w:trHeight w:val="4250" w:hRule="atLeast"/></w:trPr>${left}${right}</w:tr></w:tbl>`);

  blocks.push(...empty(1));
  blocks.push(para(run(d.greeting || 'Уважаемый(ая) ______________!'), { jc: 'center' }));
  blocks.push(...empty(1));

  const ages = d.ageFrom && d.ageTo ? ` для обучающихся с ${d.ageFrom} до ${d.ageTo} лет` : ' для обучающихся';
  blocks.push(para(run(`${d.school || '«______»'} информирует вас о том, что ${d.period || '__.__.__–__.__.__'} на базе школы прошли мастер-классы по направлению деятельности мобильного технопарка «Кванториум-28»${ages}.`), { jc: 'both', firstLine: 708 }));
  blocks.push(para(run(`Мастер-классы были проведены следующими педагогами дополнительного образования МТ «Кванториум-28»${d.mtNo ? ' №' + d.mtNo : ''}:`), { jc: 'both', firstLine: 708 }));
  const list = (d.teachers || []).filter(t => t.name && Number(t.hours) > 0);
  list.forEach((t, i) => blocks.push(para(run(`${t.name} в количестве ${t.hours} ${hoursWord(Number(t.hours))}${i === list.length - 1 ? '.' : ';'}`), { firstLine: 708 })));
  const n = Number(d.children) || 0;
  blocks.push(para(run(`Общее количество детей, посетивших мастер-классы, составило ${n || '___'} ${n ? peopleWord(n) : 'человек'}.${d.pages ? ' Список детей прилагаем.' : ''}`), { jc: 'both', firstLine: 708 }));

  blocks.push(...empty(3));
  if (d.pages) blocks.push(para(run(`Приложение: на ${d.pages} л. в 1 экз.`)));
  blocks.push(...empty(4));
  // подпись: «Директор ____ И. О. Фамилия» с табуляцией к правому краю
  const tabs = '<w:tabs><w:tab w:val="left" w:pos="2835"/><w:tab w:val="right" w:pos="9345"/></w:tabs>';
  blocks.push(para([run('Директор'), tab(), run('_______________________'), tab(), run(d.directorName || '')], { tabs }));
  blocks.push(para([tab(), run('(подпись, печать организации)')], { tabs }));
  blocks.push(...empty(3));
  if (d.executor) blocks.push(para(run(`Исполнитель ${d.executor}`)));

  return buildDocx(blocks, {
    page: { w: 11906, h: 16838 },
    margins: { top: 1134, right: 850, bottom: 1134, left: 1701 },
    defaults: { font: FONT, size: 14, line: 240 },
  });
}
