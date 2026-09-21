// Страница «Итоговая ведомость»: выбор групп, автооценки по заездам, ручная правка, Word и печать.
import { h, toast, download, emptyState, aggBadge } from '../core/ui.js';
import { getState, update, allGroups, viewedAgg, activeAgg, isViewingArchive } from '../core/store.js';
import { go } from '../core/router.js';
import { buildRows, buildVedomostDocx, NA, SHIFTS } from '../exporters/vedomost.js';

const DEFAULT_HEADER = {
  org: 'ГОСУДАРСТВЕННОЕ АВТОНОМНОЕ УЧРЕЖДЕНИЕ ДОПОЛНИТЕЛЬНОГО ПРОФЕССИОНАЛЬНОГО ОБРАЗОВАНИЯ «АМУРСКИЙ ОБЛАСТНОЙ ИНСТИТУТ РАЗВИТИЯ ОБРАЗОВАНИЯ» (ГАУ ДПО «АмИРО»)',
  tech: 'Мобильный технопарк «КВАНТОРИУМ-28»',
  program: 'по ДООП «Робототехника/3D-моделирование», предмет Труд (технология), модуль «Робототехника», «3D-моделирование, прототипирование, макетирование»',
  place: '',
  period: '',
  teacher: '',
};

const MARK_OPTIONS = ['', '5', '4', '3', '2', NA];

export function render(root) {
  const wrap = h('div', {});
  root.append(wrap);

  function header() {
    const st = getState();
    return { ...DEFAULT_HEADER, teacher: st.plan?.teacher || '', ...(viewedAgg(st).vedomostHeader || {}) };
  }

  function selectedGroups(agg) {
    const sel = agg.vedomostGroups || [];
    const codeOf = (groupId) => Object.entries(agg.mapping || {}).find(([, m]) => m?.groupId === groupId)?.[0] || '';
    return allGroups(agg)
      .filter(g => sel.includes(g.group.id))
      .map(g => ({ ...g, code: codeOf(g.group.id) || `${g.subject.title} · ${g.group.name}` }));
  }

  function redraw() {
    const st = getState();
    const agg = viewedAgg(st);
    const readOnly = isViewingArchive(st);
    wrap.innerHTML = '';

    if (!agg.students?.subjects?.length) {
      wrap.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Итоговая ведомость', aggBadge(agg, readOnly)))));
      wrap.append(h('div', { class: 'card' }, emptyState('📋', 'Сначала импортируйте список обучающихся.',
        readOnly ? null : h('button', { class: 'btn primary', onClick: () => go('data') }, 'Перейти к импорту'))));
      return;
    }

    const hd = header();
    const groups = selectedGroups(agg);
    const sections = buildRows(agg, groups);

    wrap.append(h('div', { class: 'page-head no-print' },
      h('div', {},
        h('h1', {}, 'Итоговая ведомость', aggBadge(agg, readOnly)),
        h('p', {}, 'Оценка за заезд — округлённый средний балл из журнала; «н/а», если оценок за заезд нет. Любую ячейку можно поправить вручную.')),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn', onClick: () => go('journal') }, '← К журналу'),
        h('button', { class: 'btn', onClick: () => window.print() }, '🖨 Печать'),
        h('button', { class: 'btn primary', onClick: () => exportDocx(hd, sections) }, '⤓ Скачать Word'),
      )));

    wrap.append(headerCard(hd, redraw, readOnly));
    wrap.append(groupsCard(agg, redraw, readOnly));

    if (!sections.length) {
      wrap.append(h('div', { class: 'card' }, emptyState('👥', 'Выберите группы, которые войдут в ведомость.')));
      return;
    }
    wrap.append(previewCard(hd, sections, redraw, readOnly));
  }

  async function exportDocx(hd, sections) {
    if (!sections.length) return toast('Не выбрана ни одна группа', 'err');
    try {
      const blob = await buildVedomostDocx(hd, sections);
      const name = `Итоговая ведомость${hd.place ? ' ' + hd.place.replace(/[\\/:*?"<>|]/g, '') : ''}.docx`;
      download(name, blob);
      toast('Ведомость выгружена в Word');
    } catch (e) { console.error(e); toast('Ошибка выгрузки: ' + e.message, 'err'); }
  }

  redraw();
}

function headerCard(hd, redraw, readOnly) {
  const set = (key) => (e) => update(x => {
    const a = activeAgg(x);
    a.vedomostHeader = { ...(a.vedomostHeader || {}), [key]: e.target.value };
  });
  const fld = (label, key, area) => h('label', { class: 'field' }, h('span', {}, label),
    area ? h('textarea', { rows: area, disabled: readOnly, onChange: set(key) }, hd[key])
         : h('input', { type: 'text', value: hd[key], disabled: readOnly, onChange: set(key) }));

  return h('details', { class: 'acc no-print', style: { marginBottom: '16px' }, open: !hd.place },
    h('summary', {}, 'Шапка ведомости'),
    h('div', { class: 'acc-body' },
      fld('Организация', 'org', 3),
      h('div', { style: { height: '10px' } }),
      h('div', { class: 'row' }, fld('Технопарк', 'tech'), fld('Педагог', 'teacher')),
      h('div', { style: { height: '10px' } }),
      fld('Программа / предмет / модуль', 'program', 2),
      h('div', { style: { height: '10px' } }),
      h('div', { class: 'row' },
        fld('Агломерация (населённый пункт)', 'place'),
        fld('Период (например 24.02.2026 - 30.04.2026)', 'period')),
      readOnly ? null : h('div', { style: { marginTop: '12px' } },
        h('button', { class: 'btn sm', onClick: () => { update(x => { activeAgg(x).vedomostHeader = {}; }); redraw(); } }, '↺ Вернуть значения по умолчанию'))));
}

function groupsCard(agg, redraw, readOnly) {
  const sel = agg.vedomostGroups || [];
  const all = allGroups(agg);
  const codeOf = (groupId) => Object.entries(agg.mapping || {}).find(([, m]) => m?.groupId === groupId)?.[0] || '';

  const toggle = (id) => update(x => {
    const a = activeAgg(x);
    const cur = new Set(a.vedomostGroups || []);
    cur.has(id) ? cur.delete(id) : cur.add(id);
    a.vedomostGroups = all.filter(g => cur.has(g.group.id)).map(g => g.group.id);
  });

  const bySubject = new Map();
  for (const g of all) {
    if (!bySubject.has(g.subject.id)) bySubject.set(g.subject.id, { subject: g.subject, groups: [] });
    bySubject.get(g.subject.id).groups.push(g);
  }

  const body = h('div', {});
  for (const { subject, groups } of bySubject.values()) {
    body.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', margin: '10px 0 6px' } },
      h('b', { style: { fontSize: '13px' } }, subject.title),
      readOnly ? null : h('button', {
        class: 'btn sm ghost',
        onClick: () => { update(x => { const a = activeAgg(x); const cur = new Set(a.vedomostGroups || []); groups.forEach(g => cur.add(g.group.id)); a.vedomostGroups = all.filter(g => cur.has(g.group.id)).map(g => g.group.id); }); redraw(); }
      }, 'выбрать все')));
    body.append(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
      ...groups.map(g => h('button', {
        class: 'tab' + (sel.includes(g.group.id) ? ' active' : ''),
        disabled: readOnly,
        onClick: () => { toggle(g.group.id); redraw(); }
      }, codeOf(g.group.id) || g.group.name, h('span', { class: 'badge' }, g.group.students.length)))));
  }

  return h('div', { class: 'card no-print', style: { marginBottom: '16px' } },
    h('h3', {}, 'Группы в ведомости ', h('span', { class: 'hint' }, `выбрано: ${sel.length}`)),
    h('div', { class: 'card-sub' }, 'Названия секций берутся из кодов расписания, если группа с ним сопоставлена.'),
    body,
    (sel.length && !readOnly) ? h('div', { style: { marginTop: '12px' } },
      h('button', { class: 'btn sm danger ghost', onClick: () => { update(x => { activeAgg(x).vedomostGroups = []; }); redraw(); } }, 'Снять выбор')) : null);
}

function previewCard(hd, sections, redraw, readOnly) {
  const st = viewedAgg(getState());
  const rows = [];
  for (const sec of sections) {
    rows.push(h('tr', { class: 'sec' }, h('td', { colspan: 6 }, h('b', {}, sec.code))));
    for (const r of sec.students) {
      const cells = SHIFTS.map((sh, i) => {
        const ov = (st.vedomostMarks || {})[r.student.id] || {};
        const auto = ov[sh] === undefined;
        return h('td', { class: 'num' }, h('select', {
          class: 'mark-sel' + (auto ? '' : ' edited'), disabled: readOnly,
          onChange: (e) => {
            update(x => {
              const a = activeAgg(x);
              a.vedomostMarks = a.vedomostMarks || {};
              const m = a.vedomostMarks[r.student.id] = a.vedomostMarks[r.student.id] || {};
              if (e.target.value === '') delete m[sh]; else m[sh] = e.target.value;
            });
            redraw();
          }
        }, ...MARK_OPTIONS.map(v => h('option', { value: v, selected: !auto && ov[sh] === v },
          v === '' ? `авто (${r.marks[i]})` : v))));
      });
      const ovF = ((st.vedomostMarks || {})[r.student.id] || {}).final;
      rows.push(h('tr', {},
        h('td', { class: 'num muted' }, r.no),
        h('td', {}, r.name),
        ...cells,
        h('td', { class: 'num' }, h('select', {
          class: 'mark-sel final' + (ovF === undefined ? '' : ' edited'), disabled: readOnly,
          onChange: (e) => {
            update(x => {
              const a = activeAgg(x);
              a.vedomostMarks = a.vedomostMarks || {};
              const m = a.vedomostMarks[r.student.id] = a.vedomostMarks[r.student.id] || {};
              if (e.target.value === '') delete m.final; else m.final = e.target.value;
            });
            redraw();
          }
        }, ...MARK_OPTIONS.map(v => h('option', { value: v, selected: ovF === v },
          v === '' ? `авто (${r.final})` : v)))),
      ));
    }
  }

  const print = h('div', { class: 'print-only vedomost-print' },
    h('p', { class: 'v-org' }, hd.org),
    h('p', { class: 'v-tech' }, hd.tech),
    h('h2', {}, 'Итоговая ведомость'),
    hd.program ? h('p', { class: 'v-prog' }, hd.program) : null,
    (hd.place || hd.period) ? h('p', { class: 'v-place' }, `агломерация  ${hd.place}  ${hd.period ? '(' + hd.period + ')' : ''}`) : null,
    ...sections.map(sec => h('table', { class: 'v-table' },
      h('thead', {}, h('tr', {}, h('th', {}, '№ п/п'), h('th', {}, 'Фамилии, имена'),
        h('th', {}, '1 заезд'), h('th', {}, '2 заезд'), h('th', {}, '3 заезд'), h('th', {}, 'итоговая'))),
      h('tbody', {},
        h('tr', {}, h('td', { colspan: 6, style: { textAlign: 'center', fontWeight: '700' } }, sec.code)),
        ...sec.students.map(r => h('tr', {},
          h('td', { style: { textAlign: 'center' } }, r.no), h('td', {}, r.name),
          ...r.marks.map(m => h('td', { style: { textAlign: 'center' } }, m)),
          h('td', { style: { textAlign: 'center', fontWeight: '700' } }, r.final)))))),
    h('p', { class: 'v-sign' }, `Педагог: ${hd.teacher}         подпись/_________________`));

  return h('div', { class: 'card' },
    h('h3', { class: 'no-print' }, 'Предпросмотр и правка оценок'),
    h('div', { class: 'card-sub no-print' }, 'В выпадающем списке «авто (…)» — расчёт из журнала; выберите другое значение, чтобы поставить оценку вручную.'),
    h('div', { class: 'table-wrap no-print' },
      h('table', { class: 'compact vedomost' },
        h('thead', {}, h('tr', {},
          h('th', { class: 'num' }, '№'), h('th', {}, 'Фамилия Имя'),
          h('th', { class: 'num' }, '1 заезд'), h('th', { class: 'num' }, '2 заезд'),
          h('th', { class: 'num' }, '3 заезд'), h('th', { class: 'num' }, 'Итоговая'))),
        h('tbody', {}, ...rows))),
    print);
}
