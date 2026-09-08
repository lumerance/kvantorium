// «Набор» — группы дополнительного образования, которые педагог собирает сам.
// Названия групп (У1, Д2 …) подсказываются из кодов загруженного расписания
// заезда, а состав правится руками в процессе набора: ФИО + два факта по
// каждому ребёнку — сдан ли договор и отправлено ли заявление в Навигатор.
import { h, toast, download, confirmBox, modal, emptyState, progressBar, printElement } from '../core/ui.js';
import { getState, update } from '../core/store.js';
import { parseCode } from '../parsers/schedule.js';
import { SHIFTS, ENROLL_SUBJECT_ID } from './journal.js';
import { go } from '../core/router.js';

const MIN_SIZE = 8, MAX_SIZE = 12;   // норматив наполняемости группы ДО
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

let uid = 0;
const nextId = (p) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

const groupsOf = (st = getState()) => st.enroll?.groups || [];
const findGroup = (id, st = getState()) => groupsOf(st).find(g => g.id === id) || null;
const counts = (g) => ({
  n: g.students.length,
  contract: g.students.filter(s => s.contract).length,
  navigator: g.students.filter(s => s.navigator).length,
});
const sizeTone = (n) => (n >= MIN_SIZE && n <= MAX_SIZE ? 'ok' : 'warn');

/** Коды из расписаний всех заездов. */
function scheduleCodes(st) {
  const out = new Set();
  for (const sh of SHIFTS) for (const c of (st.schedules[String(sh)]?.codes || [])) out.add(c);
  return [...out].sort();
}

// Сетевые предметы идут под Т (труд) и И (информатика) — это школьные списки из
// docx. Дополнительное образование обозначают другими буквами: Д (доп), У
// (углублённый), П (проектный) и т.п.
const isDoCode = (code) => !/^[ТИ]/i.test(norm(code));

/** Расшифровка направления из легенды расписания: «Д Р - Умные технологии…». */
function programForCode(st, code) {
  const p = parseCode(code);
  if (!p) return '';
  const key = `${p.prefix} ${p.tail}`.trim().toUpperCase().replace(/\s+/g, ' ');
  for (const sh of SHIFTS) {
    for (const note of (st.schedules[String(sh)]?.notes || [])) {
      const m = /^([А-ЯЁ](?:\s*[А-ЯЁ])*)\s*[-–—]\s*(.+)$/.exec(norm(note));
      if (!m) continue;
      const nk = m[1].toUpperCase().replace(/\s+/g, ' ');
      if (nk === key || nk === p.prefix.toUpperCase()) {
        // хвост «– 2 группы» из легенды в название направления не нужен
        return norm(m[2]).replace(/\s*[–—-]\s*\d+\s*групп[а-яё]*\s*$/i, '');
      }
    }
  }
  return '';
}

/** Все известные ФИО из загруженных списков — для автоподсказки при вводе. */
function knownFio(st) {
  const out = new Set();
  for (const s of st.students?.subjects || []) for (const g of s.groups) for (const p of g.students) out.add(p.fio);
  return [...out].sort();
}

function addGroup(name, program = '', code = null) {
  const clean = norm(name);
  if (!clean) return toast('Впишите название группы', 'err');
  if (groupsOf().some(g => g.name.toLowerCase() === clean.toLowerCase())) return toast(`Группа «${clean}» уже есть`, 'err');
  update(x => {
    x.enroll.groups.push({ id: nextId('eg_'), name: clean, program: norm(program), code: code || null, createdAt: new Date().toISOString(), students: [] });
  });
  return true;
}

/** Сколько занятий по коду набежало во всех загруженных заездах — подсказка при выборе кода. */
function lessonsCountForCode(st, code) {
  if (!code) return 0;
  let n = 0;
  for (const sh of SHIFTS) n += (st.schedules[String(sh)]?.lessons || []).filter(l => l.code === code).length;
  return n;
}

/** Открыть журнал сразу на этой группе «Набора». */
function openInJournal(groupId) {
  update(x => { x.ui.journalSubject = ENROLL_SUBJECT_ID; x.ui.journalGroup = groupId; });
  go('journal');
}

/* ======================= страница ======================= */
export function render(root) {
  // no-print: на печать уходит только отдельный узел (printElement), сама
  // страница в распечатку не попадает.
  const wrap = h('div', { class: 'no-print' });
  root.append(wrap);
  let totalsBox = null;
  const cards = new Map();   // groupId -> элемент карточки

  redraw();

  function redraw() {
    const st = getState();
    wrap.innerHTML = '';
    cards.clear();

    wrap.append(h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'Набор в группы'),
        h('p', {}, 'Группы дополнительного образования, которые вы набираете сами: состав правится по ходу набора, у каждого ребёнка отмечаются договор и заявление в Навигаторе.')),
      h('div', { class: 'head-actions' },
        groupsOf(st).length ? h('button', { class: 'btn', onClick: () => download('Набор_группы_ДО.csv', toCsv(groupsOf(st)), 'text/csv;charset=utf-8') }, '⤓ CSV') : null,
        groupsOf(st).length ? h('button', { class: 'btn', onClick: () => printElement(printNode(groupsOf(st))) }, '🖨 Печать списков') : null,
      )));

    totalsBox = totalsCard(st);
    wrap.append(totalsBox);
    wrap.append(addCard(st, redraw));

    if (!groupsOf(st).length) {
      wrap.append(h('div', { class: 'card' }, emptyState('👥',
        'Пока ни одной группы. Заведите её сверху — вручную или одним кликом из кода расписания.',
        scheduleCodes(st).length ? null : h('button', { class: 'btn primary', onClick: () => go('data') }, 'Загрузить расписание →'))));
      return;
    }

    const list = h('div', {});
    for (const g of groupsOf(st)) list.append(mountCard(g));
    wrap.append(list);
  }

  /** Карточка группы + её замена на месте, без перерисовки всей страницы. */
  function mountCard(g, focusAdd = false) {
    const card = groupCard(g, { refresh: () => remount(g.id, true), reload: redraw, refreshTotals });
    cards.set(g.id, card);
    if (focusAdd) requestAnimationFrame(() => card.querySelector('.add-fio')?.focus());
    return card;
  }

  function remount(groupId, focusAdd) {
    const fresh = findGroup(groupId);
    const old = cards.get(groupId);
    if (!old) return redraw();
    if (!fresh) { old.remove(); cards.delete(groupId); return redraw(); }
    const nw = mountCard(fresh, focusAdd);
    old.replaceWith(nw);
    refreshTotals();
  }

  function refreshTotals() {
    const fresh = totalsCard(getState());
    totalsBox.replaceWith(fresh);
    totalsBox = fresh;
  }
}

/* ---------------- сводка ---------------- */
function totalsCard(st) {
  const gs = groupsOf(st);
  const all = gs.reduce((a, g) => a + g.students.length, 0);
  const contract = gs.reduce((a, g) => a + counts(g).contract, 0);
  const navigator = gs.reduce((a, g) => a + counts(g).navigator, 0);
  const cell = (label, value, sub, bar) => h('div', { class: 'card' },
    h('div', { class: 'stat' },
      h('div', { class: 'label' }, label),
      h('div', { class: 'value' }, value),
      sub ? h('div', { class: 'sub' }, sub) : null),
    bar || null);
  return h('div', { class: 'grid cols-4', style: { marginBottom: '16px' } },
    cell('Групп', gs.length, gs.length ? `${gs.filter(g => g.students.length >= MIN_SIZE && g.students.length <= MAX_SIZE).length} в норме ${MIN_SIZE}–${MAX_SIZE}` : 'ещё не заведены'),
    cell('Детей', all, 'в наборе всего'),
    cell('Договоры', `${contract} из ${all}`, all ? `осталось собрать ${all - contract}` : '—', progressBar(contract, all)),
    cell('Навигатор', `${navigator} из ${all}`, all ? `осталось отправить ${all - navigator}` : '—', progressBar(navigator, all)),
  );
}

/* ---------------- создание групп ---------------- */
function addCard(st, redraw) {
  const nameInput = h('input', { type: 'text', placeholder: 'например: У1', class: 'mono' });
  const progInput = h('input', { type: 'text', placeholder: 'направление (необязательно)' });
  const create = () => {
    const name = norm(nameInput.value);
    // если вписанное название совпадает с кодом из расписания — сразу
    // привязываем группу к нему, чтобы занятия появились в журнале без
    // отдельного шага
    const matchedCode = scheduleCodes(st).find(c => c.toLowerCase() === name.toLowerCase()) || null;
    if (addGroup(nameInput.value, progInput.value, matchedCode) === true) {
      toast(`Группа «${name}» создана`);
      nameInput.value = ''; progInput.value = '';
      redraw();
    }
  };
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') create(); });
  progInput.addEventListener('keydown', e => { if (e.key === 'Enter') create(); });

  const taken = new Set(groupsOf(st).map(g => g.name.toLowerCase()));
  const free = scheduleCodes(st).filter(c => !taken.has(c.toLowerCase()));
  const suggested = free.filter(isDoCode);

  const chips = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' } },
    ...free.map(code => h('button', {
      class: 'btn sm' + (isDoCode(code) ? ' ghost' : ' ghost muted-btn'),
      title: programForCode(st, code) || 'Создать группу с этим названием',
      onClick: () => { if (addGroup(code, programForCode(st, code), code) === true) { toast(`Группа «${code}» создана`); redraw(); } },
    }, `+ ${code}`)));

  return h('div', { class: 'card', style: { marginBottom: '16px' } },
    h('h3', {}, 'Новая группа'),
    h('div', { class: 'card-sub' }, 'Аббревиатура любая — У1 (углублённый), Д2 и т.д. Названия можно взять прямо из расписания заезда: коды ниже уже разобраны из загруженных документов.'),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Название группы'), nameInput),
      h('label', { class: 'field' }, h('span', {}, 'Направление / программа'), progInput),
      h('button', { class: 'btn primary fixed', onClick: create }, '+ Создать')),
    free.length
      ? h('div', {},
        h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '14px 0 0' } },
          suggested.length
            ? 'Из расписания — похоже на дополнительное образование, а остальные коды это сетевые предметы:'
            : 'Коды из загруженного расписания:'),
        chips)
      : (scheduleCodes(st).length
        ? h('p', { class: 'muted', style: { fontSize: '12.5px', marginBottom: 0 } }, 'Все коды из расписания уже заведены как группы.')
        : h('p', { class: 'muted', style: { fontSize: '12.5px', marginBottom: 0 } }, 'Загрузите расписание заезда на вкладке «Данные» — и названия групп можно будет добавлять одним кликом.')));
}

/** Строка привязки группы к коду расписания — источник занятий для журнала. */
function codeRow(g, st, refresh) {
  const codes = scheduleCodes(st);
  const n = lessonsCountForCode(st, g.code);
  return h('div', {
    style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '8px 0 4px', fontSize: '12.5px' },
  },
    h('span', { class: 'muted' }, '📅 Код в расписании:'),
    codes.length
      ? h('select', {
        class: 'mono', style: { width: 'auto' },
        onChange: (e) => {
          const v = e.target.value || null;
          update(x => { const gr = (x.enroll.groups || []).find(y => y.id === g.id); if (gr) gr.code = v; });
          refresh();
        },
      },
        h('option', { value: '', selected: !g.code }, '— не привязан —'),
        ...codes.map(c => h('option', { value: c, selected: g.code === c }, c)))
      : h('span', { class: 'muted' }, g.code || '— не привязан —'),
    g.code ? h('span', { class: 'muted' }, `· ${n} занятий во всех заездах`) : null,
    h('button', { class: 'btn sm ghost', onClick: () => openInJournal(g.id) }, '📋 Открыть в журнале'));
}

/* ---------------- карточка группы ---------------- */
function groupCard(g, { refresh, reload, refreshTotals }) {
  const st = getState();
  const c = counts(g);

  const sizePill = h('span', { class: `pill ${sizeTone(c.n)}` }, `${c.n} чел.`);
  const contractPill = h('span', { class: 'pill' }, `договор ${c.contract}/${c.n}`);
  const navPill = h('span', { class: 'pill' }, `Навигатор ${c.navigator}/${c.n}`);

  // Пересчёт шапки без перерисовки таблицы — чекбоксы не теряют фокус,
  // а страница не прыгает к началу при каждой галочке.
  const recount = () => {
    const fresh = findGroup(g.id);
    if (!fresh) return;
    const k = counts(fresh);
    sizePill.textContent = `${k.n} чел.`;
    sizePill.className = `pill ${sizeTone(k.n)}`;
    contractPill.textContent = `договор ${k.contract}/${k.n}`;
    navPill.textContent = `Навигатор ${k.navigator}/${k.n}`;
    refreshTotals();
  };

  const toggle = (studentId, field) => (e) => {
    const on = e.target.checked;
    update(x => {
      const gr = (x.enroll.groups || []).find(y => y.id === g.id);
      const stu = gr?.students.find(y => y.id === studentId);
      if (stu) stu[field] = on;
    });
    recount();
  };

  const rows = g.students.map((s, i) => h('tr', {},
    h('td', { class: 'num muted' }, i + 1),
    h('td', {}, h('input', {
      type: 'text', value: s.fio, class: 'cell-input',
      onChange: (e) => {
        const v = norm(e.target.value);
        if (!v) { e.target.value = s.fio; return; }
        update(x => {
          const stu = (x.enroll.groups || []).find(y => y.id === g.id)?.students.find(y => y.id === s.id);
          if (stu) stu.fio = v;
        });
      },
    })),
    h('td', { style: { textAlign: 'center' } }, h('input', {
      type: 'checkbox', checked: !!s.contract, class: 'box', title: 'Договор сдан',
      onChange: toggle(s.id, 'contract'),
    })),
    h('td', { style: { textAlign: 'center' } }, h('input', {
      type: 'checkbox', checked: !!s.navigator, class: 'box', title: 'Заявление отправлено в Навигатор',
      onChange: toggle(s.id, 'navigator'),
    })),
    h('td', {}, h('input', {
      type: 'text', value: s.note || '', placeholder: '—', class: 'cell-input muted',
      onChange: (e) => update(x => {
        const stu = (x.enroll.groups || []).find(y => y.id === g.id)?.students.find(y => y.id === s.id);
        if (stu) stu.note = norm(e.target.value);
      }),
    })),
    h('td', {}, h('button', {
      class: 'btn sm danger ghost', title: 'Убрать из группы',
      onClick: () => {
        update(x => {
          const gr = (x.enroll.groups || []).find(y => y.id === g.id);
          if (gr) gr.students = gr.students.filter(y => y.id !== s.id);
        });
        refresh();
      },
    }, '×')),
  ));

  const listId = `fio-${g.id}`;
  const addInput = h('input', {
    type: 'text', class: 'add-fio', placeholder: 'Фамилия Имя Отчество', list: listId, autocomplete: 'off',
  });
  const add = () => {
    const fio = norm(addInput.value);
    if (!fio) return;
    if (g.students.some(s => s.fio.toLowerCase() === fio.toLowerCase())) { toast('Такой ребёнок в группе уже есть', 'err'); return; }
    update(x => {
      const gr = (x.enroll.groups || []).find(y => y.id === g.id);
      if (gr) gr.students.push({ id: nextId('es_'), fio, contract: false, navigator: false, note: '', addedAt: new Date().toISOString() });
    });
    addInput.value = '';
    refresh();
  };
  addInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'compact enroll-table' },
    h('thead', {}, h('tr', {},
      h('th', { style: { width: '44px' } }, '№'),
      h('th', {}, 'ФИО'),
      h('th', { style: { width: '90px', textAlign: 'center' } }, 'Договор'),
      h('th', { style: { width: '110px', textAlign: 'center' } }, 'Навигатор'),
      h('th', { style: { width: '25%' } }, 'Примечание'),
      h('th', { style: { width: '44px' } }, ''))),
    h('tbody', {}, ...rows)));

  return h('div', { class: 'card', style: { marginBottom: '16px' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '4px' } },
      h('h3', { style: { margin: 0 } }, h('span', { class: 'mono' }, g.name)),
      sizePill, contractPill, navPill,
      h('span', { style: { flex: '1 1 auto' } }),
      h('button', { class: 'btn sm ghost', onClick: () => renameDialog(g, reload) }, '✎ Переименовать'),
      h('button', { class: 'btn sm ghost', onClick: () => printElement(printNode([findGroup(g.id) || g])) }, '🖨 Печать'),
      h('button', {
        class: 'btn sm danger ghost',
        onClick: () => confirmBox(`Удалить группу «${g.name}»${g.students.length ? ` вместе со списком (${g.students.length} чел.)` : ''}?`, () => {
          update(x => { x.enroll.groups = (x.enroll.groups || []).filter(y => y.id !== g.id); });
          toast('Группа удалена');
          reload();
        })
      }, '🗑')),
    g.program ? h('div', { class: 'card-sub', style: { marginTop: 0 } }, g.program) : null,
    codeRow(g, st, refresh),
    c.n ? table : h('p', { class: 'muted', style: { fontSize: '13px', margin: '10px 0' } }, 'Пока пусто — впишите первого ребёнка ниже.'),
    h('datalist', { id: listId }, ...knownFio(st).map(f => h('option', { value: f }))),
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('label', { class: 'field' }, h('span', {}, 'Добавить ребёнка'), addInput),
      h('button', { class: 'btn fixed', onClick: add }, '+ Добавить')),
    h('p', { class: 'muted', style: { fontSize: '12px', margin: '8px 0 0' } },
      c.n < MIN_SIZE ? `До нижней границы наполняемости не хватает ${MIN_SIZE - c.n} чел. (норма ${MIN_SIZE}–${MAX_SIZE}).`
        : c.n > MAX_SIZE ? `Перебор: в группе на ${c.n - MAX_SIZE} чел. больше нормы ${MIN_SIZE}–${MAX_SIZE}.`
          : `Наполняемость в норме (${MIN_SIZE}–${MAX_SIZE} чел.). Enter в поле ввода добавляет следующего.`),
  );
}

function renameDialog(g, reload) {
  const nameInput = h('input', { type: 'text', value: g.name, class: 'mono' });
  const progInput = h('input', { type: 'text', value: g.program || '', placeholder: 'направление (необязательно)' });
  modal({
    title: `Группа «${g.name}»`,
    body: h('div', {},
      h('label', { class: 'field' }, h('span', {}, 'Название'), nameInput),
      h('label', { class: 'field', style: { marginTop: '10px' } }, h('span', {}, 'Направление / программа'), progInput)),
    okText: 'Сохранить',
    onOk: () => {
      const name = norm(nameInput.value);
      if (!name) { toast('Название не может быть пустым', 'err'); return false; }
      if (groupsOf().some(x => x.id !== g.id && x.name.toLowerCase() === name.toLowerCase())) { toast(`Группа «${name}» уже есть`, 'err'); return false; }
      update(x => {
        const gr = (x.enroll.groups || []).find(y => y.id === g.id);
        if (gr) { gr.name = name; gr.program = norm(progInput.value); }
      });
      reload();
    },
  });
}

/* ---------------- выгрузка и печать ---------------- */
export function toCsv(groups) {
  const rows = [['Группа', 'Направление', '№', 'ФИО', 'Договор сдан', 'Заявление в Навигаторе', 'Примечание']];
  for (const g of groups) {
    g.students.forEach((s, i) => rows.push([g.name, g.program || '', i + 1, s.fio, s.contract ? 'да' : 'нет', s.navigator ? 'да' : 'нет', s.note || '']));
    if (!g.students.length) rows.push([g.name, g.program || '', '', '', '', '', 'группа пуста']);
  }
  return '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
}

function printNode(groups) {
  return h('div', { class: 'print-only enroll-print' },
    h('h2', {}, 'Набор в группы дополнительного образования'),
    ...groups.map(g => {
      const c = counts(g);
      return h('div', { class: 'e-group' },
        h('h3', {}, `${g.name}${g.program ? ` — ${g.program}` : ''}`),
        h('p', { class: 'e-sub' }, `Всего: ${c.n} чел. · договоров сдано: ${c.contract} · заявлений в Навигаторе: ${c.navigator}`),
        h('table', { class: 'e-table' },
          h('thead', {}, h('tr', {},
            h('th', {}, '№'), h('th', {}, 'ФИО'), h('th', {}, 'Договор'), h('th', {}, 'Навигатор'), h('th', {}, 'Примечание'))),
          h('tbody', {}, ...(g.students.length ? g.students : [null]).map((s, i) => s
            ? h('tr', {},
              h('td', { class: 'c' }, i + 1), h('td', {}, s.fio),
              h('td', { class: 'c' }, s.contract ? '✓' : ''), h('td', { class: 'c' }, s.navigator ? '✓' : ''),
              h('td', {}, s.note || ''))
            : h('tr', {}, h('td', { colspan: 5, class: 'c' }, 'группа пуста'))))));
    }));
}
