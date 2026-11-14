// Прогноз отпускных на странице «Зарплата»: «сколько я получу отпускных,
// если дальше буду зарабатывать как в этом месяце».
//
// Расчётный период — 12 календарных месяцев перед месяцем начала отпуска
// (та же методика, что во вкладке «Отпускные», см. vacation.js):
//  · месяцы раньше рассчитываемого — из «Истории зарплат» (сохранённые
//    расчёты, с премиями и неполными месяцами);
//  · сам рассчитываемый месяц — как он посчитан сейчас;
//  · месяцы после него — такие же, но полные: «неполный месяц» — разовая
//    ситуация (отпуск, больничный), переносить её в будущее нельзя;
//  · прошлый месяц, которого нет в истории, тоже берётся как текущий —
//    и это явно видно в разбивке.
// Суммы — на руки по официальной ставке, без ГПХ: ГПХ в отпускные не входит.
import { h, money0, modal, MONTHS } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { getState, update } from '../core/store.js';
import { periodMonths, daysInMonth, calcAverageDaily } from './vacation.js';

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d = 1) => `${y}-${pad(m)}-${pad(d)}`;
const dateRuLong = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  const gen = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return `${d} ${gen[m - 1]} ${y}`;
};

/** Настройки прогноза; по умолчанию — ближайший июль после рассчитываемого месяца. */
export function forecastSettings(st = getState()) {
  const s = st.salary;
  const f = s.vacationForecast || {};
  const defYear = s.month < 7 ? s.year : s.year + 1;
  return {
    start: /^\d{4}-\d{2}-\d{2}$/.test(f.start || '') ? f.start : isoOf(defYear, 7, 1),
    days: Number(f.days) > 0 ? Number(f.days) : (Number(st.vacation?.vacationDays) || 28),
  };
}

/**
 * @param {object} cur   расчёт текущего месяца ({net, partial, fact, norm})
 * @param {number} fullNet на руки за этот же месяц, если бы он был полным
 */
export function computeForecast(st, cur, fullNet, settings = forecastSettings(st)) {
  const s = st.salary;
  const [sy, sm] = settings.start.split('-').map(Number);
  const here = s.year * 12 + s.month;
  const history = s.history || [];
  const months = periodMonths(sy, sm).map(({ year, month }) => {
    const idx = year * 12 + month;
    if (idx < here) {
      const rec = history.find(e => e.year === year && e.month === month);
      if (rec) {
        const excluded = rec.factDays != null && rec.workDays
          ? Math.max(0, Math.round((1 - rec.factDays / rec.workDays) * daysInMonth(year, month))) : 0;
        return { year, month, net: rec.net, excludedDays: excluded, source: 'history' };
      }
      return { year, month, net: fullNet, excludedDays: 0, source: 'missing' };
    }
    if (idx === here) {
      const excluded = cur.partial && cur.norm ? Math.round((1 - cur.fact / cur.norm) * daysInMonth(year, month)) : 0;
      return { year, month, net: cur.net, excludedDays: excluded, source: 'current' };
    }
    return { year, month, net: fullNet, excludedDays: 0, source: 'future' };
  });
  const calc = calcAverageDaily(months);
  return {
    ...settings, months: calc.rows, avgDaily: calc.avgDaily, totalSalary: calc.totalSalary, totalDays: calc.totalDays,
    payout: calc.avgDaily * settings.days,
    counts: {
      history: months.filter(m => m.source === 'history').length,
      missing: months.filter(m => m.source === 'missing').length,
      projected: months.filter(m => m.source === 'current' || m.source === 'future').length,
    },
  };
}

const SOURCE = {
  history: ['из истории', 'ok'],
  current: ['этот месяц', 'cyan'],
  future: ['как этот месяц', ''],
  missing: ['нет в истории → как этот', 'warn'],
};

/** Панель на странице «Зарплата»; клик открывает настройку и разбивку. */
export function forecastCard(cur, fullNet, redraw) {
  const st = getState();
  const f = computeForecast(st, cur, fullNet);
  const monthName = `${MONTHS[st.salary.month - 1]} ${st.salary.year}`;
  const notes = [
    f.counts.history ? `из истории: ${f.counts.history} мес.` : null,
    f.counts.projected ? `как ${monthName.toLowerCase()}: ${f.counts.projected} мес.` : null,
    f.counts.missing ? `нет в истории: ${f.counts.missing} мес.` : null,
  ].filter(Boolean);

  return h('button', { class: 'card forecast-card', type: 'button', onClick: () => openForecast(cur, fullNet, redraw) },
    h('div', { class: 'fc-ico' }, icon('plane', 22)),
    h('div', { class: 'fc-main' },
      h('div', { class: 'stat' },
        h('div', { class: 'label' }, 'Прогноз отпускных'),
        h('div', { class: 'value' }, money0(f.payout)),
        h('div', { class: 'sub' }, `с ${dateRuLong(f.start)} · ${f.days} дн. · на руки, без ГПХ`))),
    h('div', { class: 'fc-side' },
      h('div', { class: 'fc-avg' }, h('span', { class: 'muted' }, 'средний дневной'), h('b', { class: 'mono' }, money0(f.avgDaily))),
      h('div', { class: 'fc-notes' }, ...notes.map((t, i) => h('span', { class: 'pill' + (f.counts.missing && i === notes.length - 1 ? ' warn' : '') }, t))),
      h('span', { class: 'fc-hint' }, 'настроить ', icon('chevron', 14))));
}

function openForecast(cur, fullNet, redraw) {
  const st = getState();
  const set = forecastSettings(st);
  const startInput = h('input', { type: 'date', value: set.start });
  const daysInput = h('input', { type: 'number', min: '1', max: '120', step: '1', value: String(set.days) });
  const result = h('div', {});

  const render = () => {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(startInput.value) ? startInput.value : set.start;
    const days = Math.max(1, parseInt(daysInput.value, 10) || set.days);
    const f = computeForecast(getState(), cur, fullNet, { start, days });
    result.replaceChildren(
      h('div', { class: 'grid cols-3', style: { margin: '14px 0' } },
        h('div', { class: 'card' }, h('div', { class: 'stat' }, h('div', { class: 'label' }, `Отпускные за ${days} дн.`), h('div', { class: 'value' }, money0(f.payout)), h('div', { class: 'sub' }, 'на руки'))),
        h('div', { class: 'card' }, h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Средний дневной'), h('div', { class: 'value cyan' }, money0(f.avgDaily)), h('div', { class: 'sub' }, `${f.totalDays.toFixed(2)} расч. дн.`))),
        h('div', { class: 'card' }, h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Заработок за период'), h('div', { class: 'value plain' }, money0(f.totalSalary)), h('div', { class: 'sub' }, '12 месяцев до отпуска')))),
      h('div', { class: 'table-wrap', style: { maxHeight: '320px' } }, h('table', { class: 'compact' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Месяц'), h('th', {}, 'Откуда сумма'), h('th', { class: 'num' }, 'На руки'), h('th', { class: 'num' }, 'Искл. дней'), h('th', { class: 'num' }, 'Расч. дней'))),
        h('tbody', {}, ...f.months.map(m => h('tr', {},
          h('td', {}, `${MONTHS[m.month - 1]} ${m.year}`),
          h('td', {}, h('span', { class: 'pill ' + SOURCE[m.source][1] }, SOURCE[m.source][0])),
          h('td', { class: 'num mono' }, money0(m.net)),
          h('td', { class: 'num mono' }, m.excluded || ''),
          h('td', { class: 'num mono' }, m.calcDays.toFixed(2))))))),
      f.counts.missing ? h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '10px 0 0' } },
        '⚠ Для месяцев «нет в истории» сохраните их расчёт на этой странице (выберите месяц → «Сохранить расчёт») — прогноз станет точнее.') : null);
  };
  startInput.addEventListener('input', render);
  daysInput.addEventListener('input', render);
  render();

  modal({
    wide: true, title: '✈ Прогноз отпускных',
    body: h('div', {},
      h('p', { class: 'muted', style: { marginTop: 0 } },
        'Сколько придёт отпускных, если зарплата и дальше будет как в рассчитываемом месяце. Прошлые месяцы берутся из «Истории зарплат», будущие — как этот месяц. Методика — как во вкладке «Отпускные» (12 месяцев до начала отпуска, 29,3 дня в месяце).'),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, h('span', {}, 'Начало отпуска'), startInput),
        h('label', { class: 'field' }, h('span', {}, 'Дней отпуска (календарных)'), daysInput)),
      result),
    okText: 'Сохранить',
    onOk: () => {
      const start = /^\d{4}-\d{2}-\d{2}$/.test(startInput.value) ? startInput.value : set.start;
      const days = Math.max(1, parseInt(daysInput.value, 10) || set.days);
      update(x => { x.salary.vacationForecast = { start, days }; });
      redraw();
    },
  });
}
