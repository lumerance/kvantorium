// Счётчик часов по индивидуальному плану: сколько закрыто и что осталось.
import { h, toast, statCard, progressBar, hoursFmt, dateRu, download, modal, confirmBox, fileDrop, emptyState } from '../core/ui.js';
import { getState, update, lessonsForGroup, allGroups, viewedAgg } from '../core/store.js';
import { importPlanFile } from '../parsers/plan.js';
import { BASE_WORKS, QUICK_ACTIONS } from '../data/works.js';
import { buildPlanReport } from '../exporters/plan-export.js';

const KIND_LABEL = { teaching: 'Учебные', method: 'Методические' };

/** Актуальный справочник видов работ: из импортированного плана либо базовый. */
export function worksCatalog(st = getState()) {
  const fromPlan = st.plan?.works;
  if (fromPlan?.length) return fromPlan;
  return BASE_WORKS.map(w => ({ ...w, planned: 0 }));
}

/** Свод: норма / списано / остаток по каждому типу и по каждому виду работ. */
export function computeHours(st = getState()) {
  const norm = Number(st.hoursSettings.annualNorm) || 0;
  const target = { teaching: norm / 2, method: norm / 2 };
  const works = worksCatalog(st);
  const done = { teaching: 0, method: 0 };
  const byWork = new Map();
  for (const w of works) byWork.set(w.id, { work: w, done: 0, count: 0 });
  for (const e of st.hoursLog) {
    const kind = e.kind === 'teaching' ? 'teaching' : 'method';
    done[kind] += Number(e.hours) || 0;
    const rec = byWork.get(e.workId);
    if (rec) { rec.done += Number(e.hours) || 0; rec.count++; }
  }
  const plannedSum = { teaching: 0, method: 0 };
  for (const w of works) plannedSum[w.kind] += w.planned || 0;
  return {
    norm, target, done, works, byWork, plannedSum,
    left: { teaching: target.teaching - done.teaching, method: target.method - done.method },
    total: { target: norm, done: done.teaching + done.method },
  };
}

export function render(root) {
  const wrap = h('div', {});
  root.append(wrap);

  function redraw() {
    const st = getState();
    const c = computeHours(st);
    wrap.innerHTML = '';

    wrap.append(h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'Счётчик часов'),
        h('p', {}, st.plan
          ? `План импортирован: ${st.plan.sourceName || ''} · ${st.plan.teacher || ''} · ${st.plan.direction || ''}`
          : 'Индивидуальный план не импортирован — используется базовый справочник видов работ.')),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn primary', onClick: () => addEntryDialog(redraw) }, '+ Списать часы'),
        h('button', { class: 'btn', onClick: () => importDialog(redraw) }, '⤒ Импорт плана (.xlsx)'),
        h('button', { class: 'btn', onClick: exportXlsx }, '⤓ Excel по форме плана'),
        st.hoursLog.length ? h('button', { class: 'btn', onClick: exportLog }, '⤓ CSV') : null,
      )));

    /* ---- сводка ---- */
    const pct = (d, t) => t > 0 ? Math.round(d / t * 100) : 0;
    wrap.append(h('div', { class: 'grid cols-4', style: { marginBottom: '16px' } },
      statCard('Годовая норма', hoursFmt(c.norm), `по ${hoursFmt(c.norm / 2)} на каждый вид`, 'plain'),
      statCard('Закрыто всего', hoursFmt(c.total.done), `${pct(c.total.done, c.norm)}% нормы`),
      statCard('Осталось учебных', hoursFmt(Math.max(0, c.left.teaching)), `закрыто ${hoursFmt(c.done.teaching)} из ${hoursFmt(c.target.teaching)}`, 'cyan'),
      statCard('Осталось методических', hoursFmt(Math.max(0, c.left.method)), `закрыто ${hoursFmt(c.done.method)} из ${hoursFmt(c.target.method)}`, 'amber'),
    ));

    /* ---- прогресс по типам ---- */
    const kindCard = (kind, cls) => {
      const t = c.target[kind], d = c.done[kind];
      return h('div', { class: 'card' },
        h('h3', {}, KIND_LABEL[kind] + ' часы'),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Норма (половина плана)'), h('span', { class: 'v' }, hoursFmt(t))),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Списано'), h('span', { class: 'v' }, hoursFmt(d))),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Осталось закрыть'),
          h('span', { class: 'v', style: { color: d >= t ? 'var(--neon)' : 'var(--text)' } }, hoursFmt(Math.max(0, t - d)))),
        h('div', { style: { marginTop: '10px' } }, progressBar(d, t, cls)),
        h('div', { class: 'muted', style: { marginTop: '6px', fontSize: '12px' } },
          `${pct(d, t)}% · в плане расписано ${hoursFmt(c.plannedSum[kind])}`),
      );
    };

    wrap.append(h('div', { class: 'grid cols-2', style: { marginBottom: '16px' } },
      kindCard('teaching', 'cyan'), kindCard('method', ''),
      h('div', { class: 'card' },
        h('h3', {}, 'Годовая норма'),
        h('div', { class: 'card-sub' }, 'Норма делится поровну: половина — учебные часы, половина — методические.'),
        h('div', { class: 'row' },
          h('label', { class: 'field' }, h('span', {}, 'Часов за учебный год'),
            h('input', {
              type: 'number', min: 0, step: 1, value: st.hoursSettings.annualNorm,
              onChange: (e) => { update(x => { x.hoursSettings.annualNorm = parseFloat(e.target.value) || 0; }); redraw(); }
            })),
          st.plan ? h('button', {
            class: 'btn fixed', onClick: () => {
              const total = Math.round(st.plan.totals.all);
              update(x => { x.hoursSettings.annualNorm = total; }); redraw();
              toast(`Норма взята из плана: ${total} ч`);
            }
          }, `↺ Из плана (${Math.round(st.plan?.totals.all || 0)} ч)`) : null,
        ),
        h('div', { class: 'legend', style: { marginTop: '12px' } },
          h('span', { class: 'k' }, h('b', {}, hoursFmt(c.target.teaching)), ' учебных'),
          h('span', { class: 'k' }, h('b', {}, hoursFmt(c.target.method)), ' методических')),
      ),
      quickCard(redraw),
    ));

    /* ---- что осталось закрыть по видам работ ---- */
    wrap.append(worksTable(c, redraw));

    /* ---- журнал списаний ---- */
    wrap.append(logTable(st, redraw));
  }

  async function exportXlsx() {
    try {
      const blob = await buildPlanReport(getState());
      const y = (getState().plan?.year || '').replace(/\//g, '-');
      download(`Индивидуальный_план_факт${y ? '_' + y : ''}.xlsx`, blob);
      toast('Выгружено в Excel по форме индивидуального плана');
    } catch (e) { console.error(e); toast('Ошибка выгрузки: ' + e.message, 'err'); }
  }

  function exportLog() {
    const st = getState();
    const rows = [['Дата', 'Тип', 'Наименование', 'Сроки', 'Вид работы', 'Часы', 'Комментарий']];
    for (const e of st.hoursLog) rows.push([dateRu(e.date), KIND_LABEL[e.kind], e.subject || '', e.period || '', e.title, String(e.hours).replace('.', ','), e.note || '']);
    download('Списанные_часы.csv', '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  }

  redraw();
}

/* ================= карточки ================= */

function quickCard(redraw) {
  const st = getState();
  const works = worksCatalog(st);
  const findWork = (q, kind) => works.find(w => w.kind === kind && w.title.toLowerCase().includes(q.toLowerCase()))
    || works.find(w => w.title.toLowerCase().includes(q.toLowerCase()));

  const btns = QUICK_ACTIONS.map(a => {
    const w = findWork(a.workTitle, a.kind);
    return h('button', {
      class: 'btn sm', title: w ? w.title : 'Вид работы не найден в плане',
      onClick: () => {
        if (!w) return toast('В плане нет подходящего вида работы — добавьте запись вручную', 'err');
        addEntry({ workId: w.id, kind: w.kind, title: w.title, hours: a.hours, note: a.title });
        toast(`Списано ${a.hours} ч: ${a.title}`); redraw();
      }
    }, `${a.title} · ${a.hours} ч`);
  });

  return h('div', { class: 'card' },
    h('h3', {}, 'Быстрые списания'),
    h('div', { class: 'card-sub' }, 'Одна кнопка — одно типовое действие с нормативным объёмом часов.'),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } }, ...btns));
}

function worksTable(c, redraw) {
  const groups = new Map();
  for (const w of c.works) {
    const key = `${w.kind}|${w.category || 'Прочее'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }
  const body = h('tbody', {});
  for (const [key, list] of groups) {
    const [kind, cat] = key.split('|');
    body.append(h('tr', {}, h('td', { colspan: 6, style: { background: 'rgba(43,255,139,.05)', fontWeight: '700' } },
      h('span', { class: `pill ${kind === 'teaching' ? 'cyan' : 'ok'}` }, KIND_LABEL[kind]), ' ', cat)));
    for (const w of list) {
      const rec = c.byWork.get(w.id) || { done: 0, count: 0 };
      const left = (w.planned || 0) - rec.done;
      body.append(h('tr', {},
        h('td', { class: 'sticky-col', style: { maxWidth: '520px', whiteSpace: 'normal' } }, w.title),
        h('td', { class: 'num' }, w.planned ? hoursFmt(w.planned) : '—'),
        h('td', { class: 'num' }, rec.done ? hoursFmt(rec.done) : '—'),
        h('td', { class: 'num' }, w.planned
          ? h('span', { class: left <= 0 ? 'neon-text' : '' }, left <= 0 ? 'закрыто' : hoursFmt(left))
          : '—'),
        h('td', { style: { minWidth: '130px' } }, w.planned ? progressBar(rec.done, w.planned, 'sm') : ''),
        h('td', {}, h('button', {
          class: 'btn sm', onClick: () => addEntryDialog(redraw, { workId: w.id })
        }, '+ списать')),
      ));
    }
  }
  return h('div', { class: 'card', style: { marginBottom: '16px' } },
    h('h3', {}, 'Что нужно закрыть по видам работ'),
    h('div', { class: 'card-sub' }, 'План — из импортированного индивидуального плана. Списано — ваши внесённые действия.'),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'compact' },
        h('thead', {}, h('tr', {},
          h('th', { class: 'sticky-col' }, 'Вид работы'), h('th', { class: 'num' }, 'План'),
          h('th', { class: 'num' }, 'Списано'), h('th', { class: 'num' }, 'Осталось'),
          h('th', {}, 'Прогресс'), h('th', {}, ''))),
        body)));
}

function logTable(st, redraw) {
  if (!st.hoursLog.length) {
    return h('div', { class: 'card' }, h('h3', {}, 'Журнал списаний'),
      emptyState('🕓', 'Пока ничего не списано. Нажмите «Списать часы» или используйте быстрые кнопки.'));
  }
  const sorted = [...st.hoursLog].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);
  return h('div', { class: 'card' },
    h('h3', {}, `Журнал списаний · ${st.hoursLog.length}`),
    h('div', { class: 'table-wrap', style: { maxHeight: '460px' } },
      h('table', { class: 'compact' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Дата'), h('th', {}, 'Тип'), h('th', {}, 'Наименование'), h('th', {}, 'Вид работы'),
          h('th', { class: 'num' }, 'Часы'), h('th', {}, 'Комментарий'), h('th', {}, ''))),
        h('tbody', {}, ...sorted.map(e => h('tr', {},
          h('td', { class: 'mono' }, dateRu(e.date)),
          h('td', {}, h('span', { class: `pill ${e.kind === 'teaching' ? 'cyan' : 'ok'}` }, KIND_LABEL[e.kind])),
          h('td', { class: e.subject ? '' : 'muted', style: { whiteSpace: 'normal', maxWidth: '220px' } }, e.subject || '—'),
          h('td', { style: { whiteSpace: 'normal', maxWidth: '420px' } }, e.title),
          h('td', { class: 'num mono' }, hoursFmt(e.hours)),
          h('td', { class: 'muted', style: { whiteSpace: 'normal', maxWidth: '320px' } }, e.note || ''),
          h('td', {}, h('button', {
            class: 'btn sm danger ghost',
            onClick: () => { update(x => { x.hoursLog = x.hoursLog.filter(z => z.id !== e.id); }); redraw(); }
          }, '×')),
        ))))));
}

/* ================= действия ================= */

function addEntry({ workId, kind, title, hours, note, date, subject, period }) {
  update(x => {
    x.hoursLog.push({
      id: Date.now() + Math.floor(Math.random() * 1000),
      date: date || new Date().toISOString().slice(0, 10),
      kind, workId, title, hours: Number(hours) || 0, note: note || '',
      subject: subject || '', period: period || '',
    });
  });
}

/** Подсказки для поля «Наименование»: строки плана + группы из журнала
 *  (просматриваемой агломерации — план и списания часов общие на весь год,
 *  а группы у каждой агломерации свои). */
function subjectSuggestions(st) {
  const out = new Set();
  for (const sh of (st.plan?.sheets || [])) for (const e of sh.entries) if (e.name) out.add(e.name);
  const agg = viewedAgg(st);
  const groups = allGroups(agg);
  for (const [code, m] of Object.entries(agg.mapping || {})) {
    if (groups.some(g => g.group.id === m?.groupId)) out.add(`Группа ${code}`);
  }
  return [...out];
}

function addEntryDialog(redraw, preset = {}) {
  const st = getState();
  const works = worksCatalog(st);
  const sel = h('select', {}, ...works.map(w => h('option', {
    value: w.id, selected: preset.workId === w.id,
  }, `${w.kind === 'teaching' ? '📘' : '🧩'} ${w.category ? w.category + ' · ' : ''}${w.title}${w.planned ? ` (план ${w.planned} ч)` : ''}`)));
  const hoursInput = h('input', { type: 'number', step: '0.5', min: '0', value: preset.hours ?? 1 });
  const dateInput = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
  const noteInput = h('input', { type: 'text', placeholder: 'комментарий (необязательно)' });
  const listId = 'subj-' + Math.random().toString(36).slice(2, 8);
  const subjectInput = h('input', { type: 'text', list: listId, placeholder: 'например: Группа Т1 РШ7', value: preset.subject || '' });
  const dataList = h('datalist', { id: listId }, ...subjectSuggestions(st).map(v => h('option', { value: v })));
  const periodInput = h('input', { type: 'text', placeholder: 'например: 26.12.2025 - 07.02.2026', value: preset.period || '' });
  const presetRow = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' } });

  const refreshPresets = () => {
    presetRow.innerHTML = '';
    const w = works.find(x => x.id === sel.value);
    for (const p of (w?.presets || [])) {
      presetRow.append(h('button', { class: 'btn sm', onClick: () => { hoursInput.value = p; } }, `${p} ч`));
    }
  };
  sel.addEventListener('change', refreshPresets);
  refreshPresets();

  modal({
    title: 'Списать часы',
    body: h('div', {},
      h('label', { class: 'field', style: { marginBottom: '10px' } }, h('span', {}, 'Вид работы'), sel),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, h('span', {}, 'Наименование группы / мероприятия'), subjectInput, dataList),
        h('label', { class: 'field' }, h('span', {}, 'Сроки проведения'), periodInput)),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('label', { class: 'field' }, h('span', {}, 'Дата'), dateInput),
        h('label', { class: 'field' }, h('span', {}, 'Часы'), hoursInput)),
      presetRow,
      h('label', { class: 'field', style: { marginTop: '10px' } }, h('span', {}, 'Комментарий'), noteInput),
      h('p', { class: 'muted', style: { fontSize: '12px', marginBottom: 0 } },
        'Наименование попадает в строку выгрузки по форме индивидуального плана — выбирайте его из подсказок, чтобы строки совпали с планом.'),
    ),
    okText: 'Списать',
    onOk: () => {
      const w = works.find(x => x.id === sel.value);
      const hrs = parseFloat(hoursInput.value);
      if (!w || !isFinite(hrs) || hrs <= 0) { toast('Укажите вид работы и положительное число часов', 'err'); return false; }
      addEntry({ workId: w.id, kind: w.kind, title: w.title, hours: hrs, note: noteInput.value, date: dateInput.value, subject: subjectInput.value, period: periodInput.value });
      toast(`Списано ${hrs} ч`); redraw();
    },
  });
}

function importDialog(redraw) {
  const info = h('div', { class: 'muted', style: { marginTop: '12px', fontSize: '13px' } });
  const drop = fileDrop({
    title: 'Перетащите файл индивидуального плана (.xlsx)',
    hint: 'листы «учебная» и «Метод, Восп» разбираются автоматически',
    accept: '.xlsx',
    onFile: async (file) => {
      info.textContent = 'Читаю файл…';
      try {
        const plan = await importPlanFile(file);
        update(x => {
          x.plan = { ...plan, importedAt: new Date().toISOString() };
          if (x.hoursSettings.source !== 'manual-edited') x.hoursSettings.annualNorm = Math.round(plan.totals.all) || x.hoursSettings.annualNorm;
        });
        toast(`План загружен: ${plan.works.length} видов работ, ${Math.round(plan.totals.all)} ч`);
        document.querySelector('.modal-back')?.remove();
        redraw();
      } catch (e) {
        console.error(e);
        info.textContent = 'Ошибка: ' + e.message;
        toast('Не удалось прочитать файл: ' + e.message, 'err');
      }
    },
  });
  modal({ title: 'Импорт индивидуального плана', body: h('div', {}, drop, info), okText: null, cancelText: 'Закрыть' });
}
