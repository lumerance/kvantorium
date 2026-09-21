// Единое хранилище состояния (localStorage) + подписки.
import { autoMatch } from '../parsers/schedule.js';

const KEY = 'kvantorium28.state.v1';

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// Один рабочий период («агломерация» — блок из трёх заездов). Всё, что
// относится к конкретному набору детей — списки, расписания, журнал,
// сопоставление, «Набор», КТП-программы, ведомость — живёт внутри
// агломерации целиком, для официального и фактического журнала сразу.
// Когда одна агломерация сменяется другой (новый набор детей на весь
// следующий блок заездов), заводится новая — прежняя не стирается и не
// перезаписывается, а остаётся в списке для просмотра (см. viewedAgg/
// activeAgg ниже и переключатель на странице «Данные»).
const AGG_DEFAULTS = {
  students: null,               // {subjects, stats, sourceName, importedAt}
  schedules: {},                // {"1": {...}, "2": {...}, "3": {...}}
  mapping: {},                  // код расписания -> {subjectId, groupId}
  journal: {},                  // shift -> groupId -> studentId -> lessonKey -> mark
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
    // Свои классы для фактического журнала — те же «группы набора», что и в
    // официальном (js/pages/enroll.js), только без учёта договора/Навигатора:
    // это реальные классы, а не набираемые самим педагогом группы ДО.
    enroll: { groups: [] },
  },
  // Учебные программы с КТП: темы/содержание/тип занятия по часам. Программа
  // привязывается к группе, дальше часы раскладываются по заездам и занятиям
  // официального расписания (см. js/parsers/ktp.js и js/pages/ktp-panel.js).
  programs: [],                 // [{id, name, sourceName, shiftHours:[12,12,12], rows:[{no,theme,content,type,hours}]}]
  groupPrograms: {},            // groupId -> programId
  ktpOffsets: {},               // "groupId|shift" -> сдвиг по КТП, если занятие переносили
  vedomostHeader: {},           // шапка итоговой ведомости
  vedomostGroups: [],           // группы, попадающие в ведомость
  vedomostMarks: {},            // ручные правки оценок: studentId -> {1,2,3,final}
};

function newAgglomeration(name) {
  return {
    id: 'agg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: (name || '').trim() || 'Агломерация',
    createdAt: new Date().toISOString(),
    ...clone(AGG_DEFAULTS),
  };
}

export const DEFAULTS = {
  version: 2,
  agglomerations: [],           // [{id, name, createdAt, ...AGG_DEFAULTS}] — наполняется при первом запуске
  activeAgglomerationId: null,
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
  ui: {
    journalShift: 1, journalSubject: null, journalGroup: null, salaryTab: 'calc',
    actualJournalShift: 1, actualJournalSubject: null, actualJournalGroup: null,
    viewingAgglomerationId: null,   // null = смотрим активную; иначе — архивную (только чтение)
  },
};

function deepDefaults(target, defs) {
  for (const k of Object.keys(defs)) {
    if (target[k] === undefined || target[k] === null && defs[k] !== null) target[k] = clone(defs[k]);
    else if (defs[k] && typeof defs[k] === 'object' && !Array.isArray(defs[k]) && typeof target[k] === 'object') {
      deepDefaults(target[k], defs[k]);
    }
  }
  return target;
}

/** Старый формат (до появления агломераций) хранил students/schedules/…
 *  прямо на верхнем уровне state. Оборачивает их в первую агломерацию —
 *  так апдейт не стирает то, что уже накопил педагог. Не трогает state,
 *  где агломерации уже есть (повторный запуск — no-op). */
let didMigrateLegacy = false;

function migrateLegacy(raw) {
  if (Array.isArray(raw.agglomerations) && raw.agglomerations.length) return raw;
  const legacyKeys = Object.keys(AGG_DEFAULTS);
  const hasLegacy = legacyKeys.some(k => raw[k] !== undefined);
  const agg = newAgglomeration('Агломерация 1');
  for (const k of legacyKeys) {
    if (raw[k] !== undefined) agg[k] = raw[k];
    delete raw[k];
  }
  if (hasLegacy || !raw.agglomerations) {
    raw.agglomerations = [agg];
    raw.activeAgglomerationId = agg.id;
    didMigrateLegacy = true;
  }
  return raw;
}

/** Приводит сырой объект (из localStorage или из импортированного бэкапа)
 *  к текущей форме: миграция старого плоского формата, доподстановка
 *  дефолтов на верхнем уровне и отдельно внутри каждой агломерации
 *  (массивы deepDefaults не обходит — см. её реализацию), гарантия что
 *  агломерация есть хотя бы одна и activeAgglomerationId на неё указывает. */
function finalizeState(raw) {
  const s = deepDefaults(migrateLegacy(raw), DEFAULTS);
  if (!s.agglomerations.length) s.agglomerations.push(newAgglomeration('Агломерация 1'));
  for (const agg of s.agglomerations) deepDefaults(agg, AGG_DEFAULTS);
  if (!s.agglomerations.some(a => a.id === s.activeAgglomerationId)) {
    s.activeAgglomerationId = s.agglomerations[0].id;
  }
  return s;
}

let state;
try {
  const raw = localStorage.getItem(KEY);
  state = finalizeState(raw ? JSON.parse(raw) : clone(DEFAULTS));
} catch { state = finalizeState(clone(DEFAULTS)); }
// Перевод в формат с агломерациями должен сохраниться сразу, а не только
// при следующей правке — иначе педагог мог бы открыть журнал, ничего не
// поменять, закрыть вкладку, а localStorage остался бы в старом плоском
// виде (следующий запуск просто смигрировал бы заново — не потеря данных,
// но лучше зафиксировать сразу и синхронно, не дожидаясь debounce у save()).
if (didMigrateLegacy) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { console.error('Не удалось сохранить состояние после перехода на агломерации', e); }
}

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
  state = finalizeState(clone(DEFAULTS));
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
  state = finalizeState(s);
  save();
  listeners.forEach(l => l(state));
}

/* ---------- агломерации ---------- */

/** Активная агломерация — та, куда идёт вся новая работа и куда пишут
 *  все мутирующие функции ниже, независимо от того, что сейчас открыто
 *  на экране (см. viewedAgg). */
export function activeAgg(st = state) {
  return st.agglomerations.find(a => a.id === st.activeAgglomerationId) || st.agglomerations[0];
}

/** Просматриваемая агломерация — обычно совпадает с активной; на странице
 *  «Данные» можно временно переключиться на просмотр архивной
 *  (st.ui.viewingAgglomerationId) — страницы должны открывать её только
 *  для чтения (см. isViewingArchive). */
export function viewedAgg(st = state) {
  const id = st.ui?.viewingAgglomerationId;
  if (!id) return activeAgg(st);
  return st.agglomerations.find(a => a.id === id) || activeAgg(st);
}

export function isViewingArchive(st = state) {
  return viewedAgg(st).id !== activeAgg(st).id;
}

export function allAgglomerations(st = state) {
  return st.agglomerations.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Заводит новую агломерацию и сразу делает её активной — прежняя остаётся
 *  в списке, доступная через переключатель просмотра. */
export function createAgglomeration(name) {
  const agg = newAgglomeration(name);
  update(x => {
    x.agglomerations.push(agg);
    x.activeAgglomerationId = agg.id;
    x.ui.viewingAgglomerationId = null;
  });
  return agg.id;
}

export function renameAgglomeration(id, name) {
  const clean = (name || '').trim();
  if (!clean) return;
  update(x => {
    const a = x.agglomerations.find(a => a.id === id);
    if (a) a.name = clean;
  });
}

/** Переключает, какая агломерация сейчас ПРОСМАТРИВАЕТСЯ. На то, куда
 *  пишутся новые данные, не влияет — писать можно только в активную. */
export function switchViewedAgglomeration(id) {
  update(x => {
    x.ui.viewingAgglomerationId = (id === x.activeAgglomerationId) ? null : id;
  });
}

/** Делает уже существующую агломерацию активной (например, вернулись
 *  доработать прошлую), в отличие от createAgglomeration, которая всегда
 *  заводит новую с нуля. */
export function setActiveAgglomeration(id) {
  update(x => {
    if (!x.agglomerations.some(a => a.id === id)) return;
    x.activeAgglomerationId = id;
    x.ui.viewingAgglomerationId = null;
  });
}

/** Удаляет агломерацию из списка — нельзя удалить последнюю оставшуюся.
 *  Если удаляемая была активной/просматриваемой, откатывается на первую. */
export function deleteAgglomeration(id) {
  update(x => {
    if (x.agglomerations.length <= 1) return;
    x.agglomerations = x.agglomerations.filter(a => a.id !== id);
    if (x.activeAgglomerationId === id) x.activeAgglomerationId = x.agglomerations[0].id;
    if (x.ui.viewingAgglomerationId === id) x.ui.viewingAgglomerationId = null;
  });
}

/* ---------- удобные выборки ---------- */
// Почти все функции ниже принимают необязательный kind: 'actual' — работать с
// «Фактическим» журналом (agg.actual.*) вместо основного «Официального»
// (agg.* напрямую). Опущенный kind = официальный. st/agg здесь — объект
// агломерации (см. activeAgg/viewedAgg), а не весь стейт приложения целиком:
// у агломерации ровно та форма (students/schedules/mapping/journal/actual/…),
// что и была у верхнего уровня state до появления агломераций, поэтому вся
// логика ниже не менялась — только то, что ей передают на входе.
const ns = (st, kind) => (kind === 'actual' ? st.actual : st);

export function allGroups(st = activeAgg(), kind = null) {
  const root = ns(st, kind);
  const out = [];
  for (const s of root.students?.subjects || []) {
    for (const g of s.groups) out.push({ subject: s, group: g });
  }
  return out;
}

export function findGroup(groupId, st = activeAgg(), kind = null) {
  return allGroups(st, kind).find(x => x.group.id === groupId) || null;
}

/**
 * Занятия по коду расписания напрямую — для групп «Набора» (дополнительное
 * образование, которые педагог набирает сам). Такие группы не входят в
 * st.mapping (он только для сетевых предметов из списка обучающихся), код
 * привязывается прямо к записи группы в st.enroll.groups.
 */
export function lessonsForCode(shift, code, st = activeAgg(), kind = null) {
  const root = ns(st, kind);
  const sch = root.schedules[String(shift)];
  if (!sch || !code) return [];
  return sch.lessons.filter(l => l.code === code)
    .sort((a, b) => a.date.localeCompare(b.date) || a.no - b.no);
}

/** Занятия конкретной группы в заезде — по сопоставленным кодам расписания. */
export function lessonsForGroup(shift, groupId, st = activeAgg(), kind = null) {
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
export function recalcStudentStats(st = activeAgg(), kind = null) {
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
function purgeGroup(agg, groupId, kind) {
  const root = ns(agg, kind);
  for (const sh of Object.keys(root.journal || {})) delete root.journal[sh]?.[groupId];
  for (const [code, m] of Object.entries(root.mapping || {})) if (m?.groupId === groupId) delete root.mapping[code];
  if (kind !== 'actual') agg.vedomostGroups = (agg.vedomostGroups || []).filter(id => id !== groupId);
}

/** Оставляет только перечисленные группы (по id); предметы без групп удаляются.
 *  Всегда действует на активную агломерацию (см. activeAgg). */
export function keepGroups(keepIds, kind = null) {
  const keep = new Set(keepIds);
  update(x => {
    const agg = activeAgg(x);
    const root = ns(agg, kind);
    for (const sub of root.students?.subjects || []) {
      for (const g of sub.groups) if (!keep.has(g.id)) purgeGroup(agg, g.id, kind);
      sub.groups = sub.groups.filter(g => keep.has(g.id));
    }
    if (root.students) root.students.subjects = root.students.subjects.filter(s => s.groups.length);
    recalcStudentStats(agg, kind);
    const subjKey = kind === 'actual' ? 'actualJournalSubject' : 'journalSubject';
    const grpKey = kind === 'actual' ? 'actualJournalGroup' : 'journalGroup';
    if (!allGroups(agg, kind).some(g2 => g2.group.id === x.ui[grpKey])) {
      const first = allGroups(agg, kind)[0];
      x.ui[subjKey] = first?.subject.id || null;
      x.ui[grpKey] = first?.group.id || null;
    }
  });
}

export function removeGroup(groupId, kind = null) {
  const keep = allGroups(activeAgg(state), kind).filter(x => x.group.id !== groupId).map(x => x.group.id);
  keepGroups(keep, kind);
}

export function removeSubject(subjectId, kind = null) {
  const keep = allGroups(activeAgg(state), kind).filter(x => x.subject.id !== subjectId).map(x => x.group.id);
  keepGroups(keep, kind);
}

/** Сопоставляет ещё не сопоставленные коды расписания с группами из списка
 *  обучающихся автоматически (по grade/префиксу — см. parsers/schedule.js).
 *  kind как везде: 'actual' — фактический журнал, иначе официальный.
 *  Всегда действует на активную агломерацию. */
export function autoMapAll(kind = null) {
  const agg = activeAgg(state);
  const data = ns(agg, kind);
  const subjects = data.students?.subjects || [];
  if (!subjects.length) return 0;
  const codes = new Set();
  for (const sh of [1, 2, 3]) for (const c of (data.schedules[String(sh)]?.codes || [])) codes.add(c);
  let n = 0;
  update(x => {
    const root = ns(activeAgg(x), kind);
    for (const c of codes) {
      if (root.mapping[c]) continue;
      const m = autoMatch(c, subjects);
      if (m) { root.mapping[c] = m; n++; }
    }
  });
  return n;
}

/** Оставляет в расписании заезда только занятия выбранных педагогов и кодов.
 *  Всегда действует на активную агломерацию. */
export function filterSchedule(shift, { teachers, codes } = {}, kind = null) {
  update(x => {
    const root = ns(activeAgg(x), kind);
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
