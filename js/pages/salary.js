// Калькулятор заработной платы: ставка + ГПХ, сравнение с 1,5 ставки.
import { h, money, money0, toast, statCard, download, MONTHS, captureFocus, restoreFocus, moreMenu, modal, contextMenu } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { getState, update } from '../core/store.js';
import { WORK_DAYS, YEARS, workDays, yearTotal, isPreliminary } from '../data/calendar.js';
import * as vacation from './vacation.js';
import { forecastTile } from './vacation-forecast.js';
import { tripRvForMonth } from './trips.js';
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

/** Палитра цифр в плитках (ПКМ по плитке). */
const TILE_TONES = [
  { value: '', label: 'Основной цвет', color: 'var(--neon)' },
  { value: 'cyan', label: 'Голубой', color: 'var(--cyan)' },
  { value: 'blue', label: 'Синий', color: 'var(--blue)' },
  { value: 'violet', label: 'Фиолетовый', color: 'var(--violet)' },
  { value: 'magenta', label: 'Розовый', color: 'var(--magenta)' },
  { value: 'red', label: 'Красный', color: 'var(--red)' },
  { value: 'orange', label: 'Оранжевый', color: 'var(--orange)' },
  { value: 'amber', label: 'Жёлтый', color: 'var(--amber)' },
  { value: 'plain', label: 'Как текст', color: 'var(--text)' },
];

/** Постоянные величины: оклад, надбавки, ГПХ, проценты. */
const CONST_KEYS = [
  ['base', 'Оклад 1 ставки, ₽'], ['intensive', 'Доплата за интенсив, ₽'], ['quality', 'Надбавка за качество, ₽'],
  ['gph', 'Сумма ГПХ (начислено), ₽'], ['ndfl', 'НДФЛ, %'], ['district', 'Районный коэф., %'], ['north', 'Северная надбавка, %'],
];
// по расчётному листку за июль 2026 — пока педагог не задал свои
const BUILTIN_CONSTANTS = { base: 21700, intensive: 17811.97, quality: 2467.98, gph: 22142, ndfl: 13, district: 30, north: 30 };
const myConstants = (s) => ({ ...BUILTIN_CONSTANTS, ...(s.myConstants || {}) });

/** Окно «Мои актуальные значения»: к ним возвращает кнопка сброса. */
function myConstantsModal(redraw) {
  const s = getState().salary;
  const cur = myConstants(s);
  const inputs = {};
  const fieldOf = ([k, label]) => {
    inputs[k] = h('input', { type: 'text', inputmode: 'decimal', value: String(cur[k]) });
    return h('label', { class: 'field' }, h('span', {}, label), inputs[k]);
  };
  const read = () => {
    const out = {};
    for (const [k] of CONST_KEYS) {
      const v = parseFloat(String(inputs[k].value).replace(/\s/g, '').replace(',', '.'));
      out[k] = isFinite(v) ? v : cur[k];
    }
    return out;
  };
  modal({
    title: 'Мои актуальные значения',
    body: h('div', {},
      h('p', { class: 'muted', style: { marginTop: 0, fontSize: '13px' } },
        'Значения из вашего последнего расчётного листка. Кнопка сброса в «Постоянных величинах» возвращает именно их — удобно после того, как вы посчитали месяц со старыми суммами.'),
      h('div', { class: 'grid cols-2' }, ...CONST_KEYS.map(fieldOf)),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '14px' } },
        h('button', {
          class: 'btn sm', type: 'button',
          onClick: () => { for (const [k] of CONST_KEYS) inputs[k].value = String(s[k]); },
        }, icon('copy', 16), 'Взять из текущих полей'),
        h('button', {
          class: 'btn sm ghost', type: 'button',
          onClick: () => { for (const [k] of CONST_KEYS) inputs[k].value = String(BUILTIN_CONSTANTS[k]); },
        }, icon('reset', 16), 'Как в листке за июль 2026'))),
    okText: 'Сохранить и применить',
    onOk: () => {
      const v = read();
      update(x => { x.salary.myConstants = v; Object.assign(x.salary, v); });
      toast('Актуальные значения сохранены'); redraw();
    },
  });
}

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

/** Все форматы работы: ставка × есть ли ГПХ. */
export const FORMATS = [0.5, 1, 1.5].flatMap(rate => [{ rate, gph: false }, { rate, gph: true }])
  .map(f => ({ ...f, key: `${f.rate}${f.gph ? '+gph' : ''}`, label: RATE_LABELS[f.rate] + (f.gph ? ' + ГПХ' : '') }));
const fmtKey = (rate, gph) => `${rate}${gph ? '+gph' : ''}`;

/** Начислено/на руки для формата по готовому calcAll(). */
export function formatTotals(r, p, key) {
  const f = FORMATS.find(x => x.key === key) || FORMATS[2];
  const base = { 0.5: r.half, 1: r.one, 1.5: r.oneHalf }[f.rate];
  return {
    ...f, base,
    gross: base.gross + (f.gph ? p.gph : 0),
    net: base.net + (f.gph ? r.gphNet : 0),
  };
}

/** С каким форматом сравниваем (выбор педагога, по умолчанию — 1,5 ставки). */
export function compareKeys(r) {
  const ui = getState().ui.salaryCompare || {};
  const cur = fmtKey(r.rate ?? 1, r.hasGph !== false);
  const a = FORMATS.some(f => f.key === ui.a) ? ui.a : cur;
  let b = FORMATS.some(f => f.key === ui.b) ? ui.b : '1.5';
  if (b === a) b = FORMATS.find(f => f.key !== a)?.key;
  return { a, b, cur };
}

/** «Сравнение форматов работы»: два выбираемых формата + все шесть на шкале.
 *  Переиспользуется на вкладке расчёта и в истории зарплат. */
export function comparisonCard(r, p, { onChange } = {}) {
  const card = h('div', { class: 'card', style: { marginBottom: '16px' } });
  const draw = () => {
    const { a, b, cur } = compareKeys(r);
    const A = formatTotals(r, p, a), B = formatTotals(r, p, b);
    const diff = A.net - B.net;
    const pick = (side, value) => h('select', {
      class: 'cmp-select', 'aria-label': side === 'a' ? 'Формат A' : 'Формат B',
      onChange: (e) => {
        update(x => { x.ui.salaryCompare = { ...(x.ui.salaryCompare || {}), [side]: e.target.value }; });
        draw(); onChange?.();
      },
    }, ...FORMATS.map(f => h('option', { value: f.key, selected: f.key === value }, f.label + (f.key === cur ? ' (сейчас)' : ''))));
    const col = (T, side) => h('div', { class: 'cmp-col ' + side },
      h('div', { class: 'kv' }, h('span', { class: 'k' }, `${RATE_LABELS[T.rate]}, к начислению`), h('span', { class: 'v' }, money(T.base.gross))),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, `${RATE_LABELS[T.rate]}, на руки`), h('span', { class: 'v' }, money(T.base.net))),
      T.gph ? h('div', { class: 'kv' }, h('span', { class: 'k' }, `ГПХ после НДФЛ (${p.ndfl}%)`), h('span', { class: 'v' }, money(r.gphNet))) : null,
      h('div', { class: 'kv total' }, h('span', { class: 'k' }, 'Итого на руки'), h('span', { class: 'v' }, money(T.net))));

    const all = FORMATS.map(f => formatTotals(r, p, f.key));
    const max = Math.max(...all.map(x => x.net)) || 1;
    card.replaceChildren(
      h('h3', {}, 'Сравнение форматов работы'),
      h('div', { class: 'card-sub' }, 'Выберите в списках, что с чем сравнить. Ниже — все шесть вариантов на одной шкале.'),
      h('div', { class: 'grid cols-2' },
        h('div', {}, h('label', { class: 'field cmp-field' }, h('span', {}, 'Формат A'), pick('a', a)), col(A, 'a')),
        h('div', {}, h('label', { class: 'field cmp-field' }, h('span', {}, 'Формат B'), pick('b', b)), col(B, 'b'))),
      h('hr', { class: 'sep' }),
      h('p', { style: { margin: '0 0 12px', fontSize: '14px' } },
        Math.abs(diff) < 0.5
          ? ['Оба формата дают одинаково на руки.']
          : diff > 0
            ? [h('b', { class: 'neon-text' }, A.label), ' выгоднее, чем ', h('b', {}, B.label), ', на ', h('b', { class: 'neon-text' }, money(diff)), ' в месяц — ', h('b', {}, money(diff * 12)), ' за год.']
            : [h('b', { class: 'neon-text' }, B.label), ' выгоднее, чем ', h('b', {}, A.label), ', на ', h('b', { class: 'neon-text' }, money(-diff)), ' в месяц — ', h('b', {}, money(-diff * 12)), ' за год.']),
      h('div', { class: 'cmp-bars' }, ...all.map(x => h('div', { class: 'cmp-bar' + (x.key === a ? '' : x.key === b ? ' b' : ' other') },
        h('span', {}, x.label + (x.key === cur ? ' · сейчас' : '')),
        h('span', { class: 'track' }, h('span', { class: 'fill', style: { display: 'block', transform: `scaleX(${Math.max(0, x.net) / max})` } })),
        h('span', { class: 'v' }, money0(x.net))))));
  };
  draw();
  return card;
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
      }, icon('history', 16), 'История зарплат'),
      h('button', {
        class: 'tab' + (tab === 'vacation' ? ' active' : ''),
        onClick: () => { update(x => { x.ui.salaryTab = 'vacation'; }); mount(); },
      }, icon('plane', 16), 'Отпускные'),
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
        h('button', { class: 'btn primary', onClick: () => saveHistory(r) }, icon('save', 16), 'Сохранить расчёт'),
        moreMenu([{ label: 'Выгрузить расчёт (CSV)', icon: icon('sheet', 16), onClick: () => exportCsv(r, s) }]),
      )));

    /* --- ряд настроек начисления: формат работы + постоянные величины --- */
    const mine = myConstants(s);
    const changed = CONST_KEYS.some(([k]) => Number(s[k]) !== Number(mine[k]));
    wrap.append(h('div', { class: 'grid cols-2', style: { marginBottom: '16px', alignItems: 'stretch' } },
      h('div', { class: 'card' },
        h('h3', {}, 'Формат работы'),
        h('div', { class: 'card-sub' }, 'Ставка, на которой вы оформлены, и договор ГПХ — от этого зависят расчёт, расчётный листок и отпускные.'),
        h('div', { class: 'fmt-rates' },
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
          h('span', {}, 'Также работаю по договору ГПХ')),
        h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '12px 0 0' } }, 'Сейчас: ', h('b', { class: 'neon-text' }, formatLabel))),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', {},
            h('h3', {}, 'Постоянные величины', changed ? h('span', { class: 'dot-changed', title: 'Отличаются от ваших актуальных значений' }) : null),
            h('div', { class: 'card-sub', style: { marginBottom: '10px' } }, 'Меняются раз в полгода — у каждого педагога свои.')),
          h('div', { class: 'card-tools' },
            h('button', {
              class: 'btn sm ghost icon-btn', title: 'Вернуть актуальные значения', 'aria-label': 'Вернуть актуальные значения',
              onClick: () => {
                update(x => { for (const [k] of CONST_KEYS) x.salary[k] = mine[k]; });
                toast('Возвращены актуальные значения'); redraw();
              },
            }, icon('reset', 16)),
            h('button', {
              class: 'btn sm ghost icon-btn', title: 'Мои актуальные значения…', 'aria-label': 'Мои актуальные значения',
              onClick: () => myConstantsModal(redraw),
            }, icon('settings', 16)))),
        h('div', { class: 'row' }, field('Оклад 1 ставки, ₽', 'base'), field('Доплата за интенсив, ₽', 'intensive')),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          field('Надбавка за качество, ₽', 'quality'), s.hasGph ? field('Сумма ГПХ (начислено), ₽', 'gph') : null),
        h('p', { class: 'muted', style: { fontSize: '12px', margin: '10px 0 0' } },
          `НДФЛ ${s.ndfl}%, районный коэффициент ${s.district}%, северная надбавка ${s.north}% — меняются в окне «Мои актуальные значения».`),
      ),
    ));

    /* --- итоговые плитки --- */
    const fullNet = partial ? calcAll({ ...p, factDays: null }).current.net : r.current.net;
    const { b: cmpB } = compareKeys(r);
    const B = formatTotals(r, p, cmpB);
    const gain = r.withGph - B.net;
    const tones = s.tileColors || {};
    const colorable = (key, def, node) => {
      const tone = tones[key] ?? def;
      const val = node.querySelector('.stat .value');
      if (val) val.className = 'value ' + tone;
      node.classList.add('tile-colorable');
      node.title = node.title || 'Правая кнопка мыши — цвет цифр';
      node.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [
          { title: 'Цвет цифр' },
          { swatches: TILE_TONES.map(t => ({ ...t, active: t.value === tone })), onPick: (v) => { update(x => { x.salary.tileColors = { ...(x.salary.tileColors || {}), [key]: v }; }); redraw(); } },
          tones[key] !== undefined ? 'sep' : null,
          tones[key] !== undefined ? { label: 'Как было', icon: icon('reset', 16), onClick: () => { update(x => { const c = { ...(x.salary.tileColors || {}) }; delete c[key]; x.salary.tileColors = c; }); redraw(); } } : null,
        ]);
      });
      return node;
    };
    wrap.append(h('div', { class: 'grid cols-4 tiles-5', style: { marginBottom: '16px' } },
      colorable('current', '', statCard(`${formatLabel} · на руки`, money0(r.withGph),
        `до НДФЛ ${money0(r.current.gross + (r.hasGph ? p.gph : 0))}`, '')),
      colorable('forecast', '', forecastTile(r.current, fullNet, redraw)),
      colorable('gain', gain >= 0 ? '' : 'magenta', statCard(gain >= 0 ? 'Выгода текущего формата' : 'Проигрыш текущего формата',
        (gain >= 0 ? '+' : '−') + money0(Math.abs(gain)),
        `по сравнению с «${B.label}»`, '')),
      colorable('rv', 'amber', statCard('Стоимость одного РВ', '+' + money0(r.current.rvMarginalNet),
        `на руки · до НДФЛ +${money0(r.current.rvMarginalGross)}`, 'amber')),
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

    wrap.append(h('div', { class: 'card', style: { marginBottom: '16px' } },
      h('h3', {}, 'Ежемесячный ввод'),
      h('div', { class: 'card-sub' }, 'Рабочие дни подставляются из производственного календаря — их можно перебить вручную.'),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, h('span', {}, 'Год'), yearSel),
        h('label', { class: 'field' }, h('span', {}, 'Месяц'), monthSel),
        field('Кол-во рабочих дней', 'workDays', { step: 1 }),
        field('Кол-во РВ (рабочих выходных)', 'rv', { step: 1 }),
        h('button', {
          class: 'btn fixed', onClick: () => {
            const d = workDays(s.year, s.month, s.calendarOverrides);
            if (!d) return toast('Для этого месяца нет данных календаря', 'err');
            update(x => { x.salary.workDays = d; }); redraw(); toast(`Подставлено ${d} раб. дн.`);
          }
        }, icon('reset', 16), 'Из календаря'),
      ),
      autoDays && autoDays !== s.workDays
        ? h('p', { class: 'muted', style: { marginTop: '10px', fontSize: '12.5px' } },
            `В календаре за ${MONTHS[s.month - 1]} ${s.year} — ${autoDays} рабочих дней, а введено ${s.workDays}.`)
        : null,
      (() => {
        const rvTrips = tripRvForMonth(s.year, s.month);
        if (!rvTrips.length && !s.rv) return null;
        const IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'][s.month - 1];
        const list = rvTrips.map(r => `${r.date.slice(8, 10)}.${r.date.slice(5, 7)} — ${r.reason}`).join('; ');
        return h('p', { class: 'muted trip-hint', style: { marginTop: '10px', fontSize: '12.5px' } }, icon('bus', 15),
          rvTrips.length ? `По графику заездов в ${IN} — РВ: ${rvTrips.length} (${list}).` : `По графику заездов в ${IN} РВ нет.`,
          rvTrips.length !== s.rv ? h('button', {
            class: 'btn sm ghost', style: { marginLeft: '8px' },
            onClick: () => { update(x => { x.salary.rv = rvTrips.length; }); redraw(); toast(`Подставлено РВ: ${rvTrips.length}`); },
          }, 'Подставить') : null);
      })(),
      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '12px' } },
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
          h('span', {}, 'Неполный месяц (отпуск, больничный)')),
        s.partialMonth ? h('label', { class: 'field', style: { width: '200px' } }, h('span', {}, 'Фактически отработано дней'),
          h('input', {
            type: 'text', inputmode: 'numeric', value: s.factDays ?? s.workDays,
            onInput: (e) => { const v = parseFloat(e.target.value); update(x => { x.salary.factDays = isFinite(v) ? v : 0; }); redraw(); },
          })) : null,
        s.partialMonth ? h('p', { class: 'muted', style: { fontSize: '12.5px', flex: '1 1 220px', margin: 0 } },
          partial
            ? `Оклад, доплата за интенсив и надбавка за качество урезаются пропорционально: × ${r.current.fact}/${r.current.norm}.`
            : 'Пока фактические дни равны норме — расчёт как за полный месяц.') : null),
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
    wrap.append(comparisonCard(r, p, { onChange: redraw }));
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
