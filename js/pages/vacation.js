// Расчёт отпускных: вкладка внутри «Зарплаты».
//
// Методика — ст. 139 ТК РФ и Постановление Правительства РФ № 922:
// среднедневной заработок = сумма зарплаты за 12 календарных месяцев,
// предшествующих месяцу начала отпуска, / (12 × 29,3), а для месяцев,
// отработанных не полностью, вместо 29,3 берётся 29,3/дней_в_месяце ×
// (дней_в_месяце − исключённых дней).
//
// Мы считаем это на «чистых» суммах (на руки, без ГПХ), которые вводит
// пользователь помесячно, а не на официальных суммах до вычета НДФЛ —
// поскольку НДФЛ обычно удерживается по одной и той же ставке 13% каждый
// месяц (включая сами отпускные), результат линейно совпадает с тем, что
// получится, если официально считать по зарплате до налога, а затем
// удержать 13% с отпускных: и то и другое — просто X × 0,87.
import { icon } from '../core/icons.js';
import { h, money0, toast, download, confirmBox, MONTHS, captureFocus, restoreFocus } from '../core/ui.js';
import { getState, update } from '../core/store.js';

const AVG_MONTH_DAYS = 29.3;

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** 12 календарных месяцев, предшествующих месяцу начала отпуска (от старого к новому). */
export function periodMonths(year, month) {
  const out = [];
  let y = year, m = month;
  for (let i = 0; i < 12; i++) {
    m--;
    if (m < 1) { m = 12; y--; }
    out.unshift({ year: y, month: m });
  }
  return out;
}

export const monthKey = (year, month) => `${year}-${month}`;

/**
 * @param {Array<{year, month, net, excludedDays}>} entries
 * @returns {{rows, totalSalary, totalDays, avgDaily}}
 */
export function calcAverageDaily(entries) {
  let totalSalary = 0;
  let totalDays = 0;
  const rows = entries.map(e => {
    const dim = daysInMonth(e.year, e.month);
    const excluded = Math.min(Math.max(Number(e.excludedDays) || 0, 0), dim);
    const full = excluded === 0;
    const calcDays = full ? AVG_MONTH_DAYS : (AVG_MONTH_DAYS / dim) * (dim - excluded);
    const net = Number(e.net) || 0;
    totalSalary += net;
    totalDays += calcDays;
    return { ...e, daysInMonth: dim, excluded, full, calcDays, net };
  });
  const avgDaily = totalDays > 0 ? totalSalary / totalDays : 0;
  return { rows, totalSalary, totalDays, avgDaily };
}

export const calcVacationPay = (avgDaily, vacationDays) => avgDaily * (Number(vacationDays) || 0);

export function render(root) {
  const wrap = h('div', {});
  root.append(wrap);

  function redraw() {
    const focusToken = captureFocus(wrap);
    const st = getState();
    const v = st.vacation;
    const period = periodMonths(v.startYear, v.startMonth);
    const entries = period.map(({ year, month }) => {
      const rec = v.months[monthKey(year, month)] || {};
      return { year, month, net: rec.net ?? '', excludedDays: rec.excludedDays ?? 0 };
    });
    const filled = entries.filter(e => e.net !== '' && e.net !== null);
    const calc = calcAverageDaily(entries.map(e => ({ ...e, net: e.net === '' ? 0 : e.net })));
    const payout = calcVacationPay(calc.avgDaily, v.vacationDays);

    wrap.innerHTML = '';

    wrap.append(h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'Отпускные'),
        h('p', {}, 'Средний дневной заработок и сумма отпускных по 12 месяцам, предшествующим началу отпуска.'))));

    wrap.append(h('div', { class: 'card-sub', style: { margin: '0 0 16px' } },
      'Средний дневной заработок считаем по официальной методике (Постановление №922: сумма зарплаты за 12 месяцев ÷ (12×29,3), ',
      'с поправкой на неполные месяцы) — но на суммах «на руки», которые вы вводите сами. Это математически даёт готовую сумму отпускных на руки: ',
      'НДФЛ 13% удерживается что с обычной зарплаты, что с отпускных по одной ставке, поэтому пересчёт линеен и его не нужно применять повторно.'));

    /* --- итоги --- */
    wrap.append(h('div', { class: 'grid cols-3', style: { marginBottom: '16px' } },
      h('div', { class: 'card' }, h('div', { class: 'stat' },
        h('div', { class: 'label' }, 'Среднедневной заработок'),
        h('div', { class: 'value' }, money0(calc.avgDaily)),
        h('div', { class: 'sub' }, `на руки · заполнено ${filled.length} из 12 мес.`))),
      h('div', { class: 'card' }, h('div', { class: 'stat' },
        h('div', { class: 'label' }, `Отпускные за ${v.vacationDays || 0} дн.`),
        h('div', { class: 'value cyan' }, money0(payout)),
        h('div', { class: 'sub' }, 'на руки, календарных дней'))),
      h('div', { class: 'card' }, h('div', { class: 'stat' },
        h('div', { class: 'label' }, 'Учтено расчётных дней'),
        h('div', { class: 'value plain' }, calc.totalDays.toFixed(2)),
        h('div', { class: 'sub' }, `сумма зарплаты за период: ${money0(calc.totalSalary)}`))),
    ));

    /* --- ввод периода --- */
    const yearInput = h('input', {
      type: 'number', value: v.startYear, style: { maxWidth: '110px' },
      onChange: (e) => { const y = parseInt(e.target.value, 10); if (isFinite(y)) { update(x => { x.vacation.startYear = y; }); redraw(); } },
    });
    const monthSel = h('select', {
      onChange: (e) => { update(x => { x.vacation.startMonth = parseInt(e.target.value, 10); }); redraw(); },
    }, ...MONTHS.map((n, i) => h('option', { value: i + 1, selected: v.startMonth === i + 1 }, n)));
    const daysInput = h('input', {
      type: 'text', inputmode: 'numeric', value: v.vacationDays,
      onInput: (e) => { const d = parseFloat(e.target.value); update(x => { x.vacation.vacationDays = isFinite(d) ? d : 0; }); redraw(); },
    });

    wrap.append(h('div', { class: 'grid cols-2', style: { marginBottom: '16px' } },
      h('div', { class: 'card' },
        h('h3', {}, 'Месяц начала отпуска'),
        h('div', { class: 'card-sub' }, 'Расчётный период — 12 календарных месяцев перед этим месяцем (таблица ниже подстроится).'),
        h('div', { class: 'row' },
          h('label', { class: 'field' }, h('span', {}, 'Год'), yearInput),
          h('label', { class: 'field' }, h('span', {}, 'Месяц'), monthSel),
          h('label', { class: 'field' }, h('span', {}, 'Дней отпуска'), daysInput),
        )),
      h('div', { class: 'card' },
        h('h3', {}, 'Быстрое заполнение'),
        h('div', { class: 'card-sub' }, 'Подставит суммы «1 ставка на руки» из сохранённых расчётов зарплаты (вкладка «Расчёт по месяцам») для месяцев, которые совпадают по году и месяцу.'),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          h('button', { class: 'btn sm', onClick: () => fillFromHistory(period, redraw) }, icon('zap', 16), 'Заполнить из истории зарплаты'),
          h('button', { class: 'btn sm danger ghost', onClick: () => confirmBox('Очистить все 12 введённых сумм?', () => { update(x => { x.vacation.months = {}; }); redraw(); }) }, 'Очистить месяцы'),
        )),
    ));

    /* --- таблица 12 месяцев --- */
    wrap.append(h('div', { class: 'card', style: { marginBottom: '16px' } },
      h('h3', {}, 'Зарплата за расчётный период (на руки, без ГПХ)'),
      h('div', { class: 'table-wrap' },
        h('table', { class: 'compact' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Месяц'), h('th', { class: 'num' }, 'Зарплата на руки, ₽'),
            h('th', { class: 'num' }, 'Искл. дней'), h('th', { class: 'num' }, 'Расчётных дней'))),
          h('tbody', {}, ...calc.rows.map((row, i) => h('tr', {},
            h('td', {}, `${MONTHS[row.month - 1]} ${row.year}`),
            h('td', { class: 'num' }, h('input', {
              type: 'text', inputmode: 'decimal', value: entries[i].net,
              placeholder: '0', style: { textAlign: 'right', width: '130px' },
              onInput: (e) => {
                const raw = e.target.value.replace(',', '.');
                const v = parseFloat(raw);
                setMonth(row.year, row.month, { net: raw === '' ? undefined : (isFinite(v) ? v : entries[i].net) });
                redraw();
              },
            })),
            h('td', { class: 'num' }, h('input', {
              type: 'text', inputmode: 'numeric', value: row.excluded || '',
              placeholder: '0', title: 'Дни отпуска, больничного, командировки или неоплачиваемого отпуска в этом месяце — они не считаются полными',
              style: { textAlign: 'right', width: '80px' },
              onInput: (e) => { setMonth(row.year, row.month, { excludedDays: e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0 }); redraw(); },
            })),
            h('td', { class: 'num mono' }, row.calcDays.toFixed(2)),
          ))),
          h('tfoot', {}, h('tr', {},
            h('td', {}, h('b', {}, 'Итого')),
            h('td', { class: 'num mono' }, h('b', {}, money0(calc.totalSalary))),
            h('td', {}, ''),
            h('td', { class: 'num mono' }, h('b', {}, calc.totalDays.toFixed(2))),
          )))),
      h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '10px', marginBottom: 0 } },
        '«Искл. дней» — календарные дни, когда вы уже были в отпуске, на больничном, в командировке с сохранением среднего заработка или в неоплачиваемом отпуске. За такой месяц вписывайте зарплату только за фактически отработанную часть.'),
    ));

    /* --- действия --- */
    wrap.append(h('div', { style: { display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' } },
      h('button', { class: 'btn primary', onClick: () => { saveHistory(v, calc, payout); redraw(); } }, icon('save', 16), 'Сохранить расчёт'),
      h('button', { class: 'btn', onClick: () => exportCsv(v, calc, payout) }, icon('download', 16), 'CSV'),
    ));

    /* --- история --- */
    if (v.history?.length) wrap.append(historyCard(redraw));

    restoreFocus(wrap, focusToken);
  }

  function setMonth(year, month, patch) {
    update(x => {
      const key = monthKey(year, month);
      x.vacation.months[key] = { ...(x.vacation.months[key] || {}), ...patch };
    });
  }

  redraw();
}

function fillFromHistory(period, redraw) {
  const st = getState();
  const salaryHist = st.salary.history || [];
  let n = 0;
  update(x => {
    for (const { year, month } of period) {
      const rec = salaryHist.find(h => h.year === year && h.month === month);
      if (!rec) continue;
      const key = monthKey(year, month);
      const patch = { net: Math.round(rec.net * 100) / 100 };
      if (rec.factDays != null) patch.excludedDays = Math.max(0, Math.round((1 - rec.factDays / rec.workDays) * daysInMonth(year, month)));
      x.vacation.months[key] = { ...(x.vacation.months[key] || {}), ...patch };
      n++;
    }
  });
  toast(n ? `Заполнено месяцев: ${n} из 12` : 'В истории расчётов зарплаты нет подходящих месяцев — заполните вручную или сохраните расчёты за нужные месяцы на вкладке «Расчёт по месяцам»', n ? 'ok' : 'err');
  redraw();
}

function saveHistory(v, calc, payout) {
  update(x => {
    x.vacation.history.unshift({
      id: Date.now(), startYear: v.startYear, startMonth: v.startMonth,
      vacationDays: v.vacationDays, avgDaily: calc.avgDaily, payout,
      filledMonths: calc.rows.filter(r => r.net > 0).length,
    });
    x.vacation.history = x.vacation.history.slice(0, 24);
  });
  toast('Расчёт отпускных сохранён');
}

function exportCsv(v, calc, payout) {
  const rows = [['Месяц', 'Зарплата на руки, ₽', 'Искл. дней', 'Расчётных дней']];
  for (const r of calc.rows) rows.push([`${MONTHS[r.month - 1]} ${r.year}`, String(r.net).replace('.', ','), r.excluded, r.calcDays.toFixed(2).replace('.', ',')]);
  rows.push(['Итого', String(Math.round(calc.totalSalary * 100) / 100).replace('.', ','), '', calc.totalDays.toFixed(2).replace('.', ',')]);
  rows.push(['Среднедневной заработок', String(Math.round(calc.avgDaily * 100) / 100).replace('.', ','), '', '']);
  rows.push([`Отпускные за ${v.vacationDays} дн.`, String(Math.round(payout * 100) / 100).replace('.', ','), '', '']);
  download(`Отпускные_${MONTHS[v.startMonth - 1]}_${v.startYear}.csv`,
    '﻿' + rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}

function historyCard(redraw) {
  const v = getState().vacation;
  return h('div', { class: 'card' },
    h('h3', {}, 'Сохранённые расчёты отпускных'),
    h('div', { class: 'table-wrap', style: { maxHeight: '320px' } },
      h('table', { class: 'compact' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Начало отпуска'), h('th', { class: 'num' }, 'Дней'),
          h('th', { class: 'num' }, 'Ср. дневной'), h('th', { class: 'num' }, 'Отпускные'),
          h('th', { class: 'num' }, 'Заполнено мес.'), h('th', {}, ''))),
        h('tbody', {}, ...v.history.map(it => h('tr', {},
          h('td', {}, `${MONTHS[it.startMonth - 1]} ${it.startYear}`),
          h('td', { class: 'num' }, it.vacationDays),
          h('td', { class: 'num t-right mono' }, money0(it.avgDaily)),
          h('td', { class: 'num t-right mono neon-text' }, money0(it.payout)),
          h('td', { class: 'num' }, `${it.filledMonths}/12`),
          h('td', {}, h('button', {
            class: 'btn sm danger ghost',
            onClick: () => { update(x => { x.vacation.history = x.vacation.history.filter(z => z.id !== it.id); }); redraw(); }
          }, '×')),
        ))))));
}
