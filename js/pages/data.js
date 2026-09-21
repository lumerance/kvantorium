// Страница «Данные»: импорт docx/xlsx, сопоставление кодов расписания с группами, резервные копии.
// Официальный и Фактический журналы (см. js/pages/journal.js) — это два
// независимых набора списка/расписания/сопоставления одной и той же формы;
// переключаются вкладкой вверху страницы, вся логика ниже общая — просто
// читает/пишет либо st.* (официальный), либо st.actual.* (фактический).
import { h, toast, fileDrop, download, modal, confirmBox, dateRu, emptyState, pickFile, aggBadge } from '../core/ui.js';
import {
  getState, update, resetAll, exportBackup, importBackup, allGroups, keepGroups, removeGroup, removeSubject, filterSchedule, autoMapAll,
  viewedAgg, activeAgg, isViewingArchive, allAgglomerations, createAgglomeration, renameAgglomeration, switchViewedAgglomeration, setActiveAgglomeration,
} from '../core/store.js';
import { importStudentsFile, importStudentsCsvFile, studentsToCsv } from '../parsers/students.js';
import { importScheduleFile, parseCode } from '../parsers/schedule.js';
import { importPlanFile } from '../parsers/plan.js';
import { SHIFTS } from './journal.js';
import { programsCard } from './ktp-panel.js';
import { actualScheduleCard } from './actual-schedule-panel.js';
import { go } from '../core/router.js';

const dataOf = (st, kind) => (kind === 'actual' ? st.actual : st);
const uiKeys = (kind) => (kind === 'actual'
  ? { subj: 'actualJournalSubject', grp: 'actualJournalGroup' }
  : { subj: 'journalSubject', grp: 'journalGroup' });

export function render(root, params = {}) {
  const wrap = h('div', {});
  root.append(wrap);
  let kind = params.kind === 'actual' ? 'actual' : 'official';

  function redraw() {
    const st = getState();
    const agg = viewedAgg(st);
    const readOnly = isViewingArchive(st);
    wrap.innerHTML = '';
    wrap.append(h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Данные', aggBadge(agg, readOnly)), h('p', {}, 'Импорт документов, сопоставление групп и резервные копии. Всё хранится локально в браузере.')),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn', onClick: () => download(`Кванториум28_бэкап_${new Date().toISOString().slice(0, 10)}.json`, exportBackup(), 'application/json') }, '⤓ Выгрузить всё'),
        h('button', { class: 'btn', onClick: () => pickFile('.json', async f => {
          try { importBackup(await f.text()); toast('Резервная копия загружена'); redraw(); }
          catch (e) { toast('Ошибка: ' + e.message, 'err'); }
        }) }, '⤒ Загрузить копию'),
        h('button', { class: 'btn danger', onClick: () => confirmBox('Удалить ВСЕ данные приложения — включая все агломерации (списки, расписания, журналы), часы и настройки зарплаты?', () => { resetAll(); toast('Данные очищены'); redraw(); }) }, '🗑 Очистить'),
      )));

    wrap.append(agglomerationSwitcher(st, redraw));
    if (readOnly) {
      wrap.append(h('div', { class: 'card', style: { marginBottom: '16px', padding: '12px 16px' } },
        h('span', { class: 'muted' }, '🗄 Просмотр архивной агломерации — импорт и правки здесь недоступны. Новые данные по-прежнему пишутся в активную агломерацию.')));
    }

    wrap.append(h('div', { class: 'tabs', style: { marginBottom: '16px' } },
      h('button', { class: 'tab' + (kind === 'official' ? ' active' : ''), onClick: () => { kind = 'official'; redraw(); } }, '📋 Официальный журнал'),
      h('button', { class: 'tab' + (kind === 'actual' ? ' active' : ''), onClick: () => { kind = 'actual'; redraw(); } }, '📝 Фактический журнал')));
    wrap.append(h('p', { class: 'muted', style: { fontSize: '12.5px', marginTop: '-8px', marginBottom: '16px' } },
      kind === 'actual'
        ? 'Реальный состав и расписание — если отличаются от официальных сетевых документов. Список и коды никак не связаны с официальным журналом, кроме переноса оценок по совпадающим ФИО.'
        : 'Официальные сетевые документы школ — на них строится ведомость, часы по плану и переносятся оценки из фактического журнала.'));

    wrap.append(studentsRow(agg, redraw, kind, readOnly));
    wrap.append(scheduleCard(agg, redraw, kind, readOnly));
    wrap.append(h('div', { style: { marginBottom: '16px' } }, mappingCard(agg, redraw, kind, readOnly)));
    if (kind === 'official') {
      wrap.append(h('div', { style: { marginBottom: '16px' } }, planCard(st, redraw)));
      wrap.append(programsCard(agg, redraw, readOnly));
    }
  }

  redraw();
}

/* ---------------- агломерации: список, переключение, создание ---------------- */
// Агломерация — блок из трёх заездов с одним набором детей. Когда набор
// сменяется на новый учебный период, заводится новая агломерация — прежняя
// не стирается, а остаётся здесь в списке доступной для просмотра (только
// чтение — писать можно только в активную, см. store.js: activeAgg/viewedAgg).
function agglomerationSwitcher(st, redraw) {
  const list = allAgglomerations(st);
  const active = activeAgg(st);
  const viewed = viewedAgg(st);

  const pill = (agg) => {
    const isActive = agg.id === active.id;
    const isViewed = agg.id === viewed.id;
    const n = agg.students?.stats?.students ?? 0;
    return h('div', {
      class: 'check-pill' + (isViewed ? ' on' : ''),
      style: { cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' },
      onClick: () => { switchViewedAgglomeration(agg.id); redraw(); },
    },
      h('span', {}, agg.name),
      h('span', { class: 'muted mono', style: { fontSize: '11px' } }, `${n} чел.`),
      isActive ? h('span', { class: 'pill ok', style: { fontSize: '10.5px' } }, 'активна') : null,
      h('button', {
        class: 'btn sm ghost', title: 'Переименовать', style: { padding: '2px 6px' },
        onClick: (e) => { e.stopPropagation(); renameModal(agg, redraw); },
      }, '✎'),
      (!isActive) ? h('button', {
        class: 'btn sm ghost', title: 'Сделать активной — новые записи будут идти сюда', style: { padding: '2px 6px' },
        onClick: (e) => {
          e.stopPropagation();
          confirmBox(`Сделать «${agg.name}» активной агломерацией? Все новые изменения (отметки, импорт, набор) будут идти в неё, пока не переключите снова.`,
            () => { setActiveAgglomeration(agg.id); redraw(); });
        },
      }, '⇧ сделать активной') : null);
  };

  return h('div', { class: 'card', style: { marginBottom: '16px' } },
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' } },
      h('div', {},
        h('h3', { style: { margin: '0 0 4px' } }, '📚 Агломерации'),
        h('p', { class: 'muted', style: { fontSize: '12.5px', margin: 0 } },
          'Каждая — свой набор детей на блок из трёх заездов. Прошлые остаются доступны для просмотра, писать можно только в активную.')),
      h('button', { class: 'btn sm primary', onClick: () => newAgglomerationModal(redraw) }, '+ Новая агломерация')),
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' } }, ...list.map(pill)));
}

function newAgglomerationModal(redraw) {
  const input = h('input', { type: 'text', placeholder: 'Например, «Агломерация 2»', value: '' });
  modal({
    title: '+ Новая агломерация',
    body: h('div', {},
      h('p', { class: 'muted', style: { marginTop: 0 } },
        'Заводит новый, пустой набор данных (список, расписание, журнал, «Набор», КТП, ведомость) и делает его активным — все новые записи пойдут в него. Прежняя агломерация никуда не денется, останется доступна для просмотра выше.'),
      h('label', { class: 'field' }, h('span', {}, 'Название'), input)),
    okText: 'Создать и сделать активной',
    onOk: () => { createAgglomeration(input.value); toast('Новая агломерация создана и стала активной'); redraw(); },
  });
}

function renameModal(agg, redraw) {
  const input = h('input', { type: 'text', value: agg.name });
  modal({
    title: 'Переименовать агломерацию',
    body: h('label', { class: 'field' }, h('span', {}, 'Название'), input),
    okText: 'Сохранить',
    onOk: () => {
      if (!input.value.trim()) { toast('Название не может быть пустым', 'err'); return false; }
      renameAgglomeration(agg.id, input.value);
      redraw();
    },
  });
}

/* ---------------- список обучающихся: строка + модальное окно ---------------- */
// Полное содержимое (список, кнопки, загрузка файла) открывается в модалке —
// на странице остаётся только сводная строка с числом детей и кнопкой
// «Открыть», а не панель на всю высоту.
function studentsRow(agg, redraw, kind, readOnly) {
  const s = dataOf(agg, kind).students;
  return h('div', { class: 'card', style: { marginBottom: '16px' } },
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' } },
      h('div', {},
        h('h3', { style: { margin: '0 0 4px' } }, '1. Список обучающихся'),
        h('p', { class: 'muted', style: { fontSize: '12.5px', margin: 0 } },
          s ? `${s.stats.subjects} предм. · ${s.stats.groups} групп · ${s.stats.students} детей` + (s.sourceName ? ` — ${s.sourceName}` : '')
            : 'Список ещё не загружен')),
      h('button', { class: 'btn primary', onClick: () => openStudentsModal(kind, redraw) }, s ? '📋 Открыть' : '📋 Загрузить')));
}

function openStudentsModal(kind, outerRedraw) {
  const wrap = h('div', {});
  let closeModal = null;
  const localRedraw = () => { outerRedraw(); render(); };
  function render() {
    wrap.innerHTML = '';
    const st = getState();
    const agg = viewedAgg(st);
    const readOnly = isViewingArchive(st);
    wrap.append(studentsCard(agg, localRedraw, kind, { heading: null, onNavigate: () => closeModal?.(), readOnly }));
  }
  render();
  const { close } = modal({
    wide: true,
    title: kind === 'actual' ? 'Список обучающихся · Фактический журнал' : 'Список обучающихся · Официальный журнал',
    body: wrap, okText: null, cancelText: 'Закрыть',
  });
  closeModal = close;
}

function studentsCard(agg, redraw, kind, opts = {}) {
  const { heading = '1. Список обучающихся', onNavigate, readOnly = false } = opts;
  const s = dataOf(agg, kind).students;
  const { subj, grp } = uiKeys(kind);
  const body = h('div', {});
  if (readOnly) body.append(h('p', { class: 'muted', style: { fontSize: '12.5px', marginTop: 0 } },
    '🗄 Архивная агломерация — список показан только для просмотра.'));
  if (s) {
    body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Файл'), h('span', { class: 'v' }, s.sourceName || '—')));
    body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Предметов / групп / детей'),
      h('span', { class: 'v' }, `${s.stats.subjects} / ${s.stats.groups} / ${s.stats.students}`)));
    const list = h('div', { style: { marginTop: '10px' } });
    for (const sub of s.subjects) {
      list.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '10px 0 4px' } },
        h('span', { style: { fontSize: '13px', fontWeight: '700' } }, sub.title),
        sub.grade ? h('span', { class: 'pill cyan' }, sub.grade + ' класс') : null,
        readOnly ? null : h('button', {
          class: 'btn sm danger ghost', title: 'Удалить предмет целиком',
          onClick: () => confirmBox(`Удалить «${sub.title}» со всеми группами? Отметки этих групп в журнале тоже пропадут.`,
            () => { removeSubject(sub.id, kind); toast('Предмет удалён'); redraw(); })
        }, '×')));
      list.append(h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
        ...sub.groups.map(g => h('span', { class: 'pill removable' },
          `${g.name} · ${g.students.length}`,
          readOnly ? null : h('button', {
            class: 'pill-x', title: 'Убрать группу',
            onClick: () => confirmBox(`Убрать «${sub.title} · ${g.name}» (${g.students.length} чел.)? Отметки этой группы в журнале тоже пропадут.`,
              () => { removeGroup(g.id, kind); toast('Группа убрана'); redraw(); })
          }, '×')))));
    }
    body.append(list);
    body.append(h('div', { style: { display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' } },
      h('button', { class: 'btn sm', onClick: () => download('Обучающиеся.csv', studentsToCsv(s.subjects), 'text/csv;charset=utf-8') }, '⤓ Экспорт учеников (CSV)'),
      readOnly ? null : h('button', { class: 'btn sm', onClick: () => pickCsv(redraw, kind) }, '⤒ Импорт учеников (CSV)'),
      readOnly ? null : h('button', { class: 'btn sm', onClick: () => groupsDialog(redraw, false, kind) }, '☑ Выбрать группы'),
      (!readOnly && scheduleCodesExist(agg, kind)) ? h('button', {
        class: 'btn sm', title: 'Убрать группы, которых нет в загруженном расписании',
        onClick: () => keepOnlyScheduled(redraw, kind)
      }, '⚡ Только мои по расписанию') : null,
      h('button', { class: 'btn sm', onClick: () => { onNavigate?.(); go('journal', kind === 'actual' ? { kind: 'actual' } : undefined); } }, 'Открыть журнал →'),
    ));
  }
  if (!readOnly) {
    if (!s) body.append(h('div', { style: { marginBottom: '10px' } },
      h('button', { class: 'btn sm', onClick: () => pickCsv(redraw, kind) }, '⤒ Импорт учеников из CSV')));
    body.append(fileDrop({
      title: s ? 'Загрузить другой список обучающихся (.docx)' : 'Список обучающихся (.docx)',
      hint: 'дети автоматически разбиваются по предметам и группам',
      accept: '.docx',
      onFile: async (file) => {
        try {
          const res = await importStudentsFile(file);
          update(x => {
            const a = dataOf(activeAgg(x), kind);
            a.students = { ...res, importedAt: new Date().toISOString() };
            x.ui[subj] = res.subjects[0]?.id || null;
            x.ui[grp] = res.subjects[0]?.groups[0]?.id || null;
          });
          autoMapAll(kind);
          toast(`Загружено: ${res.stats.groups} групп, ${res.stats.students} детей`);
          redraw();
          if (res.stats.groups > 1) groupsDialog(redraw, true, kind);
        } catch (e) { console.error(e); toast('Ошибка импорта: ' + e.message, 'err'); }
      },
    }));
  }
  if (!heading) return body;
  return h('div', { class: 'card' }, h('h3', {}, heading), body);
}

function pickCsv(redraw, kind) {
  const { subj, grp } = uiKeys(kind);
  pickFile('.csv,text/csv', async (file) => {
    try {
      const res = await importStudentsCsvFile(file);
      update(x => {
        dataOf(activeAgg(x), kind).students = { ...res, importedAt: new Date().toISOString() };
        x.ui[subj] = res.subjects[0]?.id || null;
        x.ui[grp] = res.subjects[0]?.groups[0]?.id || null;
      });
      autoMapAll(kind);
      toast(`Из CSV загружено: ${res.stats.groups} групп, ${res.stats.students} детей`);
      redraw();
    } catch (e) { console.error(e); toast('Ошибка импорта CSV: ' + e.message, 'err'); }
  });
}


/* ---------------- выбор групп и фильтр расписания ---------------- */

const lastName = (fio) => (fio || '').trim().split(/\s+/)[0].toLowerCase();

function scheduleCodesExist(agg, kind) {
  const data = dataOf(agg, kind);
  return SHIFTS.some(sh => (data.schedules[String(sh)]?.codes || []).length);
}

/** Оставляет только те группы, что встречаются в загруженном расписании.
 *  Вызывается только вне архива (кнопка скрыта в readOnly) — читает и пишет активную. */
function keepOnlyScheduled(redraw, kind) {
  const agg = activeAgg(getState());
  const data = dataOf(agg, kind);
  const codes = new Set();
  for (const sh of SHIFTS) for (const c of (data.schedules[String(sh)]?.codes || [])) codes.add(c);
  const keep = new Set();
  for (const [code, m] of Object.entries(data.mapping || {})) if (codes.has(code) && m?.groupId) keep.add(m.groupId);
  if (!keep.size) return toast('Ни одна группа не сопоставлена с расписанием — сначала настройте сопоставление', 'err');
  const all = allGroups(agg, kind);
  const drop = all.filter(g => !keep.has(g.group.id));
  if (!drop.length) return toast('Лишних групп нет — все есть в расписании');
  confirmBox(`Убрать ${drop.length} групп(ы), которых нет в расписании: ${drop.map(g => g.group.name).slice(0, 6).join(', ')}${drop.length > 6 ? '…' : ''}?`,
    () => { keepGroups([...keep], kind); toast(`Убрано групп: ${drop.length}`); redraw(); });
}

/** Модалка «какие группы оставить». afterImport — открыта сразу после импорта.
 *  Вызывается только вне архива (кнопка скрыта в readOnly) — читает и пишет активную. */
function groupsDialog(redraw, afterImport = false, kind) {
  const agg = activeAgg(getState());
  const all = allGroups(agg, kind);
  if (!all.length) return toast('Список обучающихся пуст', 'err');
  const checked = new Set(all.map(g => g.group.id));
  const body = h('div', {});
  if (afterImport) body.append(h('p', { class: 'muted', style: { marginTop: 0 } },
    'В документе обычно списки нескольких педагогов. Снимите галочки с чужих групп — они не попадут в журнал.'));

  const boxes = new Map();
  const bySubject = new Map();
  for (const g of all) {
    if (!bySubject.has(g.subject.id)) bySubject.set(g.subject.id, { subject: g.subject, groups: [] });
    bySubject.get(g.subject.id).groups.push(g);
  }
  const counter = h('span', { class: 'pill ok' }, '');
  const refresh = () => { counter.textContent = `оставить: ${checked.size} из ${all.length}`; };

  const mapping = dataOf(agg, kind).mapping || {};
  for (const { subject, groups } of bySubject.values()) {
    const head = h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', margin: '12px 0 6px' } },
      h('b', { style: { fontSize: '13px' } }, subject.title),
      h('button', {
        class: 'btn sm ghost', onClick: () => {
          const allOn = groups.every(g => checked.has(g.group.id));
          groups.forEach(g => { allOn ? checked.delete(g.group.id) : checked.add(g.group.id); boxes.get(g.group.id).checked = !allOn; });
          refresh();
        }
      }, 'все / никого'));
    body.append(head);
    const row = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
    for (const g of groups) {
      const cb = h('input', {
        type: 'checkbox', checked: true, style: { width: 'auto', margin: 0 },
        onChange: (e) => { e.target.checked ? checked.add(g.group.id) : checked.delete(g.group.id); refresh(); },
      });
      boxes.set(g.group.id, cb);
      const codes = Object.entries(mapping).filter(([, m]) => m?.groupId === g.group.id).map(([c]) => c);
      row.append(h('label', {
        class: 'check-pill',
      }, cb, h('span', {}, `${g.group.name} · ${g.group.students.length}`),
        codes.length ? h('span', { class: 'muted mono', style: { fontSize: '11px' } }, codes.join(' ')) : null));
    }
    body.append(row);
  }
  refresh();
  body.append(h('div', { style: { marginTop: '14px' } }, counter));

  modal({
    wide: true, title: 'Какие группы оставить',
    body, okText: 'Применить',
    onOk: () => {
      if (!checked.size) { toast('Нужно оставить хотя бы одну группу', 'err'); return false; }
      const removed = all.length - checked.size;
      keepGroups([...checked], kind);
      toast(removed ? `Убрано групп: ${removed}` : 'Оставлены все группы');
      redraw();
    },
  });
}

/** Модалка фильтра расписания: педагоги и коды групп.
 *  Вызывается только вне архива (кнопка скрыта в readOnly) — читает и пишет активную. */
function scheduleDialog(shift, redraw, afterImport = false, kind) {
  const st = getState();
  const agg = activeAgg(st);
  const data = dataOf(agg, kind);
  const sc = data.schedules[String(shift)];
  if (!sc) return;
  const myLast = lastName(st.plan?.teacher || agg.vedomostHeader?.teacher || '');
  const teachers = new Set(
    afterImport && myLast && sc.teachers.some(t => lastName(t) === myLast)
      ? sc.teachers.filter(t => lastName(t) === myLast)
      : sc.teachers);
  const codes = new Set(sc.codes);

  const body = h('div', {});
  if (afterImport) body.append(h('p', { class: 'muted', style: { marginTop: 0 } },
    'В документе расписание нескольких педагогов. Оставьте только свои занятия — журнал построится по ним.'));

  const stat = h('div', { class: 'pill ok', style: { marginTop: '12px' } }, '');
  const codeBoxes = new Map();
  const recount = () => {
    const n = sc.lessons.filter(l => teachers.has(l.teacher) && (codes.has(l.code) || l.kind === 'event')).length;
    stat.textContent = `останется занятий: ${n} из ${sc.lessons.length}`;
  };

  body.append(h('h4', { style: { margin: '10px 0 6px', fontSize: '13px' } }, 'Педагоги'));
  const tRow = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
  for (const t of sc.teachers) {
    const cnt = sc.lessons.filter(l => l.teacher === t).length;
    const cb = h('input', {
      type: 'checkbox', checked: teachers.has(t), style: { width: 'auto', margin: 0 },
      onChange: (e) => { e.target.checked ? teachers.add(t) : teachers.delete(t); recount(); },
    });
    tRow.append(h('label', { class: 'check-pill' }, cb, h('span', {}, t || '(без имени)'),
      h('span', { class: 'muted mono', style: { fontSize: '11px' } }, cnt)));
  }
  body.append(tRow);

  body.append(h('h4', { style: { margin: '16px 0 6px', fontSize: '13px' } }, 'Группы в расписании'));
  const cRow = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
  for (const c of sc.codes) {
    const cnt = sc.lessons.filter(l => l.code === c).length;
    const cb = h('input', {
      type: 'checkbox', checked: true, style: { width: 'auto', margin: 0 },
      onChange: (e) => { e.target.checked ? codes.add(c) : codes.delete(c); recount(); },
    });
    codeBoxes.set(c, cb);
    cRow.append(h('label', { class: 'check-pill' }, cb, h('span', { class: 'mono' }, c),
      h('span', { class: 'muted mono', style: { fontSize: '11px' } }, cnt)));
  }
  body.append(cRow);
  body.append(h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
    h('button', {
      class: 'btn sm ghost', onClick: () => {
        const keep = sc.codes.filter(c => sc.lessons.some(l => l.code === c && teachers.has(l.teacher)));
        codes.clear(); keep.forEach(c => codes.add(c));
        codeBoxes.forEach((cb, c) => { cb.checked = codes.has(c); });
        recount();
      }
    }, '⚡ Только группы выбранных педагогов')));
  body.append(stat);
  recount();

  modal({
    wide: true, title: `Расписание ${shift} заезда — что оставить`,
    body, okText: 'Применить',
    onOk: () => {
      if (!teachers.size || !codes.size) { toast('Нужно оставить хотя бы одного педагога и одну группу', 'err'); return false; }
      filterSchedule(shift, { teachers: [...teachers], codes: [...codes] }, kind);
      autoMapAll(kind);
      const left = dataOf(activeAgg(getState()), kind).schedules[String(shift)].lessons.length;
      toast(`В расписании ${shift} заезда осталось занятий: ${left}`);
      redraw();
    },
  });
}

/* ---------------- индивидуальный план ---------------- */
function planCard(st, redraw) {
  const p = st.plan;
  const body = h('div', {});
  if (p) {
    body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Файл'), h('span', { class: 'v' }, p.sourceName || '—')));
    body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Педагог'), h('span', { class: 'v' }, p.teacher || '—')));
    body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Учебные часы по плану'), h('span', { class: 'v' }, Math.round(p.totals.teaching))));
    body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Методические часы по плану'), h('span', { class: 'v' }, Math.round(p.totals.method))));
    body.append(h('div', { class: 'kv total' }, h('span', { class: 'k' }, 'Всего'), h('span', { class: 'v' }, Math.round(p.totals.all))));
    body.append(h('div', { style: { marginTop: '12px' } },
      h('button', { class: 'btn sm', onClick: () => go('hours') }, 'Открыть счётчик часов →')));
  }
  body.append(fileDrop({
    title: p ? 'Загрузить другой индивидуальный план (.xlsx)' : 'Индивидуальный план (.xlsx)',
    hint: 'листы «учебная» и «Метод, Восп»',
    accept: '.xlsx',
    onFile: async (file) => {
      try {
        const plan = await importPlanFile(file);
        update(x => { x.plan = { ...plan, importedAt: new Date().toISOString() }; });
        toast(`План загружен: ${plan.works.length} видов работ`);
        redraw();
      } catch (e) { console.error(e); toast('Ошибка импорта: ' + e.message, 'err'); }
    },
  }));
  return h('div', { class: 'card' }, h('h3', {}, '4. Индивидуальный план'), body);
}

/* ---------------- расписание ---------------- */
// Фактическое расписание вносится день за днём (см. actual-schedule-panel.js) —
// школа присылает его на завтра, а не файлом на весь заезд, как официальное.
// Панель со всеми днями может стать длинной, поэтому на странице — только
// сводная строка, а сама панель (форма + свёрнутые дни выбранного заезда)
// открывается в модальном окне.
function actualScheduleRow(agg, redraw, kind, readOnly) {
  const data = dataOf(agg, kind);
  let days = 0, lessons = 0;
  for (const sh of SHIFTS) {
    const sc = data.schedules[String(sh)];
    if (!sc) continue;
    lessons += sc.lessons.length;
    days += new Set(sc.lessons.map(l => l.date)).size;
  }
  return h('div', { class: 'card', style: { marginBottom: '16px' } },
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' } },
      h('div', {},
        h('h3', { style: { margin: '0 0 4px' } }, '2. Расписание по дням'),
        h('p', { class: 'muted', style: { fontSize: '12.5px', margin: 0 } },
          days ? `${days} дн. внесено · ${lessons} занятий всего` : 'Школа обычно присылает расписание на завтра — вносите день за днём')),
      h('button', { class: 'btn primary', onClick: () => openActualScheduleModal(redraw, readOnly) }, days ? '🗓 Открыть' : '🗓 Внести день')));
}

function openActualScheduleModal(outerRedraw, readOnly) {
  modal({
    wide: true,
    title: 'Расписание по дням · Фактический журнал',
    body: actualScheduleCard(outerRedraw, readOnly),
    okText: null, cancelText: 'Закрыть',
  });
}

function scheduleCard(agg, redraw, kind, readOnly) {
  if (kind === 'actual') return actualScheduleRow(agg, redraw, kind, readOnly);

  const data = dataOf(agg, kind);
  const cards = SHIFTS.map(shift => {
    const sc = data.schedules[String(shift)];
    const body = h('div', {});
    if (sc) {
      body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Файл'), h('span', { class: 'v', style: { fontSize: '11px' } }, sc.sourceName || '—')));
      body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Занятий'), h('span', { class: 'v' }, sc.lessons.length)));
      body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Даты'),
        h('span', { class: 'v', style: { fontSize: '12px' } }, sc.dates.length ? `${dateRu(sc.dates[0])} – ${dateRu(sc.dates.at(-1))}` : '—')));
      body.append(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Педагоги'), h('span', { class: 'v', style: { fontSize: '11.5px' } }, sc.teachers.join(', ') || '—')));
      body.append(h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '10px 0' } },
        ...sc.codes.map(c => h('span', { class: 'pill' + (data.mapping[c] ? ' ok' : ' warn') }, c))));
      body.append(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        readOnly ? null : h('button', { class: 'btn sm', onClick: () => scheduleDialog(shift, redraw, false, kind) }, '☑ Оставить только свои'),
        h('button', { class: 'btn sm', onClick: () => showLessons(sc, shift) }, 'Показать занятия'),
        readOnly ? null : h('button', {
          class: 'btn sm danger', onClick: () => confirmBox(`Удалить расписание ${shift} заезда?`, () => {
            update(x => { delete dataOf(activeAgg(x), kind).schedules[String(shift)]; }); redraw();
          })
        }, 'Удалить')));
    }
    if (readOnly) return h('div', { class: 'card' }, h('h3', {}, `Заезд ${shift}`, sc ? h('span', { class: 'pill ok', style: { marginLeft: '8px' } }, 'загружен') : null), body);
    body.append(fileDrop({
      title: sc ? `Заменить расписание ${shift} заезда` : `Расписание ${shift} заезда (.docx)`,
      hint: 'номер заезда определяется из шапки документа',
      accept: '.docx',
      onFile: async (file) => {
        try {
          const res = await importScheduleFile(file);
          const detected = res.shift;
          const target = detected && detected !== shift
            ? await askShift(detected, shift) : shift;
          update(x => { dataOf(activeAgg(x), kind).schedules[String(target)] = { ...res, importedAt: new Date().toISOString() }; });
          autoMapAll(kind);
          toast(`Расписание ${target} заезда загружено: ${res.lessons.length} занятий`);
          redraw();
          if (res.teachers.length > 1) scheduleDialog(target, redraw, true, kind);
        } catch (e) { console.error(e); toast('Ошибка импорта: ' + e.message, 'err'); }
      },
    }));
    return h('div', { class: 'card' }, h('h3', {}, `Заезд ${shift}`, sc ? h('span', { class: 'pill ok', style: { marginLeft: '8px' } }, 'загружен') : null), body);
  });

  return h('div', { style: { marginBottom: '16px' } },
    h('h2', { style: { fontSize: '16px', margin: '0 0 10px' } }, '2. Расписание занятий — по одному документу на заезд'),
    h('div', { class: 'grid cols-3' }, ...cards));
}

function askShift(detected, chosen) {
  return new Promise(resolve => {
    modal({
      title: 'Номер заезда',
      body: h('p', {}, `В документе указан ${detected} заезд, а файл загружается в ячейку ${chosen} заезда. Куда сохранить?`),
      okText: `В ${detected} заезд (как в документе)`,
      cancelText: `В ${chosen} заезд`,
      onOk: () => resolve(detected),
    });
    // при закрытии без выбора — берём ячейку, в которую перетащили
    const back = document.querySelector('.modal-back');
    const obs = new MutationObserver(() => { if (!document.body.contains(back)) { obs.disconnect(); resolve(chosen); } });
    obs.observe(document.getElementById('modal-root'), { childList: true });
  });
}

function showLessons(sc, shift) {
  const rows = sc.lessons.map(l => h('tr', {},
    h('td', { class: 'mono' }, dateRu(l.date)), h('td', {}, l.weekday), h('td', { class: 'num' }, l.no),
    h('td', { class: 'mono' }, l.time), h('td', {}, l.code), h('td', {}, l.teacher), h('td', { class: 'muted' }, l.direction)));
  modal({
    wide: true, title: `Занятия ${shift} заезда · ${sc.lessons.length}`,
    body: h('div', { class: 'table-wrap' }, h('table', { class: 'compact' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Дата'), h('th', {}, 'День'), h('th', {}, '№'), h('th', {}, 'Время'), h('th', {}, 'Код'), h('th', {}, 'Педагог'), h('th', {}, 'Направление'))),
      h('tbody', {}, ...rows))),
    okText: null, cancelText: 'Закрыть',
  });
}

/* ---------------- сопоставление кодов ---------------- */
function mappingCard(agg, redraw, kind, readOnly) {
  const data = dataOf(agg, kind);
  const codes = new Set();
  for (const sh of SHIFTS) for (const c of (data.schedules[String(sh)]?.codes || [])) codes.add(c);
  const list = [...codes].sort();
  const groups = allGroups(agg, kind);

  if (!list.length) {
    return h('div', { class: 'card' }, h('h3', {}, '3. Сопоставление групп'),
      emptyState('🔗', 'Загрузите расписание — коды групп появятся здесь для сопоставления со списком детей.'));
  }

  const rows = list.map(code => {
    const p = parseCode(code);
    const cur = data.mapping[code];
    const sel = h('select', {
      disabled: readOnly,
      onChange: readOnly ? undefined : (e) => {
        const v = e.target.value;
        update(x => {
          const root = dataOf(activeAgg(x), kind);
          if (!v) delete root.mapping[code];
          else { const [subjectId, groupId] = v.split('|'); root.mapping[code] = { subjectId, groupId }; }
        });
        redraw();
      }
    },
      h('option', { value: '' }, '— не сопоставлено —'),
      ...groups.map(({ subject, group }) => h('option', {
        value: `${subject.id}|${group.id}`,
        selected: cur?.groupId === group.id,
      }, `${subject.title} · ${group.name} (${group.students.length})`)));

    const usedIn = SHIFTS.filter(sh => (data.schedules[String(sh)]?.codes || []).includes(code));
    return h('tr', {},
      h('td', {}, h('b', { class: 'mono' }, code)),
      h('td', { class: 'muted', style: { fontSize: '12px' } },
        p ? `${p.prefix} · группа ${p.group}${p.grade ? ` · ${p.grade} класс` : ''}` : ''),
      h('td', {}, ...usedIn.map(s => h('span', { class: 'pill', style: { marginRight: '4px' } }, `${s} заезд`))),
      h('td', { style: { minWidth: '340px' } }, sel),
      h('td', {}, cur ? h('span', { class: 'pill ok' }, '✓') : h('span', { class: 'pill warn' }, '!')),
    );
  });

  return h('div', { class: 'card' },
    h('h3', {}, '3. Сопоставление кодов расписания с группами'),
    h('div', { class: 'card-sub' }, 'Коды вида «Т1 РШ7» связываются с группами из списка автоматически: буква — направление, цифра — номер группы, последняя цифра — класс. Проверьте и поправьте, где нужно.'),
    readOnly ? null : h('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px' } },
      h('button', { class: 'btn sm', onClick: () => { const n = autoMapAll(kind); toast(n ? `Сопоставлено автоматически: ${n}` : 'Новых совпадений не найдено'); redraw(); } }, '⚡ Сопоставить автоматически'),
      h('button', { class: 'btn sm danger ghost', onClick: () => { update(x => { dataOf(activeAgg(x), kind).mapping = {}; }); redraw(); } }, 'Сбросить сопоставление')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'compact' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Код'), h('th', {}, 'Разбор'), h('th', {}, 'Заезды'), h('th', {}, 'Группа из списка'), h('th', {}, ''))),
      h('tbody', {}, ...rows))));
}
