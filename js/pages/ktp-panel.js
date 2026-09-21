// Учебные программы (КТП) — привязка к группам и выдача тем по дням.
//
// Зачем: в электронном журнале на один день заведено одно поле темы/типа/
// описания, а занятий в этот день может быть три подряд. Здесь по КТП и
// официальному расписанию сразу собирается готовый текст на весь день —
// остаётся нажать «скопировать» и вставить.
import { h, toast, modal, confirmBox, fileDrop, copyText, dateRu } from '../core/ui.js';
import { getState, update, allGroups } from '../core/store.js';
import {
  importKtpFile, splitPastedTable, rowsFromMatrix, detectColumns,
  programHours, defaultShiftHours, slotsForShift,
} from '../parsers/ktp.js';
import { go } from '../core/router.js';

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
/** Склонение: 1 занятие, 2 занятия, 5 занятий. */
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  return b === 1 ? one : many;
};
let uid = 0;
const nextId = (p) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

const programOf = (st, groupId) => (st.programs || []).find(p => p.id === (st.groupPrograms || {})[groupId]) || null;
const FIELD_LABELS = { no: '№', theme: 'Тема', content: 'Содержание', type: 'Тип занятия', hours: 'Часы', date: 'Дата' };

/* ====================== панель в журнале ====================== */

/**
 * Темы КТП по дням для текущей группы и заезда.
 * @param {object} group группа журнала (обычная или из «Набора»)
 * @param {number} shift номер заезда
 * @param {Array} lessons занятия группы в этом заезде, по порядку
 */
export function ktpCard(st, group, shift, lessons, redraw) {
  const program = programOf(st, group.id);
  if (!program) {
    return h('details', { class: 'acc no-print', style: { marginBottom: '14px' } },
      h('summary', {}, '📚 Темы по КТП'),
      h('div', { class: 'acc-body' },
        h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '13px' } },
          `К группе «${group.name}» не привязана учебная программа. Загрузите КТП на странице «Данные» и отметьте там эту группу — темы, содержание и тип занятия сами разложатся по дням заезда, с кнопками «скопировать» для электронного журнала.`),
        h('button', { class: 'btn sm', onClick: () => go('data') }, 'Загрузить программу →')));
  }

  const slots = slotsForShift(program, shift);
  const key = `${group.id}|${shift}`;
  const offset = Number((st.ktpOffsets || {})[key]) || 0;
  const total = programHours(program);
  const split = program.shiftHours || defaultShiftHours(total);
  const shiftStart = split.slice(0, shift - 1).reduce((a, b) => a + (Number(b) || 0), 0);

  // занятия расписания -> дни, каждому занятию свой час КТП
  const days = [];
  lessons.forEach((l, i) => {
    const item = { lesson: l, slot: slots[i + offset] || null };
    const last = days[days.length - 1];
    if (last && last.date === l.date) last.items.push(item);
    else days.push({ date: l.date, weekday: l.weekday, items: [item] });
  });

  const used = lessons.length + offset;
  const body = h('div', { class: 'acc-body' });

  body.append(h('div', { class: 'card-sub', style: { marginTop: 0 } },
    `${program.name} · заезд ${shift}: часы КТП ${shiftStart + 1}–${shiftStart + slots.length} из ${total} · занятий в расписании ${lessons.length}`));

  /* сдвиг — если занятие переносили и темы «уехали» */
  const offsetLabel = h('b', { class: 'mono' }, String(offset));
  const setOffset = (v) => {
    update(x => { x.ktpOffsets = x.ktpOffsets || {}; x.ktpOffsets[key] = Math.max(-slots.length, Math.min(slots.length, v)); });
    redraw();
  };
  body.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '0 0 12px' } },
    h('span', { class: 'muted', style: { fontSize: '12.5px' } }, 'Сдвиг по КТП:'),
    h('button', { class: 'btn sm ghost', onClick: () => setOffset(offset - 1) }, '−'),
    offsetLabel,
    h('button', { class: 'btn sm ghost', onClick: () => setOffset(offset + 1) }, '+'),
    offset ? h('button', { class: 'btn sm ghost', onClick: () => setOffset(0) }, 'сбросить') : null,
    h('span', { class: 'muted', style: { fontSize: '12px' } }, '— если занятие переносили или отменяли')));

  for (const day of days) body.append(dayBlock(day));

  const missing = Math.max(0, lessons.length - Math.max(0, slots.length - offset));
  const leftover = Math.max(0, slots.length - offset - lessons.length);
  if (missing) body.append(h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '4px 0 0' } },
    `⚠ На ${missing === 1 ? 'последнее' : 'последние'} ${missing} ${plural(missing, 'занятие', 'занятия', 'занятий')} часов КТП в этом заезде не осталось — проверьте деление программы по заездам или сдвиг.`));
  else if (leftover) body.append(h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '4px 0 0' } },
    `Осталось нераспределённых часов КТП в этом заезде: ${leftover}.`));

  // свёрнуто по умолчанию — раскрывается по клику, если тема нужна прямо сейчас
  return h('details', { class: 'acc no-print', style: { marginBottom: '14px' } },
    h('summary', {}, '📚 Темы по КТП — по дням, для электронного журнала'),
    body);
}

/** Склейка значений за день: подряд идущие одинаковые (тема на 3 часа) — один раз. */
function mergeField(items, pick) {
  const out = [];
  for (const it of items) {
    const v = norm(it.slot ? pick(it.slot.row) : '');
    if (v && out[out.length - 1] !== v) out.push(v);
  }
  return out.join('; ');
}

/** Уникальные значения за день — без привязки к соседству, только порядок
 *  первого появления. Нужна для «Тип занятия»: там мало вариантов
 *  (изучение нового, применение, повторение…), и совпадение — не только
 *  подряд идущее (одна тема КТП на несколько часов), но и через занятие,
 *  например 1-й и 3-й урок за день. Тема и содержание так не склеиваются —
 *  повтор не подряд там обычно значит разные по факту фрагменты урока.
 *  Разделитель — запятая, а не «;»: электронный журнал при вставке текста
 *  с точкой с запятой выдаёт ошибку. */
function mergeUnique(items, pick) {
  const out = [];
  for (const it of items) {
    const v = norm(it.slot ? pick(it.slot.row) : '');
    if (v && !out.includes(v)) out.push(v);
  }
  return out.join(', ');
}

function dayBlock(day) {
  const nos = day.items.map(it => it.lesson.no);
  const hours = day.items.map(it => it.slot?.hourNo).filter(Boolean);
  const theme = mergeField(day.items, r => r.theme);
  const content = mergeField(day.items, r => r.content);
  const type = mergeUnique(day.items, r => r.type);

  const field = (label, value) => h('div', { class: 'ktp-field' },
    h('span', { class: 'k' }, label),
    h('div', { class: 'v' + (value ? '' : ' empty') }, value || '— в КТП нет данных'),
    value ? h('button', {
      class: 'btn sm ghost', title: `Скопировать: ${label.toLowerCase()}`,
      onClick: async () => {
        const ok = await copyText(value);
        toast(ok ? `${label}: скопировано` : 'Не удалось скопировать', ok ? 'ok' : 'err');
      },
    }, '⧉') : null);

  const all = [theme && `Тема: ${theme}`, type && `Тип занятия: ${type}`, content && `Описание: ${content}`].filter(Boolean).join('\n');

  return h('div', { class: 'ktp-day' },
    h('div', { class: 'ktp-day-head' },
      h('b', {}, `${dateRu(day.date)}, ${day.weekday || ''}`),
      h('span', { class: 'pill' }, `${day.items.length} зан. · уроки ${nos.join(', ')}`),
      hours.length ? h('span', { class: 'pill cyan' }, hours.length > 1 ? `КТП, часы ${hours[0]}–${hours[hours.length - 1]}` : `КТП, час ${hours[0]}`) : h('span', { class: 'pill warn' }, 'нет часов КТП'),
      h('span', { style: { flex: '1 1 auto' } }),
      all ? h('button', {
        class: 'btn sm', onClick: async () => {
          const ok = await copyText(all);
          toast(ok ? 'Скопировано всё за день' : 'Не удалось скопировать', ok ? 'ok' : 'err');
        },
      }, '⧉ Всё за день') : null),
    field('Тема', theme),
    field('Тип занятия', type),
    field('Описание', content));
}

/* ====================== карточка на странице «Данные» ====================== */

export function programsCard(st, redraw) {
  const programs = st.programs || [];
  const body = h('div', {});

  if (!programs.length) {
    body.append(h('div', { class: 'card-sub', style: { marginTop: 0 } },
      'Программа с КТП привязывается к группам: дальше в журнале на каждый день заезда сразу будет готовый текст темы, типа и описания занятия — с кнопкой «скопировать» в электронный журнал.'));
  }
  for (const p of programs) body.append(programBlock(p, st, redraw));

  body.append(fileDrop({
    title: programs.length ? 'Загрузить ещё одну программу (.docx)' : 'Учебная программа с КТП (.docx)',
    hint: 'из документа берётся таблица КТП: тема, содержание, тип занятия, часы',
    accept: '.docx',
    onFile: async (file) => {
      try {
        const res = await importKtpFile(file);
        const hours = res.rows.reduce((a, r) => a + r.hours, 0);
        const prog = {
          id: nextId('prog_'), name: res.name, sourceName: res.sourceName,
          importedAt: new Date().toISOString(), shiftHours: defaultShiftHours(hours), rows: res.rows,
        };
        update(x => { x.programs = [...(x.programs || []), prog]; });
        toast(`Программа загружена: ${res.rows.length} строк КТП, ${hours} ч`);
        redraw();
        assignModal(prog, redraw);
      } catch (e) { console.error(e); toast('Ошибка импорта: ' + e.message, 'err'); }
    },
  }));

  body.append(h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } },
    h('button', { class: 'btn sm', onClick: () => pasteModal(redraw) }, '⤒ Вставить КТП таблицей (из PDF, Word, Excel)')));
  body.append(h('p', { class: 'muted', style: { fontSize: '12px', margin: '10px 0 0' } },
    'PDF напрямую пока не читается: откройте программу, выделите таблицу КТП, скопируйте и вставьте её кнопкой выше — колонки распознаются, а что не угадалось, поправите вручную.'));

  return h('div', { class: 'card' }, h('h3', {}, '5. Учебные программы (КТП)'), body);
}

function programBlock(program, st, redraw) {
  const total = programHours(program);
  const split = program.shiftHours || defaultShiftHours(total);
  const splitSum = split.reduce((a, b) => a + (Number(b) || 0), 0);
  const assigned = Object.entries(st.groupPrograms || {}).filter(([, pid]) => pid === program.id).map(([gid]) => gid);
  const groupLabel = (gid) => {
    const g = allGroups(st).find(x => x.group.id === gid);
    if (g) return `${g.subject.title} · ${g.group.name}`;
    const e = (st.enroll?.groups || []).find(x => x.id === gid);
    return e ? `Набор · ${e.name}` : gid;
  };

  const setField = (patch) => update(x => {
    const p = (x.programs || []).find(y => y.id === program.id);
    if (p) Object.assign(p, patch);
  });

  const shiftInput = (i) => h('input', {
    type: 'text', inputmode: 'numeric', value: split[i] ?? 0, style: { width: '70px', textAlign: 'center' },
    onChange: (e) => {
      const v = Math.max(0, parseInt(e.target.value, 10) || 0);
      const next = [...split]; next[i] = v;
      setField({ shiftHours: next });
      redraw();
    },
  });

  return h('div', { class: 'card', style: { marginBottom: '12px', background: 'rgba(255,255,255,.015)' } },
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Название программы'),
        h('input', { type: 'text', value: program.name, onChange: (e) => { setField({ name: norm(e.target.value) || 'Учебная программа' }); redraw(); } })),
      h('div', { class: 'fixed', style: { display: 'flex', gap: '8px', alignItems: 'flex-end' } },
        h('button', { class: 'btn sm', onClick: () => ktpModal(program, redraw) }, '📋 Показать КТП'),
        h('button', { class: 'btn sm', onClick: () => assignModal(program, redraw) }, `🔗 Группы (${assigned.length})`),
        h('button', {
          class: 'btn sm danger ghost',
          onClick: () => confirmBox(`Удалить программу «${program.name}»? Привязки групп к ней тоже пропадут.`, () => {
            update(x => {
              x.programs = (x.programs || []).filter(y => y.id !== program.id);
              for (const [gid, pid] of Object.entries(x.groupPrograms || {})) if (pid === program.id) delete x.groupPrograms[gid];
            });
            toast('Программа удалена'); redraw();
          })
        }, '🗑'))),

    h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '12px' } },
      h('span', { class: 'muted', style: { fontSize: '12.5px' } }, 'Часы по заездам:'),
      shiftInput(0), h('span', { class: 'muted' }, '+'), shiftInput(1), h('span', { class: 'muted' }, '+'), shiftInput(2),
      h('span', { class: splitSum === total ? 'pill ok' : 'pill warn' },
        splitSum === total ? `= ${total} ч, как в КТП` : `= ${splitSum} ч, а в КТП ${total} ч`),
      h('button', { class: 'btn sm ghost', onClick: () => { setField({ shiftHours: defaultShiftHours(total) }); redraw(); } }, '↺ Как обычно'),
    ),
    h('p', { class: 'muted', style: { fontSize: '12px', margin: '8px 0 0' } },
      `${program.rows.length} строк КТП · ${total} ч · файл: ${program.sourceName || 'вставлено вручную'}`),
    assigned.length
      ? h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' } },
        ...assigned.map(gid => h('span', { class: 'pill ok' }, groupLabel(gid))))
      : h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '10px 0 0' } }, '⚠ Программа ещё не привязана ни к одной группе — в журнале темы не появятся.'));
}

/* ---------- привязка к группам ---------- */
function groupOptions(st) {
  const out = allGroups(st).map(({ subject, group }) => ({ id: group.id, label: `${group.name} · ${group.students.length}`, section: subject.title }));
  for (const g of st.enroll?.groups || []) out.push({ id: g.id, label: `${g.name} · ${g.students.length}`, section: 'Набор (ДО)' });
  return out;
}

function assignModal(program, redraw) {
  const st = getState();
  const list = groupOptions(st);
  if (!list.length) return toast('Сначала загрузите список обучающихся — привязывать программу пока не к чему', 'err');
  const assigned = new Set(Object.entries(st.groupPrograms || {}).filter(([, pid]) => pid === program.id).map(([gid]) => gid));

  const bySection = new Map();
  for (const g of list) {
    if (!bySection.has(g.section)) bySection.set(g.section, []);
    bySection.get(g.section).push(g);
  }

  const body = h('div', {});
  body.append(h('p', { class: 'muted', style: { marginTop: 0 } },
    'Отметьте группы, которые учатся по этой программе. У группы может быть только одна программа — отметка здесь снимет привязку к другой.'));
  for (const [section, groups] of bySection) {
    body.append(h('div', { style: { margin: '12px 0 6px' } }, h('b', { style: { fontSize: '13px' } }, section)));
    body.append(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
      ...groups.map(g => {
        const other = (st.programs || []).find(p => p.id !== program.id && (st.groupPrograms || {})[g.id] === p.id);
        return h('label', { class: 'check-pill' },
          h('input', {
            type: 'checkbox', checked: assigned.has(g.id), style: { width: 'auto', margin: 0 },
            onChange: (e) => { e.target.checked ? assigned.add(g.id) : assigned.delete(g.id); },
          }),
          h('span', {}, g.label),
          other ? h('span', { class: 'muted', style: { fontSize: '11px' } }, `сейчас: ${other.name.slice(0, 22)}`) : null);
      })));
  }

  modal({
    wide: true, title: `Группы по программе «${program.name}»`,
    body, okText: 'Применить',
    onOk: () => {
      update(x => {
        x.groupPrograms = x.groupPrograms || {};
        for (const g of list) {
          if (assigned.has(g.id)) x.groupPrograms[g.id] = program.id;
          else if (x.groupPrograms[g.id] === program.id) delete x.groupPrograms[g.id];
        }
      });
      toast(assigned.size ? `Программа привязана к группам: ${assigned.size}` : 'Привязки сняты');
      redraw();
    },
  });
}

/* ---------- просмотр и правка КТП ---------- */
function ktpModal(program, redraw) {
  const body = h('div', {});
  const tbody = h('tbody', {});

  const setRow = (rowId, patch) => update(x => {
    const p = (x.programs || []).find(y => y.id === program.id);
    const r = p?.rows[rowId];
    if (r) Object.assign(r, patch);
  });

  const fill = () => {
    tbody.innerHTML = '';
    const cur = (getState().programs || []).find(y => y.id === program.id);
    let hour = 0;
    (cur?.rows || []).forEach((r, i) => {
      const from = hour + 1; hour += Math.max(1, Number(r.hours) || 1);
      tbody.append(h('tr', {},
        h('td', { class: 'num muted mono' }, from === hour ? String(from) : `${from}–${hour}`),
        h('td', {}, h('input', { type: 'text', class: 'cell-input', value: r.theme, onChange: (e) => setRow(i, { theme: norm(e.target.value) }) })),
        h('td', {}, h('input', { type: 'text', class: 'cell-input', value: r.content, onChange: (e) => setRow(i, { content: norm(e.target.value) }) })),
        h('td', {}, h('input', { type: 'text', class: 'cell-input', value: r.type, onChange: (e) => setRow(i, { type: norm(e.target.value) }) })),
        h('td', {}, h('input', {
          type: 'text', inputmode: 'numeric', class: 'cell-input', value: r.hours, style: { width: '56px', textAlign: 'center' },
          onChange: (e) => { setRow(i, { hours: Math.max(1, parseInt(e.target.value, 10) || 1) }); fill(); },
        })),
        h('td', {}, h('button', {
          class: 'btn sm danger ghost', title: 'Удалить строку',
          onClick: () => {
            update(x => { const p = (x.programs || []).find(y => y.id === program.id); if (p) p.rows.splice(i, 1); });
            fill();
          }
        }, '×'))));
    });
  };
  fill();

  body.append(h('p', { class: 'muted', style: { marginTop: 0 } },
    'Первая колонка — какие часы программы занимает строка. Правки сохраняются сразу.'));
  body.append(h('div', { class: 'table-wrap' }, h('table', { class: 'compact enroll-table' },
    h('thead', {}, h('tr', {},
      h('th', { style: { width: '70px' } }, 'Часы'), h('th', {}, 'Тема'), h('th', {}, 'Содержание'),
      h('th', { style: { width: '18%' } }, 'Тип занятия'), h('th', { style: { width: '70px' } }, 'Часов'), h('th', { style: { width: '44px' } }, ''))),
    tbody)));
  body.append(h('div', { style: { marginTop: '10px' } },
    h('button', {
      class: 'btn sm', onClick: () => {
        update(x => { const p = (x.programs || []).find(y => y.id === program.id); if (p) p.rows.push({ no: null, theme: '', content: '', type: '', hours: 1 }); });
        fill();
      }
    }, '+ Строка')));

  modal({ wide: true, title: `КТП · ${program.name}`, body, okText: 'Готово', onOk: () => redraw(), cancelText: 'Закрыть' });
}

/* ---------- вставка КТП таблицей ---------- */
function pasteModal(redraw) {
  const ta = h('textarea', { rows: 8, placeholder: 'Вставьте сюда таблицу КТП целиком — из Word, Excel или выделением из PDF' });
  const preview = h('div', { style: { marginTop: '12px' } });
  let matrix = [];
  let map = {};
  let skipFirst = false;

  const renderPreview = () => {
    preview.innerHTML = '';
    if (!matrix.length) return;
    const width = Math.max(...matrix.map(r => r.length));

    const selects = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' } });
    for (let i = 0; i < width; i++) {
      const cur = Object.keys(FIELD_LABELS).find(k => map[k] === i) || '';
      selects.append(h('label', { class: 'field', style: { flex: '0 0 auto' } },
        h('span', {}, `Колонка ${i + 1}`),
        h('select', {
          onChange: (e) => {
            const v = e.target.value;
            for (const k of Object.keys(map)) if (map[k] === i) delete map[k];
            if (v) map[v] = i;
            renderPreview();
          }
        },
          h('option', { value: '', selected: !cur }, '— не использовать —'),
          ...Object.entries(FIELD_LABELS).map(([k, label]) => h('option', { value: k, selected: cur === k }, label)))));
    }
    preview.append(selects);

    const rows = rowsFromMatrix(matrix, map, skipFirst);
    preview.append(h('div', { class: 'pill' + (rows.length ? ' ok' : ' warn') },
      rows.length ? `распознано строк: ${rows.length}, часов: ${rows.reduce((a, r) => a + r.hours, 0)}` : 'не распознано ни одной строки — укажите, где тема'));
    preview.append(h('div', { class: 'table-wrap', style: { marginTop: '10px', maxHeight: '260px' } },
      h('table', { class: 'compact' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Тема'), h('th', {}, 'Содержание'), h('th', {}, 'Тип'), h('th', { class: 'num' }, 'Часов'))),
        h('tbody', {}, ...rows.slice(0, 8).map(r => h('tr', {},
          h('td', {}, r.theme), h('td', { class: 'muted' }, r.content), h('td', {}, r.type), h('td', { class: 'num' }, r.hours)))))));
  };

  const body = h('div', {},
    h('p', { class: 'muted', style: { marginTop: 0 } },
      'Из Word и Excel таблица вставляется колонками автоматически. Из PDF колонки распознаются по крупным пробелам — если разъехалось, поправьте потом в «Показать КТП».'),
    ta,
    h('div', { style: { marginTop: '10px' } },
      h('button', {
        class: 'btn sm', onClick: () => {
          matrix = splitPastedTable(ta.value);
          if (!matrix.length) return toast('Пусто — вставьте таблицу', 'err');
          map = detectColumns(matrix[0]);
          skipFirst = map.theme !== undefined;
          if (!skipFirst) map = { theme: 1, content: 2, type: 3, hours: 4, no: 0 };
          renderPreview();
        }
      }, '🔍 Разобрать')),
    preview);

  modal({
    wide: true, title: 'КТП таблицей', body, okText: 'Создать программу',
    onOk: () => {
      const rows = rowsFromMatrix(matrix, map, skipFirst);
      if (!rows.length) { toast('Не распознано ни одной строки', 'err'); return false; }
      const hours = rows.reduce((a, r) => a + r.hours, 0);
      const prog = {
        id: nextId('prog_'), name: 'Учебная программа', sourceName: '',
        importedAt: new Date().toISOString(), shiftHours: defaultShiftHours(hours), rows,
      };
      update(x => { x.programs = [...(x.programs || []), prog]; });
      toast(`Программа создана: ${rows.length} строк, ${hours} ч`);
      redraw();
      assignModal(prog, redraw);
    },
  });
}
