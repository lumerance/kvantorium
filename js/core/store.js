// Единое хранилище состояния (localStorage) + подписки.
const KEY = 'kvantorium28.state.v1';

export const DEFAULTS = {
  version: 1,
  students: null,               // {subjects, stats, sourceName, importedAt}
  schedules: {},                // {"1": {...}, "2": {...}, "3": {...}}
  mapping: {},                  // код расписания -> {subjectId, groupId}
  journal: {},                  // shift -> groupId -> studentId -> lessonKey -> mark
  plan: null,                   // разобранный индивидуальный план
  hoursLog: [],                 // списанные часы
  hoursSettings: { annualNorm: 2000, source: 'manual' },
  hoursTemplates: [],           // пользовательские шаблоны списаний
  salary: {
    base: 21700,
    // intensive/quality пересчитаны по расчётному листку за июль 2026
    // (3 отработанных дня из 23): доплата за интенсив 2 323,30 → на полный
    // месяц 2 323,30×23/3 ≈ 17 811,97; надбавка за качество 321,91×23/3 ≈ 2 467,98.
    // Проверьте точные суммы у себя в бухгалтерии — при расхождении просто
    // впишите верные числа в поля ниже, это никак не ломает расчёт.
    intensive: 17811.97,
    quality: 2467.98,
    gph: 22142,
    rate: 1,        // официальная ставка: 0.5 / 1 / 1.5
    hasGph: true,   // есть ли вдобавок договор ГПХ (по умолчанию — как раньше)
    ndfl: 13,
    district: 30,
    north: 30,
    workDays: 22,
    rv: 2,
    partialMonth: false,        // неполный месяц (отпуск/больничный часть месяца)
    factDays: null,             // фактически отработано дней при partialMonth
    year: 2026,
    month: new Date().getMonth() + 1,
    calendarOverrides: {},      // "2026-1": 15
    history: [],                // сохранённые расчёты — по одному на месяц (см. «История зарплат»)
    requisites: {                // шапка для выгрузки расчётного листка
      org: 'ГАУ ДПО Амурский областной институт развития образования',
      unit: 'Кванториум',
      position: 'Педагог дополнительного образования',
      fio: '',
      tabNo: '',
    },
  },
  vacation: {
    startYear: 2026,
    startMonth: new Date().getMonth() + 1,
    months: {},                  // "2026-1": {net, excludedDays}
    vacationDays: 14,
    history: [],                 // сохранённые расчёты отпускных
  },
  // Группы дополнительного образования: набор ведёт сам педагог (У1, Д2 …),
  // состав правится вручную, у каждого ребёнка два факта — договор и Навигатор.
  enroll: { groups: [] },       // [{id, name, program, note, createdAt, students:[...]}]
  // «Фактический» журнал — параллельный набор списка/расписания/журнала того
  // же вида, что и основной (официальный): свой импорт, свои группы, свои
  // отметки. Нужен, когда реальный состав занятий отличается от официальных
  // сетевых документов — фамилии в обоих журналах могут совпадать, тогда
  // оценки переносятся кнопкой на официальном журнале (см. js/pages/journal.js).
  actual: {
    students: null,
    schedules: {},
    mapping: {},
    journal: {},
  },
  vedomostHeader: {},           // шапка итоговой ведомости
  vedomostGroups: [],           // группы, попадающие в ведомость
  vedomostMarks: {},            // ручные правки оценок: studentId -> {1,2,3,final}
  ui: {
    journalShift: 1, journalSubject: null, journalGroup: null, salaryTab: 'calc',
    actualJournalShift: 1, actualJournalSubject: null, actualJournalGroup: null,
  },
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function deepDefaults(target, defs) {
  for (const k of Object.keys(defs)) {
    if (target[k] === undefined || target[k] === null && defs[k] !== null) target[k] = clone(defs[k]);
    else if (defs[k] && typeof defs[k] === 'object' && !Array.isArray(defs[k]) && typeof target[k] === 'object') {
      deepDefaults(target[k], defs[k]);
    }
  }
  return target;
}

let state;
try {
  const raw = localStorage.getItem(KEY);
  state = raw ? deepDefaults(JSON.parse(raw), DEFAULTS) : clone(DEFAULTS);
} catch { state = clone(DEFAULTS); }

const listeners = new Set();
let saveTimer = null;

export function getState() { return state; }

export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.error('Не удалось сохранить состояние', e); }
  }, 120);
}

export function update(fn) {
  fn(state);
  save();
  listeners.forEach(l => l(state));
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function resetAll() {
  state = clone(DEFAULTS);
  localStorage.removeItem(KEY);
  listeners.forEach(l => l(state));
}

export function exportBackup() {
  return JSON.stringify({ app: 'kvantorium28', exportedAt: new Date().toISOString(), state }, null, 2);
}

export function importBackup(json) {
  const data = JSON.parse(json);
  const s = data.state || data;
  if (!s || typeof s !== 'object') throw new Error('Некорректный файл резервной копии.');
  state = deepDefaults(s, DEFAULTS);
  save();
  listeners.forEach(l => l(state));
}

/* ---------- удобные выборки ---------- */
// Почти все функции ниже принимают необязательный kind: 'actual' — работать с
// «Фактическим» журналом (st.actual.*) вместо основного «Официального»
// (st.* напрямую). Опущенный kind = официальный, так что все существующие
// вызовы без него ведут себя ровно как раньше.
const ns = (st, kind) => (kind === 'actual' ? st.actual : st);

export function allGroups(st = state, kind = null) {
  const root = ns(st, kind);
  const out = [];
  for (const s of root.students?.subjects || []) {
    for (const g of s.groups) out.push({ subject: s, group: g });
  }
  return out;
}

export function findGroup(groupId, st = state, kind = null) {
  return allGroups(st, kind).find(x => x.group.id === groupId) || null;
}

/**
 * Занятия по коду расписания напрямую — для групп «Набора» (дополнительное
 * образование, которые педагог набирает сам). Такие группы не входят в
 * st.mapping (он только для сетевых предметов из списка обучающихся), код
 * привязывается прямо к записи группы в st.enroll.groups.
 */
export function lessonsForCode(shift, code, st = state, kind = null) {
  const root = ns(st, kind);
  const sch = root.schedules[String(shift)];
  if (!sch || !code) return [];
  return sch.lessons.filter(l => l.code === code)
    .sort((a, b) => a.date.localeCompare(b.date) || a.no - b.no);
}

/** Занятия конкретной группы в заезде — по сопоставленным кодам расписания. */
export function lessonsForGroup(shift, groupId, st = state, kind = null) {
  const root = ns(st, kind);
  const sch = root.schedules[String(shift)];
  if (!sch) return [];
  const codes = Object.entries(root.mapping).filter(([, m]) => m && m.groupId === groupId).map(([c]) => c);
  if (!codes.length) return [];
  const set = new Set(codes);
  return sch.lessons.filter(l => set.has(l.code))
    .sort((a, b) => a.date.localeCompare(b.date) || a.no - b.no);
}

export const lessonKey = (l) => `${l.date}#${l.no}`;

/* ---------- удаление лишних групп и занятий ---------- */

/** Пересчитывает сводку по спискам обучающихся. */
export function recalcStudentStats(st = state, kind = null) {
  const root = ns(st, kind);
  const subs = root.students?.subjects || [];
  if (!root.students) return;
  root.students.stats = {
    subjects: subs.length,
    groups: subs.reduce((a, s) => a + s.groups.length, 0),
    students: subs.reduce((a, s) => a + s.groups.reduce((b, g) => b + g.students.length, 0), 0),
  };
}

/** Убирает следы группы из журнала, сопоставления и (для официального) ведомости. */
function purgeGroup(st, groupId, kind) {
  const root = ns(st, kind);
  for (const sh of Object.keys(root.journal || {})) delete root.journal[sh]?.[groupId];
  for (const [code, m] of Object.entries(root.mapping || {})) if (m?.groupId === groupId) delete root.mapping[code];
  if (kind !== 'actual') st.vedomostGroups = (st.vedomostGroups || []).filter(id => id !== groupId);
}

/** Оставляет только перечисленные группы (по id); предметы без групп удаляются. */
export function keepGroups(keepIds, kind = null) {
  const keep = new Set(keepIds);
  update(st => {
    const root = ns(st, kind);
    for (const sub of root.students?.subjects || []) {
      for (const g of sub.groups) if (!keep.has(g.id)) purgeGroup(st, g.id, kind);
      sub.groups = sub.groups.filter(g => keep.has(g.id));
    }
    if (root.students) root.students.subjects = root.students.subjects.filter(s => s.groups.length);
    recalcStudentStats(st, kind);
    const subjKey = kind === 'actual' ? 'actualJournalSubject' : 'journalSubject';
    const grpKey = kind === 'actual' ? 'actualJournalGroup' : 'journalGroup';
    if (!allGroups(st, kind).some(x => x.group.id === st.ui[grpKey])) {
      const first = allGroups(st, kind)[0];
      st.ui[subjKey] = first?.subject.id || null;
      st.ui[grpKey] = first?.group.id || null;
    }
  });
}

export function removeGroup(groupId, kind = null) {
  const keep = allGroups(state, kind).filter(x => x.group.id !== groupId).map(x => x.group.id);
  keepGroups(keep, kind);
}

export function removeSubject(subjectId, kind = null) {
  const keep = allGroups(state, kind).filter(x => x.subject.id !== subjectId).map(x => x.group.id);
  keepGroups(keep, kind);
}

/** Оставляет в расписании заезда только занятия выбранных педагогов и кодов. */
export function filterSchedule(shift, { teachers, codes } = {}, kind = null) {
  update(st => {
    const root = ns(st, kind);
    const sc = root.schedules[String(shift)];
    if (!sc) return;
    const tSet = teachers ? new Set(teachers) : null;
    const cSet = codes ? new Set(codes) : null;
    sc.lessons = sc.lessons.filter(l =>
      (!tSet || tSet.has(l.teacher)) && (!cSet || cSet.has(l.code) || l.kind === 'event'));
    sc.teachers = [...new Set(sc.lessons.map(l => l.teacher).filter(Boolean))];
    sc.codes = [...new Set(sc.lessons.filter(l => l.kind !== 'event').map(l => l.code))].sort();
    sc.dates = [...new Set(sc.lessons.map(l => l.date))].sort();
  });
}
