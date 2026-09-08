// Расчётный листок за месяц по мотивам официальной формы организации
// (см. пример в чате): шапка с ФИО/должностью/окладом, таблица начислений
// слева и удержаний/выплат справа, итог. Строится из сохранённой записи
// «Истории зарплат» — того, что реально стояло в калькуляторе на момент
// сохранения (params) и что из этого посчиталось (calc.current — по ставке,
// на которой педагог официально оформлен; ГПХ в официальный листок не
// входит, это отдельный договор).
import { buildDocx, p, table } from '../lib/docx-write.js';
import { MONTHS } from '../core/ui.js';
import { applyBonus } from '../pages/salary.js';

const HOURS_PER_DAY = 3.6; // норма при 18-часовой учебной неделе (5 дней)
// Сокращения месяцев как в реальном листке: короткие названия (март, май, июнь,
// июль) не сокращаются, остальные — с точкой.
const SHORT_MONTHS = ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const fmt = (n) => (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt1 = (n) => (Math.round((n + Number.EPSILON) * 10) / 10).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * @param {object} entry запись из salary.history (year, month, params, calc)
 * @param {object} requisites salary.requisites
 */
export async function buildPayslipDocx(entry, requisites) {
  const bonus = entry.bonus || { amount: 0, note: '' };
  const calc = applyBonus(entry.calc, bonus, entry.params.ndfl);
  // calc.current — расчёт по ставке, на которой педагог реально оформлен
  // (params.rate); у старых записей без этого поля равносильно «1 ставка».
  const one = calc.current || calc.one;
  const period = `${SHORT_MONTHS[entry.month - 1]} ${entry.year}`;
  const days = one.partial ? one.fact : one.norm;
  const hours = days * HOURS_PER_DAY;
  const ndfl = one.gross - one.net;

  const blocks = [];
  blocks.push(p(`Организация: ${requisites.org || ''}`, { bold: true, size: 12, spacingAfter: 8 }));
  blocks.push(p(`РАСЧЕТНЫЙ ЛИСТОК ЗА ${MONTHS[entry.month - 1].toUpperCase()} ${entry.year}`, { size: 12, spacingAfter: 4 }));

  const w = [30, 20, 8, 8, 12, 22];
  const head = table(w, [
    [
      { text: `${requisites.fio || ''}${requisites.tabNo ? ` (${requisites.tabNo})` : ''}`, span: 4, bold: true },
      { text: 'К выплате:', span: 1 },
      { text: fmt(one.net), align: 'right', bold: true },
    ],
    [
      { text: `Организация: ${requisites.org || ''}`, span: 4 },
      { text: 'Должность:', span: 1 },
      { text: requisites.position || '' },
    ],
    [
      { text: `Подразделение: ${requisites.unit || ''}`, span: 4 },
      { text: 'Оклад (тариф):', span: 1 },
      { text: fmt(entry.params.base) },
    ],
  ]);
  blocks.push(head, p('', { size: 4, spacingAfter: 4 }));

  const c = (text, opts = {}) => ({ text, ...opts });
  const rows = [
    [c('Вид', { bold: true }), c('Период', { bold: true }), c('Дни', { bold: true, align: 'center' }),
      c('Часы', { bold: true, align: 'center' }), c('Сумма', { bold: true, align: 'right' }),
      c('Вид / Период / Сумма', { bold: true })],
    [c('Начислено:', { bold: true }), '', '', '', c(fmt(one.gross), { align: 'right', bold: true }),
      c(`Удержано:  ${fmt(ndfl)}`, { bold: true })],
    [c('Оплата по окладу (по часам)'), c(period), c(String(days)), c(fmt1(hours), { align: 'center' }),
      c(fmt(one.oklad), { align: 'right' }), c(`НДФЛ  ${period}  ${fmt(ndfl)}`)],
    [c('Районный коэффициент'), c(period), '', c(`${days} дн.`, { align: 'center' }),
      c(fmt(one.district), { align: 'right' }), c('Выплачено:', { bold: true })],
    [c('Северная надбавка'), c(period), '', c(`${days} дн.`, { align: 'center' }),
      c(fmt(one.north), { align: 'right' }), c(fmt(one.net), { align: 'right', bold: true })],
    [c('Надбавка за качество работы'), c(period), '', c(`${days} дн.`, { align: 'center' }),
      c(fmt(one.quality), { align: 'right' }), c(`Зарплата за ${period}`, {})],
    [c('Доплата за интенсивность и высокие результаты'), c(period), '', c(`${days} дн.`, { align: 'center' }),
      c(fmt(one.intensive), { align: 'right' }), c(fmt(one.net), { align: 'right' })],
  ];
  if (one.rvSum > 0) {
    rows.push([c('Сумма по РВ (рабочие выходные)'), c(period), '', c(`${entry.params.rv} дн.`, { align: 'center' }),
      c(fmt(one.rvSum), { align: 'right' }), '']);
  }
  if (bonus.amount > 0) {
    rows.push([c(bonus.note ? `Премия (${bonus.note})` : 'Премия'), c(period), '', '',
      c(fmt(bonus.amount), { align: 'right' }), '']);
  }
  blocks.push(table(w, rows), p('', { size: 4, spacingAfter: 6 }));

  blocks.push(p(`Долг предприятия на начало: 0,00`, { size: 11 }));
  blocks.push(p(`Долг предприятия на конец: 0,00`, { size: 11, spacingAfter: 10 }));
  blocks.push(p(one.partial
    ? `Неполный месяц: отработано ${one.fact} из ${one.norm} рабочих дней. Оклад и обе надбавки урезаны пропорционально, районный коэффициент и северная надбавка — 30% от их суммы.`
    : `Полный отработанный месяц — ${one.norm} рабочих дней.`, { size: 9, italic: true }));
  blocks.push(p('Документ сформирован автоматически инструментом педагога Кванториум-28 на основе введённых данных — не является официальным бухгалтерским документом.',
    { size: 9, italic: true, spacingBefore: 4 }));

  return buildDocx(blocks);
}
