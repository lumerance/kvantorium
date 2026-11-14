// Окно «Ведомость групп ДО»: выбор групп «Набора», шапка (педагог, квантум,
// место — подставляются из плана и агломерации и запоминаются), диапазон
// баллов. Баллы раздаются случайно; по желанию — с оглядкой на средний балл
// ребёнка в журнале.
import { h, toast, modal, download } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { getState, update, viewedAgg, lessonsForCode } from '../core/store.js';
import { placeOfAgg, placeTitle } from '../data/places.js';
import { buildVedomostDoXlsx, randomScores, levelOf } from '../exporters/vedomost-do.js';

const SHIFTS = [1, 2, 3];
const shortName = (fio) => String(fio || '').trim().split(/\s+/).slice(0, 2).join(' ');
const shortCode = (g) => String(g.code || g.name || '').trim().split(/\s+/)[0] || g.name;

/** Учебный год по дате: сентябрь–декабрь — «2026/27», январь–август — «2025/26». */
function schoolYear(d = new Date()) {
  const y = d.getFullYear(), m = d.getMonth() + 1;
  const a = m >= 9 ? y : y - 1;
  return `${a}/${String((a + 1) % 100).padStart(2, '0')}`;
}

/** Средний балл ребёнка (только оценки 2–5) за все заезды. */
function journalAvg(agg, groupId, studentId) {
  const g = [];
  for (const sh of SHIFTS) {
    const cell = agg.journal?.[sh]?.[groupId]?.[studentId] || {};
    for (const m of Object.values(cell)) if (/^[2-5]$/.test(m)) g.push(Number(m));
  }
  return g.length ? g.reduce((a, b) => a + b, 0) / g.length : null;
}

/** Дата итогового контроля по умолчанию — последнее занятие группы в 3-м заезде. */
function lastLessonDate(agg, groups) {
  let last = '';
  for (const g of groups) {
    if (!g.code) continue;
    for (const sh of [3, 2, 1]) {
      const ls = lessonsForCode(sh, g.code, agg);
      if (ls.length) { const d = ls[ls.length - 1].date; if (d > last) last = d; break; }
    }
  }
  return last || new Date().toISOString().slice(0, 10);
}

const programOf = (agg, groupId) => (agg.programs || []).find(p => p.id === (agg.groupPrograms || {})[groupId])?.name || '';

export function openVedomostDo() {
  const st = getState();
  const agg = viewedAgg(st);
  const groups = (agg.enroll?.groups || []).filter(g => g.students?.length);
  if (!groups.length) return toast('В «Наборе» нет групп дополнительного образования с детьми', 'err');

  const prof = st.docsProfile || {};
  const place = placeOfAgg(agg);
  const val = {
    teacher: prof.teacher || st.plan?.teacher || agg.vedomostHeader?.teacher || '',
    kvantum: prof.kvantum || st.plan?.direction || '',
    place: placeTitle(place),
    year: schoolYear(),
    date: lastLessonDate(agg, groups),
    min: prof.min ?? 2,
    max: prof.max ?? 4,
    byJournal: prof.byJournal ?? true,
  };

  const inp = (key, type = 'text', extra = {}) => h('input', { type, value: String(val[key]), ...extra, onInput: (e) => { val[key] = e.target.value; } });
  const selected = new Set(groups.map(g => g.id));
  const programs = Object.fromEntries(groups.map(g => [g.id, programOf(agg, g.id) || g.program || '']));

  const groupRows = groups.map(g => h('tr', {},
    h('td', {}, h('label', { class: 'check-pill' + (selected.has(g.id) ? ' on' : ''), style: { whiteSpace: 'nowrap' } },
      h('input', {
        type: 'checkbox', checked: true, style: { width: 'auto', margin: 0 },
        onChange: (e) => { e.target.checked ? selected.add(g.id) : selected.delete(g.id); e.target.parentElement.classList.toggle('on', e.target.checked); },
      }),
      h('span', {}, `${g.name} · ${g.students.length} чел.`))),
    h('td', { style: { width: '100%' } }, h('input', {
      type: 'text', value: programs[g.id], placeholder: 'Название программы (в кавычках на листе)',
      onInput: (e) => { programs[g.id] = e.target.value; },
    }))));

  const rangeMin = h('select', {}, ...[1, 2, 3].map(v => h('option', { value: v, selected: Number(val.min) === v }, v)));
  const rangeMax = h('select', {}, ...[2, 3, 4].map(v => h('option', { value: v, selected: Number(val.max) === v }, v)));
  const byJournal = h('input', { type: 'checkbox', checked: !!val.byJournal, style: { width: 'auto', margin: 0 } });

  modal({
    wide: true,
    title: [icon('sheet', 18), ' Ведомость групп ДО (Excel)'],
    body: h('div', {},
      h('p', { class: 'muted', style: { marginTop: 0, fontSize: '13px' } },
        'Каждая группа — отдельный лист книги по форме технопарка. Детям раздаются баллы 1–4 по семи компетенциям в выбранном диапазоне; итог и уровень посчитаются формулами — их можно поправить прямо в Excel.'),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, h('span', {}, 'Педагог'), inp('teacher')),
        h('label', { class: 'field' }, h('span', {}, 'Квантум'), inp('kvantum', 'text', { placeholder: 'например VR/AR/IT' })),
        h('label', { class: 'field' }, h('span', {}, 'Населённый пункт'), inp('place', 'text', { placeholder: 'с. Новокиевский Увал' }))),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('label', { class: 'field' }, h('span', {}, 'Учебный год'), inp('year')),
        h('label', { class: 'field' }, h('span', {}, 'Дата контроля'), inp('date', 'date')),
        h('label', { class: 'field' }, h('span', {}, 'Баллы от'), rangeMin),
        h('label', { class: 'field' }, h('span', {}, 'до'), rangeMax)),
      h('label', { class: 'check-pill', style: { display: 'inline-flex', marginTop: '12px' } }, byJournal,
        h('span', {}, 'Учитывать средний балл ребёнка в журнале (у сильных — чаще верх диапазона)')),
      h('h4', { style: { margin: '18px 0 8px' } }, 'Группы и программы'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'compact' }, h('tbody', {}, ...groupRows)))),
    okText: 'Скачать Excel',
    onOk: () => {
      const lo = Math.min(Number(rangeMin.value), Number(rangeMax.value));
      const hi = Math.max(Number(rangeMin.value), Number(rangeMax.value));
      const chosen = groups.filter(g => selected.has(g.id));
      if (!chosen.length) { toast('Отметьте хотя бы одну группу', 'err'); return false; }
      const data = chosen.map(g => ({
        code: shortCode(g), name: g.name, program: programs[g.id].trim(),
        students: g.students.map(s => ({
          name: shortName(s.fio),
          scores: randomScores(lo, hi, byJournal.checked ? journalAvg(agg, g.id, s.id) : null),
        })),
      }));
      update(x => {
        x.docsProfile = { ...(x.docsProfile || {}), teacher: val.teacher.trim(), kvantum: val.kvantum.trim(), min: lo, max: hi, byJournal: byJournal.checked };
      });
      const hd = { teacher: val.teacher.trim(), kvantum: val.kvantum.trim(), place: val.place.trim(), year: val.year.trim(), date: val.date };
      buildVedomostDoXlsx(hd, data).then(blob => {
        const levels = data.flatMap(g => g.students.map(s => levelOf(s.scores.reduce((a, b) => a + b, 0))));
        const cnt = (l) => levels.filter(x => x === l).length;
        download(`Ведомость ДО${hd.place ? ' ' + hd.place.replace(/[\\/:*?"<>|]/g, '') : ''}.xlsx`, blob);
        toast(`Ведомость выгружена: ${data.length} ${data.length === 1 ? 'лист' : 'листа(ов)'}, высокий ${cnt('в')}, средний ${cnt('с')}, низкий ${cnt('н')}`);
      }).catch(e => { console.error(e); toast('Ошибка выгрузки: ' + e.message, 'err'); });
    },
  });
}
