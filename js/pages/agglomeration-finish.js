// «Завершить агломерацию»: закрывает агломерацию для правки и списывает по
// ней часы в «Часы по плану» — так, как они расписаны в индивидуальном плане.
//
// Как устроен план (лист «учебная» / «Метод, Восп»): строка на группу (её
// код из расписания — «Т2 РШ7», «Д1 ВШ»), группы одной агломерации идут
// блоком под одним периодом.
//  · Учебные часы группы — это все её уроки: лекции + практика +
//    промежуточный + итоговый контроль = 34 (или 36) уроков программы.
//    Контроль — часть уроков, а не сверху. Деление уроков — по типу занятия
//    из КТП или как в строке группы в плане (переключатель в окне).
//  · Подготовка к занятиям (17 / 18 ч) и консультации для родителей (3 ч у
//    групп ДО) — на группу за всю агломерацию.
//  · Расписание, электронный журнал, организация команд, передача
//    оборудования — за агломерацию, в первой строке блока.
//  · Разработка программ и дидактики, работа с оборудованием стоят в плане
//    не на каждую агломерацию — их не трогаем, они списываются вручную.
// Без плана — те же правила с нормами по умолчанию. Всё показывается
// списком, любую строку можно выключить или поправить до списания.
import { h, toast, modal, confirmBox, hoursFmt } from '../core/ui.js';
import { getState, allGroups, lessonsForGroup, lessonsForCode, completeAgglomeration, reopenAgglomeration, createAgglomeration } from '../core/store.js';
import { slotsForShift } from '../parsers/ktp.js';
import { isDoCode } from '../parsers/schedule.js';
import { worksCatalog } from './hours.js';
import { BASE_WORKS } from '../data/works.js';
import { planBlocks, placeOfAgg } from '../data/places.js';

const SHIFTS = [1, 2, 3];
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// Виды работ — ищутся по названию в индивидуальном плане (или в базовом
// справочнике, если план не загружен).
const WORK = {
  lecture: { kind: 'teaching', re: /лекци|бесед/i },
  practice: { kind: 'teaching', re: /практическ/i },
  interim: { kind: 'teaching', re: /промежуточ/i },
  final: { kind: 'teaching', re: /итогов/i },
  prep: { kind: 'method', re: /подготовк.*заняти/i },
  parents: { kind: 'method', re: /консультац.*родител/i },
  schedule: { kind: 'method', re: /расписани/i },
  journal: { kind: 'method', re: /электронн.*журнал|навигатор/i },
  teams: { kind: 'method', re: /организац.*команд/i },
  equipment: { kind: 'method', re: /передач.*оборудов/i },
};
const LESSON_KEYS = ['lecture', 'practice', 'interim', 'final'];
const AGG_KEYS = ['schedule', 'journal', 'teams', 'equipment'];
const LESSON_SHORT = { lecture: 'Л', practice: 'П', interim: 'ПК', final: 'ИК' };

// Нормы по умолчанию — когда в плане нет строки группы или блока агломерации.
const DEFAULTS = { schedule: 2, journal: 5, teams: 4, equipment: 4, parentsDo: 3 };

function findWork(st, key) {
  const w = WORK[key];
  const pick = (list) => list.find(x => x.kind === w.kind && w.re.test(x.title));
  return pick(worksCatalog(st)) || pick(BASE_WORKS) || { id: `${w.kind}:${key}`, kind: w.kind, title: key };
}

/** Тип занятия из КТП -> вид учебной работы. */
export function lessonKind(type) {
  const t = norm(type);
  if (!t) return 'practice';
  if (/промежуточ|контрольн|тестирован/.test(t)) return 'interim';
  if (/защит|итогов|аттестац|зачёт|зачет/.test(t)) return 'final';
  if (/изучени|нового|теори|лекци|ознаком|бесед/.test(t) && !/практическ/.test(t)) return 'lecture';
  return 'practice';
}

/* ---------- индивидуальный план ---------- */

/** Часы строки плана по виду работы (key из WORK), 0 — если нет. */
function planValue(plan, kind, rowName, key) {
  if (!plan || !rowName) return 0;
  for (const sh of plan.sheets || []) {
    if (sh.kind !== kind) continue;
    const w = sh.works.find(x => WORK[key].re.test(x.title));
    const e = sh.entries.find(x => x.name === rowName);
    if (w && e) return Number(e.hours[w.col]) || 0;
  }
  return 0;
}

/** Строка плана для кода группы (точное совпадение, иначе по вхождению). */
function planRow(plan, code) {
  const c = norm(code);
  if (!plan || !c) return null;
  const all = (plan.sheets || []).flatMap(s => s.entries);
  return (all.find(e => norm(e.name) === c) || all.find(e => norm(e.name).includes(c)))?.name || null;
}

/* ---------- группы и уроки ---------- */

const fmtDate = (iso) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };

/** Все группы агломерации с проведёнными уроками и раскладкой по КТП. */
export function collectGroups(st, agg) {
  const out = [];
  const add = (id, label, code, isDo, lessonsOf) => {
    const program = (agg.programs || []).find(p => p.id === (agg.groupPrograms || {})[id]) || null;
    const g = { id, label, code, isDo, ktp: { lecture: 0, practice: 0, interim: 0, final: 0 }, noKtp: 0, lessons: 0, dates: [] };
    for (const sh of SHIFTS) {
      const lessons = lessonsOf(sh);
      if (!lessons.length) continue;
      const slots = program ? slotsForShift(program, sh) : [];
      const offset = Number((agg.ktpOffsets || {})[`${id}|${sh}`]) || 0;
      lessons.forEach((l, i) => {
        const slot = slots[i + offset];
        if (!slot) g.noKtp++;
        g.ktp[lessonKind(slot?.row?.type)]++;
        g.lessons++;
        g.dates.push(l.date);
      });
    }
    if (!g.lessons) return;
    g.dates.sort();
    g.period = `${fmtDate(g.dates[0])} - ${fmtDate(g.dates[g.dates.length - 1])}`;
    g.planRow = planRow(st.plan, code);
    g.subject = g.planRow || code || label;
    // в отчёте «Сроки проведения» — как в строке плана, если группа в нём есть
    const pe = g.planRow && (st.plan.sheets || []).flatMap(s => s.entries).find(e => e.name === g.planRow);
    if (pe?.period) g.period = pe.period;
    g.plan = Object.fromEntries(LESSON_KEYS.map(k => [k, planValue(st.plan, 'teaching', g.planRow, k)]));
    out.push(g);
  };
  for (const { subject, group } of allGroups(agg)) {
    const codes = Object.entries(agg.mapping || {}).filter(([, m]) => m?.groupId === group.id).map(([c]) => c);
    add(group.id, `${subject.title} · ${group.name}`, codes[0] || group.name, false, (sh) => lessonsForGroup(sh, group.id, agg));
  }
  for (const g of agg.enroll?.groups || []) {
    if (g.code) add(g.id, `Набор · ${g.name}`, g.code, true, (sh) => lessonsForCode(sh, g.code, agg));
  }
  return out;
}

/** Деление n уроков в пропорциях плана (метод наибольшего остатка). */
function splitLikePlan(n, plan) {
  const total = LESSON_KEYS.reduce((a, k) => a + plan[k], 0);
  if (!total) return null;
  const raw = LESSON_KEYS.map(k => ({ k, v: n * plan[k] / total }));
  const out = Object.fromEntries(raw.map(r => [r.k, Math.floor(r.v)]));
  let rest = n - Object.values(out).reduce((a, b) => a + b, 0);
  for (const r of raw.sort((a, b) => (b.v % 1) - (a.v % 1))) { if (rest-- <= 0) break; out[r.k]++; }
  return out;
}

/** Блок плана этой агломерации: период, в котором больше всего её групп. */
function findBlock(st, groups) {
  const blocks = planBlocks(st.plan);
  const names = new Set(groups.map(g => g.planRow).filter(Boolean));
  let best = null, bestN = 0;
  blocks.forEach((b, i) => {
    const n = b.names.filter(x => names.has(x)).length;
    if (n > bestN) { best = { ...b, index: i, next: blocks[i + 1] || null }; bestN = n; }
  });
  return best;
}

/** Предлагаемые записи списания. split: 'ktp' | 'plan'. */
export function proposeItems(st, agg, split = 'ktp') {
  const groups = collectGroups(st, agg);
  const block = findBlock(st, groups);
  const allDates = groups.flatMap(g => g.dates).sort();
  const lastDate = allDates[allDates.length - 1] || new Date().toISOString().slice(0, 10);
  const aggPeriod = allDates.length ? `${fmtDate(allDates[0])} - ${fmtDate(lastDate)}` : '';
  const items = [];
  const push = (section, key, subject, period, hours, note, source) => {
    if (!(hours > 0)) return;
    const w = findWork(st, key);
    items.push({ section, key, kind: w.kind, workId: w.id, title: w.title, subject, period, hours, note, source, include: true, date: lastDate });
  };

  for (const g of groups) {
    const planSplit = split === 'plan' && g.planRow ? splitLikePlan(g.lessons, g.plan) : null;
    const counts = planSplit || g.ktp;
    const how = planSplit ? 'как в плане' : (g.noKtp ? `по КТП, без КТП ${g.noKtp} ур. — как практика` : 'по КТП');
    const planHint = g.planRow ? `план: ${LESSON_KEYS.map(k => `${LESSON_SHORT[k]} ${g.plan[k]}`).join(' · ')}` : 'нет строки в плане';
    for (const k of LESSON_KEYS) push('lessons', k, g.subject, g.period, counts[k], `${g.label} · уроков ${g.lessons} · ${how} · ${planHint}`, planSplit ? 'plan' : 'ktp');
  }
  for (const g of groups) {
    const prep = planValue(st.plan, 'method', g.planRow, 'prep');
    push('groups', 'prep', g.subject, g.period, prep || Math.round(g.lessons / 2),
      `${g.label} · ${prep ? 'по плану' : 'половина уроков (нет строки в плане)'}`, prep ? 'plan' : 'norm');
    const parents = planValue(st.plan, 'method', g.planRow, 'parents');
    const parentsDef = g.isDo || isDoCode(g.code) ? DEFAULTS.parentsDo : 0;
    push('groups', 'parents', g.subject, g.period, g.planRow ? parents : parentsDef,
      `${g.label} · консультации для родителей${g.planRow ? ' · по плану' : ''}`, g.planRow ? 'plan' : 'norm');
  }
  // часы за агломерацию — в той строке блока плана, где они стоят
  const firstRow = block?.names?.[0] || groups[0]?.subject || agg.name;
  const notes = { schedule: 'составление расписания', journal: 'электронный журнал за агломерацию', teams: 'организация работы команд', equipment: 'передача оборудования' };
  for (const k of AGG_KEYS) {
    let row = null, hours = 0;
    for (const name of block?.names || []) { const v = planValue(st.plan, 'method', name, k); if (v) { row = name; hours = v; break; } }
    push('agg', k, row || firstRow, block?.period || aggPeriod, hours || DEFAULTS[k],
      `${notes[k]} · ${row ? 'по плану' : 'норма по умолчанию'}`, row ? 'plan' : 'norm');
  }
  return { groups, items, block };
}

const SECTION_TITLES = {
  lessons: 'Проведённые уроки — учебные часы (контроль входит в уроки)',
  groups: 'По группам за агломерацию',
  agg: 'За агломерацию целиком',
};

export function openFinishDialog(agg, redraw) {
  const st = getState();
  let split = 'ktp';
  let { groups, items, block } = proposeItems(st, agg, split);
  const hasPlanRows = groups.some(g => g.planRow);
  const place = block?.place || placeOfAgg(agg);

  const body = h('div', {});
  const tables = h('div', {});
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

  const renderTables = () => {
    tables.replaceChildren();
    for (const section of ['lessons', 'groups', 'agg']) {
      const rows = items.filter(i => i.section === section);
      if (!rows.length) continue;
      const head = h('div', { class: 'finish-h' }, SECTION_TITLES[section]);
      if (section === 'lessons' && hasPlanRows) {
        const tab = (val, label) => h('button', { type: 'button', class: 'tab' + (split === val ? ' active' : ''), onClick: () => setSplit(val) }, label);
        head.append(h('div', { class: 'tabs finish-split' }, tab('ktp', 'по типу занятия из КТП'), tab('plan', 'как в индивидуальном плане')));
      }
      tables.append(head);
      tables.append(h('div', { class: 'table-wrap', style: { maxHeight: 'none' } }, h('table', { class: 'compact finish-table' },
        h('colgroup', {}, h('col', { style: { width: '36px' } }), h('col', { style: { width: '32%' } }), h('col', {}), h('col', { style: { width: '96px' } })),
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Вид работы'), h('th', {}, 'Строка плана / основание'), h('th', { class: 'num' }, 'Часов'))),
        h('tbody', {}, ...rows.map(it => {
          const tr = h('tr', { class: it.include ? '' : 'off' });
          const cb = h('input', { type: 'checkbox', class: 'box', checked: it.include, onChange: (e) => { it.include = e.target.checked; tr.classList.toggle('off', !it.include); refresh(); } });
          const hrs = h('input', { type: 'number', min: '0', step: '0.5', value: String(it.hours), class: 'finish-hours',
            onInput: (e) => { it.hours = Math.max(0, parseFloat(e.target.value) || 0); refresh(); } });
          tr.append(
            h('td', {}, cb),
            h('td', {}, h('div', { class: 'finish-work' }, it.title), h('span', { class: 'pill ' + (it.kind === 'teaching' ? 'cyan' : 'ok') }, it.kind === 'teaching' ? 'учебная' : 'методическая')),
            h('td', {}, h('div', { class: 'mono' }, it.subject), h('div', { class: 'muted', style: { fontSize: '11.5px' } }, [it.note, it.period].filter(Boolean).join(' · '))),
            h('td', { class: 'num' }, hrs));
          return tr;
        })))));
    }
    refresh();
  };

  // смена деления уроков пересобирает только строки уроков, правки остальных сохраняются
  const setSplit = (val) => {
    split = val;
    const fresh = proposeItems(getState(), agg, split).items.filter(i => i.section === 'lessons');
    items = [...fresh, ...items.filter(i => i.section !== 'lessons')];
    renderTables();
  };

  body.append(h('p', { class: 'muted', style: { marginTop: 0 } },
    `Агломерация «${agg.name}»${place ? ` (${place})` : ''} закроется для правки (журнал, списки, «Набор», КТП — только просмотр), а отмеченные строки спишутся в «Часы по плану» — в те же строки, что в индивидуальном плане. `,
    'Проверьте и поправьте часы — если что-то пошло не так, агломерацию можно открыть снова, списанное при этом уберётся.'));
  if (!groups.length) body.append(h('p', { class: 'pill warn' }, 'В агломерации нет проведённых уроков: расписание не загружено или группы не сопоставлены с кодами.'));
  if (!st.plan) body.append(h('p', { class: 'muted', style: { fontSize: '12.5px' } }, 'Индивидуальный план не загружен — виды работ из базового справочника, часы по нормам по умолчанию. Загрузите план в «Часах по плану», чтобы часы легли в его строки.'));
  else if (block) body.append(h('p', { class: 'muted', style: { fontSize: '12.5px' } }, `Блок плана: ${block.period}${block.place ? ` · ${block.place}` : ''} · групп в плане: ${block.names.length}, найдено в агломерации: ${groups.filter(g => g.planRow).length}.`));
  const missing = groups.filter(g => !g.planRow);
  if (st.plan && missing.length) body.append(h('p', { class: 'pill warn' }, `Нет строки в плане: ${missing.map(g => g.code || g.label).join(', ')} — часы уйдут отдельной строкой с этим кодом.`));
  body.append(tables);
  body.append(totals);
  body.append(h('p', { class: 'muted', style: { fontSize: '12px', margin: '10px 0 0' } },
    'Разработка программ и дидактических материалов, работа с оборудованием стоят в плане не на каждую агломерацию — их списывайте в «Часах по плану» вручную.'));
  renderTables();

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
      afterFinish(block, redraw);
    },
  });
}

/** После завершения — предложить сразу завести следующую (по следующему блоку плана). */
function afterFinish(block, redraw) {
  const nextPlace = block?.next?.place || '';
  const nameInput = h('input', { type: 'text', value: nextPlace, placeholder: 'Например, «Талакан»' });
  modal({
    title: 'Начать новую агломерацию?',
    body: h('div', {},
      h('p', { class: 'muted', style: { marginTop: 0 } },
        'Завершённая агломерация останется доступной для просмотра. Новая начнётся с чистого листа: свои списки, расписание и журнал.',
        nextPlace ? ` По плану следующая — ${nextPlace} (${block.next.period}).` : ''),
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
