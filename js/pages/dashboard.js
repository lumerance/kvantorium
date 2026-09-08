// Обзорная страница: состояние импортов, ближайшие занятия, часы и зарплата одним взглядом.
import { h, statCard, hoursFmt, money0, dateRu, emptyState, WEEKDAY_SHORT, MONTHS } from '../core/ui.js';
import { getState, lessonsForGroup, allGroups } from '../core/store.js';
import { computeHours } from './hours.js';
import { calcAll, RATE_LABELS } from './salary.js';
import { go } from '../core/router.js';
import { SHIFTS } from './journal.js';

export function render(root) {
  const st = getState();
  const c = computeHours(st);
  const s = st.salary;
  const r = calcAll({ base: s.base, intensive: s.intensive, quality: s.quality, gph: s.gph, ndfl: s.ndfl, district: s.district, north: s.north, workDays: s.workDays, rv: s.rv, rate: s.rate, hasGph: s.hasGph });
  const formatLabel = (RATE_LABELS[r.rate] || RATE_LABELS[1]) + (r.hasGph ? ' + ГПХ' : '');

  root.append(h('div', { class: 'page-head' },
    h('div', {},
      h('h1', {}, 'Рабочий стол педагога'),
      h('p', {}, 'Журнал, часы по индивидуальному плану и расчёт зарплаты — в одном месте. Данные хранятся только в этом браузере.')),
    h('div', { class: 'head-actions' },
      h('button', { class: 'btn primary', onClick: () => go('data') }, '⤒ Импорт документов'))));

  const groups = allGroups(st);
  const loadedShifts = SHIFTS.filter(sh => st.schedules[String(sh)]);
  const marksCount = countMarks(st);

  root.append(h('div', { class: 'grid cols-4', style: { marginBottom: '16px' } },
    statCard('Групп в журнале', String(groups.length), `${st.students?.stats.students || 0} обучающихся`),
    statCard('Заездов загружено', `${loadedShifts.length} / 3`, loadedShifts.length ? `заезды: ${loadedShifts.join(', ')}` : 'расписание не загружено', 'cyan'),
    statCard('Закрыто часов', hoursFmt(c.total.done), `из ${hoursFmt(c.norm)} · осталось ${hoursFmt(Math.max(0, c.norm - c.total.done))}`, 'amber'),
    statCard('Зарплата на руки', money0(r.withGph), `${formatLabel} · ${MONTHS[s.month - 1]} ${s.year}`, ''),
  ));

  root.append(h('div', { class: 'grid cols-2', style: { marginBottom: '16px' } },
    h('div', { class: 'card' },
      h('h3', {}, 'Готовность к работе'),
      checklist([
        [!!st.students, 'Список обучающихся импортирован', st.students ? `${st.students.stats.groups} групп` : 'нужен docx со списком детей'],
        [loadedShifts.length > 0, 'Расписание заездов загружено', `${loadedShifts.length} из 3 заездов`],
        [Object.keys(st.mapping).length > 0, 'Группы сопоставлены с расписанием', `${Object.keys(st.mapping).length} кодов связано`],
        [!!st.plan, 'Индивидуальный план импортирован', st.plan ? `${Math.round(st.plan.totals.all)} ч по плану` : 'нужен xlsx с планом'],
        [marksCount > 0, 'Отметки в журнале', `${marksCount} отметок`],
      ]),
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' } },
        h('button', { class: 'btn sm', onClick: () => go('data') }, 'Данные'),
        h('button', { class: 'btn sm', onClick: () => go('journal') }, 'Журнал'),
        h('button', { class: 'btn sm', onClick: () => go('hours') }, 'Часы'),
        h('button', { class: 'btn sm', onClick: () => go('salary') }, 'Зарплата'))),
    upcomingCard(st),
  ));

  root.append(h('div', { class: 'grid cols-2' },
    h('div', { class: 'card' },
      h('h3', {}, 'Часы по индивидуальному плану'),
      kindLine('Учебные', c.done.teaching, c.target.teaching),
      kindLine('Методические', c.done.method, c.target.method),
      h('p', { class: 'muted', style: { fontSize: '12.5px', marginTop: '12px', marginBottom: 0 } },
        'Норма делится поровну между учебными и методическими часами.')),
    h('div', { class: 'card' },
      h('h3', {}, 'Сравнение форматов оплаты'),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, `${formatLabel}, на руки`), h('span', { class: 'v neon-text' }, money0(r.withGph))),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, '1,5 ставки официально, на руки'), h('span', { class: 'v' }, money0(r.oneHalf.net))),
      h('div', { class: 'kv total' },
        h('span', { class: 'k' }, r.benefit >= 0 ? 'Выгода текущего формата' : 'Проигрыш текущего формата'),
        h('span', { class: 'v' }, (r.benefit >= 0 ? '+' : '−') + money0(Math.abs(r.benefit)) + ' / мес')),
      h('p', { class: 'muted', style: { fontSize: '12.5px', marginTop: '10px', marginBottom: 0 } },
        `Расчёт при ${s.workDays} рабочих днях и ${s.rv} РВ.`)),
  ));
}

function kindLine(label, done, target) {
  const pct = target > 0 ? Math.min(100, done / target * 100) : 0;
  return h('div', { style: { margin: '12px 0' } },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' } },
      h('span', {}, label),
      h('span', { class: 'mono' }, `${hoursFmt(done)} / ${hoursFmt(target)}`)),
    h('div', { class: 'progress' }, h('i', { style: { width: pct + '%' } })));
}

function checklist(items) {
  return h('div', {}, ...items.map(([ok, title, sub]) => h('div', { style: { display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '7px 0' } },
    h('span', { class: 'pill ' + (ok ? 'ok' : 'warn'), style: { flex: 'none' } }, ok ? '✓' : '—'),
    h('div', {}, h('div', { style: { fontSize: '13.5px' } }, title),
      h('div', { class: 'muted', style: { fontSize: '12px' } }, sub)))));
}

function upcomingCard(st) {
  const today = new Date().toISOString().slice(0, 10);
  const all = [];
  for (const sh of SHIFTS) {
    const sc = st.schedules[String(sh)];
    if (!sc) continue;
    for (const l of sc.lessons) all.push({ ...l, shift: sh });
  }
  all.sort((a, b) => a.date.localeCompare(b.date) || a.no - b.no);
  const future = all.filter(l => l.date >= today);
  const past = future.length === 0;
  const near = past ? all.slice(-12) : future.slice(0, 12);

  const body = near.length
    ? h('div', { class: 'table-wrap', style: { maxHeight: '330px' } },
        h('table', { class: 'compact' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Дата'), h('th', {}, 'День'), h('th', { class: 'num' }, '№'), h('th', {}, 'Время'), h('th', {}, 'Код'), h('th', {}, 'Группа'))),
          h('tbody', {}, ...near.map(l => {
            const m = st.mapping[l.code];
            const g = m ? allGroups(st).find(x => x.group.id === m.groupId) : null;
            return h('tr', {},
              h('td', { class: 'mono' }, dateRu(l.date)),
              h('td', {}, WEEKDAY_SHORT[l.weekday] || l.weekday),
              h('td', { class: 'num' }, l.no),
              h('td', { class: 'mono' }, l.time),
              h('td', {}, l.code),
              h('td', { class: g ? '' : 'muted' }, g ? `${g.subject.title.split('(')[0].trim()} · ${g.group.name}` : 'не сопоставлено'));
          }))))
    : emptyState('🗓', 'Ближайших занятий нет — загрузите расписание заездов.');

  return h('div', { class: 'card' },
    h('h3', {}, past && near.length ? 'Последние занятия по расписанию' : 'Ближайшие занятия'),
    past && near.length ? h('div', { class: 'card-sub' }, 'Все загруженные занятия уже прошли — показаны последние по датам.') : null,
    body);
}

function countMarks(st) {
  let n = 0;
  for (const sh of Object.values(st.journal || {}))
    for (const g of Object.values(sh || {}))
      for (const s of Object.values(g || {})) n += Object.keys(s || {}).length;
  return n;
}
