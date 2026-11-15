// «Заезды»: планы-графики перемещения технопарков МК-1 и МК-2, для своей команды. По каждому
// заезду — выезд (за день до начала), сколько будних и выходных дней в дороге
// и на месте, и будут ли РВ (выезд в выходной/праздник, конец заезда в субботу).
import { h, toast, modal, confirmBox, switchToggle, MONTHS } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { getState, update } from '../core/store.js';
import { go } from '../core/router.js';
import { DEFAULT_TRIPS, MKS, SEASON, PLACE_KINDS, HOLIDAYS, legInfo, rvByMonth, weekday, isWeekend } from '../data/trips.js';

const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const ddmm = (s) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;
const ddmmyy = (s) => `${ddmm(s)}.${s.slice(2, 4)}`;
const today = () => new Date().toISOString().slice(0, 10);
const plural = (n, a, b, c) => { const x = Math.abs(n) % 100, y = x % 10; return x > 10 && x < 20 ? c : y > 1 && y < 5 ? b : y === 1 ? a : c; };
const monthName = (key) => { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };

/** Заезды с учётом правок педагога. */
export function tripsList(st = getState()) {
  let list = st.trips?.list;
  // правки, сохранённые до появления МК-1, — дополняем заездами МК-1 из графика
  if (list && !list.some(t => t.mk === 'mk1')) {
    list = [...list.map(t => ({ mk: 'mk2', ...t })), ...DEFAULT_TRIPS.map((t, i) => ({ id: `t${i}`, ...t })).filter(t => t.mk === 'mk1')];
  }
  return (list || DEFAULT_TRIPS).map((t, i) => ({ id: t.id || `t${i}`, mk: t.mk || 'mk2', ...t }));
}
export const myTeam = (st = getState()) => st.trips?.team ?? 2;
export const myMk = (st = getState()) => st.trips?.mk ?? 'mk2';
export const myTrips = (st = getState()) => tripsList(st).filter(t => t.mk === myMk(st) && t.team === myTeam(st));

/** РВ по заездам в месяце (для подсказки на странице «Зарплата»). */
export function tripRvForMonth(year, month, st = getState()) {
  return rvByMonth(myTrips(st))[`${year}-${String(month).padStart(2, '0')}`] || [];
}

export function render(root) {
  const wrap = h('div', {});
  root.append(wrap);
  const open = new Set();

  function draw() {
    const st = getState();
    const team = myTeam(st);
    const mk = myMk(st);
    const trips = myTrips(st);
    const now = today();
    // номер заезда внутри места (агломерации): 1, 2, 3
    const byPlace = new Map();
    for (const t of trips) { if (!byPlace.has(t.place)) byPlace.set(t.place, []); byPlace.get(t.place).push(t); }
    const rvMonths = rvByMonth(trips);
    const next = trips.find(t => t.parts[t.parts.length - 1].to >= now);

    wrap.replaceChildren(
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Заезды'),
          h('p', {}, `${MKS.find(m => m.key === mk).label}, команда ${team} · план-график на ${SEASON} уч. год. Выезд — за день до начала заезда.`)),
        h('div', { class: 'head-actions mk-switch' },
          ...MKS.map(m => h('div', { class: 'mk-group' },
            h('div', { class: 'mk-label' }, m.label),
            h('div', { class: 'tabs', role: 'radiogroup', 'aria-label': `${m.label}: команда` },
              ...[1, 2].map(n => h('button', {
                type: 'button', class: 'tab' + (mk === m.key && team === n ? ' active' : ''), role: 'radio', 'aria-checked': String(mk === m.key && team === n),
                onClick: () => { update(x => { x.trips = { ...(x.trips || {}), mk: m.key, team: n }; }); open.clear(); draw(); },
              }, `Команда ${n}`))))))),

      // РВ по месяцам — сводка
      h('div', { class: 'card', style: { marginBottom: '16px' } },
        h('h3', {}, 'РВ по месяцам'),
        h('div', { class: 'card-sub' }, 'Работа в выходной: выезд в субботу, воскресенье или праздник, а также конец заезда в субботу.'),
        Object.keys(rvMonths).length
          ? h('div', { class: 'rv-months' }, ...Object.keys(rvMonths).sort().map(k => h('div', { class: 'rv-month' + (k === now.slice(0, 7) ? ' cur' : '') },
              h('div', { class: 'rv-month-name' }, monthName(k)),
              h('div', { class: 'rv-month-n' }, `${rvMonths[k].length} РВ`),
              ...rvMonths[k].map(r => h('div', { class: 'muted rv-why' }, `${ddmm(r.date)} ${WD[weekday(r.date)]} — ${r.reason}`)))))
          : h('p', { class: 'muted', style: { margin: 0 } }, 'По графику РВ не выпадает.')),

      ...[...byPlace.entries()].map(([place, list]) => h('div', { class: 'card trip-place', style: { marginBottom: '16px' } },
        h('h3', {}, icon('layers', 16), `${PLACE_KINDS[place] ? PLACE_KINDS[place] + ' ' : ''}${place}`),
        ...list.map((t, i) => tripRow(t, i + 1, now, t === next)))),

      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        st.trips?.list ? h('button', {
          class: 'btn ghost', type: 'button',
          onClick: () => confirmBox('Вернуть даты заездов к утверждённому плану-графику? Ваши правки дат пропадут.', () => {
            update(x => { x.trips = { ...(x.trips || {}), list: null }; }); toast('Даты как в плане-графике'); draw();
          }),
        }, icon('reset', 16), 'Как в плане-графике') : null));
  }

  function tripRow(t, no, now, isNext) {
    const legs = t.parts.map(legInfo);
    const start = legs[0].depart, end = legs[legs.length - 1].to;
    const status = end < now ? 'прошёл' : start <= now ? 'идёт сейчас' : null;
    const daysTo = !status ? Math.round((new Date(start) - new Date(now)) / 864e5) : null;
    const rv = legs.flatMap(l => l.rv);
    const weekdays = legs.reduce((a, l) => a + l.weekdays, 0);
    const weekends = legs.reduce((a, l) => a + l.weekends, 0);
    const holidays = legs.reduce((a, l) => a + l.holidays, 0);
    const isOpen = open.has(t.id);

    const head = h('button', {
      type: 'button', class: 'trip-head', 'aria-expanded': String(isOpen),
      onClick: () => { isOpen ? open.delete(t.id) : open.add(t.id); draw(); },
    },
      h('span', { class: 'trip-no' }, `${no} заезд`),
      h('span', { class: 'trip-dates mono' }, t.parts.map(p => `${ddmm(p.from)}–${ddmmyy(p.to)}`).join(' + ')),
      h('span', { class: 'muted trip-dep' }, `выезд ${ddmm(start)} ${WD[weekday(start)]}`),
      h('span', { class: 'trip-badges' },
        status ? h('span', { class: 'pill' + (status === 'идёт сейчас' ? ' ok' : '') }, status)
          : isNext ? h('span', { class: 'pill cyan' }, `через ${daysTo} ${plural(daysTo, 'день', 'дня', 'дней')}`) : null,
        rv.length ? h('span', { class: 'pill warn' }, `РВ: ${rv.length}`) : h('span', { class: 'pill' }, 'без РВ')),
      h('span', { class: 'trip-chev' + (isOpen ? ' open' : '') }, icon('chevron', 16)));

    if (!isOpen) return h('div', { class: 'trip' + (status === 'прошёл' ? ' past' : '') }, head);

    const strip = h('div', { class: 'trip-strip' }, ...legs.flatMap((l, li) => [
      li ? h('div', { class: 'trip-gap' }, 'перерыв') : null,
      ...l.days.map(d => h('div', {
        class: 'trip-day' + (isWeekend(d) ? ' we' : '') + (HOLIDAYS.has(d) ? ' hol' : '') + (d === l.depart ? ' dep' : '') + (l.rv.some(r => r.date === d) ? ' rv' : '') + (d === now ? ' today' : ''),
        title: `${ddmmyy(d)} ${WD[weekday(d)]}${d === l.depart ? ' · выезд' : ''}${HOLIDAYS.has(d) ? ' · праздник' : ''}`,
      }, h('span', {}, WD[weekday(d)]), h('b', {}, d.slice(8, 10)))),
    ]).filter(Boolean));

    const rvMonths = {};
    for (const r of rv) (rvMonths[r.date.slice(0, 7)] = rvMonths[r.date.slice(0, 7)] || []).push(r);

    return h('div', { class: 'trip open' + (status === 'прошёл' ? ' past' : '') }, head,
      h('div', { class: 'trip-body' },
        strip,
        h('div', { class: 'grid cols-4 trip-stats' },
          stat('В заезде', `${weekdays + weekends + holidays} дн.`, `с выезда ${ddmm(start)} по ${ddmm(end)}`),
          stat('Будних', String(weekdays), 'рабочие дни'),
          stat('Выходных', String(weekends + holidays), holidays ? `из них праздничных: ${holidays}` : 'суббот и воскресений'),
          stat('Учебных по плану', String(t.parts.reduce((a, p) => a + (p.plan || 0), 0)), 'дней занятий в школе')),
        rv.length
          ? h('div', { class: 'trip-rv' },
              h('b', {}, 'РВ: '),
              ...Object.entries(rvMonths).map(([k, list]) => h('div', {},
                `${monthName(k)} — ${list.length}: `, list.map(r => `${ddmm(r.date)} (${r.reason})`).join(', '),
                ' ', h('button', {
                  type: 'button', class: 'btn sm ghost', onClick: () => {
                    const [y, m] = k.split('-').map(Number);
                    const total = tripRvForMonth(y, m).length;
                    update(x => { x.salary.year = y; x.salary.month = m; x.salary.rv = total; x.ui.salaryTab = 'calc'; });
                    toast(`В расчёт за ${monthName(k)} подставлено РВ: ${total}`); go('salary');
                  },
                }, icon('salary', 14), 'в расчёт зарплаты'))))
          : h('p', { class: 'muted', style: { margin: '10px 0 0' } }, 'РВ в этом заезде нет: выезд в будний день, заезд заканчивается не в субботу.'),
        h('div', { style: { marginTop: '10px' } },
          h('button', { type: 'button', class: 'btn sm', onClick: () => editTrip(t) }, icon('pen', 14), 'Изменить даты'))));
  }

  const stat = (label, value, sub) => h('div', { class: 'card' }, h('div', { class: 'stat' },
    h('div', { class: 'label' }, label), h('div', { class: 'value plain', style: { fontSize: '22px' } }, value), h('div', { class: 'sub' }, sub)));

  function editTrip(t) {
    const inputs = t.parts.map(p => ({ from: h('input', { type: 'date', value: p.from }), to: h('input', { type: 'date', value: p.to }) }));
    modal({
      title: `Изменить даты · ${t.place}`,
      body: h('div', {},
        ...inputs.map((x, i) => h('div', { class: 'row', style: { marginBottom: '10px' } },
          h('label', { class: 'field' }, h('span', {}, inputs.length > 1 ? `Часть ${i + 1}: начало` : 'Начало заезда'), x.from),
          h('label', { class: 'field' }, h('span', {}, 'Конец'), x.to))),
        h('p', { class: 'muted', style: { fontSize: '12.5px', margin: 0 } }, 'Выезд считается за день до начала.')),
      okText: 'Сохранить',
      onOk: () => {
        if (inputs.some(x => !x.from.value || !x.to.value || x.from.value > x.to.value)) { toast('Проверьте даты', 'err'); return false; }
        update(x => {
          const list = tripsList(x).map(z => ({ ...z, parts: z.parts.map(p => ({ ...p })) }));
          const it = list.find(z => z.id === t.id);
          it.parts = it.parts.map((p, i) => ({ ...p, from: inputs[i].from.value, to: inputs[i].to.value }));
          x.trips = { ...(x.trips || {}), list };
        });
        toast('Даты заезда сохранены'); draw();
      },
    });
  }

  draw();
}
