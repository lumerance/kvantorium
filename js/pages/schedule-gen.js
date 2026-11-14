// «Расписание занятий» (Документы): окно с параметрами заезда → расстановка
// уроков по часам КТП → редактируемый предпросмотр → Word по образцу.
//
// Группы и часы берутся из выбранной агломерации: сетевые группы — по
// сопоставлению кодов расписания, группы ДО — из «Набора»; часы за заезд —
// из привязанной КТП (обычно 12 + 12 + 10 и 12 + 12 + 12). Если в
// агломерации ещё нет кодов (новый набор), группы добавляются вручную.
import { h, toast, modal, download } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { getState, update, allAgglomerations, viewedAgg } from '../core/store.js';
import { isDoCode } from '../parsers/schedule.js';
import { programHours, defaultShiftHours } from '../parsers/ktp.js';
import { placeOfAgg, placeTitle } from '../data/places.js';
import { buildSchedule, schoolDays, countPlaced, checkGrid, weeksOf, weekdayIdx, DEFAULT_TIMES } from '../lib/schedule-build.js';
import { buildScheduleDocx } from '../exporters/schedule-docx.js';

const DEFAULT_KV = { title: 'Руководитель МТ «Кванториум-28» №1', head: 'О.В. Гончарук' };
const natural = (a, b) => a.localeCompare(b, 'ru', { numeric: true });
const shortDate = (iso) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y.slice(2)}`; };
const WD_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/** «Рафальский Константин Евгеньевич» -> «Рафальский К.» */
const teacherShort = (fio) => {
  const [last, first] = String(fio || '').trim().split(/\s+/);
  return last ? `${last}${first ? ' ' + first[0] + '.' : ''}` : '';
};

/** Учебный год заезда: «2026 - 2027». */
function yearLabel(from) {
  const [y, m] = (from || new Date().toISOString()).split('-').map(Number);
  const a = m >= 9 ? y : y - 1;
  return `${a} - ${a + 1}`;
}

/** Цвет группы в предпросмотре — стабильный по коду. */
function hue(code) {
  let x = 0;
  for (const ch of code) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return x % 360;
}

/** Группы агломерации с часами на заезд. */
export function groupsOfAgg(agg, shift) {
  const out = new Map();
  const progOf = (gid) => (agg.programs || []).find(p => p.id === (agg.groupPrograms || {})[gid]) || null;
  const hoursFor = (gid, isDo) => {
    const prog = progOf(gid);
    if (prog) {
      const split = prog.shiftHours || defaultShiftHours(programHours(prog));
      return { hours: Number(split[shift - 1]) || 0, source: prog.name };
    }
    return { hours: isDo ? 12 : [12, 12, 10][shift - 1], source: null };
  };
  for (const [code, m] of Object.entries(agg.mapping || {})) {
    if (!m?.groupId) continue;
    out.set(code, { code, isDo: isDoCode(code), ...hoursFor(m.groupId, false), on: true });
  }
  for (const g of agg.enroll?.groups || []) {
    if (!g.code) continue;
    out.set(g.code, { code: g.code, isDo: true, ...hoursFor(g.id, true), on: true });
  }
  // коды из загруженных расписаний, ещё не сопоставленные — выключены по умолчанию
  for (const sh of ['1', '2', '3']) for (const c of agg.schedules?.[sh]?.codes || []) {
    if (!out.has(c)) out.set(c, { code: c, isDo: isDoCode(c), hours: isDoCode(c) ? 12 : [12, 12, 10][shift - 1], source: null, on: false });
  }
  return [...out.values()].sort((a, b) => (a.isDo - b.isDo) || natural(a.code, b.code));
}

export function openScheduleGenerator() {
  const st = getState();
  const aggs = allAgglomerations(st);
  const cfg = st.scheduleGen || {};
  const draftKey = (aggId, shift) => `${aggId}|${shift}`;

  const state = {
    aggId: viewedAgg(st).id,
    shift: 1,
    from: '', to: '',
    fiveDay: !!cfg.fiveDay,
    groups: [],
    school: { name: '', locality: '', director: '' },
    kv: { ...DEFAULT_KV, ...(cfg.kv || {}) },
    direction: '',
    comment: '',
    variant: 0,
    grid: null,
    second: { enabled: true, direction: '', first: true, ...(cfg.second || {}) },
  };

  const aggOf = () => aggs.find(a => a.id === state.aggId) || aggs[0];
  const placeOf = () => placeOfAgg(aggOf());

  /** Подставляет всё, что известно об агломерации/заезде (и черновик, если есть). */
  function loadContext() {
    const agg = aggOf();
    const sch = agg.schedules?.[String(state.shift)];
    const draft = (getState().scheduleDrafts || {})[draftKey(state.aggId, state.shift)];
    const place = placeOf();
    const saved = (getState().scheduleGen?.schools || {})[place || '_'] || {};
    state.school = { name: saved.name || '', locality: saved.locality || (place ? `${placeTitle(place)} Амурской области` : ''), director: saved.director || '' };
    const prof = getState().docsProfile || {};
    const plan = getState().plan || {};
    const kv = prof.kvantum || plan.direction || '';
    const teacher = teacherShort(prof.teacher || plan.teacher || '');
    state.direction = getState().scheduleGen?.direction || (kv ? `${kv}${teacher ? ` (${teacher})` : ''}` : teacher);
    state.groups = groupsOfAgg(agg, state.shift);
    if (draft) {
      Object.assign(state, { from: draft.from, to: draft.to, fiveDay: draft.fiveDay, variant: draft.variant || 0 });
      if (draft.groups?.length) state.groups = draft.groups;
      state.grid = draft.grid;
    } else {
      state.from = sch?.dates?.[0] || '';
      state.to = sch?.dates?.[sch.dates.length - 1] || '';
      state.grid = null;
    }
    const hrs = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'час' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'часа' : 'часов'}`;
    const doHours = state.groups.find(g => g.isDo && g.on)?.hours;
    state.comment = getState().scheduleGen?.comment ||
      ['Комментарий:', 'Количество занятий группы в день – не более 3-х.', doHours ? `За заезд выдаётся ${hrs(doHours)} программы в группе.` : ''].filter(Boolean).join('\n');
  }

  const body = h('div', { class: 'sg' });
  const fill = (...kids) => body.replaceChildren(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));
  const dlg = modal({ wide: 'xl', title: [icon('calendar', 18), ' Расписание занятий'], body, cancelText: 'Закрыть' });

  /* ----------------------- шаг 1: параметры ----------------------- */
  function step1() {
    const days = schoolDays(state.from, state.to, state.fiveDay);
    const aggSel = h('select', { onChange: (e) => { state.aggId = e.target.value; loadContext(); step1(); } },
      ...aggs.map(a => h('option', { value: a.id, selected: a.id === state.aggId }, a.name + (placeOfAgg(a) && !a.name.includes(placeOfAgg(a)) ? ` · ${placeOfAgg(a)}` : ''))));
    const shiftSel = h('div', { class: 'tabs', role: 'radiogroup', 'aria-label': 'Заезд' },
      ...[1, 2, 3].map(s => h('button', { type: 'button', class: 'tab' + (s === state.shift ? ' active' : ''), onClick: () => { state.shift = s; loadContext(); step1(); } }, `${s} заезд`)));
    const date = (key) => h('input', { type: 'date', value: state[key], onChange: (e) => { state[key] = e.target.value; state.grid = null; step1(); } });
    const txt = (obj, key, ph) => h('input', { type: 'text', value: obj[key] || '', placeholder: ph || '', onInput: (e) => { obj[key] = e.target.value; } });

    const total = state.groups.filter(g => g.on).reduce((a, g) => a + (Number(g.hours) || 0), 0);
    const cap = days.length * DEFAULT_TIMES.length;

    const groupRow = (g, i) => h('tr', { class: g.on ? '' : 'muted' },
      h('td', {}, h('label', { class: 'check-pill' + (g.on ? ' on' : '') },
        h('input', { type: 'checkbox', checked: g.on, style: { width: 'auto', margin: 0 }, onChange: (e) => { g.on = e.target.checked; state.grid = null; step1(); } }),
        h('span', { class: 'mono' }, g.code))),
      h('td', {}, h('span', { class: 'pill' + (g.isDo ? ' cyan' : '') }, g.isDo ? 'ДО' : 'сетевая')),
      h('td', {}, h('input', {
        type: 'text', inputmode: 'numeric', value: String(g.hours), style: { width: '64px', textAlign: 'center' },
        onChange: (e) => { g.hours = Math.max(0, parseInt(e.target.value, 10) || 0); state.grid = null; step1(); },
      })),
      h('td', { class: 'muted', style: { fontSize: '12px' } }, g.source ? `по КТП «${g.source}»` : 'обычно'),
      h('td', {}, h('button', { type: 'button', class: 'btn sm ghost icon-btn', title: 'Убрать группу', 'aria-label': 'Убрать группу', onClick: () => { state.groups.splice(i, 1); state.grid = null; step1(); } }, icon('x', 14))));

    const newCode = h('input', { type: 'text', placeholder: 'код, например Т2 НуР5', style: { width: '200px' } });
    const addGroup = () => {
      const c = newCode.value.replace(/\s+/g, ' ').trim();
      if (!c) return;
      if (state.groups.some(g => g.code === c)) return toast('Такая группа уже есть', 'err');
      const isDo = isDoCode(c);
      state.groups.push({ code: c, isDo, hours: isDo ? 12 : [12, 12, 10][state.shift - 1], source: null, on: true });
      state.grid = null; step1();
    };
    newCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addGroup(); } });

    const draft = (getState().scheduleDrafts || {})[draftKey(state.aggId, state.shift)];

    fill(
      h('div', { class: 'grid cols-2' },
        h('div', {},
          h('h4', { class: 'sg-h' }, 'Заезд'),
          h('label', { class: 'field' }, h('span', {}, 'Агломерация'), aggSel),
          h('div', { style: { marginTop: '10px' } }, shiftSel),
          h('div', { class: 'row', style: { marginTop: '10px' } },
            h('label', { class: 'field' }, h('span', {}, 'Первый день заезда'), date('from')),
            h('label', { class: 'field' }, h('span', {}, 'Последний день'), date('to'))),
          h('label', { class: 'check-pill', style: { display: 'inline-flex', marginTop: '10px' } },
            h('input', { type: 'checkbox', checked: state.fiveDay, style: { width: 'auto', margin: 0 }, onChange: (e) => { state.fiveDay = e.target.checked; state.grid = null; step1(); } }),
            h('span', {}, '5-дневная неделя (без суббот)')),
          h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '8px 0 0' } },
            days.length
              ? `Учебных дней: ${days.length} (${days.map(d => `${WD_SHORT[weekdayIdx(d)]} ${shortDate(d).slice(0, 5)}`).join(', ')}). Воскресенье — выходной.`
              : 'Укажите даты заезда.')),
        h('div', {},
          h('h4', { class: 'sg-h' }, 'Шапка: школа'),
          h('label', { class: 'field' }, h('span', {}, 'Школа (после «Директор школы»)'), txt(state.school, 'name', 'МОБУ «Увальская СОШ»')),
          h('div', { class: 'row', style: { marginTop: '10px' } },
            h('label', { class: 'field' }, h('span', {}, 'Населённый пункт'), txt(state.school, 'locality', 'с. Новокиевский Увал Амурской области')),
            h('label', { class: 'field' }, h('span', {}, 'Директор (Фамилия И.О.)'), txt(state.school, 'director', 'Онищенко Н.В.'))),
          h('h4', { class: 'sg-h', style: { marginTop: '14px' } }, 'Шапка: технопарк'),
          h('div', { class: 'row' },
            h('label', { class: 'field' }, h('span', {}, 'Должность'), txt(state.kv, 'title')),
            h('label', { class: 'field' }, h('span', {}, 'И.О. Фамилия'), txt(state.kv, 'head'))),
          h('label', { class: 'field', style: { marginTop: '10px' } }, h('span', {}, 'Направление (педагог) — строка над уроками'), txt(state, 'direction', 'VR/AR/IT (Рафальский К.)')),
          h('h4', { class: 'sg-h', style: { marginTop: '14px' } }, 'Второй педагог'),
          h('label', { class: 'check-pill', style: { display: 'inline-flex' } },
            h('input', { type: 'checkbox', checked: state.second.enabled, style: { width: 'auto', margin: 0 }, onChange: (e) => { state.second.enabled = e.target.checked; step1(); } }),
            h('span', {}, 'Пустая таблица второго педагога (те же даты и уроки — он заполнит сам)')),
          state.second.enabled ? h('div', { class: 'row', style: { marginTop: '10px' } },
            h('label', { class: 'field' }, h('span', {}, 'Направление (педагог)'), txt(state.second, 'direction', 'Робототехника (Приходько А.)')),
            h('label', { class: 'field' }, h('span', {}, 'Где в таблице'),
              h('select', { onChange: (e) => { state.second.first = e.target.value === 'first'; } },
                h('option', { value: 'first', selected: state.second.first }, 'Выше моего блока'),
                h('option', { value: 'last', selected: !state.second.first }, 'Ниже моего блока')))) : null,
          h('label', { class: 'field', style: { marginTop: '10px' } }, h('span', {}, 'Комментарий под расписанием'),
            h('textarea', { rows: 3, onInput: (e) => { state.comment = e.target.value; } }, state.comment)))),

      h('h4', { class: 'sg-h', style: { marginTop: '18px' } }, 'Группы и часы на заезд'),
      state.groups.length ? null : h('p', { class: 'muted', style: { fontSize: '13px' } },
        'В этой агломерации ещё нет сопоставленных групп. Добавьте коды групп вручную — так, как они будут в расписании.'),
      state.groups.length ? h('div', { class: 'table-wrap', style: { maxHeight: '260px' } }, h('table', { class: 'compact' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Группа'), h('th', {}, 'Тип'), h('th', {}, 'Часов'), h('th', {}, 'Откуда'), h('th', {}, ''))),
        h('tbody', {}, ...state.groups.map(groupRow)))) : null,
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' } },
        newCode, h('button', { type: 'button', class: 'btn sm', onClick: addGroup }, icon('plus', 16), 'Добавить группу'),
        h('span', { class: 'muted', style: { marginLeft: 'auto', fontSize: '12.5px' } },
          `Всего ${total} ур. на ${days.length} дн. · вмещается до ${cap}`)),

      h('div', { class: 'sg-actions' },
        draft ? h('button', { type: 'button', class: 'btn', onClick: () => { state.grid = draft.grid; step2(); } }, icon('history', 16), 'Открыть сохранённый вариант') : null,
        h('button', {
          type: 'button', class: 'btn primary',
          onClick: () => {
            if (!days.length) return toast('Укажите даты заезда', 'err');
            if (!state.groups.some(g => g.on && g.hours > 0)) return toast('Отметьте хотя бы одну группу', 'err');
            if (total > cap) return toast(`Уроков (${total}) больше, чем помещается в ${days.length} дн. — проверьте часы и даты`, 'err');
            generate(); step2();
          },
        }, 'Составить расписание', icon('arrowRight', 16))));
  }

  function generate() {
    const days = schoolDays(state.from, state.to, state.fiveDay);
    const r = buildSchedule({ days, groups: state.groups.filter(g => g.on), slotsPerDay: DEFAULT_TIMES.length, variant: state.variant });
    state.grid = r.grid;
    if (r.problems.length) toast(r.problems[0], 'err', 6000);
    saveDraft();
  }

  function saveDraft() {
    const { aggId, shift, from, to, fiveDay, groups, grid, variant } = state;
    const place = placeOf() || '_';
    update(x => {
      x.scheduleDrafts = { ...(x.scheduleDrafts || {}), [draftKey(aggId, shift)]: { from, to, fiveDay, groups, grid, variant, savedAt: new Date().toISOString() } };
      x.scheduleGen = {
        ...(x.scheduleGen || {}), fiveDay, kv: state.kv, direction: state.direction, comment: state.comment, second: state.second,
        schools: { ...(x.scheduleGen?.schools || {}), [place]: { ...state.school } },
      };
    });
  }

  /* ----------------------- шаг 2: предпросмотр ----------------------- */
  function step2() {
    const days = schoolDays(state.from, state.to, state.fiveDay);
    for (const d of days) if (!state.grid[d]) state.grid[d] = Array(DEFAULT_TIMES.length).fill('');
    const codes = state.groups.filter(g => g.on).map(g => g.code);
    const placed = countPlaced(Object.fromEntries(days.map(d => [d, state.grid[d]])));
    const issues = checkGrid(Object.fromEntries(days.map(d => [d, state.grid[d]])));
    const bad = new Set(issues.map(i => `${i.date}|${i.code}`));
    const weeks = weeksOf(days, state.fiveDay);

    const cellSel = (d, i) => {
      const v = state.grid[d][i] || '';
      const sel = h('select', {
        class: 'sg-cell' + (v ? ' on' : '') + (bad.has(`${d}|${v}`) ? ' bad' : ''),
        style: v ? `--h:${hue(v)}` : null,
        'aria-label': `${shortDate(d)}, ${i + 1} урок`,
        onChange: (e) => { state.grid[d][i] = e.target.value; saveDraft(); step2(); },
      }, h('option', { value: '' }, '—'), ...codes.map(c => h('option', { value: c, selected: c === v }, c)),
        v && !codes.includes(v) ? h('option', { value: v, selected: true }, v) : null);
      return sel;
    };

    const weekTable = (w) => h('div', { class: 'table-wrap sg-week' }, h('table', { class: 'compact sg-table' },
      h('thead', {},
        h('tr', {}, h('th', {}, `${w.no} неделя`), ...w.days.map(d => h('th', { class: d.date ? '' : 'muted' }, d.weekday, h('br'), d.date ? shortDate(d.date) : '—')))),
      h('tbody', {}, ...DEFAULT_TIMES.map((t, i) => h('tr', {},
        h('td', { class: 'sg-time' }, h('b', {}, `${i + 1}.`), ` ${t}`),
        ...w.days.map(d => h('td', {}, d.date ? cellSel(d.date, i) : null)))))));

    const counters = h('div', { class: 'sg-counters' }, ...state.groups.filter(g => g.on).map(g => {
      const n = placed[g.code] || 0;
      const ok = n === Number(g.hours);
      return h('span', { class: 'sg-count' + (ok ? ' ok' : ' warn'), style: `--h:${hue(g.code)}`, title: ok ? 'Часы совпадают' : `Нужно ${g.hours} ч` },
        h('i', {}), h('span', { class: 'mono' }, g.code), h('b', { class: 'mono' }, `${n}/${g.hours}`));
    }));

    fill(
      h('div', { class: 'sg-toolbar' },
        h('button', { type: 'button', class: 'btn ghost', onClick: () => step1() }, icon('arrowLeft', 16), 'Параметры'),
        h('span', { class: 'muted', style: { fontSize: '12.5px' } }, `${aggOf().name} · ${state.shift} заезд · ${shortDate(state.from)}–${shortDate(state.to)}`),
        h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          h('button', { type: 'button', class: 'btn', title: 'Расставить заново по-другому', onClick: () => { state.variant++; generate(); step2(); } }, icon('refresh', 16), 'Другой вариант'),
          h('button', { type: 'button', class: 'btn primary', onClick: exportDocx }, icon('download', 16), 'Скачать Word'))),
      counters,
      issues.length
        ? h('p', { class: 'sg-issues' }, icon('alert', 15), issues.slice(0, 4).map(i => `${shortDate(i.date)}: ${i.text}`).join(' · ') + (issues.length > 4 ? ` · и ещё ${issues.length - 4}` : ''))
        : h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '0 0 10px' } },
          'Клетку можно поменять — выберите другую группу или «—». Правки сохраняются сами, к ним можно вернуться позже.' +
          (state.second.enabled ? ' В Word будет ещё пустой блок второго педагога с теми же датами и уроками.' : '')),
      ...weeks.map(weekTable));
  }

  async function exportDocx() {
    const days = schoolDays(state.from, state.to, state.fiveDay);
    const issues = checkGrid(Object.fromEntries(days.map(d => [d, state.grid[d]])));
    try {
      saveDraft();
      const place = placeOf();
      const blob = await buildScheduleDocx({
        school: state.school, kv: state.kv, yearLabel: yearLabel(state.from),
        place: placeTitle(place), shift: state.shift, direction: state.direction,
        days, fiveDay: state.fiveDay, grid: state.grid, times: DEFAULT_TIMES, comment: state.comment, second: state.second,
      });
      download(`Расписание ${place ? place + ' ' : ''}${state.shift} заезд.docx`, blob);
      toast(issues.length ? `Расписание скачано. Обратите внимание: ${issues.length} замечаний` : 'Расписание скачано');
    } catch (e) { console.error(e); toast('Ошибка выгрузки: ' + e.message, 'err'); }
  }

  loadContext();
  step1();
  return dlg;
}
