// Печатная копия расчётного листка «как оригинал»: строится как обычная HTML-
// разметка (не docx), скрытая на экране (.print-only) и показывается только
// в @media print (см. css/style.css) — тот же приём, что и печать ведомости.
// Даёт куда более точное совпадение со шрифтом/линиями/расположением реального
// листка, чем генерация .docx через сырой OOXML.
import { h, MONTHS } from '../core/ui.js';
import { applyBonus } from '../pages/salary.js';

const SHORT_MONTHS = ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const HOURS_PER_DAY = 3.6;

const money2 = (n) => (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num2 = (n) => (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// «Часы» в сыром столбце показаны без принудительных нулей (18, но 10,8) — как в оригинале;
// с двумя знаками они появляются только в столбце «Оплачено» (18,00 чс. / 10,80 чс.).
const nat = (n) => (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

/** @param {object} entry запись из salary.history · @param {object} requisites salary.requisites */
export function payslipPrintNode(entry, requisites) {
  const bonus = entry.bonus || { amount: 0, note: '' };
  const calc = applyBonus(entry.calc, bonus, entry.params.ndfl);
  // calc.current — расчёт по ставке, на которой педагог реально оформлен
  // (params.rate); у старых записей без этого поля равносильно «1 ставка».
  const one = calc.current || calc.one;
  const period = `${SHORT_MONTHS[entry.month - 1]} ${entry.year}`;
  const days = one.partial ? one.fact : one.norm;
  const hours = days * HOURS_PER_DAY;
  const ndfl = one.gross - one.net;

  // Пары строк левого (начисления) и правого (удержания/выплата) блоков —
  // ровно тот порядок и состав, что в реальном листке организации.
  const left = [
    ['Оплата по окладу (по часам)', period, String(days), nat(hours), `${num2(hours)} чс.`, money2(one.oklad)],
    ['Районный коэффициент', period, '', '', `${num2(days)} дн.`, money2(one.district)],
    ['Северная надбавка', period, '', '', `${num2(days)} дн.`, money2(one.north)],
    ['Надбавка за качество работы', period, '', '', `${num2(days)} дн.`, money2(one.quality)],
    ['Доплата за интенсивность и высокие результаты', period, '', '', `${num2(days)} дн.`, money2(one.intensive)],
  ];
  if (one.rvSum > 0) left.push(['Сумма по РВ (рабочие выходные)', period, '', '', `${num2(entry.params.rv)} дн.`, money2(one.rvSum)]);
  if (bonus.amount > 0) left.push([bonus.note ? `Премия (${bonus.note})` : 'Премия', period, '', '', '', money2(bonus.amount)]);

  const right = [
    ['b:Удержано:', '', 'b:' + money2(ndfl)],
    ['НДФЛ', period, money2(ndfl)],
    ['b:Выплачено:', '', 'b:' + money2(one.net)],
    [`Зарплата за ${period}`, period, money2(one.net)],
  ];
  // Первая строка тела — итоги «Начислено:/Удержано:», выравненные по высоте с первой строкой левого блока.
  const rowsCount = Math.max(left.length, right.length - 1) + 1;

  const th = (text, opts = {}) => h('th', opts, text);
  const cellText = (v) => typeof v === 'string' && v.startsWith('b:') ? h('b', {}, v.slice(2)) : v;
  const td = (v, opts = {}) => h('td', opts, cellText(v));

  const bodyRows = [];
  for (let i = 0; i < rowsCount; i++) {
    const l = i === 0 ? ['b:Начислено:', '', '', '', '', 'b:' + money2(one.gross)] : left[i - 1];
    const r = right[i] || ['', '', ''];
    bodyRows.push(h('tr', {},
      td(l ? l[0] : '', { class: l && l[0].startsWith('b:') ? 'b' : '' }),
      td(l ? l[1] : ''),
      td(l ? l[2] : '', { class: 'c' }),
      td(l ? l[3] : '', { class: 'c' }),
      td(l ? l[4] : '', { class: 'r' }),
      td(l ? l[5] : '', { class: 'r' + (l && l[0].startsWith('b:') ? ' b' : '') }),
      td(r[0], { class: r[0].startsWith('b:') ? 'b' : '' }),
      td(r[1]),
      td(r[2], { class: 'r' + (r[0].startsWith('b:') ? ' b' : '') }),
    ));
  }

  const table = h('table', { class: 'ps-table' },
    h('thead', {},
      h('tr', {},
        th('Вид', { rowspan: 2 }), th('Период', { rowspan: 2 }), th('Рабочие', { colspan: 2 }),
        th('Оплачено', { rowspan: 2, class: 'r' }), th('Сумма', { rowspan: 2, class: 'r' }),
        th('Вид', { rowspan: 2 }), th('Период', { rowspan: 2 }), th('Сумма', { rowspan: 2, class: 'r' })),
      h('tr', {}, th('Дни', { class: 'c' }), th('Часы', { class: 'c' }))),
    h('tbody', {}, ...bodyRows));

  return h('div', { class: 'print-only payslip-print' },
    h('p', { class: 'ps-org' }, `Организация: ${requisites.org || ''}`),
    h('p', { class: 'ps-title' }, `РАСЧЕТНЫЙ ЛИСТОК ЗА ${MONTHS[entry.month - 1].toUpperCase()} ${entry.year}`),
    h('table', { class: 'ps-head' },
      h('tr', {},
        h('td', { class: 'b', colspan: 2 }, `${requisites.fio || ''}${requisites.tabNo ? ` (${requisites.tabNo})` : ''}`),
        h('td', { class: 'lbl b' }, 'К выплате:'), h('td', { class: 'r b' }, money2(one.net))),
      h('tr', {},
        h('td', { colspan: 2 }, `Организация: ${requisites.org || ''}`),
        h('td', { class: 'lbl' }, 'Должность:'), h('td', {}, requisites.position || '')),
      h('tr', {},
        h('td', { colspan: 2 }, `Подразделение: ${requisites.unit || ''}`),
        h('td', { class: 'lbl' }, 'Оклад (тариф):'), h('td', {}, money2(entry.params.base)))),
    table,
    h('table', { class: 'ps-foot' },
      h('tr', {},
        h('td', {}, 'Долг предприятия на начало'), h('td', { class: 'r' }, '0,00'),
        h('td', { class: 'lbl' }, 'Долг предприятия на конец'), h('td', { class: 'r' }, '0,00'))),
    h('p', { class: 'ps-disclaimer' },
      'Документ сформирован инструментом педагога Кванториум-28 по вашим сохранённым данным — не является официальным бухгалтерским документом.'));
}
