// «Набор» — группы, которые педагог заводит сам, а не получает готовым
// списком. Два вида, переключаются вкладкой вверху страницы:
//  · Официальный — группы дополнительного образования (У1, Д2 …), которые
//    набираются по своему усмотрению; у каждого ребёнка отмечаются договор
//    и заявление в Навигаторе, есть норматив наполняемости 8–12 человек.
//  · Фактический — обычные классы для фактического журнала (7А, 7Б …),
//    которых нет в официальных сетевых документах; просто список детей, без
//    договора и Навигатора — это не набор, а реальный состав класса.
// Хранится раздельно (st.enroll / st.actual.enroll), но одной и той же
// логикой — как и всё остальное деление на kind в этом приложении.
import { h, toast, download, confirmBox, modal, emptyState, progressBar, printElement } from '../core/ui.js';
import { getState, update } from '../core/store.js';
import { parseCode } from '../parsers/schedule.js';
import { SHIFTS, ENROLL_SUBJECT_ID } from './journal.js';
import { go } from '../core/router.js';

const MIN_SIZE = 8, MAX_SIZE = 12;   // норматив наполняемости группы ДО (только для официального)
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

let uid = 0;
const nextId = (p) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

const dataOf = (st, kind) => (kind === 'actual' ? st.actual.enroll : st.enroll);
const schedulesOf = (st, kind) => (kind === 'actual' ? st.actual.schedules : st.schedules);
const studentsOf = (st, kind) => (kind === 'actual' ? st.actual.students : st.students);
const uiKeys = (kind) => (kind === 'actual'
  ? { subj: 'actualJournalSubject', grp: 'actualJournalGroup' }
  : { subj: 'journalSubject', grp: 'journalGroup' });

const groupsOf = (st = getState(), kind = 'official') => dataOf(st, kind)?.groups || [];
const findGroup = (id, st = getState(), kind = 'official') => groupsOf(st, kind).find(g => g.id === id) || null;
const counts = (g) => ({
  n: g.students.length,
  contract: g.students.filter(s => s.contract).length,
  navigator: g.students.filter(s => s.navigator).length,
});
const sizeTone = (n) => (n >= MIN_SIZE && n <= MAX_SIZE ? 'ok' : 'warn');

/** Коды из расписаний всех заездов нужного журнала. */
function scheduleCodes(st, kind) {
  const sch = schedulesOf(st, kind);
  const out = new Set();
  for (const sh of SHIFTS) for (const c of (sch[String(sh)]?.codes || [])) out.add(c);
  return [...out].sort();
}

// Сетевые предметы идут под Т (труд) и И (информатика) — это школьные списки из
// docx. Дополнительное образование обозначают другими буквами: Д (доп), У
// (углублённый), П (проектный) и т.п. Имеет смысл только для официального —
// у фактических классов такого деления по смыслу нет.
const isDoCode = (code) => !/^[ТИ]/i.test(norm(code));

/** Расшифровка направления из легенды расписания: «Д Р - Умные технологии…». */
function programForCode(st, code, kind) {
  const p = parseCode(code);
  if (!p) return '';
  const sch = schedulesOf(st, kind);
  const key = `${p.prefix} ${p.tail}`.trim().toUpperCase().replace(/\s+/g, ' ');
  for (const sh of SHIFTS) {
    for (const note of (sch[String(sh)]?.notes || [])) {
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
function knownFio(st, kind) {
  const out = new Set();
  for (const s of studentsOf(st, kind)?.subjects || []) for (const g of s.groups) for (const p of g.students) out.add(p.fio);
  return [...out].sort();
}

/** Создаёт группу/класс, возвращает её id или null при ошибке (имя пустое/занято). */
function addGroup(name, program = '', code = null, kind = 'official') {
  const clean = norm(name);
  if (!clean) { toast('Впишите название группы', 'err'); return null; }
  if (groupsOf(getState(), kind).some(g => g.name.toLowerCase() === clean.toLowerCase())) { toast(`Группа «${clean}» уже есть`, 'err'); return null; }
  const id = nextId('eg_');
  update(x => {
    dataOf(x, kind).groups.push({ id, name: clean, program: norm(program), code: code || null, createdAt: new Date().toISOString(), students: [] });
  });
  return id;
}

/** Сколько занятий по коду набежало во всех загруженных заездах — подсказка при выборе кода. */
function lessonsCountForCode(st, code, kind) {
  if (!code) return 0;
  const sch = schedulesOf(st, kind);
  let n = 0;
  for (const sh of SHIFTS) n += (sch[String(sh)]?.lessons || []).filter(l => l.code === code).length;
  return n;
}

/** Открыть журнал сразу на этой группе. */
function openInJournal(groupId, kind) {
  const { subj, grp } = uiKeys(kind);
  update(x => { x.ui[subj] = ENROLL_SUBJECT_ID; x.ui[grp] = groupId; });
  go('journal', kind === 'actual' ? { kind: 'actual' } : undefined);
}

/* ======================= страница ======================= */
export function render(root, params = {}) {
  // no-print: на печать уходит только отдельный узел (printElement), сама
  // страница в распечатку не попадает.
  const wrap = h('div', { class: 'no-print' });
  root.append(wrap);
  let kind = params.kind === 'actual' ? 'actual' : 'official';
  let totalsBox = null;
  const cards = new Map();      // groupId -> элемент карточки
  const expanded = new Set();   // groupId раскрытых панелей — по умолчанию все свёрнуты

  redraw();

  function redraw() {
    const st = getState();
    const isDO = kind === 'official';
    wrap.innerHTML = '';
    cards.clear();

    wrap.append(h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, isDO ? 'Набор в группы' : 'Классы фактического журнала'),
        h('p', {}, isDO
          ? 'Группы дополнительного образования, которые вы набираете сами: состав правится по ходу набора, у каждого ребёнка отмечаются договор и заявление в Навигаторе.'
          : 'Классы, которых нет в официальных сетевых документах, — для фактического журнала: просто список детей, без договора и Навигатора.')),
      h('div', { class: 'head-actions' },
        groupsOf(st, kind).length ? h('button', { class: 'btn', onClick: () => download(isDO ? 'Набор_группы_ДО.csv' : 'Фактические_классы.csv', toCsv(groupsOf(st, kind), isDO), 'text/csv;charset=utf-8') }, '⤓ CSV') : null,
        groupsOf(st, kind).length ? h('button', { class: 'btn', onClick: () => printElement(printNode(groupsOf(st, kind), isDO)) }, '🖨 Печать списков') : null,
      )));

    wrap.append(h('div', { class: 'tabs', style: { marginBottom: '16px' } },
      h('button', { class: 'tab' + (kind === 'official' ? ' active' : ''), onClick: () => { kind = 'official'; redraw(); } }, '📋 Официальный (ДО)'),
      h('button', { class: 'tab' + (kind === 'actual' ? ' active' : ''), onClick: () => { kind = 'actual'; redraw(); } }, '📝 Фактический (классы)')));

    totalsBox = totalsCard(st, kind, isDO);
    wrap.append(totalsBox);
    wrap.append(addCard(st, redraw, kind, isDO, onGroupCreated));

    if (!groupsOf(st, kind).length) {
      wrap.append(h('div', { class: 'card' }, emptyState('👥',
        isDO ? 'Пока ни одной группы. Заведите её сверху — вручную или одним кликом из кода расписания.'
             : 'Пока ни одного класса. Заведите его сверху — вручную или одним кликом из кода расписания.',
        scheduleCodes(st, kind).length ? null : h('button', { class: 'btn primary', onClick: () => go('data', kind === 'actual' ? { kind: 'actual' } : undefined) }, 'Загрузить расписание →'))));
      return;
    }

    const list = h('div', {});
    for (const g of groupsOf(st, kind)) list.append(mountCard(g));
    wrap.append(list);
  }

  /** Карточка группы + её замена на месте, без перерисовки всей страницы. */
  function mountCard(g, focusAdd = false) {
    const isDO = kind === 'official';
    if (focusAdd) expanded.add(g.id);
    const isOpen = expanded.has(g.id);
    const toggle = () => { isOpen ? expanded.delete(g.id) : expanded.add(g.id); remount(g.id); };
    const card = groupCard(g, { refresh: () => remount(g.id, true), reload: redraw, refreshTotals, kind, isDO, isOpen, toggle });
    cards.set(g.id, card);
    if (focusAdd) requestAnimationFrame(() => card.querySelector('.add-fio')?.focus());
    return card;
  }

  function remount(groupId, focusAdd) {
    const fresh = findGroup(groupId, getState(), kind);
    const old = cards.get(groupId);
    if (!old) return redraw();
    if (!fresh) { old.remove(); cards.delete(groupId); return redraw(); }
    const nw = mountCard(fresh, focusAdd);
    old.replaceWith(nw);
    refreshTotals();
  }

  /** Новая группа/класс сразу раскрывается и фокусирует поле ввода ребёнка. */
  function onGroupCreated(groupId) {
    expanded.add(groupId);
    remount(groupId, true);
  }

  function refreshTotals() {
    const fresh = totalsCard(getState(), kind, kind === 'official');
    totalsBox.replaceWith(fresh);
    totalsBox = fresh;
  }
}

/* ---------------- сводка ---------------- */
function totalsCard(st, kind, isDO) {
  const gs = groupsOf(st, kind);
  const all = gs.reduce((a, g) => a + g.students.length, 0);
  const cell = (label, value, sub, bar) => h('div', { class: 'card' },
    h('div', { class: 'stat' },
      h('div', { class: 'label' }, label),
      h('div', { class: 'value' }, value),
      sub ? h('div', { class: 'sub' }, sub) : null),
    bar || null);

  if (!isDO) {
    // фактическим классам норматив наполняемости и договор/Навигатор не нужны
    return h('div', { class: 'grid cols-4', style: { marginBottom: '16px' } },
      cell('Классов', gs.length, gs.length ? '' : 'ещё не заведены'),
      cell('Детей', all, 'во всех классах'));
  }

  const contract = gs.reduce((a, g) => a + counts(g).contract, 0);
  const navigator = gs.reduce((a, g) => a + counts(g).navigator, 0);
  return h('div', { class: 'grid cols-4', style: { marginBottom: '16px' } },
    cell('Групп', gs.length, gs.length ? `${gs.filter(g => g.students.length >= MIN_SIZE && g.students.length <= MAX_SIZE).length} в норме ${MIN_SIZE}–${MAX_SIZE}` : 'ещё не заведены'),
    cell('Детей', all, 'в наборе всего'),
    cell('Договоры', `${contract} из ${all}`, all ? `осталось собрать ${all - contract}` : '—', progressBar(contract, all)),
    cell('Навигатор', `${navigator} из ${all}`, all ? `осталось отправить ${all - navigator}` : '—', progressBar(navigator, all)),
  );
}

/* ---------------- создание групп ---------------- */
function addCard(st, redraw, kind, isDO, onGroupCreated) {
  const nameInput = h('input', { type: 'text', placeholder: isDO ? 'например: У1' : 'например: 7А', class: 'mono' });
  const progInput = h('input', { type: 'text', placeholder: 'направление (необязательно)' });
  const create = () => {
    const name = norm(nameInput.value);
    // если вписанное название совпадает с кодом из расписания — сразу
    // привязываем группу к нему, чтобы занятия появились в журнале без
    // отдельного шага
    const matchedCode = scheduleCodes(st, kind).find(c => c.toLowerCase() === name.toLowerCase()) || null;
    const id = addGroup(nameInput.value, progInput.value, matchedCode, kind);
    if (id) {
      toast(`${isDO ? 'Группа' : 'Класс'} «${name}» ${isDO ? 'создана' : 'создан'}`);
      nameInput.value = ''; progInput.value = '';
      redraw();
      onGroupCreated(id);   // сразу раскрыть новую панель и дать вписывать детей
    }
  };
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') create(); });
  progInput.addEventListener('keydown', e => { if (e.key === 'Enter') create(); });

  const taken = new Set(groupsOf(st, kind).map(g => g.name.toLowerCase()));
  const free = scheduleCodes(st, kind).filter(c => !taken.has(c.toLowerCase()));
  const suggested = isDO ? free.filter(isDoCode) : free;

  const chips = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' } },
    ...free.map(code => h('button', {
      class: 'btn sm' + (isDO && !isDoCode(code) ? ' ghost muted-btn' : ' ghost'),
      title: programForCode(st, code, kind) || `Создать ${isDO ? 'группу' : 'класс'} с этим названием`,
      onClick: () => {
        const id = addGroup(code, programForCode(st, code, kind), code, kind);
        if (id) { toast(`${isDO ? 'Группа' : 'Класс'} «${code}» ${isDO ? 'создана' : 'создан'}`); redraw(); onGroupCreated(id); }
      },
    }, `+ ${code}`)));

  return h('div', { class: 'card', style: { marginBottom: '16px' } },
    h('h3', {}, isDO ? 'Новая группа' : 'Новый класс'),
    h('div', { class: 'card-sub' }, isDO
      ? 'Аббревиатура любая — У1 (углублённый), Д2 и т.д. Названия можно взять прямо из расписания заезда: коды ниже уже разобраны из загруженных документов.'
      : 'Название — как удобно, например 7А. Названия можно взять прямо из фактического расписания: коды ниже уже разобраны из внесённых дней.'),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, isDO ? 'Название группы' : 'Название класса'), nameInput),
      h('label', { class: 'field' }, h('span', {}, 'Направление / программа'), progInput),
      h('button', { class: 'btn primary fixed', onClick: create }, '+ Создать')),
    free.length
      ? h('div', {},
        h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '14px 0 0' } },
          isDO
            ? (suggested.length ? 'Из расписания — похоже на дополнительное образование, а остальные коды это сетевые предметы:' : 'Коды из загруженного расписания:')
            : 'Коды из фактического расписания:'),
        chips)
      : (scheduleCodes(st, kind).length
        ? h('p', { class: 'muted', style: { fontSize: '12.5px', marginBottom: 0 } }, `Все коды из расписания уже заведены как ${isDO ? 'группы' : 'классы'}.`)
        : h('p', { class: 'muted', style: { fontSize: '12.5px', marginBottom: 0 } },
            isDO ? 'Загрузите расписание заезда на вкладке «Данные» — и названия групп можно будет добавлять одним кликом.'
                 : 'Внесите расписание на вкладке «Данные» → «Фактический журнал» — и названия классов можно будет добавлять одним кликом.')));
}

/** Строка привязки группы к коду расписания — источник занятий для журнала. */
function codeRow(g, st, refresh, kind) {
  const codes = scheduleCodes(st, kind);
  const n = lessonsCountForCode(st, g.code, kind);
  return h('div', {
    style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '8px 0 4px', fontSize: '12.5px' },
  },
    h('span', { class: 'muted' }, '📅 Код в расписании:'),
    codes.length
      ? h('select', {
        class: 'mono', style: { width: 'auto' },
        onChange: (e) => {
          const v = e.target.value || null;
          update(x => { const gr = dataOf(x, kind).groups.find(y => y.id === g.id); if (gr) gr.code = v; });
          refresh();
        },
      },
        h('option', { value: '', selected: !g.code }, '— не привязан —'),
        ...codes.map(c => h('option', { value: c, selected: g.code === c }, c)))
      : h('span', { class: 'muted' }, g.code || '— не привязан —'),
    g.code ? h('span', { class: 'muted' }, `· ${n} занятий во всех заездах`) : null,
    h('button', { class: 'btn sm ghost', onClick: () => openInJournal(g.id, kind) }, '📋 Открыть в журнале'));
}

/* ---------------- карточка группы: свёрнута по умолчанию, раскрывается по клику ---------------- */
function groupCard(g, { refresh, reload, refreshTotals, kind, isDO, isOpen, toggle }) {
  const st = getState();
  const c = counts(g);

  const sizePill = h('span', { class: isDO ? `pill ${sizeTone(c.n)}` : 'pill' }, `${c.n} чел.`);
  const contractPill = isDO ? h('span', { class: 'pill' }, `договор ${c.contract}/${c.n}`) : null;
  const navPill = isDO ? h('span', { class: 'pill' }, `Навигатор ${c.navigator}/${c.n}`) : null;

  // Пересчёт шапки без перерисовки таблицы — чекбоксы не теряют фокус,
  // а страница не прыгает к началу при каждой галочке.
  const recount = () => {
    const fresh = findGroup(g.id, getState(), kind);
    if (!fresh) return;
    const k = counts(fresh);
    sizePill.textContent = `${k.n} чел.`;
    if (isDO) {
      sizePill.className = `pill ${sizeTone(k.n)}`;
      contractPill.textContent = `договор ${k.contract}/${k.n}`;
      navPill.textContent = `Навигатор ${k.navigator}/${k.n}`;
    }
    refreshTotals();
  };

  const toggleField = (studentId, field) => (e) => {
    const on = e.target.checked;
    update(x => {
      const gr = dataOf(x, kind).groups.find(y => y.id === g.id);
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
          const stu = dataOf(x, kind).groups.find(y => y.id === g.id)?.students.find(y => y.id === s.id);
          if (stu) stu.fio = v;
        });
      },
    })),
    isDO ? h('td', { style: { textAlign: 'center' } }, h('input', {
      type: 'checkbox', checked: !!s.contract, class: 'box', title: 'Договор сдан',
      onChange: toggleField(s.id, 'contract'),
    })) : null,
    isDO ? h('td', { style: { textAlign: 'center' } }, h('input', {
      type: 'checkbox', checked: !!s.navigator, class: 'box', title: 'Заявление отправлено в Навигатор',
      onChange: toggleField(s.id, 'navigator'),
    })) : null,
    h('td', {}, h('input', {
      type: 'text', value: s.note || '', placeholder: '—', class: 'cell-input muted',
      onChange: (e) => update(x => {
        const stu = dataOf(x, kind).groups.find(y => y.id === g.id)?.students.find(y => y.id === s.id);
        if (stu) stu.note = norm(e.target.value);
      }),
    })),
    h('td', {}, h('button', {
      class: 'btn sm danger ghost', title: 'Убрать из группы',
      onClick: () => {
        update(x => {
          const gr = dataOf(x, kind).groups.find(y => y.id === g.id);
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
      const gr = dataOf(x, kind).groups.find(y => y.id === g.id);
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
      isDO ? h('th', { style: { width: '90px', textAlign: 'center' } }, 'Договор') : null,
      isDO ? h('th', { style: { width: '110px', textAlign: 'center' } }, 'Навигатор') : null,
      h('th', { style: { width: '25%' } }, 'Примечание'),
      h('th', { style: { width: '44px' } }, ''))),
    h('tbody', {}, ...rows)));

  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  const head = h('div', {
    style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', cursor: 'pointer' },
    onClick: toggle,
  },
    h('span', { class: 'muted', style: { fontSize: '12px', width: '10px', display: 'inline-block' } }, isOpen ? '▾' : '▸'),
    h('h3', { style: { margin: 0 } }, h('span', { class: 'mono' }, g.name)),
    sizePill, contractPill, navPill,
    h('span', { style: { flex: '1 1 auto' } }),
    h('button', { class: 'btn sm ghost', onClick: stop(() => renameDialog(g, reload, kind, isDO)) }, '✎ Переименовать'),
    h('button', { class: 'btn sm ghost', onClick: stop(() => printElement(printNode([findGroup(g.id, getState(), kind) || g], isDO))) }, '🖨 Печать'),
    h('button', {
      class: 'btn sm danger ghost',
      onClick: stop(() => confirmBox(`Удалить ${isDO ? 'группу' : 'класс'} «${g.name}»${g.students.length ? ` вместе со списком (${g.students.length} чел.)` : ''}?`, () => {
        update(x => { dataOf(x, kind).groups = dataOf(x, kind).groups.filter(y => y.id !== g.id); });
        toast(`${isDO ? 'Группа' : 'Класс'} удалён${isDO ? 'а' : ''}`);
        reload();
      }))
    }, '🗑'));

  const body = isOpen ? h('div', { style: { marginTop: '10px' } },
    g.program ? h('div', { class: 'card-sub', style: { marginTop: 0 } }, g.program) : null,
    codeRow(g, st, refresh, kind),
    c.n ? table : h('p', { class: 'muted', style: { fontSize: '13px', margin: '10px 0' } }, 'Пока пусто — впишите первого ребёнка ниже.'),
    h('datalist', { id: listId }, ...knownFio(st, kind).map(f => h('option', { value: f }))),
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('label', { class: 'field' }, h('span', {}, 'Добавить ребёнка'), addInput),
      h('button', { class: 'btn fixed', onClick: add }, '+ Добавить')),
    isDO ? h('p', { class: 'muted', style: { fontSize: '12px', margin: '8px 0 0' } },
      c.n < MIN_SIZE ? `До нижней границы наполняемости не хватает ${MIN_SIZE - c.n} чел. (норма ${MIN_SIZE}–${MAX_SIZE}).`
        : c.n > MAX_SIZE ? `Перебор: в группе на ${c.n - MAX_SIZE} чел. больше нормы ${MIN_SIZE}–${MAX_SIZE}.`
          : `Наполняемость в норме (${MIN_SIZE}–${MAX_SIZE} чел.). Enter в поле ввода добавляет следующего.`)
      : h('p', { class: 'muted', style: { fontSize: '12px', margin: '8px 0 0' } }, 'Enter в поле ввода добавляет следующего ребёнка.'),
  ) : null;

  return h('div', { class: 'card', style: { marginBottom: '16px' } }, head, body);
}

function renameDialog(g, reload, kind, isDO) {
  const nameInput = h('input', { type: 'text', value: g.name, class: 'mono' });
  const progInput = h('input', { type: 'text', value: g.program || '', placeholder: 'направление (необязательно)' });
  modal({
    title: `${isDO ? 'Группа' : 'Класс'} «${g.name}»`,
    body: h('div', {},
      h('label', { class: 'field' }, h('span', {}, isDO ? 'Название' : 'Название класса'), nameInput),
      h('label', { class: 'field', style: { marginTop: '10px' } }, h('span', {}, 'Направление / программа'), progInput)),
    okText: 'Сохранить',
    onOk: () => {
      const name = norm(nameInput.value);
      if (!name) { toast('Название не может быть пустым', 'err'); return false; }
      if (groupsOf(getState(), kind).some(x => x.id !== g.id && x.name.toLowerCase() === name.toLowerCase())) { toast(`${isDO ? 'Группа' : 'Класс'} «${name}» уже есть`, 'err'); return false; }
      update(x => {
        const gr = dataOf(x, kind).groups.find(y => y.id === g.id);
        if (gr) { gr.name = name; gr.program = norm(progInput.value); }
      });
      reload();
    },
  });
}

/* ---------------- выгрузка и печать ---------------- */
export function toCsv(groups, isDO = true) {
  const head = isDO
    ? ['Группа', 'Направление', '№', 'ФИО', 'Договор сдан', 'Заявление в Навигаторе', 'Примечание']
    : ['Класс', 'Направление', '№', 'ФИО', 'Примечание'];
  const rows = [head];
  for (const g of groups) {
    g.students.forEach((s, i) => rows.push(isDO
      ? [g.name, g.program || '', i + 1, s.fio, s.contract ? 'да' : 'нет', s.navigator ? 'да' : 'нет', s.note || '']
      : [g.name, g.program || '', i + 1, s.fio, s.note || '']));
    if (!g.students.length) rows.push(isDO
      ? [g.name, g.program || '', '', '', '', '', 'группа пуста']
      : [g.name, g.program || '', '', '', 'класс пуст']);
  }
  return '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
}

function printNode(groups, isDO = true) {
  return h('div', { class: 'print-only enroll-print' },
    h('h2', {}, isDO ? 'Набор в группы дополнительного образования' : 'Классы фактического журнала'),
    ...groups.map(g => {
      const c = counts(g);
      return h('div', { class: 'e-group' },
        h('h3', {}, `${g.name}${g.program ? ` — ${g.program}` : ''}`),
        h('p', { class: 'e-sub' }, isDO
          ? `Всего: ${c.n} чел. · договоров сдано: ${c.contract} · заявлений в Навигаторе: ${c.navigator}`
          : `Всего: ${c.n} чел.`),
        h('table', { class: 'e-table' },
          h('thead', {}, h('tr', {},
            h('th', {}, '№'), h('th', {}, 'ФИО'),
            isDO ? h('th', {}, 'Договор') : null, isDO ? h('th', {}, 'Навигатор') : null,
            h('th', {}, 'Примечание'))),
          h('tbody', {}, ...(g.students.length ? g.students : [null]).map((s, i) => s
            ? h('tr', {},
              h('td', { class: 'c' }, i + 1), h('td', {}, s.fio),
              isDO ? h('td', { class: 'c' }, s.contract ? '✓' : '') : null,
              isDO ? h('td', { class: 'c' }, s.navigator ? '✓' : '') : null,
              h('td', {}, s.note || ''))
            : h('tr', {}, h('td', { colspan: isDO ? 5 : 3, class: 'c' }, isDO ? 'группа пуста' : 'класс пуст'))))));
    }));
}
