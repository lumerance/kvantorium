// Электронный журнал: заезды → предметы → группы (вкладки), отметки и средние баллы.
//
// Два независимых журнала — «Официальный» (сетевые документы школ: st.students /
// schedules / mapping / journal) и «Фактический» (реальный состав и расписание,
// если отличаются от официальных: st.actual.*) — переключаются выпадающим
// списком под кнопкой «Журнал» в шапке (адрес отличается ?kind=actual).
// У них разные списки детей и расписания, но часть детей совпадает по ФИО —
// кнопка «Перенести из Фактического» на официальном журнале переносит средний
// балл за заезд для совпавших учеников как ручную правку в st.vedomostMarks
// (её же понимает «Итоговая ведомость» — см. js/pages/vedomost.js), не трогая
// сами отметки официального журнала.
import { h, toast, dateRu, download, emptyState, WEEKDAY_SHORT, modal, aggBadge, moreMenu, contextMenu } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { openVedomostDo } from './vedomost-do.js';
import { getState, update, lessonsForGroup, lessonsForCode, lessonKey, activeAgg, viewedAgg, isViewingArchive } from '../core/store.js';
import { ktpCard } from './ktp-panel.js';
import { go } from '../core/router.js';

export const SHIFTS = [1, 2, 3];
// Группы «Набора» — в официальном журнале это группы дополнительного
// образования (педагог набирает сам), в фактическом — обычные классы
// (st.actual.enroll) — показываются как ещё один псевдо-предмет в своём
// журнале; занятия для них берутся напрямую по коду расписания, а не через
// mapping.
export const ENROLL_SUBJECT_ID = '__enroll__';
const shortName = (fio) => (fio || '').trim().split(/\s+/).slice(0, 2).join(' ');
const matchKey = (fio) => shortName(fio).toLowerCase();

/** Короткое название профиля для телефона: «Промробо/Промдизайн (5 класс)» -> «5 класс». */
function shortSubject(s) {
  if (s.isEnroll) return s.title.replace(/\s*\(.*\)\s*$/, '') || s.title;
  const m = /(\d{1,2})\s*класс/i.exec(s.title);
  if (m) return `${m[1]} класс`;
  return s.grade ? `${s.grade} класс` : s.title;
}

function enrollAsSubject(agg, isActual) {
  const src = isActual ? agg.actual.enroll : agg.enroll;
  const groups = (src?.groups || []).map(g => ({
    id: g.id, name: g.name, code: g.code || null, program: g.program || '',
    students: g.students.map(s => ({ id: s.id, fio: s.fio, short: shortName(s.fio) })),
  }));
  return { id: ENROLL_SUBJECT_ID, title: isActual ? 'Классы' : 'Набор (ДО)', isEnroll: true, groups };
}
const MARKS = ['✓', 'н', '5', '4', '3', '2'];
const CYCLE = ['', '✓', 'н', '5', '4', '3', '2'];
const markClass = (m) => m === '✓' ? 'm-p' : m === 'н' ? 'm-n' : m ? 'm-' + m : '';
const isGrade = (m) => /^[2-5]$/.test(m || '');

function avgOf(marks) {
  const g = marks.filter(isGrade).map(Number);
  if (!g.length) return null;
  return g.reduce((a, b) => a + b, 0) / g.length;
}
const avgClass = (v) => v === null ? 'none' : v >= 4.5 ? 'g5' : v >= 3.5 ? 'g4' : v >= 2.5 ? 'g3' : 'g2';
const fmtAvg = (v) => v === null ? '—' : v.toFixed(2);

/** Все оценки ученика за все заезды в данном журнале (root — st или st.actual). */
function allMarksOfStudent(root, groupId, studentId) {
  const out = [];
  for (const sh of SHIFTS) {
    const cell = root.journal?.[sh]?.[groupId]?.[studentId];
    if (cell) out.push(...Object.values(cell));
  }
  return out;
}

/** Средний балл ученика за конкретный заезд в данном журнале, или null. */
function shiftAvgOfStudent(root, groupId, studentId, shift) {
  const cell = root.journal?.[shift]?.[groupId]?.[studentId];
  return cell ? avgOf(Object.values(cell)) : null;
}

/** Плоский список {subject, group, student} по всем предметам списка обучающихся. */
function flatStudents(root) {
  const out = [];
  for (const sub of root.students?.subjects || []) {
    for (const g of sub.groups) for (const stu of g.students) out.push({ subject: sub, group: g, student: stu });
  }
  return out;
}

export function render(root, params = {}) {
  const kind = params.kind === 'actual' ? 'actual' : 'official';
  const isActual = kind === 'actual';
  const journalRoot = (st) => (isActual ? st.actual : st);
  const uiShiftKey = isActual ? 'actualJournalShift' : 'journalShift';
  const uiSubjectKey = isActual ? 'actualJournalSubject' : 'journalSubject';
  const uiGroupKey = isActual ? 'actualJournalGroup' : 'journalGroup';
  const kindTitle = isActual ? 'Фактический' : 'Официальный';

  const wrap = h('div', {});
  root.append(wrap);
  let brush = '✓';
  let randomCfg = null;   // { fives, fours } — заданное в модалке «Случайные оценки»
  let pipetteBuf = null;  // { date, groupId, shift, cols: [{studentId: mark}] } — скопированный день
  let lastAction = null;  // { shift, groupId, label, undo() } — для кнопки «↩ Отменить»

  /** Снимок всех отметок группы за заезд — для отмены массовых действий
   *  («Все присутствуют», «Случайные оценки»), которые иначе не откатить
   *  иначе как вручную переклацать каждую клетку обратно. Всегда работает
   *  с активной агломерацией — писать можно только в неё. */
  function snapshotGroupJournal(shift, groupId) {
    const j = journalRoot(activeAgg(getState())).journal;
    return JSON.parse(JSON.stringify(j?.[shift]?.[groupId] || {}));
  }
  function restoreGroupJournal(shift, groupId, snapshot) {
    update(x => {
      const j = journalRoot(activeAgg(x)).journal;
      j[shift] = j[shift] || {};
      j[shift][groupId] = snapshot;
    });
  }

  function setMark(shift, groupId, studentId, key, mark) {
    update(x => {
      const j = journalRoot(activeAgg(x)).journal;
      j[shift] = j[shift] || {};
      j[shift][groupId] = j[shift][groupId] || {};
      j[shift][groupId][studentId] = j[shift][groupId][studentId] || {};
      if (!mark) delete j[shift][groupId][studentId][key];
      else j[shift][groupId][studentId][key] = mark;
    });
  }

  function redraw() {
    const st = getState();
    const agg = viewedAgg(st);
    const readOnly = isViewingArchive(st);
    const data = journalRoot(agg);
    wrap.innerHTML = '';

    const realSubjects = data.students?.subjects || [];
    const enrollGroups = (isActual ? agg.actual.enroll : agg.enroll)?.groups || [];
    if (!realSubjects.length && !enrollGroups.length) {
      wrap.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, `Электронный журнал · ${kindTitle}`), aggBadge(agg, readOnly))));
      wrap.append(h('div', { class: 'card' }, emptyState(icon('list', 34),
        isActual
          ? 'Фактический список обучающихся ещё не загружен. Импортируйте свой docx со списком детей и docx с реальным расписанием — либо заведите класс на вкладке «Набор».'
          : 'Список обучающихся ещё не загружен. Импортируйте docx со списком детей и docx с расписанием — либо заведите группу дополнительного образования на вкладке «Набор».',
        readOnly ? null : h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } },
          h('button', { class: 'btn primary', onClick: () => go('data', isActual ? { kind: 'actual' } : undefined) }, 'Перейти к импорту'),
          h('button', { class: 'btn', onClick: () => go('enroll', isActual ? { kind: 'actual' } : undefined) }, isActual ? 'Открыть «Классы»' : 'Открыть «Набор»')))));
      return;
    }

    const ui = st.ui;
    const shift = ui[uiShiftKey] || 1;
    const subjects = enrollGroups.length ? [...realSubjects, enrollAsSubject(agg, isActual)] : realSubjects;
    let subject = subjects.find(s => s.id === ui[uiSubjectKey]) || subjects[0];
    let group = subject.groups.find(g => g.id === ui[uiGroupKey]) || subject.groups[0];

    const sched = data.schedules[String(shift)];
    const lessons = subject.isEnroll ? lessonsForCode(shift, group.code, agg, kind) : lessonsForGroup(shift, group.id, agg, kind);
    const canTransfer = st.ui.showActualJournal && !isActual && !subject.isEnroll && (agg.actual?.students?.subjects || []).length > 0;

    wrap.append(h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, `Электронный журнал · ${kindTitle}`, aggBadge(agg, readOnly)),
        h('p', {}, `${subject.title} · ${group.name} · ${group.students.length} чел.` +
          (sched ? ` · расписание ${shift} заезда: ${sched.lessons.length} занятий` : ' · расписание заезда не загружено'))),
      h('div', { class: 'head-actions' },
        (!readOnly && lastAction && lastAction.shift === shift && lastAction.groupId === group.id)
          ? h('button', { class: 'btn danger ghost', title: `Отменить: ${lastAction.label}`, onClick: () => lastAction.undo() }, icon('undo', 16), `Отменить (${lastAction.label})`)
          : null,
        readOnly ? null : h('button', { class: 'btn primary', onClick: () => markAllPresent(shift, group, lessons) }, icon('check', 16), 'Все присутствуют'),
        moreMenu([
          { title: 'Выгрузка' },
          { label: 'Экспорт журнала группы (CSV)', icon: icon('sheet', 16), onClick: () => exportJournal(data, subject, group, shift, lessons) },
          (subject.isEnroll || isActual) ? null : { label: 'Итоговая ведомость по предмету', icon: icon('documents', 16), onClick: () => openVedomost(subject) },
          (subject.isEnroll && !isActual) ? { label: 'Ведомость групп ДО (Excel)', icon: icon('documents', 16), onClick: () => openVedomostDo() } : null,
          (!readOnly && canTransfer) ? 'sep' : null,
          (!readOnly && canTransfer) ? { label: 'Перенести оценки из Фактического', icon: icon('journalActual', 16), onClick: () => openTransferDialog(redraw) } : null,
          'sep',
          { label: subject.isEnroll ? (isActual ? 'Настроить классы' : 'Настроить группы «Набора»') : 'Списки и расписание (Данные)', icon: icon(subject.isEnroll ? 'enroll' : 'data', 16),
            onClick: () => go(subject.isEnroll ? 'enroll' : 'data', isActual ? { kind: 'actual' } : undefined) },
        ]),
      )));

    /* --- вкладки заездов / предметов / групп — один компактный блок --- */
    wrap.append(h('div', { class: 'tab-tiers' },
      h('div', { class: 'tabs-row' }, ...SHIFTS.map(s => {
        const sc = data.schedules[String(s)];
        return h('button', {
          class: 'tab' + (s === shift ? ' active' : ''),
          onClick: () => { update(x => { x.ui[uiShiftKey] = s; }); redraw(); }
        }, `${s} заезд`, h('span', { class: 'badge' }, sc ? `${sc.lessons.length}` : '—'));
      })),
      h('div', { class: 'tabs-row sub' }, ...subjects.map(s => h('button', {
        class: 'tab' + (s.id === subject.id ? ' active' : ''),
        title: (readOnly || s.isEnroll) ? null : 'Правая кнопка мыши — переименовать',
        onClick: () => { update(x => { x.ui[uiSubjectKey] = s.id; x.ui[uiGroupKey] = s.groups[0]?.id; }); redraw(); },
        onContextmenu: (readOnly || s.isEnroll) ? null : (e) => {
          e.preventDefault();
          contextMenu(e.clientX, e.clientY, [
            { title: s.title },
            { label: 'Переименовать…', icon: icon('pen', 16), onClick: () => renameSubject(s) },
          ]);
        },
      }, h('span', { class: 'lbl-full' }, s.title), h('span', { class: 'lbl-short' }, shortSubject(s))))),
      h('div', { class: 'tabs-row sub' }, ...subject.groups.map(g => h('button', {
        class: 'tab' + (g.id === group.id ? ' active' : ''),
        onClick: () => { update(x => { x.ui[uiGroupKey] = g.id; }); redraw(); }
      }, g.name, h('span', { class: 'badge' }, g.students.length))))));

    /* --- панель отметок --- */
    wrap.append(readOnly
      ? h('div', { class: 'card', style: { marginBottom: '14px', padding: '12px 16px' } },
          h('span', { class: 'muted' }, icon('archive', 16), 'Архивная агломерация — отметки только для просмотра, редактирование недоступно.'))
      : h('div', { class: 'card', style: { marginBottom: '14px', padding: '12px 16px' } },
      h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' } },
        h('span', { class: 'muted', style: { fontSize: '12.5px', fontWeight: '600' } }, 'Кисть:'),
        ...MARKS.map(m => h('button', {
          class: 'mark ' + markClass(m) + (brush === m ? '' : ''),
          style: { width: '44px', outline: brush === m ? '2px solid var(--neon)' : 'none', outlineOffset: '2px' },
          onClick: () => { brush = m; redraw(); }
        }, m)),
        h('button', {
          class: 'btn sm' + (brush === '' ? ' primary' : ''), title: 'Стереть',
          onClick: () => { brush = ''; redraw(); }
        }, icon('eraser', 16), h('span', { class: 'btn-label' }, 'Стереть')),
        h('button', {
          class: 'btn sm' + (brush === null ? ' primary' : ''), title: 'Цикл по клику: ✓ → н → 5 → 4 → 3 → 2',
          onClick: () => { brush = null; redraw(); }
        }, icon('refresh', 16), h('span', { class: 'btn-label' }, 'Цикл по клику')),
        h('button', {
          class: 'btn sm' + (brush === 'pipette' ? ' primary' : ''),
          title: 'Пипетка: клик по шапке урока копирует его отметки, клик по другому уроку — вставляет их',
          onClick: () => { brush = 'pipette'; redraw(); },
        }, icon('pipette', 16), h('span', { class: 'btn-label' }, 'Пипетка')),
        (brush === 'pipette' && pipetteBuf && pipetteBuf.groupId === group.id && pipetteBuf.shift === shift)
          ? h('span', { class: 'pill ok pipette-chip' }, `скопирован ${pipetteBuf.no} ур. ${dateRu(pipetteBuf.date)}`,
              h('button', { class: 'chip-x', title: 'Забыть скопированное', 'aria-label': 'Забыть скопированное', onClick: () => { pipetteBuf = null; redraw(); } }, icon('x', 13)))
          : null,
        h('button', {
          class: 'btn sm' + (brush === 'random' ? ' primary' : ''),
          title: randomCfg ? `Случайные оценки: ${randomCfg.fives}×5, ${randomCfg.fours}×4 — клик настроить заново` : 'Случайные оценки',
          onClick: () => openRandomModal(group),
        }, icon('dice', 16)),
        h('div', { class: 'legend', style: { marginLeft: 'auto' } },
          h('span', { class: 'k' }, h('i', { class: 'sw', style: { background: 'rgba(var(--accent-rgb),.3)' } }), icon('check', 16), 'был'),
          h('span', { class: 'k' }, h('i', { class: 'sw', style: { background: 'rgba(125,149,163,.3)' } }), 'н — не был'),
          h('span', { class: 'k' }, h('i', { class: 'sw', style: { background: 'var(--red)' } }), '2'),
          h('span', { class: 'k' }, h('i', { class: 'sw', style: { background: 'var(--orange)' } }), '3'),
          h('span', { class: 'k' }, h('i', { class: 'sw', style: { background: 'var(--yellow)' } }), '4'),
          h('span', { class: 'k' }, h('i', { class: 'sw', style: { background: 'var(--green-bright)' } }), '5'),
        ))));

    if (!sched) {
      wrap.append(h('div', { class: 'card' }, emptyState(icon('calendar', 34),
        `Расписание ${shift} заезда не загружено.`,
        readOnly ? null : h('button', { class: 'btn primary', onClick: () => go('data', isActual ? { kind: 'actual' } : undefined) }, 'Загрузить расписание'))));
      return;
    }
    if (!lessons.length) {
      if (subject.isEnroll) {
        const msg = group.code
          ? `В расписании ${shift} заезда нет занятий с кодом «${group.code}».`
          : `Группа «${group.name}» не привязана к коду в расписании.`;
        wrap.append(h('div', { class: 'card' }, emptyState(icon('link', 34), msg,
          readOnly ? null : h('button', { class: 'btn primary', onClick: () => go('enroll', isActual ? { kind: 'actual' } : undefined) }, 'Привязать код в «Наборе»'))));
        return;
      }
      const mapped = Object.entries(data.mapping).filter(([, m]) => m?.groupId === group.id).length;
      wrap.append(h('div', { class: 'card' }, emptyState(icon('link', 34),
        mapped ? `В расписании ${shift} заезда нет занятий для этой группы.`
               : `Группа «${group.name}» не сопоставлена ни с одним кодом расписания (например «Т1 РШ7»).`,
        readOnly ? null : h('button', { class: 'btn primary', onClick: () => go('data', isActual ? { kind: 'actual' } : undefined) }, 'Настроить сопоставление'))));
      return;
    }

    // темы КТП по дням — только для официального расписания, по нему заполняется
    // электронный журнал
    if (!isActual) wrap.append(ktpCard(agg, group, shift, lessons, redraw, readOnly));

    /** Случайные оценки на одно занятие: fives пятёрок и fours четвёрок —
     *  случайным ученикам, присутствовавшим в этот день, остальным из них —
     *  случайно 3 или 2. У кого на первом уроке дня стоит «н» — оценка не
     *  ставится, вместо неё на это занятие тоже повторяется «н» (в один
     *  день обычно 2-3 урока подряд одним блоком, оценки ставятся не на
     *  первый из них — но раз не пришёл к началу, значит не был и дальше). */
    function fillLessonRandom(l) {
      if (!randomCfg) return;
      const before = snapshotGroupJournal(shift, group.id);
      const jGroup = data.journal?.[shift]?.[group.id] || {};
      const dayLessons = lessons.filter(x => x.date === l.date).sort((a, b) => a.no - b.no);
      const firstKey = lessonKey(dayLessons[0]);

      const present = [];
      const absentIds = [];
      for (const s of group.students) {
        if ((jGroup[s.id]?.[firstKey] || '') === 'н') absentIds.push(s.id);
        else present.push(s.id);
      }
      for (let i = present.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [present[i], present[j]] = [present[j], present[i]];
      }
      const n = present.length;
      const f5 = Math.min(randomCfg.fives, n);
      const f4 = Math.min(randomCfg.fours, n - f5);
      const k = lessonKey(l);
      let idx = 0;
      for (; idx < f5; idx++) setMark(shift, group.id, present[idx], k, '5');
      for (; idx < f5 + f4; idx++) setMark(shift, group.id, present[idx], k, '4');
      for (; idx < n; idx++) setMark(shift, group.id, present[idx], k, Math.random() < 0.65 ? '3' : '2');
      for (const id of absentIds) setMark(shift, group.id, id, k, 'н');

      lastAction = {
        shift, groupId: group.id, label: `случайные оценки · ${dateRu(l.date)}`,
        undo: () => { restoreGroupJournal(shift, group.id, before); lastAction = null; toast('Действие отменено'); redraw(); },
      };
      toast(`Случайные оценки на ${dateRu(l.date)}: ${f5}×5, ${f4}×4` +
        (absentIds.length ? `, «н» у отсутствовавших: ${absentIds.length}` : ''));
      redraw();
    }

    /** Пипетка: первый клик по шапке урока копирует отметки этого урока
     *  (весь столбец), следующие клики по другим урокам — вставляют их туда.
     *  Так отметки первого урока переносятся на второй и третий того же дня. */
    function pipetteLesson(l) {
      const k = lessonKey(l);
      const jGroup = data.journal?.[shift]?.[group.id] || {};
      const fresh = !pipetteBuf || pipetteBuf.groupId !== group.id || pipetteBuf.shift !== shift;
      if (!fresh && pipetteBuf.key === k) { pipetteBuf = null; redraw(); return; }   // повторный клик — снять копию
      if (fresh) {
        const col = Object.fromEntries(group.students.map(s => [s.id, jGroup[s.id]?.[k] || '']));
        if (!Object.values(col).some(Boolean)) { toast(`В ${l.no}-м уроке ${dateRu(l.date)} нет отметок — копировать нечего`, 'err'); return; }
        pipetteBuf = { key: k, date: l.date, no: l.no, groupId: group.id, shift, col };
        toast(`Скопирован ${l.no}-й урок ${dateRu(l.date)}. Кликните по шапке другого урока, чтобы вставить`);
        redraw();
        return;
      }
      const before = snapshotGroupJournal(shift, group.id);
      update(x => {
        const j = journalRoot(activeAgg(x)).journal;
        j[shift] = j[shift] || {}; j[shift][group.id] = j[shift][group.id] || {};
        for (const s of group.students) {
          const cell = j[shift][group.id][s.id] = j[shift][group.id][s.id] || {};
          const m = pipetteBuf.col[s.id] || '';
          if (m) cell[k] = m; else delete cell[k];
        }
      });
      lastAction = {
        shift, groupId: group.id, label: `вставка в ${l.no} ур. ${dateRu(l.date)}`,
        undo: () => { restoreGroupJournal(shift, group.id, before); lastAction = null; toast('Действие отменено'); redraw(); },
      };
      toast(`Отметки ${pipetteBuf.no}-го урока ${dateRu(pipetteBuf.date)} вставлены в ${l.no}-й урок ${dateRu(l.date)}`);
      redraw();
    }

    const onHeader = brush === 'random' ? fillLessonRandom : brush === 'pipette' ? pipetteLesson : null;
    const srcKey = (brush === 'pipette' && pipetteBuf && pipetteBuf.groupId === group.id && pipetteBuf.shift === shift) ? pipetteBuf.key : null;
    wrap.append(journalTable(data, subject, group, shift, lessons, setMark, redraw, () => brush, onHeader, readOnly, srcKey));
  }

  /** Переименование профиля (предмета): «Промробо/Промдизайн (5 класс)» -> своё название. */
  function renameSubject(subj) {
    const input = h('input', { type: 'text', value: subj.title });
    modal({
      title: 'Переименовать профиль',
      body: h('div', {},
        h('label', { class: 'field' }, h('span', {}, 'Название'), input),
        h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '10px 0 0' } },
          'Название меняется везде: в журнале, ведомости, на странице «Данные». Если заново загрузить список обучающихся, вернётся название из документа.')),
      okText: 'Сохранить',
      onOk: () => {
        const v = input.value.replace(/\s+/g, ' ').trim();
        if (!v) { toast('Название не может быть пустым', 'err'); return false; }
        update(x => {
          const sj = (journalRoot(activeAgg(x)).students?.subjects || []).find(y => y.id === subj.id);
          if (sj) sj.title = v;
        });
        toast('Профиль переименован'); redraw();
      },
    });
    setTimeout(() => { input.focus(); input.select(); });
  }

  /** Открывает ведомость, предварительно выбрав группы текущего предмета. */
  function openVedomost(subject) {
    update(x => {
      const agg = activeAgg(x);
      if (!agg.vedomostGroups?.length) agg.vedomostGroups = subject.groups.map(g => g.id);
      if (!agg.vedomostHeader?.teacher && x.plan?.teacher) {
        agg.vedomostHeader = { ...(agg.vedomostHeader || {}), teacher: x.plan.teacher };
      }
    });
    go('vedomost');
  }

  function markAllPresent(shift, group, lessons) {
    if (!lessons.length) return toast('Нет занятий для отметки', 'err');
    const before = snapshotGroupJournal(shift, group.id);
    update(x => {
      const j = journalRoot(activeAgg(x)).journal;
      j[shift] = j[shift] || {}; j[shift][group.id] = j[shift][group.id] || {};
      for (const st of group.students) {
        const cell = j[shift][group.id][st.id] = j[shift][group.id][st.id] || {};
        for (const l of lessons) { const k = lessonKey(l); if (!cell[k]) cell[k] = '✓'; }
      }
    });
    lastAction = {
      shift, groupId: group.id, label: 'все присутствуют',
      undo: () => { restoreGroupJournal(shift, group.id, before); lastAction = null; toast('Действие отменено'); redraw(); },
    };
    toast(`Отмечено присутствие: ${group.students.length} чел. × ${lessons.length} занятий`);
    redraw();
  }

  /**
   * Модалка «Случайные оценки»: сколько пятёрок и четвёрок раздать. После
   * подтверждения включается кисть «random» — дальше клик по шапке занятия
   * в таблице (не по отдельной клетке) раздаёт оценки на весь столбец сразу.
   */
  function openRandomModal(group) {
    const n = group.students.length;
    if (!n) return toast('В группе нет учеников', 'err');
    const defFives = Math.max(0, Math.min(n, randomCfg?.fives ?? Math.round(n * 0.25)));
    const defFours = Math.max(0, Math.min(n - defFives, randomCfg?.fours ?? Math.round(n * 0.35)));
    const fivesInput = h('input', { type: 'number', inputmode: 'numeric', min: '0', max: String(n), value: String(defFives) });
    const foursInput = h('input', { type: 'number', inputmode: 'numeric', min: '0', max: String(n), value: String(defFours) });
    const countHint = h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '12px 0 0' } });
    const updateHint = () => {
      const fives = Math.max(0, parseInt(fivesInput.value, 10) || 0);
      const fours = Math.max(0, parseInt(foursInput.value, 10) || 0);
      const over = fives + fours > n;
      countHint.textContent = over
        ? `Внимание: в группе «${group.name}» всего ${n} чел. — указано ${fives + fours}, это больше.`
        : `В группе «${group.name}» — ${n} чел.: ${fives}×5, ${fours}×4, оставшимся ${n - fives - fours} — случайно 3 или 2.`;
      countHint.style.color = over ? 'var(--red)' : '';
    };
    fivesInput.addEventListener('input', updateHint);
    foursInput.addEventListener('input', updateHint);
    updateHint();
    modal({
      title: [icon('dice', 16), 'Случайные оценки'],
      body: h('div', {},
        h('p', { class: 'muted', style: { marginTop: 0 } },
          'Укажите, сколько пятёрок и четвёрок раздать — кому именно из группы, решит случайный выбор. После подтверждения кликните по шапке занятия (дате) в таблице — оценки появятся сразу на весь столбец; так можно раздать оценки на несколько занятий подряд, не открывая модалку заново. Кто на первом уроке дня отмечен «н» — оценку не получит, а «н» повторится и на этом занятии.'),
        h('div', { class: 'row' },
          h('label', { class: 'field' }, h('span', {}, 'Пятёрок'), fivesInput),
          h('label', { class: 'field' }, h('span', {}, 'Четвёрок'), foursInput)),
        countHint),
      okText: 'Готово',
      onOk: () => {
        const fives = Math.max(0, parseInt(fivesInput.value, 10) || 0);
        const fours = Math.max(0, parseInt(foursInput.value, 10) || 0);
        if (fives + fours > n) {
          toast(`В группе только ${n} чел. — пятёрок и четвёрок вместе не может быть больше`, 'err');
          return false;
        }
        randomCfg = { fives, fours };
        brush = 'random';
        toast('Кликните по шапке занятия (дате), чтобы раздать оценки на весь столбец');
        redraw();
      },
    });
  }

  /**
   * Перенос оценок из Фактического журнала в Официальный: сравнивает детей
   * по ключу «фамилия имя» (без учёта регистра), для совпавших считает
   * средний балл за заезд по Фактическому журналу и предлагает записать его
   * как ручную правку в «Итоговую ведомость» (st.vedomostMarks) — сама
   * официальная ведомость строится из vedomostMarks/журнала, поэтому это
   * ровно то же самое, что поправить оценку в ведомости руками. Отметки
   * официального журнала (посещаемость по занятиям) не меняются — расписания
   * у журналов разные, переносить по занятиям один в один нельзя.
   */
  function openTransferDialog(redraw) {
    const st = getState();
    const agg = viewedAgg(st);
    const officialList = flatStudents(agg);
    const actualList = flatStudents(agg.actual);
    if (!actualList.length) return toast('В Фактическом журнале нет ни одного ученика', 'err');

    const actualByKey = new Map();
    for (const row of actualList) {
      const key = matchKey(row.student.fio);
      if (!actualByKey.has(key)) actualByKey.set(key, []);
      actualByKey.get(key).push(row);
    }

    const matches = [];
    for (const row of officialList) {
      const candidates = actualByKey.get(matchKey(row.student.fio));
      if (!candidates?.length) continue;
      const fact = candidates[0];
      const rounded = {};
      for (const sh of SHIFTS) {
        const avg = shiftAvgOfStudent(agg.actual, fact.group.id, fact.student.id, sh);
        if (avg !== null) rounded[sh] = String(Math.round(avg));
      }
      if (!Object.keys(rounded).length) continue;
      matches.push({ official: row, fact, rounded, ambiguous: candidates.length > 1 });
    }

    if (!matches.length) {
      toast('Совпадений по ФИО с оценками в Фактическом журнале не найдено', 'err');
      return;
    }

    const checked = new Set(matches.map((_, i) => i));
    const body = h('div', {});
    body.append(h('p', { class: 'muted', style: { marginTop: 0 } },
      'Совпадение — по «Фамилия Имя» без учёта регистра. Переносится округлённый средний балл за заезд как ручная правка в «Итоговой ведомости»: отметки официального журнала не меняются, а результат виден там же вместо «авто».'));

    const rows = matches.map((m, i) => {
      const cb = h('input', {
        type: 'checkbox', checked: true, style: { width: 'auto', margin: 0 },
        onChange: (e) => { e.target.checked ? checked.add(i) : checked.delete(i); },
      });
      return h('tr', {},
        h('td', {}, cb),
        h('td', {}, m.official.student.short || m.official.student.fio,
          m.ambiguous ? h('span', { class: 'pill warn', style: { marginLeft: '6px' } }, icon('alert', 16), 'неск. совпадений') : null),
        h('td', { class: 'muted', style: { fontSize: '12px' } }, `${m.official.subject.title} · ${m.official.group.name}`),
        h('td', { class: 'muted', style: { fontSize: '12px' } }, `${m.fact.subject.title} · ${m.fact.group.name}`),
        ...SHIFTS.map(sh => h('td', { class: 'num mono' }, m.rounded[sh] ?? '—')));
    });

    body.append(h('div', { class: 'table-wrap' }, h('table', { class: 'compact' },
      h('thead', {}, h('tr', {},
        h('th', {}, ''), h('th', {}, 'Официальный ученик'), h('th', {}, 'Официальная группа'), h('th', {}, 'Найден в Фактическом'),
        ...SHIFTS.map(sh => h('th', { class: 'num' }, `${sh} заезд`)))),
      h('tbody', {}, ...rows))));

    modal({
      wide: true, title: `Перенос оценок из Фактического · совпадений: ${matches.length}`,
      body, okText: 'Перенести отмеченные',
      onOk: () => {
        if (!checked.size) { toast('Ничего не отмечено', 'err'); return false; }
        update(x => {
          const a = activeAgg(x);
          a.vedomostMarks = a.vedomostMarks || {};
          for (const i of checked) {
            const m = matches[i];
            const rec = a.vedomostMarks[m.official.student.id] = a.vedomostMarks[m.official.student.id] || {};
            for (const sh of SHIFTS) if (m.rounded[sh] !== undefined) rec[sh] = m.rounded[sh];
          }
        });
        toast(`Оценки перенесены: ${checked.size} учеников`);
        redraw();
      },
    });
  }

  redraw();
}

/* протягивание кистью: один набор глобальных обработчиков на всю страницу */
let stopActivePaint = null;
for (const ev of ['pointerup', 'pointercancel', 'touchend', 'blur']) window.addEventListener(ev, () => stopActivePaint?.());

/** Сортировка учеников по алфавиту (клик по «Фамилия Имя»), запоминается на устройстве. */
const SORT_KEY = 'kvantorium28.journalSort';
let sortAlpha = (() => { try { return localStorage.getItem(SORT_KEY) === 'az'; } catch { return false; } })();
const orderedStudents = (group) => (sortAlpha
  ? [...group.students].sort((a, b) => (a.fio || a.short || '').localeCompare(b.fio || b.short || '', 'ru'))
  : group.students);

function journalTable(data, subject, group, shift, lessons, setMark, redraw, getBrush, onHeader, readOnly, srcKey = null) {
  const jGroup = data.journal?.[shift]?.[group.id] || {};
  const isRandomMode = !readOnly && getBrush() === 'random';
  const isPipette = !readOnly && getBrush() === 'pipette';
  const colHeaderProps = (l) => ({
    class: 'num' + ((isRandomMode || isPipette) ? ' col-random' : '') + (isPipette ? ' col-pipette' : '') + (srcKey === lessonKey(l) ? ' col-src' : ''),
    title: isRandomMode ? 'Клик — раздать случайные оценки на это занятие'
      : isPipette ? (srcKey ? (srcKey === lessonKey(l) ? 'Скопированный урок' : 'Клик — вставить скопированные отметки в этот урок') : 'Клик — скопировать отметки этого урока')
      : `${l.code} · ${l.time} · ${l.weekday}`,
    onClick: (!readOnly && onHeader) ? () => onHeader(l) : undefined,
  });

  const thead = h('thead', {},
    h('tr', {},
      h('th', {
        class: 'sticky-col th-sort' + (sortAlpha ? ' on' : ''), rowspan: 2, style: { minWidth: '220px' },
        title: sortAlpha ? 'Отсортировано по алфавиту — клик вернёт исходный порядок' : 'Клик — по алфавиту',
        'aria-sort': sortAlpha ? 'ascending' : 'none',
        onClick: () => { sortAlpha = !sortAlpha; try { localStorage.setItem(SORT_KEY, sortAlpha ? 'az' : ''); } catch { /* */ } redraw(); },
      }, 'Фамилия Имя', sortAlpha ? h('span', { class: 'th-sort-ico', 'aria-hidden': 'true' }, 'А→Я') : null),
      ...lessons.map(l => h('th', colHeaderProps(l), dateRu(l.date))),
      h('th', { class: 'num', rowspan: 2, title: 'Средний балл за заезд' }, `Ср. балл${shift === 3 ? ' (3 заезд)' : ''}`),
      shift === 3 ? h('th', { class: 'num', rowspan: 2, title: 'Средний балл за все три заезда' }, 'Ср. за 3 заезда') : null,
    ),
    h('tr', {}, ...lessons.map(l => h('th',
      { ...colHeaderProps(l), style: { fontSize: '10.5px', fontWeight: '400' } },
      `${WEEKDAY_SHORT[l.weekday] || ''} ${l.no}ур`))),
  );

  const tbody = h('tbody', {});
  // «Зажать и провести»: первая клетка решает, какую отметку ставить
  // (или стирать, если там уже эта кисть), остальные под курсором/пальцем
  // получают ту же. На телефоне — после удержания пальца ~0,35 с.
  const applyOf = new WeakMap();   // кнопка -> (mark) => void
  const markOf = new WeakMap();    // кнопка -> текущая отметка
  let paint = null;                // { mark, done:Set }
  let suppressClick = false;       // после протягивания пальцем — не считать отпускание кликом
  const paintAt = (x, y) => {
    if (!paint) return;
    const btn = document.elementFromPoint(x, y)?.closest?.('button.mark');
    if (!btn || paint.done.has(btn) || !applyOf.has(btn)) return;
    paint.done.add(btn);
    applyOf.get(btn)(paint.mark);
  };
  const stopPaint = () => { if (paint) { paint = null; document.body.classList.remove('mark-painting'); } };
  stopActivePaint = stopPaint;
  const startPaint = (btn) => {
    const brush = getBrush();
    const cur = markOf.get(btn) || '';
    const mark = brush === null ? CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length] : (cur === brush ? '' : brush);
    paint = { mark, done: new Set([btn]) };
    document.body.classList.add('mark-painting');
    applyOf.get(btn)(mark);
  };
  const brushError = () => {
    const brush = getBrush();
    if (brush === 'random') { toast('В режиме случайных оценок кликните по шапке занятия (дате)', 'err'); return true; }
    if (brush === 'pipette') { toast('Пипеткой кликайте по шапке урока (дата или «вт 1ур»)', 'err'); return true; }
    return false;
  };
  if (!readOnly) {
    let hold = null;
    tbody.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('button.mark');
      if (!btn || !applyOf.has(btn) || e.button !== 0) return;
      if (e.pointerType === 'mouse') {
        e.preventDefault();          // без выделения текста при протягивании
        if (brushError()) return;
        startPaint(btn);
      } else {
        // палец: короткое касание — обычный клик; удержание — режим протягивания
        clearTimeout(hold);
        const x0 = e.clientX, y0 = e.clientY;
        hold = setTimeout(() => { hold = null; if (!brushError()) { suppressClick = true; startPaint(btn); navigator.vibrate?.(15); } }, 350);
        const cancel = (ev) => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) { clearTimeout(hold); hold = null; } };
        btn.addEventListener('pointermove', cancel);
        btn.addEventListener('pointerup', () => { btn.removeEventListener('pointermove', cancel); clearTimeout(hold); }, { once: true });
      }
    });
    tbody.addEventListener('pointermove', (e) => { if (paint && e.pointerType === 'mouse') paintAt(e.clientX, e.clientY); });
    // на телефоне во время протягивания таблица не прокручивается
    tbody.addEventListener('touchmove', (e) => { if (!paint) return; e.preventDefault(); const t = e.touches[0]; paintAt(t.clientX, t.clientY); }, { passive: false });
  }

  orderedStudents(group).forEach((s, i) => {
    const cells = jGroup[s.id] || {};
    const avgCell = h('td', { class: 'num' });
    const avg3Cell = shift === 3 ? h('td', { class: 'num' }) : null;

    const refreshAvg = () => {
      const cur = data.journal?.[shift]?.[group.id]?.[s.id] || {};
      const v = avgOf(lessons.map(l => cur[lessonKey(l)]));
      avgCell.innerHTML = '';
      avgCell.append(h('span', { class: 'avg ' + avgClass(v) }, fmtAvg(v)));
      if (avg3Cell) {
        const v3 = avgOf(allMarksOfStudent(data, group.id, s.id));
        avg3Cell.innerHTML = '';
        avg3Cell.append(h('span', { class: 'avg ' + avgClass(v3) }, fmtAvg(v3)));
      }
    };

    const tr = h('tr', {},
      h('td', { class: 'sticky-col' },
        h('span', { class: 'muted mono', style: { marginRight: '8px' } }, i + 1),
        s.short || s.fio),
      ...lessons.map(l => {
        const k = lessonKey(l);
        const btn = h('button', { class: 'mark ' + markClass(cells[k] || ''), title: `${dateRu(l.date)} · ${l.time} · ${l.code}` }, cells[k] || '');
        if (!readOnly) {
          const apply = (mark) => {
            setMark(shift, group.id, s.id, k, mark);
            markOf.set(btn, mark || '');
            btn.className = 'mark ' + markClass(mark);
            btn.textContent = mark || '';
            refreshAvg();
          };
          applyOf.set(btn, apply);
          markOf.set(btn, cells[k] || '');
          // мышь обрабатывается в pointerdown (протягивание); click — касание и клавиатура
          btn.addEventListener('click', (e) => {
            if (suppressClick) { suppressClick = false; return; }
            if (e.pointerType === 'mouse' || (e.detail > 0 && !e.pointerType && matchMedia('(pointer: fine)').matches)) return;
            if (brushError()) return;
            const brush = getBrush();
            const cur = markOf.get(btn) || '';
            if (brush === null) apply(CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length]);
            else apply(cur === brush ? '' : brush);
          });
          btn.addEventListener('contextmenu', (e) => { e.preventDefault(); apply(''); });
        }
        return h('td', { class: 'mark-cell' + (srcKey === k ? ' col-src' : '') }, btn);
      }),
      avgCell, avg3Cell,
    );
    refreshAvg();
    tbody.append(tr);
  });

  // строка итогов по занятию
  const footer = h('tfoot', {}, h('tr', {},
    h('td', { class: 'sticky-col muted' }, 'Присутствовало'),
    ...lessons.map(l => {
      const k = lessonKey(l);
      const n = group.students.filter(s => {
        const m = jGroup[s.id]?.[k];
        return m && m !== 'н';
      }).length;
      return h('td', { class: 'num muted mono' }, n || '');
    }),
    h('td', { class: 'num muted' }, ''), shift === 3 ? h('td', {}) : null));

  return h('div', {},
    h('div', { class: 'table-wrap' }, h('table', {}, thead, tbody, footer)),
    h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '8px' } },
      readOnly
        ? [icon('archive', 16), 'Архивная агломерация — отметки показаны только для просмотра, изменить их нельзя.']
        : isPipette
          ? [icon('pipette', 16), srcKey
              ? 'Урок скопирован (подсвечен). Клик по шапке другого урока вставит в него те же отметки. Повторный клик по подсвеченному — снять копию и выбрать другой урок.'
              : 'Пипетка: кликните по шапке урока (дата или «вт 1ур») — скопируются его отметки.']
        : isRandomMode
          ? [icon('dice', 16), 'Режим случайных оценок: клик по шапке занятия (дате) раздаёт оценки всему столбцу. Отдельные клетки в этом режиме не редактируются — выберите другую кисть, чтобы вернуться к обычной простановке.']
          : 'Клик по клетке ставит выбранную кисть (повторный клик той же отметкой — снимает); зажмите и проведите — кисть ляжет на весь столбец или строку (на телефоне — удержите палец и ведите). Правая кнопка мыши — очистить. Средний балл считается только по оценкам 2–5.'));
}

function exportJournal(data, subject, group, shift, lessons) {
  const jGroup = data.journal?.[shift]?.[group.id] || {};
  const head = ['№', 'Фамилия Имя', ...lessons.map(l => `${dateRu(l.date)} ${l.no}ур`), 'Средний балл'];
  if (shift === 3) head.push('Средний за 3 заезда');
  const rows = [[`${subject.title} — ${group.name} — ${shift} заезд`], head];
  orderedStudents(group).forEach((s, i) => {
    const cells = jGroup[s.id] || {};
    const marks = lessons.map(l => cells[lessonKey(l)] || '');
    const v = avgOf(marks);
    const row = [i + 1, s.short || s.fio, ...marks, v === null ? '' : v.toFixed(2).replace('.', ',')];
    if (shift === 3) {
      const v3 = avgOf(allMarksOfStudent(data, group.id, s.id));
      row.push(v3 === null ? '' : v3.toFixed(2).replace('.', ','));
    }
    rows.push(row);
  });
  download(`Журнал_${group.name}_${shift}заезд.csv`,
    '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n'),
    'text/csv;charset=utf-8');
  toast('Журнал выгружен в CSV');
}
