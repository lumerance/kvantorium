// Расписание для «Фактического» журнала — вносится день за днём, а не одним
// файлом на весь заезд: школа даёт расписание только на завтра, поэтому
// удобнее сразу вписать его в интерфейсе, чем ждать документ на весь заезд
// целиком. Хранится в той же форме, что и официальное (st.actual.schedules
// [заезд] = {lessons, codes, teachers, dates, …}) — так весь остальной код
// (сопоставление кодов, журнал) работает с ним одинаково, без разбора kind.
import { h, toast, confirmBox, dateRu } from '../core/ui.js';
import { getState, update, autoMapAll } from '../core/store.js';

const SHIFTS = [1, 2, 3];
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const weekdayOf = (iso) => WD[new Date(iso + 'T00:00:00').getDay()];
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDaysISO = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  return b === 1 ? one : many;
};

function bumpTime(hhmm, minutes) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return hhmm || '';
  let total = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + minutes;
  total = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * № урока — сквозной порядковый номер занятия за день по времени начала, а
 * не по счёту у своей группы: если после двух уроков 7Б идут два урока 7В,
 * у них всё равно 3 и 4, а не заново 1 и 2 (реальная нумерация школьных
 * уроков в течение дня общая на всех, вне зависимости от того, какой класс
 * в какой из них занимается).
 */
function timeRanks(lessons) {
  const times = [...new Set(lessons.map(l => l.time))].sort();
  return new Map(times.map((t, i) => [t, i + 1]));
}

function recalcMeta(sc) {
  sc.teachers = [...new Set(sc.lessons.map(l => l.teacher).filter(Boolean))];
  sc.codes = [...new Set(sc.lessons.filter(l => l.kind !== 'event').map(l => l.code))].sort();
  sc.dates = [...new Set(sc.lessons.map(l => l.date))].sort();
}

/** Уже внесённые дни по всем заездам, новые сверху. */
function allDays(st) {
  const out = [];
  for (const sh of SHIFTS) {
    const sc = st.actual.schedules[String(sh)];
    if (!sc) continue;
    const byDate = new Map();
    for (const l of sc.lessons) {
      if (!byDate.has(l.date)) byDate.set(l.date, []);
      byDate.get(l.date).push(l);
    }
    for (const [date, lessons] of byDate) {
      out.push({ shift: sh, date, lessons: lessons.slice().sort((a, b) => a.time.localeCompare(b.time) || a.no - b.no) });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

function knownCodes(st) {
  const set = new Set();
  for (const sh of SHIFTS) for (const c of (st.actual.schedules[String(sh)]?.codes || [])) set.add(c);
  return [...set].sort();
}

/**
 * @param {() => void} outerRedraw redraw() всей страницы «Данные» — вызывается
 * после сохранения/удаления дня, чтобы карточка «Сопоставление групп» ниже
 * увидела новые коды (сама панель перерисовывает только себя).
 */
export function actualScheduleCard(outerRedraw) {
  const wrap = h('div', { style: { marginBottom: '16px' } });
  let lastShift = 1;
  let draft = null;  // { date, shift, lessons:[{no,time,code,dir,teacher}], editKey:{shift,date}|null }

  function freshDraft() {
    draft = { date: addDaysISO(todayISO(), 1), shift: lastShift, lessons: [], editKey: null };
  }
  freshDraft();
  render();
  return wrap;

  function render() {
    wrap.innerHTML = '';
    wrap.append(h('h2', { style: { fontSize: '16px', margin: '0 0 10px' } }, '2. Расписание по дням'));
    wrap.append(h('div', { class: 'card', style: { marginBottom: '14px' } }, formBody()));
    const days = allDays(getState());
    if (days.length) {
      for (const d of days) wrap.append(dayCard(d));
    } else {
      wrap.append(h('p', { class: 'muted', style: { fontSize: '13px', margin: '0' } },
        'Пока не внесено ни одного дня — заполните форму выше на завтра.'));
    }
  }

  /* ---------------- форма «добавить/изменить день» ---------------- */
  function formBody() {
    const st = getState();
    // подсказки — и уже сохранённые коды, и то, что уже добавлено в этот
    // черновик: иначе после первого занятия группы не по чему кликнуть,
    // чтобы быстро добавить ей ещё один урок подряд
    const codes = [...new Set([...knownCodes(st), ...draft.lessons.map(l => l.code)])].sort();

    const dateInput = h('input', { type: 'date', value: draft.date, onChange: (e) => { draft.date = e.target.value; } });
    const shiftTabs = h('div', { class: 'tabs', style: { padding: '4px' } }, ...SHIFTS.map(s => h('button', {
      class: 'tab' + (draft.shift === s ? ' active' : ''),
      onClick: () => { draft.shift = s; render(); },
    }, `${s} заезд`)));

    const timeInput = h('input', { type: 'text', class: 'mono', placeholder: '08:00', style: { flex: '0 0 90px' } });
    const codeInput = h('input', { type: 'text', placeholder: 'Группа, например Т1 НуР7', list: 'actual-known-codes' });
    const dirInput = h('input', { type: 'text', placeholder: 'Тема / направление (необязательно)' });
    const datalist = h('datalist', { id: 'actual-known-codes' }, ...codes.map(c => h('option', { value: c })));

    const focusCode = () => { if (!timeInput.value && !codeInput.value) timeInput.value = nextTimeFor(''); };
    codeInput.addEventListener('focus', focusCode);
    codeInput.addEventListener('input', () => { if (!timeInput.value) timeInput.value = nextTimeFor(codeInput.value.trim()); });

    const addRow = () => {
      const code = norm(codeInput.value);
      const time = norm(timeInput.value);
      if (!code) { toast('Впишите группу', 'err'); codeInput.focus(); return; }
      if (!time) { toast('Впишите время', 'err'); timeInput.focus(); return; }
      draft.lessons.push({ time, code, dir: norm(dirInput.value) });
      codeInput.value = ''; dirInput.value = ''; timeInput.value = '';
      render();
      wrap.querySelector('.add-lesson-code')?.focus();
    };
    [timeInput, codeInput, dirInput].forEach(inp => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRow(); } }));
    codeInput.classList.add('add-lesson-code');

    const quickAdd = (code) => {
      draft.lessons.push({ time: nextTimeFor(code), code, dir: '' });
      render();
    };

    const ranks = timeRanks(draft.lessons);
    const draftTable = draft.lessons.length ? h('div', { class: 'table-wrap', style: { marginTop: '10px' } },
      h('table', { class: 'compact' },
        h('thead', {}, h('tr', {}, h('th', {}, '№'), h('th', {}, 'Время'), h('th', {}, 'Группа'), h('th', {}, 'Направление'), h('th', {}, ''))),
        h('tbody', {}, ...draft.lessons.slice().sort((a, b) => a.time.localeCompare(b.time)).map(l => {
          const idx = draft.lessons.indexOf(l);
          return h('tr', {},
            h('td', { class: 'num muted mono' }, `${ranks.get(l.time)}ур`),
            h('td', { class: 'mono' }, l.time),
            h('td', {}, h('b', {}, l.code)),
            h('td', { class: 'muted', style: { fontSize: '12px' } }, l.dir || '—'),
            h('td', {}, h('button', { class: 'btn sm danger ghost', title: 'Убрать', onClick: () => { draft.lessons.splice(idx, 1); render(); } }, '×')));
        })))) : h('p', { class: 'muted', style: { fontSize: '12.5px', margin: '10px 0 0' } },
      'Занятий пока нет — добавьте ниже или кликните по группе, если она уже встречалась.');

    const save = () => {
      if (!draft.date) { toast('Укажите дату', 'err'); return; }
      if (!draft.lessons.length) { toast('Добавьте хотя бы одно занятие', 'err'); return; }
      lastShift = draft.shift;
      update(x => {
        // при правке дня сперва убираем его старые занятия — дата или заезд
        // могли поменяться
        if (draft.editKey) {
          const old = x.actual.schedules[String(draft.editKey.shift)];
          if (old) { old.lessons = old.lessons.filter(l => l.date !== draft.editKey.date); recalcMeta(old); }
        }
        const key = String(draft.shift);
        const sc = x.actual.schedules[key] || (x.actual.schedules[key] = {
          shift: draft.shift, sourceName: 'Внесено вручную по дням', teachers: [], codes: [], dates: [], weeks: [], notes: [], lessons: [],
        });
        const ranks = timeRanks(draft.lessons);
        sc.lessons = sc.lessons.filter(l => l.date !== draft.date)
          .concat(draft.lessons.map(l => ({
            date: draft.date, weekday: weekdayOf(draft.date), week: null,
            no: ranks.get(l.time), time: l.time, code: l.code, teacher: '', direction: l.dir, kind: 'group',
          })));
        recalcMeta(sc);
      });
      autoMapAll('actual');
      toast(`День ${dateRu(draft.date)} сохранён`);
      freshDraft();
      outerRedraw();  // «Сопоставление групп» ниже должно увидеть новые коды
    };

    return h('div', {},
      h('h3', {}, draft.editKey ? `Правка дня — ${dateRu(draft.editKey.date)}` : 'Добавить день'),
      h('div', { class: 'card-sub' }, 'Заезд подставляется тот же, что в прошлый раз — поменяйте, если начался новый.'),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, h('span', {}, 'Дата'), dateInput),
        h('label', { class: 'field' }, h('span', {}, 'Заезд'), shiftTabs)),
      h('hr', { class: 'sep' }),
      h('div', { class: 'row' }, timeInput, codeInput, dirInput,
        h('button', { class: 'btn fixed', onClick: addRow }, '+ Занятие')),
      datalist,
      codes.length ? h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' } },
        h('span', { class: 'muted', style: { fontSize: '11.5px', width: '100%' } }, 'Быстро — уже встречались:'),
        ...codes.map(c => h('button', { class: 'btn sm ghost', onClick: () => quickAdd(c) }, `+ ${c}`))) : null,
      draftTable,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '14px' } },
        h('button', { class: 'btn primary', onClick: save }, '💾 Сохранить день'),
        draft.editKey || draft.lessons.length ? h('button', { class: 'btn ghost', onClick: () => { freshDraft(); render(); } }, 'Очистить') : null));

    /** Время следующего занятия этой группы — через 45 минут после её последнего;
     *  для первой группы дня — через 45 минут после последнего занятия дня вообще. */
    function nextTimeFor(code) {
      const own = draft.lessons.filter(l => l.code === code).slice().sort((a, b) => a.time.localeCompare(b.time));
      if (own.length) return bumpTime(own[own.length - 1].time, 45);
      const all = draft.lessons.slice().sort((a, b) => a.time.localeCompare(b.time));
      return all.length ? bumpTime(all[all.length - 1].time, 45) : '08:00';
    }
  }

  /* ---------------- карточка уже внесённого дня ---------------- */
  function dayCard(d) {
    return h('div', { class: 'card', style: { marginBottom: '12px' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' } },
        h('b', { class: 'mono' }, dateRu(d.date)),
        h('span', { class: 'muted' }, d.weekday || weekdayOf(d.date)),
        h('span', { class: 'pill cyan' }, `заезд ${d.shift}`),
        h('span', { class: 'pill ok' }, `${d.lessons.length} ${plural(d.lessons.length, 'занятие', 'занятия', 'занятий')}`),
        h('span', { style: { flex: '1 1 auto' } }),
        h('button', {
          class: 'btn sm ghost', onClick: () => {
            draft = { date: d.date, shift: d.shift, lessons: d.lessons.map(l => ({ time: l.time, code: l.code, dir: l.direction || '' })), editKey: { shift: d.shift, date: d.date } };
            render();
            wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, '✎ Изменить'),
        h('button', {
          class: 'btn sm danger ghost', onClick: () => confirmBox(`Удалить день ${dateRu(d.date)} (${d.lessons.length} ${plural(d.lessons.length, 'занятие', 'занятия', 'занятий')})?`, () => {
            update(x => {
              const sc = x.actual.schedules[String(d.shift)];
              if (!sc) return;
              sc.lessons = sc.lessons.filter(l => l.date !== d.date);
              if (!sc.lessons.length) delete x.actual.schedules[String(d.shift)];
              else recalcMeta(sc);
            });
            if (draft.editKey && draft.editKey.date === d.date && draft.editKey.shift === d.shift) freshDraft();
            toast('День удалён');
            outerRedraw();  // «Сопоставление групп» ниже должно потерять пропавшие коды
          })
        }, '🗑')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'compact' },
        h('thead', {}, h('tr', {}, h('th', {}, '№'), h('th', {}, 'Время'), h('th', {}, 'Группа'), h('th', {}, 'Направление'))),
        h('tbody', {}, ...d.lessons.map(l => h('tr', {},
          h('td', { class: 'num muted mono' }, `${l.no}ур`),
          h('td', { class: 'mono' }, l.time),
          h('td', {}, h('b', {}, l.code)),
          h('td', { class: 'muted', style: { fontSize: '12px' } }, l.direction || '—')))))));
  }
}
