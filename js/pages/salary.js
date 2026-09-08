// Калькулятор заработной платы: ставка + ГПХ, сравнение с 1,5 ставки.
import { h, money, money0, toast, statCard, download, MONTHS, captureFocus, restoreFocus } from '../core/ui.js';
import { getState, update } from '../core/store.js';
import { WORK_DAYS, YEARS, workDays, yearTotal, isPreliminary } from '../data/calendar.js';
import * as vacation from './vacation.js';
import * as salaryHistoryPage from './salary-history.js';

/**
 * Расчёт одной ставки по модели из рабочей таблицы.
 * Если p.factDays меньше нормы (p.workDays) — оклад, доплата за интенсив и
 * надбавка за качество пропорционально урезаются (неполный месяц: отпуск,
 * больничный и т.п.). Формула проверена по реальному расчётному листку:
 * «Оплата по окладу» = оклад × факт.дни / норма.дней, остальные надбавки —
 * так же, районный коэффициент и северная надбавка — 30% от их суммы.
 * Цена дня для РВ всегда считается от полной месячной суммы и полной нормы —
 * работа в выходной оплачивается по цене обычного полного дня.
 */
export function calcRate(p, rate) {
  const oklad = p.base * rate;
  const norm = p.workDays > 0 ? p.workDays : 0;
  const fixed = oklad + p.intensive + p.quality;
  const dayCost = norm > 0 ? fixed / norm : 0;
  const rvPrice = dayCost * 2;
  const rvSum = p.rv * rvPrice;

  const hasFact = p.factDays !== null && p.factDays !== undefined && p.factDays !== '';
  const fact = hasFact ? Math.max(0, Math.min(Number(p.factDays), norm)) : norm;
  const partial = norm > 0 && fact < norm;
  const ratio = norm > 0 ? fact / norm : 1;

  const okladPaid = partial ? oklad * ratio : oklad;
  const quality = partial ? p.quality * ratio : p.quality;
  const intensive = partial ? p.intensive * ratio : p.intensive;

  const baseForCoef = okladPaid + quality + intensive + rvSum;
  const district = baseForCoef * (p.district / 100);
  const north = baseForCoef * (p.north / 100);
  const gross = okladPaid + rvSum + intensive + district + north + quality;
  const net = gross * (1 - p.ndfl / 100);

  // Стоимость ОДНОГО дополнительного РВ «под ключ»: сам день по двойной ставке
  // плюс районный коэффициент и северная надбавка, которые он же увеличивает.
  const rvMarginalGross = rvPrice * (1 + p.district / 100 + p.north / 100);
  const rvMarginalNet = rvMarginalGross * (1 - p.ndfl / 100);

  return { rate, oklad: okladPaid, quality, intensive, dayCost, rvPrice, rvSum, district, north, gross, net, partial, fact, norm, rvMarginalGross, rvMarginalNet };
}

/** Подписи ставок — переиспользуются везде, где нужно показать выбранный формат. */
export const RATE_LABELS = { 0.5: '0,5 ставки', 1: '1 ставка', 1.5: '1,5 ставки' };

/**
 * @param {object} p параметры расчёта; p.rate (0.5/1/1.5) — на какой ставке
 * педагог официально оформлен, p.hasGph — есть ли вдобавок договор ГПХ.
 * Раньше формат был жёстко «1 ставка + ГПХ» — теперь оба параметра берутся
 * из настроек, а старые сохранённые расчёты без них ведут себя как раньше
 * (rate по умолчанию 1, ГПХ по умолчанию учтён).
 */
export function calcAll(p) {
  const half = calcRate(p, 0.5);
  const one = calcRate(p, 1);
  const oneHalf = calcRate(p, 1.5);
  const gphNet = p.gph * (1 - p.ndfl / 100);
  const rate = [0.5, 1, 1.5].includes(p.rate) ? p.rate : 1;
  const hasGph = p.hasGph !== false;
  const byRate = { 0.5: half, 1: one, 1.5: oneHalf };
  const current = byRate[rate];
  const withGph = current.net + (hasGph ? gphNet : 0);
  return { half, one, oneHalf, gphNet, rate, hasGph, current, withGph, benefit: withGph - oneHalf.net };
}

/** Значения ещё из исходного файла-примера (до сверки с реальным расчётным листком). */
const isStaleConstants = (s) => s.intensive === 10650 && s.quality === 115;

const ROWS = [
  ['Оклад', 'oklad'],
  ['Стоимость дня', 'dayCost'],
  ['Цена одного РВ', 'rvPrice'],
  ['Сумма по РВ', 'rvSum'],
  ['Доплата за интенсив', 'intensive'],
  ['Районный коэффициент', 'district'],
  ['Северная надбавка', 'north'],
  ['Надбавка за качество', 'quality'],
];

/** «Сравнение форматов работы»: переиспользуется на вкладке расчёта и в истории зарплат. */
export function comparisonCard(r, p) {
  const rate = r.rate ?? 1;
  const hasGph = r.hasGph !== false;
  const rateLabel = RATE_LABELS[rate] || RATE_LABELS[1];
  const formatLabel = rateLabel + (hasGph ? ' + ГПХ' : '');
  const atMax = rate === 1.5 && !hasGph; // уже на максимуме — сравнивать не с чем
  return h('div', { class: 'card', style: { marginBottom: '16px' } },
    h('h3', {}, 'Сравнение форматов работы'),
    h('div', { class: 'grid cols-2' },
      h('div', {},
        h('div', { class: 'pill ok', style: { marginBottom: '10px' } }, `Текущий формат: ${formatLabel}`),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, `${rateLabel}, к начислению`), h('span', { class: 'v' }, money(r.current.gross))),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, `${rateLabel}, на руки`), h('span', { class: 'v' }, money(r.current.net))),
        hasGph ? h('div', { class: 'kv' }, h('span', { class: 'k' }, `ГПХ начислено`), h('span', { class: 'v' }, money(p.gph))) : null,
        hasGph ? h('div', { class: 'kv' }, h('span', { class: 'k' }, `ГПХ после НДФЛ (${p.ndfl}%)`), h('span', { class: 'v' }, money(r.gphNet))) : null,
        h('div', { class: 'kv total' }, h('span', { class: 'k' }, 'Итого на руки'), h('span', { class: 'v' }, money(r.withGph))),
      ),
      h('div', {},
        h('div', { class: 'pill cyan', style: { marginBottom: '10px' } }, 'Альтернатива: 1,5 ставки официально'),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Оклад 1,5 ставки'), h('span', { class: 'v' }, money(r.oneHalf.oklad))),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'К начислению без НДФЛ'), h('span', { class: 'v' }, money(r.oneHalf.gross))),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, `НДФЛ ${p.ndfl}%`), h('span', { class: 'v' }, '− ' + money(r.oneHalf.gross - r.oneHalf.net))),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'ГПХ'), h('span', { class: 'v muted' }, '—')),
        h('div', { class: 'kv total' }, h('span', { class: 'k' }, 'Итого на руки'), h('span', { class: 'v' }, money(r.oneHalf.net))),
      ),
    ),
    h('hr', { class: 'sep' }),
    atMax
      ? h('p', { class: 'muted', style: { margin: 0, fontSize: '14px' } }, 'Вы уже на максимальной официальной ставке без ГПХ — сравнивать не с чем.')
      : h('p', { style: { margin: 0, fontSize: '14px' } },
          r.benefit >= 0
            ? ['Формат ', h('b', { class: 'neon-text' }, formatLabel), ' выгоднее 1,5 ставки на ', h('b', { class: 'neon-text' }, money(r.benefit)), ' в месяц — это ', h('b', {}, money(r.benefit * 12)), ' за год.']
            : ['Формат ', h('b', {}, '1,5 ставки'), ' выгоднее на ', h('b', { class: 'neon-text' }, money(-r.benefit)), ' в месяц (', money(-r.benefit * 12), ' за год).']),
  );
}

/**
 * Накладывает разовую премию (не входит в формулу — матпомощь, премия к празднику
 * и т.п.) поверх уже посчитанного calcAll(): прибавляется к начислению каждой
 * ставки, облагается тем же НДФЛ, что и остальная зарплата. Не трогает сами
 * params/calc в состоянии — используется только для отображения и выгрузки.
 */
export function applyBonus(calc, bonus, ndfl) {
  const amount = Number(bonus?.amount) || 0;
  if (!amount) return calc;
  const addNet = amount * (1 - ndfl / 100);
  const bump = (r) => ({ ...r, gross: r.gross + amount, net: r.net + addNet });
  const half = bump(calc.half), one = bump(calc.one), oneHalf = bump(calc.oneHalf);
  const rate = calc.rate ?? 1;
  const hasGph = calc.hasGph !== false;
  const byRate = { 0.5: half, 1: one, 1.5: oneHalf };
  const current = byRate[rate];
  const withGph = current.net + (hasGph ? calc.gphNet : 0);
  return { ...calc, half, one, oneHalf, rate, hasGph, current, withGph, benefit: withGph - oneHalf.net };
}

/** «Детализация по ставкам»: переиспользуется на вкладке расчёта и в истории зарплат. */
export function detailTableCard(r, p) {
  const rate = r.rate ?? 1;
  const hasGph = r.hasGph !== false;
  const cell = (v) => h('td', { class: 'num t-right mono' }, money(v));
  const hcell = (label, val) => h('th', { class: 'num' + (rate === val ? ' active-rate' : '') }, label);
  const gphCell = (val) => (rate === val && hasGph)
    ? h('td', { class: 'num t-right mono neon-text' }, money(r.withGph))
    : h('td', { class: 'num t-right mono muted' }, '—');
  return h('div', { class: 'card', style: { marginBottom: '16px' } },
    h('h3', {}, 'Детализация по ставкам'),
    h('div', { class: 'table-wrap' },
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { class: 'sticky-col' }, 'Показатель'),
          hcell('0,5 ставки', 0.5), hcell('1 ставка', 1), hcell('1,5 ставки', 1.5))),
        h('tbody', {},
          ...ROWS.map(([label, key]) => h('tr', {},
            h('td', { class: 'sticky-col' }, label),
            cell(key in r.half ? r.half[key] : p[key]),
            cell(key in r.one ? r.one[key] : p[key]),
            cell(key in r.oneHalf ? r.oneHalf[key] : p[key]),
          )),
          h('tr', {}, h('td', { class: 'sticky-col' }, h('b', {}, 'Итого к начислению без НДФЛ')),
            cell(r.half.gross), cell(r.one.gross), cell(r.oneHalf.gross)),
          h('tr', {}, h('td', { class: 'sticky-col' }, h('b', { class: 'neon-text' }, 'Итого к получению')),
            cell(r.half.net), cell(r.one.net), cell(r.oneHalf.net)),
          h('tr', {}, h('td', { class: 'sticky-col' }, h('b', {}, 'С ГПХ на руки')),
            gphCell(0.5), gphCell(1), gphCell(1.5)),
        ))));
}

export function render(root) {
  const tabsBar = h('div', { class: 'tabs no-print', style: { marginBottom: '18px' } });
  const body = h('div', {});
  root.append(tabsBar, body);

  function mount() {
    const cur = getState().ui.salaryTab;
    const tab = cur === 'vacation' ? 'vacation' : cur === 'history' ? 'history' : 'calc';
    tabsBar.innerHTML = '';
    tabsBar.append(
      h('button', {
        class: 'tab' + (tab === 'calc' ? ' active' : ''),
        onClick: () => { update(x => { x.ui.salaryTab = 'calc'; }); mount(); },
      }, 'Расчёт по месяцам'),
      h('button', {
        class: 'tab' + (tab === 'history' ? ' active' : ''),
        onClick: () => { update(x => { x.ui.salaryTab = 'history'; }); mount(); },
      }, '📜 История зарплат'),
      h('button', {
        class: 'tab' + (tab === 'vacation' ? ' active' : ''),
        onClick: () => { update(x => { x.ui.salaryTab = 'vacation'; }); mount(); },
      }, '🏖 Отпускные'),
    );
    body.innerHTML = '';
    if (tab === 'vacation') vacation.render(body);
    else if (tab === 'history') salaryHistoryPage.render(body);
    else renderCalcTab(body);
  }

  mount();
}

function renderCalcTab(root) {
  const st = getState();
  const s = st.salary;

  // type=text вместо number: у number браузер обнуляет .value на «промежуточных»
  // значениях вроде «18000.» (до ввода цифр после точки) — при перерисовке на
  // каждое нажатие клавиши это стирало бы вводимое число.
  const field = (label, key, opts = {}) => h('label', { class: 'field' },
    h('span', {}, label),
    h('input', {
      type: 'text', inputmode: opts.step === 1 ? 'numeric' : 'decimal', value: s[key],
      onInput: (e) => { const v = parseFloat(e.target.value.replace(',', '.')); update(x => { x.salary[key] = isFinite(v) ? v : 0; }); redraw(); },
    }));

  const wrap = h('div', {});
  root.append(wrap);

  function redraw() {
    const focusToken = captureFocus(wrap);
    const st = getState(); const s = st.salary;
    const autoDays = workDays(s.year, s.month, s.calendarOverrides);
    if (autoDays && s.workDays !== autoDays && s.autoDays !== false) { /* значение подставляется кнопкой */ }
    const p = {
      base: s.base, intensive: s.intensive, quality: s.quality, gph: s.gph,
      ndfl: s.ndfl, district: s.district, north: s.north,
      workDays: s.workDays, rv: s.rv,
      factDays: s.partialMonth ? s.factDays : null,
      rate: s.rate, hasGph: s.hasGph,
    };
    const r = calcAll(p);
    const partial = r.current.partial;
    const rateLabel = RATE_LABELS[r.rate] || RATE_LABELS[1];
    const formatLabel = rateLabel + (r.hasGph ? ' + ГПХ' : '');
    wrap.innerHTML = '';

    wrap.append(h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'Калькулятор зарплаты'),
        h('p', {}, `${MONTHS[s.month - 1]} ${s.year} · норма ${autoDays ?? '—'} раб. дн. · введено ${s.workDays} дн., РВ — ${s.rv}` +
          (partial ? ` · неполный месяц: отработано ${r.current.fact} из ${r.current.norm} дн.` : ''))),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn', onClick: () => saveHistory(r) }, '💾 Сохранить расчёт'),
        h('button', { class: 'btn', onClick: () => exportCsv(r, s) }, '⤓ CSV'),
      )));

    /* --- формат работы --- */
    wrap.append(h('div', { class: 'card', style: { marginBottom: '16px' } },
      h('h3', {}, 'Формат работы'),
      h('div', { class: 'card-sub' }, 'На какой ставке вы официально оформлены и есть ли договор ГПХ — от этого зависят все расчёты, расчётный листок и отпускные.'),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' } },
        ...[0.5, 1, 1.5].map(v => h('label', { class: 'check-pill' },
          h('input', {
            type: 'radio', name: 'salaryRate', style: { width: 'auto', margin: 0 }, checked: s.rate === v,
            onChange: () => { update(x => { x.salary.rate = v; }); redraw(); },
          }),
          h('span', {}, RATE_LABELS[v])))),
      h('label', { class: 'check-pill' },
        h('input', {
          type: 'checkbox', checked: !!s.hasGph, style: { width: 'auto', margin: 0 },
          onChange: (e) => { update(x => { x.salary.hasGph = e.target.checked; }); redraw(); },
        }),
        h('span', {}, 'Также работаю по договору ГПХ (гражданско-правовому)')),
    ));

    /* --- итоговые плитки --- */
    wrap.append(h('div', { class: 'grid cols-4', style: { marginBottom: '16px' } },
      statCard(`${formatLabel} · на руки`, money0(r.withGph), 'ваш текущий формат', ''),
      statCard('1,5 ставки · на руки', money0(r.oneHalf.net), 'полностью официально', 'cyan'),
      statCard(r.benefit >= 0 ? 'Выгода текущего формата' : 'Проигрыш текущего формата',
        (r.benefit >= 0 ? '+' : '−') + money0(Math.abs(r.benefit)),
        `${(Math.abs(r.benefit) / (r.oneHalf.net || 1) * 100).toFixed(1)}% от 1,5 ставки`,
        r.benefit >= 0 ? '' : 'magenta'),
      statCard(`${rateLabel} без НДФЛ`, money0(r.current.gross), `на руки ${money0(r.current.net)}`, 'plain'),
      statCard('Стоимость одного РВ', '+' + money0(r.current.rvMarginalNet),
        `на руки · до НДФЛ +${money0(r.current.rvMarginalGross)}`, 'amber'),
    ));

    /* --- ввод --- */
    const monthSel = h('select', {
      onChange: (e) => {
        const m = parseInt(e.target.value, 10);
        update(x => { x.salary.month = m; const d = workDays(x.salary.year, m, x.salary.calendarOverrides); if (d) x.salary.workDays = d; });
        redraw();
      }
    }, ...MONTHS.map((n, i) => h('option', { value: i + 1, selected: s.month === i + 1 }, n)));

    const yearSel = h('select', {
      onChange: (e) => {
        const y = parseInt(e.target.value, 10);
        update(x => { x.salary.year = y; const d = workDays(y, x.salary.month, x.salary.calendarOverrides); if (d) x.salary.workDays = d; });
        redraw();
      }
    }, ...YEARS.map(y => h('option', { value: y, selected: s.year === y }, y + (isPreliminary(y) ? ' (предв.)' : ''))));

    wrap.append(h('div', { class: 'grid cols-2', style: { marginBottom: '16px' } },
      h('div', { class: 'card' },
        h('h3', {}, 'Ежемесячный ввод'),
        h('div', { class: 'card-sub' }, 'Рабочие дни подставляются из производственного календаря — их можно перебить вручную.'),
        h('div', { class: 'row' },
          h('label', { class: 'field' }, h('span', {}, 'Год'), yearSel),
          h('label', { class: 'field' }, h('span', {}, 'Месяц'), monthSel),
        ),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          field('Кол-во рабочих дней', 'workDays', { step: 1 }),
          field('Кол-во РВ (рабочих выходных)', 'rv', { step: 1 }),
          h('button', {
            class: 'btn fixed', onClick: () => {
              const d = workDays(s.year, s.month, s.calendarOverrides);
              if (!d) return toast('Для этого месяца нет данных календаря', 'err');
              update(x => { x.salary.workDays = d; }); redraw(); toast(`Подставлено ${d} раб. дн.`);
            }
          }, '↺ Из календаря'),
        ),
        autoDays && autoDays !== s.workDays
          ? h('p', { class: 'muted', style: { marginTop: '10px', fontSize: '12.5px' } },
              `⚠ В календаре за ${MONTHS[s.month - 1]} ${s.year} — ${autoDays} рабочих дней, а введено ${s.workDays}.`)
          : null,
        h('hr', { class: 'sep' }),
        h('label', { class: 'check-pill', style: { display: 'inline-flex' } },
          h('input', {
            type: 'checkbox', checked: !!s.partialMonth, style: { width: 'auto', margin: 0 },
            onChange: (e) => {
              update(x => {
                x.salary.partialMonth = e.target.checked;
                if (e.target.checked && (x.salary.factDays === null || x.salary.factDays === undefined)) x.salary.factDays = x.salary.workDays;
              });
              redraw();
            },
          }),
          h('span', {}, 'Неполный месяц (часть месяца — отпуск, больничный и т.п.)')),
        s.partialMonth ? h('div', { class: 'row', style: { marginTop: '10px' } },
          h('label', { class: 'field' }, h('span', {}, 'Фактически отработано дней'),
            h('input', {
              type: 'text', inputmode: 'numeric', value: s.factDays ?? s.workDays,
              onInput: (e) => { const v = parseFloat(e.target.value); update(x => { x.salary.factDays = isFinite(v) ? v : 0; }); redraw(); },
            })),
          h('p', { class: 'muted', style: { fontSize: '12.5px', flex: '1 1 220px', alignSelf: 'flex-end', margin: 0 } },
            partial
              ? `Оклад, доплата за интенсив и надбавка за качество урезаются пропорционально: × ${r.current.fact}/${r.current.norm}.`
              : 'Пока фактические дни равны норме — расчёт как за полный месяц.'),
        ) : null,
      ),
      h('div', { class: 'card' },
        h('h3', {}, 'Постоянные величины ', h('span', { class: 'hint' }, '(меняются раз в полгода)')),
        isStaleConstants(s) ? h('div', { class: 'card', style: { background: 'rgba(255,200,87,.06)', borderColor: 'rgba(255,200,87,.35)', marginBottom: '12px', padding: '12px 14px' } },
          h('p', { style: { margin: '0 0 8px', fontSize: '13px' } },
            '⚠ Похоже, у вас старые значения доплаты за интенсив/надбавки за качество (со снимка исходной таблицы). ',
            'По расчётному листку за июль 2026 актуальные — 17 811,97 ₽ и 2 467,98 ₽.'),
          h('button', {
            class: 'btn sm', onClick: () => {
              update(x => { x.salary.intensive = 17811.97; x.salary.quality = 2467.98; });
              toast('Значения обновлены'); redraw();
            }
          }, '↺ Обновить на актуальные')) : null,
        h('div', { class: 'row' }, field('Оклад 1 ставки, ₽', 'base'), field('Доплата за интенсив, ₽', 'intensive')),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          field('Надбавка за качество, ₽', 'quality'), s.hasGph ? field('Сумма ГПХ (начислено), ₽', 'gph') : null),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          field('НДФЛ, %', 'ndfl'), field('Районный коэф., %', 'district'), field('Северная надбавка, %', 'north')),
      ),
    ));

    /* --- пояснение расчёта неполного месяца (текущая ставка, как в расчётном листке) --- */
    if (partial) {
      const one = r.current;
      wrap.append(h('div', { class: 'card', style: { marginBottom: '16px' } },
        h('h3', {}, `Как посчитан неполный месяц (${rateLabel})`),
        h('div', { class: 'card-sub' },
          `Отработано ${one.fact} из ${one.norm} рабочих дней — оклад и обе надбавки урезаны в той же пропорции, районный коэффициент и северная надбавка — 30% от их суммы. Формула проверена на реальном расчётном листке за июль 2026.`),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, `Оплата по окладу (${s.base * r.rate} × ${one.fact}/${one.norm})`), h('span', { class: 'v' }, money(one.oklad))),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, `Надбавка за качество (${s.quality} × ${one.fact}/${one.norm})`), h('span', { class: 'v' }, money(one.quality))),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, `Доплата за интенсив (${s.intensive} × ${one.fact}/${one.norm})`), h('span', { class: 'v' }, money(one.intensive))),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Районный коэффициент (30%)'), h('span', { class: 'v' }, money(one.district))),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Северная надбавка (30%)'), h('span', { class: 'v' }, money(one.north))),
        one.rvSum ? h('div', { class: 'kv' }, h('span', { class: 'k' }, `Сумма по РВ (${s.rv} дн., без урезания)`), h('span', { class: 'v' }, money(one.rvSum))) : null,
        h('div', { class: 'kv total' }, h('span', { class: 'k' }, 'Начислено без НДФЛ'), h('span', { class: 'v' }, money(one.gross))),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, `НДФЛ ${s.ndfl}%`), h('span', { class: 'v' }, '− ' + money(one.gross - one.net))),
        h('div', { class: 'kv total' }, h('span', { class: 'k' }, 'На руки'), h('span', { class: 'v' }, money(one.net))),
        r.hasGph ? h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '10px', marginBottom: 0 } },
          'ГПХ в этот расчёт не входит — это отдельный договор, не привязанный к рабочим дням по ставке.') : null,
      ));
    }

    /* --- сравнение форматов и детальная таблица (переиспользуемые блоки) --- */
    wrap.append(comparisonCard(r, p));
    wrap.append(detailTableCard(r, p));

    /* --- календарь --- */
    wrap.append(calendarCard(redraw));

    /* --- история --- */
    if (s.history?.length) wrap.append(historyCard(redraw));

    restoreFocus(wrap, focusToken);
  }

  // Сохранение — источник данных для вкладки «История зарплат»: один месяц
  // может быть сохранён только один раз, повторное сохранение того же
  // года/месяца заменяет прежнюю запись более свежей (со всеми показателями
  // для развёрнутого просмотра и выгрузки расчётного листка).
  function saveHistory(r) {
    const s = getState().salary;
    const entry = {
      id: Date.now(), year: s.year, month: s.month, savedAt: new Date().toISOString(),
      workDays: s.workDays, rv: s.rv, factDays: r.current.partial ? r.current.fact : null,
      gross: r.current.gross, net: r.current.net, withGph: r.withGph, oneHalf: r.oneHalf.net, benefit: r.benefit,
      params: {
        base: s.base, intensive: s.intensive, quality: s.quality, gph: s.gph, ndfl: s.ndfl,
        district: s.district, north: s.north, workDays: s.workDays, rv: s.rv,
        factDays: s.partialMonth ? s.factDays : null,
        rate: s.rate, hasGph: s.hasGph,
      },
      calc: r,
    };
    update(x => {
      x.salary.history = x.salary.history.filter(h => !(h.year === s.year && h.month === s.month));
      x.salary.history.unshift(entry);
      x.salary.history = x.salary.history.slice(0, 240);
    });
    toast(`Расчёт за ${MONTHS[s.month - 1]} ${s.year} сохранён`); redraw();
  }

  function exportCsv(r, s) {
    const rows = [['Показатель', '0,5 ставки', '1 ставка', '1,5 ставки']];
    const f = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
    for (const [label, key] of ROWS) rows.push([label, f(r.half[key] ?? s[key]), f(r.one[key] ?? s[key]), f(r.oneHalf[key] ?? s[key])]);
    rows.push(['Итого к начислению без НДФЛ', f(r.half.gross), f(r.one.gross), f(r.oneHalf.gross)]);
    rows.push(['Итого к получению', f(r.half.net), f(r.one.net), f(r.oneHalf.net)]);
    rows.push(['ГПХ после НДФЛ', '', f(r.gphNet), '']);
    rows.push(['С ГПХ на руки', '', f(r.withGph), '']);
    rows.push(['Выгода формата с ГПХ', '', f(r.benefit), '']);
    download(`Зарплата_${MONTHS[s.month - 1]}_${s.year}.csv`,
      '﻿' + rows.map(rw => rw.map(v => `"${v}"`).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  }

  redraw();
}

function calendarCard(redraw) {
  const s = getState().salary;
  const body = h('div', { class: 'acc-body' });
  for (const y of YEARS) {
    body.append(h('div', { style: { margin: '10px 0 6px' } },
      h('b', {}, `${y} год`), ' ',
      h('span', { class: 'muted', style: { fontSize: '12.5px' } },
        `— всего ${yearTotal(y, s.calendarOverrides)} рабочих дней${isPreliminary(y) ? ' · предварительно, сверьте с постановлением о переносах' : ''}`)));
    const grid = h('div', { class: 'grid cols-4' });
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${m}`;
      const val = workDays(y, m, s.calendarOverrides);
      grid.append(h('label', { class: 'field' },
        h('span', {}, MONTHS[m - 1]),
        h('input', {
          type: 'number', min: 0, max: 31, value: val ?? '',
          onChange: (e) => {
            const v = e.target.value === '' ? null : parseInt(e.target.value, 10);
            update(x => {
              if (v === null || v === WORK_DAYS[y][m]) delete x.salary.calendarOverrides[key];
              else x.salary.calendarOverrides[key] = v;
              if (x.salary.year === y && x.salary.month === m) x.salary.workDays = v ?? WORK_DAYS[y][m];
            });
            redraw();
          }
        })));
    }
    body.append(grid);
  }
  return h('details', { class: 'acc', style: { marginBottom: '16px' } },
    h('summary', {}, 'Производственный календарь 2026–2027 (можно править)'), body);
}

function historyCard(redraw) {
  const s = getState().salary;
  return h('div', { class: 'card' },
    h('h3', {}, 'Сохранённые расчёты'),
    h('div', { class: 'table-wrap', style: { maxHeight: '340px' } },
      h('table', { class: 'compact' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Период'), h('th', {}, 'Формат'), h('th', { class: 'num' }, 'Раб. дн.'), h('th', { class: 'num' }, 'РВ'),
          h('th', { class: 'num' }, 'На руки'), h('th', { class: 'num' }, 'С ГПХ'), h('th', { class: 'num' }, '1,5 ставки'),
          h('th', { class: 'num' }, 'Выгода'), h('th', {}, ''))),
        h('tbody', {}, ...s.history.map(it => h('tr', {},
          h('td', {}, `${MONTHS[it.month - 1]} ${it.year}`),
          h('td', { class: 'muted', style: { fontSize: '12px' } },
            `${RATE_LABELS[it.params?.rate ?? 1]}${(it.params?.hasGph ?? true) ? ' + ГПХ' : ''}`),
          h('td', { class: 'num' }, it.factDays != null ? `${it.factDays}/${it.workDays}` : it.workDays), h('td', { class: 'num' }, it.rv),
          h('td', { class: 'num t-right mono' }, money0(it.net)),
          h('td', { class: 'num t-right mono neon-text' }, money0(it.withGph)),
          h('td', { class: 'num t-right mono' }, money0(it.oneHalf)),
          h('td', { class: 'num t-right mono' }, (it.benefit >= 0 ? '+' : '−') + money0(Math.abs(it.benefit))),
          h('td', {}, h('button', {
            class: 'btn sm danger ghost',
            onClick: () => { update(x => { x.salary.history = x.salary.history.filter(z => z.id !== it.id); }); redraw(); }
          }, '×')),
        ))))));
}
