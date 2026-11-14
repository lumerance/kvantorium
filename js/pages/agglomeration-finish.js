// «Завершить агломерацию»: закрывает агломерацию для правки и списывает по
// ней часы в «Часы по плану».
//
// Учебные часы — проведённые уроки (1 урок = 1 час) по официальному
// расписанию и группам «Набора» за три заезда. Вид работы урока — по типу
// занятия из привязанной КТП (так же, как КТП раскладывается по урокам в
// журнале, со «сдвигом по КТП»): изучение нового/теория → «Лекция, беседа»,
// защита/итоговое → «Итоговый контроль», остальное → «Практические занятия».
// Уроки без КТП идут как практические — это видно в списке.
// Методические и прочие часы — по нормам ниже. Всё показывается списком,
// каждую строку можно выключить или поправить до списания.
import { h, toast, modal, confirmBox, hoursFmt } from '../core/ui.js';
import { getState, allGroups, lessonsForGroup, lessonsForCode, completeAgglomeration, reopenAgglomeration, createAgglomeration } from '../core/store.js';
import { slotsForShift } from '../parsers/ktp.js';
import { worksCatalog } from './hours.js';
import { BASE_WORKS } from '../data/works.js';

const SHIFTS = [1, 2, 3];
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// Виды работ — ищутся по названию в индивидуальном плане (или в базовом
// справочнике, если план не загружен).
const WORK = {
  lecture: { kind: 'teaching', re: /лекци|бесед/i },
  practice: { kind: 'teaching', re: /практическ/i },
  final: { kind: 'teaching', re: /итогов/i },
  interim: { kind: 'teaching', re: /промежуточ/i },
  journal: { kind: 'method', re: /электронн.*журнал|навигатор/i },
  prep: { kind: 'method', re: /подготовк.*заняти/i },
  schedule: { kind: 'method', re: /расписани/i },
  teams: { kind: 'method', re: /команд/i },
  equipment: { kind: 'method', re: /передач.*оборудов/i },
};

// Нормы на агломерацию / на группу (часы), правятся в диалоге.
const NORMS = { journal: 5, schedule: 2, teams: 4, equipment: 4, prepPerShift: 17, interim: 3, final: 2 };

function findWork(st, key) {
  const w = WORK[key];
  const pick = (list) => list.find(x => x.kind === w.kind && w.re.test(x.title));
  return pick(worksCatalog(st)) || pick(BASE_WORKS) || { id: `${w.kind}:${key}`, kind: w.kind, title: key };
}

/** Тип занятия из КТП -> вид учебной работы. */
export function lessonKind(type) {
  const t = norm(type);
  if (!t) return 'practice';
  if (/защит|итогов|аттестац|зачёт|зачет/.test(t)) return 'final';
  if (/изучени|нового|теори|лекци|ознаком|бесед/.test(t) && !/практическ/.test(t)) return 'lecture';
  return 'practice';
}

/** Строка индивидуального плана для группы — чтобы списание легло в ту же строку отчёта. */
function planRowName(st, code, fallback) {
  const c = norm(code);
  if (c) for (const sh of st.plan?.sheets || []) {
    const e = sh.entries.find(x => norm(x.name).includes(c));
    if (e) return e.name;
  }
  return fallback;
}

const fmtDate = (iso) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };

/** Все группы агломерации с проведёнными уроками и раскладкой по видам работы. */
export function collectGroups(st, agg) {
  const out = [];
  const add = (id, label, code, lessonsOf) => {
    const program = (agg.programs || []).find(p => p.id === (agg.groupPrograms || {})[id]) || null;
    const g = { id, label, code, lecture: 0, practice: 0, final: 0, noKtp: 0, lessons: 0, shifts: 0, dates: [] };
    for (const sh of SHIFTS) {
      const lessons = lessonsOf(sh);
      if (!lessons.length) continue;
      g.shifts++;
      const slots = program ? slotsForShift(program, sh) : [];
      const offset = Number((agg.ktpOffsets || {})[`${id}|${sh}`]) || 0;
      lessons.forEach((l, i) => {
        const slot = slots[i + offset];
        if (!slot) g.noKtp++;
        g[lessonKind(slot?.row?.type)]++;
        g.lessons++;
        g.dates.push(l.date);
      });
    }
    if (!g.lessons) return;
    g.dates.sort();
    g.period = `${fmtDate(g.dates[0])} - ${fmtDate(g.dates[g.dates.length - 1])}`;
    g.subject = planRowName(st, code, `Группа ${code || label}`);
    out.push(g);
  };
  for (const { subject, group } of allGroups(agg)) {
    const codes = Object.entries(agg.mapping || {}).filter(([, m]) => m?.groupId === group.id).map(([c]) => c);
    add(group.id, `${subject.title} · ${group.name}`, codes[0] || group.name, (sh) => lessonsForGroup(sh, group.id, agg));
  }
  for (const g of agg.enroll?.groups || []) {
    if (g.code) add(g.id, `Набор · ${g.name}`, g.code, (sh) => lessonsForCode(sh, g.code, agg));
  }
  return out;
}

/** Предлагаемые записи списания (до правки в диалоге). */
export function proposeItems(st, agg) {
  const groups = collectGroups(st, agg);
  const allDates = groups.flatMap(g => g.dates).sort();
  const lastDate = allDates[allDates.length - 1] || new Date().toISOString().slice(0, 10);
  const aggPeriod = allDates.length ? `${fmtDate(allDates[0])} - ${fmtDate(lastDate)}` : '';
  const items = [];
  const push = (section, key, subject, period, hours, note) => {
    if (!(hours > 0)) return;
    const w = findWork(st, key);
    items.push({ section, key, kind: w.kind, workId: w.id, title: w.title, subject, period, hours, note, include: true, date: lastDate });
  };
  for (const g of groups) {
    const ktpNote = g.noKtp ? `без КТП: ${g.noKtp} ур. — как практические` : '';
    push('lessons', 'lecture', g.subject, g.period, g.lecture, `${g.label} · лекции/беседы по КТП`);
    push('lessons', 'practice', g.subject, g.period, g.practice, `${g.label}${ktpNote ? ' · ' + ktpNote : ''}`);
    push('lessons', 'final', g.subject, g.period, g.final, `${g.label} · защита / итоговое занятие по КТП`);
  }
  for (const g of groups) {
    push('groups', 'prep', g.subject, g.period, NORMS.prepPerShift * g.shifts, `${g.label} · ${NORMS.prepPerShift} ч × заездов: ${g.shifts}`);
    push('groups', 'interim', g.subject, g.period, NORMS.interim, `${g.label} · промежуточный контроль`);
    if (!g.final) push('groups', 'final', g.subject, g.period, NORMS.final, `${g.label} · итоговый контроль (в КТП нет защиты)`);
  }
  push('agg', 'journal', agg.name, aggPeriod, NORMS.journal, 'заполнение электронного журнала за агломерацию');
  push('agg', 'schedule', agg.name, aggPeriod, NORMS.schedule, 'составление расписания');
  push('agg', 'teams', agg.name, aggPeriod, NORMS.teams, 'подготовка и организация работы команд');
  push('agg', 'equipment', agg.name, aggPeriod, NORMS.equipment, 'передача оборудования');
  return { groups, items };
}

const SECTION_TITLES = {
  lessons: 'Проведённые уроки (учебные часы)',
  groups: 'По группам (подготовка, контроль)',
  agg: 'За агломерацию целиком',
};

export function openFinishDialog(agg, redraw) {
  const st = getState();
  const { groups, items } = proposeItems(st, agg);
  const totals = h('div', { class: 'finish-totals' });
  const refresh = () => {
    const on = items.filter(i => i.include && i.hours > 0);
    const t = on.filter(i => i.kind === 'teaching').reduce((a, i) => a + i.hours, 0);
    const m = on.filter(i => i.kind !== 'teaching').reduce((a, i) => a + i.hours, 0);
    totals.replaceChildren(
      h('span', { class: 'pill cyan' }, `учебные: ${hoursFmt(t)}`),
      h('span', { class: 'pill ok' }, `методические и прочие: ${hoursFmt(m)}`),
      h('span', { class: 'pill' }, `всего: ${hoursFmt(t + m)}`));
  };

  const body = h('div', {});
  body.append(h('p', { class: 'muted', style: { marginTop: 0 } },
    `Агломерация «${agg.name}» закроется для правки (журнал, списки, «Набор», КТП — только просмотр), а отмеченные строки спишутся в «Часы по плану». `,
    'Проверьте и поправьте часы — если что-то пошло не так, агломерацию можно открыть снова, списанное при этом уберётся.'));
  if (!groups.length) body.append(h('p', { class: 'pill warn' }, 'В агломерации нет проведённых уроков: расписание не загружено или группы не сопоставлены с кодами.'));
  if (!st.plan) body.append(h('p', { class: 'muted', style: { fontSize: '12.5px' } }, 'Индивидуальный план не загружен — виды работ взяты из базового справочника.'));

  for (const section of ['lessons', 'groups', 'agg']) {
    const rows = items.filter(i => i.section === section);
    if (!rows.length) continue;
    body.append(h('h4', { class: 'finish-h' }, SECTION_TITLES[section]));
    body.append(h('div', { class: 'table-wrap', style: { maxHeight: 'none' } }, h('table', { class: 'compact finish-table' },
      h('colgroup', {}, h('col', { style: { width: '36px' } }), h('col', { style: { width: '34%' } }), h('col', {}), h('col', { style: { width: '92px' } })),
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Вид работы'), h('th', {}, 'Группа / основание'), h('th', { class: 'num' }, 'Часов'))),
      h('tbody', {}, ...rows.map(it => {
        const cb = h('input', { type: 'checkbox', class: 'box', checked: it.include, onChange: (e) => { it.include = e.target.checked; tr.classList.toggle('off', !it.include); refresh(); } });
        const hrs = h('input', { type: 'number', min: '0', step: '0.5', value: String(it.hours), class: 'finish-hours',
          onInput: (e) => { it.hours = Math.max(0, parseFloat(e.target.value) || 0); refresh(); } });
        const tr = h('tr', {},
          h('td', {}, cb),
          h('td', {}, h('div', { class: 'finish-work' }, it.title), h('span', { class: 'pill ' + (it.kind === 'teaching' ? 'cyan' : 'ok') }, it.kind === 'teaching' ? 'учебная' : 'методическая')),
          h('td', {}, h('div', {}, it.subject), h('div', { class: 'muted', style: { fontSize: '11.5px' } }, [it.note, it.period].filter(Boolean).join(' · '))),
          h('td', { class: 'num' }, hrs));
        return tr;
      })))));
  }
  body.append(totals);
  refresh();

  modal({
    wide: 'xl', title: `Завершить агломерацию «${agg.name}»`, body,
    okText: 'Завершить и списать часы',
    onOk: () => {
      const entries = items.filter(i => i.include && i.hours > 0).map(i => ({
        date: i.date, kind: i.kind, workId: i.workId, title: i.title, hours: i.hours,
        note: i.note, subject: i.subject, period: i.period,
      }));
      const n = completeAgglomeration(agg.id, entries);
      toast(`Агломерация завершена, списано записей: ${n}`);
      redraw();
      afterFinish(redraw);
    },
  });
}

/** После завершения активной агломерации — предложить сразу завести новую. */
function afterFinish(redraw) {
  const nameInput = h('input', { type: 'text', placeholder: 'Например, «Агломерация 2»' });
  modal({
    title: 'Начать новую агломерацию?',
    body: h('div', {},
      h('p', { class: 'muted', style: { marginTop: 0 } }, 'Завершённая агломерация останется доступной для просмотра. Новая начнётся с чистого листа: свои списки, расписание и журнал.'),
      h('label', { class: 'field' }, h('span', {}, 'Название'), nameInput)),
    okText: 'Создать новую', cancelText: 'Позже',
    onOk: () => { createAgglomeration(nameInput.value); toast('Новая агломерация создана и стала активной'); redraw(); },
  });
}

export function confirmReopen(agg, redraw) {
  const c = agg.completion || {};
  confirmBox(`Снова открыть «${agg.name}» для правки? Списанные при завершении часы (учебные ${hoursFmt(c.teaching || 0)}, прочие ${hoursFmt(c.method || 0)}) будут убраны из «Часов по плану» — после правки агломерацию можно завершить заново.`,
    () => { reopenAgglomeration(agg.id); toast('Агломерация снова открыта для правки'); redraw(); });
}

