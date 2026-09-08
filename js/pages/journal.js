// Электронный журнал: заезды → предметы → группы (вкладки), отметки и средние баллы.
import { h, toast, dateRu, download, emptyState, WEEKDAY_SHORT, modal } from '../core/ui.js';
import { getState, update, lessonsForGroup, lessonsForCode, lessonKey } from '../core/store.js';
import { go } from '../core/router.js';

export const SHIFTS = [1, 2, 3];
// Группы «Набора» (дополнительное образование, которые педагог набирает сам)
// показываются в журнале как ещё один псевдо-предмет рядом с сетевыми —
// занятия для них берутся напрямую по коду расписания, а не через st.mapping.
export const ENROLL_SUBJECT_ID = '__enroll__';
const shortName = (fio) => (fio || '').trim().split(/\s+/).slice(0, 2).join(' ');

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

/** Все оценки ученика за все заезды. */
function allMarksOfStudent(st, groupId, studentId) {
  const out = [];
  for (const sh of SHIFTS) {
    const cell = st.journal?.[sh]?.[groupId]?.[studentId];
    if (cell) out.push(...Object.values(cell));
  }
  return out;
}

export function render(root) {
  const wrap = h('div', {});
  root.append(wrap);
  let brush = '✓';

  function setMark(shift, groupId, studentId, key, mark) {
    update(x => {
      const j = x.journal;
      j[shift] = j[shift] || {};
      j[shift][groupId] = j[shift][groupId] || {};
      j[shift][groupId][studentId] = j[shift][groupId][studentId] || {};
      if (!mark) delete j[shift][groupId][studentId][key];
      else j[shift][groupId][studentId][key] = mark;
    });
  }

  function redraw() {
    const st = getState();
    wrap.innerHTML = '';

    const realSubjects = st.students?.subjects || [];
    const enrollGroups = st.enroll?.groups || [];
    if (!realSubjects.length && !enrollGroups.length) {
      wrap.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Электронный журнал'))));
      wrap.append(h('div', { class: 'card' }, emptyState('📋',
        'Список обучающихся ещё не загружен. Импортируйте docx со списком детей и docx с расписанием — либо заведите группу дополнительного образования на вкладке «Набор».',
        h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } },
          h('button', { class: 'btn primary', onClick: () => go('data') }, 'Перейти к импорту'),
          h('button', { class: 'btn', onClick: () => go('enroll') }, 'Открыть «Набор»')))));
      return;
    }

    const ui = st.ui;
    const shift = ui.journalShift || 1;
    const subjects = enrollGroups.length ? [...realSubjects, enrollAsSubject(st)] : realSubjects;
    let subject = subjects.find(s => s.id === ui.journalSubject) || subjects[0];
    let group = subject.groups.find(g => g.id === ui.journalGroup) || subject.groups[0];

    const sched = st.schedules[String(shift)];
    const lessons = subject.isEnroll ? lessonsForCode(shift, group.code, st) : lessonsForGroup(shift, group.id, st);

    wrap.append(h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'Электронный журнал'),
        h('p', {}, `${subject.title} · ${group.name} · ${group.students.length} чел.` +
          (sched ? ` · расписание ${shift} заезда: ${sched.lessons.length} занятий` : ' · расписание заезда не загружено'))),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn', onClick: () => markAllPresent(shift, group, lessons) }, '✓ Все присутствуют'),
        h('button', { class: 'btn', onClick: () => exportJournal(st, subject, group, shift, lessons) }, '⤓ Экспорт CSV'),
        subject.isEnroll ? null : h('button', { class: 'btn primary', onClick: () => openVedomost(subject) }, '📄 Создание ведомости'),
        h('button', { class: 'btn', onClick: () => go(subject.isEnroll ? 'enroll' : 'data') }, subject.isEnroll ? '⚙ Набор' : '⚙ Данные'),
      )));

    /* --- вкладки заездов --- */
    wrap.append(h('div', { class: 'tabs' }, ...SHIFTS.map(s => {
      const sc = st.schedules[String(s)];
      return h('button', {
        class: 'tab' + (s === shift ? ' active' : ''),
        onClick: () => { update(x => { x.ui.journalShift = s; }); redraw(); }
      }, `${s} заезд`, h('span', { class: 'badge' }, sc ? `${sc.lessons.length}` : '—'));
    })));

    /* --- вкладки предметов --- */
    wrap.append(h('div', { class: 'tabs sub' }, ...subjects.map(s => h('button', {
      class: 'tab' + (s.id === subject.id ? ' active' : ''),
      onClick: () => { update(x => { x.ui.journalSubject = s.id; x.ui.journalGroup = s.groups[0]?.id; }); redraw(); }
    }, s.title))));

    /* --- вкладки групп --- */
    wrap.append(h('div', { class: 'tabs sub' }, ...subject.groups.map(g => h('button', {
      class: 'tab' + (g.id === group.id ? ' active' : ''),
      onClick: () => { update(x => { x.ui.journalGroup = g.id; }); redraw(); }
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
        h('button', { class: 'btn primary', onClick: () => go('data') }, 'Загрузить расписание'))));
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
      const mapped = Object.entries(st.mapping).filter(([, m]) => m?.groupId === group.id).length;
      wrap.append(h('div', { class: 'card' }, emptyState('🔗',
        mapped ? `В расписании ${shift} заезда нет занятий для этой группы.`
               : `Группа «${group.name}» не сопоставлена ни с одним кодом расписания (например «Т1 РШ7»).`,
        h('button', { class: 'btn primary', onClick: () => go('data') }, 'Настроить сопоставление'))));
      return;
    }

    wrap.append(journalTable(st, subject, group, shift, lessons, setMark, redraw, () => brush));
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
      const j = x.journal;
      j[shift] = j[shift] || {}; j[shift][group.id] = j[shift][group.id] || {};
      for (const st of group.students) {
        const cell = j[shift][group.id][st.id] = j[shift][group.id][st.id] || {};
        for (const l of lessons) { const k = lessonKey(l); if (!cell[k]) cell[k] = '✓'; }
      }
    });
    toast(`Отмечено присутствие: ${group.students.length} чел. × ${lessons.length} занятий`);
    redraw();
  }

  redraw();
}

function journalTable(st, subject, group, shift, lessons, setMark, redraw, getBrush) {
  const jGroup = st.journal?.[shift]?.[group.id] || {};

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
      const cur = getState().journal?.[shift]?.[group.id]?.[s.id] || {};
      const v = avgOf(lessons.map(l => cur[lessonKey(l)]));
      avgCell.innerHTML = '';
      avgCell.append(h('span', { class: 'avg ' + avgClass(v) }, fmtAvg(v)));
      if (avg3Cell) {
        const v3 = avgOf(allMarksOfStudent(getState(), group.id, s.id));
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
          const cur = getState().journal?.[shift]?.[group.id]?.[s.id]?.[k] || '';
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

function exportJournal(st, subject, group, shift, lessons) {
  const jGroup = st.journal?.[shift]?.[group.id] || {};
  const head = ['№', 'Фамилия Имя', ...lessons.map(l => `${dateRu(l.date)} ${l.no}ур`), 'Средний балл'];
  if (shift === 3) head.push('Средний за 3 заезда');
  const rows = [[`${subject.title} — ${group.name} — ${shift} заезд`], head];
  group.students.forEach((s, i) => {
    const cells = jGroup[s.id] || {};
    const marks = lessons.map(l => cells[lessonKey(l)] || '');
    const v = avgOf(marks);
    const row = [i + 1, s.short || s.fio, ...marks, v === null ? '' : v.toFixed(2).replace('.', ',')];
    if (shift === 3) {
      const v3 = avgOf(allMarksOfStudent(st, group.id, s.id));
      row.push(v3 === null ? '' : v3.toFixed(2).replace('.', ','));
    }
    rows.push(row);
  });
  download(`Журнал_${group.name}_${shift}заезд.csv`,
    '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n'),
    'text/csv;charset=utf-8');
  toast('Журнал выгружен в CSV');
}
