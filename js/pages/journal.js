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
import { h, toast, dateRu, download, emptyState, WEEKDAY_SHORT, modal } from '../core/ui.js';
import { getState, update, lessonsForGroup, lessonsForCode, lessonKey } from '../core/store.js';
import { ktpCard } from './ktp-panel.js';
import { go } from '../core/router.js';

export const SHIFTS = [1, 2, 3];
// Группы «Набора» (дополнительное образование, которые педагог набирает сам)
// показываются только в официальном журнале как ещё один псевдо-предмет —
// занятия для них берутся напрямую по коду расписания, а не через mapping.
export const ENROLL_SUBJECT_ID = '__enroll__';
const shortName = (fio) => (fio || '').trim().split(/\s+/).slice(0, 2).join(' ');
const matchKey = (fio) => shortName(fio).toLowerCase();

function enrollAsSubject(st) {
  const groups = (st.enroll?.groups || []).map(g => ({
    id: g.id, name: g.name, code: g.code || null, program: g.program || '',
    students: g.students.map(s => ({ id: s.id, fio: s.fio, short: shortName(s.fio) })),
  }));
  return { id: ENROLL_SUBJECT_ID, title: 'Набор (ДО)', isEnroll: true, groups };
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

  function setMark(shift, groupId, studentId, key, mark) {
    update(x => {
      const j = journalRoot(x).journal;
      j[shift] = j[shift] || {};
      j[shift][groupId] = j[shift][groupId] || {};
      j[shift][groupId][studentId] = j[shift][groupId][studentId] || {};
      if (!mark) delete j[shift][groupId][studentId][key];
      else j[shift][groupId][studentId][key] = mark;
    });
  }

  function redraw() {
    const st = getState();
    const data = journalRoot(st);
    wrap.innerHTML = '';

    const realSubjects = data.students?.subjects || [];
    const enrollGroups = isActual ? [] : (st.enroll?.groups || []);
    if (!realSubjects.length && !enrollGroups.length) {
      wrap.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, `Электронный журнал · ${kindTitle}`))));
      wrap.append(h('div', { class: 'card' }, emptyState('📋',
        isActual
          ? 'Фактический список обучающихся ещё не загружен. Импортируйте свой docx со списком детей и docx с реальным расписанием — отдельно от официальных документов.'
          : 'Список обучающихся ещё не загружен. Импортируйте docx со списком детей и docx с расписанием — либо заведите группу дополнительного образования на вкладке «Набор».',
        h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } },
          h('button', { class: 'btn primary', onClick: () => go('data', isActual ? { kind: 'actual' } : undefined) }, 'Перейти к импорту'),
          isActual ? null : h('button', { class: 'btn', onClick: () => go('enroll') }, 'Открыть «Набор»')))));
      return;
    }

    const ui = st.ui;
    const shift = ui[uiShiftKey] || 1;
    const subjects = enrollGroups.length ? [...realSubjects, enrollAsSubject(st)] : realSubjects;
    let subject = subjects.find(s => s.id === ui[uiSubjectKey]) || subjects[0];
    let group = subject.groups.find(g => g.id === ui[uiGroupKey]) || subject.groups[0];

    const sched = data.schedules[String(shift)];
    const lessons = subject.isEnroll ? lessonsForCode(shift, group.code, st) : lessonsForGroup(shift, group.id, st, kind);
    const canTransfer = !isActual && !subject.isEnroll && (st.actual?.students?.subjects || []).length > 0;

    wrap.append(h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, `Электронный журнал · ${kindTitle}`),
        h('p', {}, `${subject.title} · ${group.name} · ${group.students.length} чел.` +
          (sched ? ` · расписание ${shift} заезда: ${sched.lessons.length} занятий` : ' · расписание заезда не загружено'))),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn', onClick: () => markAllPresent(shift, group, lessons) }, '✓ Все присутствуют'),
        h('button', { class: 'btn', onClick: () => exportJournal(data, subject, group, shift, lessons) }, '⤓ Экспорт CSV'),
        canTransfer ? h('button', { class: 'btn', onClick: () => openTransferDialog(redraw) }, '🔁 Перенести из Фактического') : null,
        (subject.isEnroll || isActual) ? null : h('button', { class: 'btn primary', onClick: () => openVedomost(subject) }, '📄 Создание ведомости'),
        h('button', {
          class: 'btn',
          onClick: () => go(subject.isEnroll ? 'enroll' : 'data', (!subject.isEnroll && isActual) ? { kind: 'actual' } : undefined),
        }, subject.isEnroll ? '⚙ Набор' : '⚙ Данные'),
      )));

    /* --- вкладки заездов --- */
    wrap.append(h('div', { class: 'tabs' }, ...SHIFTS.map(s => {
      const sc = data.schedules[String(s)];
      return h('button', {
        class: 'tab' + (s === shift ? ' active' : ''),
        onClick: () => { update(x => { x.ui[uiShiftKey] = s; }); redraw(); }
      }, `${s} заезд`, h('span', { class: 'badge' }, sc ? `${sc.lessons.length}` : '—'));
    })));

    /* --- вкладки предметов --- */
    wrap.append(h('div', { class: 'tabs sub' }, ...subjects.map(s => h('button', {
      class: 'tab' + (s.id === subject.id ? ' active' : ''),
      onClick: () => { update(x => { x.ui[uiSubjectKey] = s.id; x.ui[uiGroupKey] = s.groups[0]?.id; }); redraw(); }
    }, s.title))));

    /* --- вкладки групп --- */
    wrap.append(h('div', { class: 'tabs sub' }, ...subject.groups.map(g => h('button', {
      class: 'tab' + (g.id === group.id ? ' active' : ''),
      onClick: () => { update(x => { x.ui[uiGroupKey] = g.id; }); redraw(); }
    }, g.name, h('span', { class: 'badge' }, g.students.length)))));

    /* --- панель отметок --- */
    wrap.append(h('div', { class: 'card', style: { marginBottom: '14px', padding: '12px 16px' } },
      h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' } },
        h('span', { class: 'muted', style: { fontSize: '12.5px', fontWeight: '600' } }, 'Кисть:'),
        ...MARKS.map(m => h('button', {
          class: 'mark ' + markClass(m) + (brush === m ? '' : ''),
          style: { width: '44px', outline: brush === m ? '2px solid var(--neon)' : 'none', outlineOffset: '2px' },
          onClick: () => { brush = m; redraw(); }
        }, m)),
        h('button', {
          class: 'btn sm' + (brush === '' ? ' primary' : ''),
          onClick: () => { brush = ''; redraw(); }
        }, '⌫ Стереть'),
        h('button', {
          class: 'btn sm' + (brush === null ? ' primary' : ''),
          onClick: () => { brush = null; redraw(); }
        }, '↻ Цикл по клику'),
        h('div', { class: 'legend', style: { marginLeft: 'auto' } },
          h('span', { class: 'k' }, h('i', { class: 'sw', style: { background: 'rgba(43,255,139,.3)' } }), '✓ был'),
          h('span', { class: 'k' }, h('i', { class: 'sw', style: { background: 'rgba(125,149,163,.3)' } }), 'н — не был'),
          h('span', { class: 'k' }, h('i', { class: 'sw', style: { background: 'var(--red)' } }), '2'),
          h('span', { class: 'k' }, h('i', { class: 'sw', style: { background: 'var(--orange)' } }), '3'),
          h('span', { class: 'k' }, h('i', { class: 'sw', style: { background: 'var(--yellow)' } }), '4'),
          h('span', { class: 'k' }, h('i', { class: 'sw', style: { background: 'var(--green-bright)' } }), '5'),
        ))));

    if (!sched) {
      wrap.append(h('div', { class: 'card' }, emptyState('🗓',
        `Расписание ${shift} заезда не загружено.`,
        h('button', { class: 'btn primary', onClick: () => go('data', isActual ? { kind: 'actual' } : undefined) }, 'Загрузить расписание'))));
      return;
    }
    if (!lessons.length) {
      if (subject.isEnroll) {
        const msg = group.code
          ? `В расписании ${shift} заезда нет занятий с кодом «${group.code}».`
          : `Группа «${group.name}» не привязана к коду в расписании.`;
        wrap.append(h('div', { class: 'card' }, emptyState('🔗', msg,
          h('button', { class: 'btn primary', onClick: () => go('enroll') }, 'Привязать код в «Наборе»'))));
        return;
      }
      const mapped = Object.entries(data.mapping).filter(([, m]) => m?.groupId === group.id).length;
      wrap.append(h('div', { class: 'card' }, emptyState('🔗',
        mapped ? `В расписании ${shift} заезда нет занятий для этой группы.`
               : `Группа «${group.name}» не сопоставлена ни с одним кодом расписания (например «Т1 РШ7»).`,
        h('button', { class: 'btn primary', onClick: () => go('data', isActual ? { kind: 'actual' } : undefined) }, 'Настроить сопоставление'))));
      return;
    }

    // темы КТП по дням — только для официального расписания, по нему заполняется
    // электронный журнал
    if (!isActual) wrap.append(ktpCard(st, group, shift, lessons, redraw));

    wrap.append(journalTable(data, subject, group, shift, lessons, setMark, redraw, () => brush));
  }

  /** Открывает ведомость, предварительно выбрав группы текущего предмета. */
  function openVedomost(subject) {
    update(x => {
      if (!x.vedomostGroups?.length) x.vedomostGroups = subject.groups.map(g => g.id);
      if (!x.vedomostHeader?.teacher && x.plan?.teacher) {
        x.vedomostHeader = { ...(x.vedomostHeader || {}), teacher: x.plan.teacher };
      }
    });
    go('vedomost');
  }

  function markAllPresent(shift, group, lessons) {
    if (!lessons.length) return toast('Нет занятий для отметки', 'err');
    update(x => {
      const j = journalRoot(x).journal;
      j[shift] = j[shift] || {}; j[shift][group.id] = j[shift][group.id] || {};
      for (const st of group.students) {
        const cell = j[shift][group.id][st.id] = j[shift][group.id][st.id] || {};
        for (const l of lessons) { const k = lessonKey(l); if (!cell[k]) cell[k] = '✓'; }
      }
    });
    toast(`Отмечено присутствие: ${group.students.length} чел. × ${lessons.length} занятий`);
    redraw();
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
    const officialList = flatStudents(st);
    const actualList = flatStudents(st.actual);
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
        const avg = shiftAvgOfStudent(st.actual, fact.group.id, fact.student.id, sh);
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
          m.ambiguous ? h('span', { class: 'pill warn', style: { marginLeft: '6px' } }, '⚠ неск. совпадений') : null),
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
          x.vedomostMarks = x.vedomostMarks || {};
          for (const i of checked) {
            const m = matches[i];
            const rec = x.vedomostMarks[m.official.student.id] = x.vedomostMarks[m.official.student.id] || {};
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

function journalTable(data, subject, group, shift, lessons, setMark, redraw, getBrush) {
  const jGroup = data.journal?.[shift]?.[group.id] || {};

  const thead = h('thead', {},
    h('tr', {},
      h('th', { class: 'sticky-col', rowspan: 2, style: { minWidth: '220px' } }, 'Фамилия Имя'),
      ...lessons.map(l => h('th', { class: 'num', title: `${l.code} · ${l.time} · ${l.weekday}` },
        dateRu(l.date))),
      h('th', { class: 'num', rowspan: 2, title: 'Средний балл за заезд' }, `Ср. балл${shift === 3 ? ' (3 заезд)' : ''}`),
      shift === 3 ? h('th', { class: 'num', rowspan: 2, title: 'Средний балл за все три заезда' }, 'Ср. за 3 заезда') : null,
    ),
    h('tr', {}, ...lessons.map(l => h('th', { class: 'num', style: { fontSize: '10.5px', fontWeight: '400' } },
      `${WEEKDAY_SHORT[l.weekday] || ''} ${l.no}ур`))),
  );

  const tbody = h('tbody', {});
  group.students.forEach((s, i) => {
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
        const apply = (mark) => {
          setMark(shift, group.id, s.id, k, mark);
          btn.className = 'mark ' + markClass(mark);
          btn.textContent = mark || '';
          refreshAvg();
        };
        btn.addEventListener('click', () => {
          const brush = getBrush();
          const cur = data.journal?.[shift]?.[group.id]?.[s.id]?.[k] || '';
          if (brush === null) apply(CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length]);
          else apply(cur === brush ? '' : brush);
        });
        btn.addEventListener('contextmenu', (e) => { e.preventDefault(); apply(''); });
        return h('td', { class: 'mark-cell' }, btn);
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
      'Клик по клетке ставит выбранную кисть (повторный клик той же отметкой — снимает), правая кнопка мыши — очистить. Средний балл считается только по оценкам 2–5.'));
}

function exportJournal(data, subject, group, shift, lessons) {
  const jGroup = data.journal?.[shift]?.[group.id] || {};
  const head = ['№', 'Фамилия Имя', ...lessons.map(l => `${dateRu(l.date)} ${l.no}ур`), 'Средний балл'];
  if (shift === 3) head.push('Средний за 3 заезда');
  const rows = [[`${subject.title} — ${group.name} — ${shift} заезд`], head];
  group.students.forEach((s, i) => {
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
