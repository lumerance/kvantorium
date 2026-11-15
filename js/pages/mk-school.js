// Справка о проведении мастер-классов для школы (письмо от школы ректору).
// Ваши часы считаются сами — по информационным справкам о МК, оформленным
// за выбранный заезд; часы других педагогов и число детей вписываются.
// Адресат, обращение, номер МТ и коллеги запоминаются.
import { h, toast, modal, download } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { getState, update, activeAgg } from '../core/store.js';
import { accountName } from '../core/cloud.js';
import { placeOfAgg } from '../data/places.js';
import { buildMkSchoolDocx } from '../exporters/mk-school-docx.js';

const short = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;
/** «Иванов Иван Иванович» -> «Иванов И.И.» */
const initials = (fio) => { const [l, f, m] = String(fio || '').trim().split(/\s+/); return l ? `${l} ${f ? f[0] + '.' : ''}${m ? m[0] + '.' : ''}`.trim() : ''; };
const ageRange = (certs) => {
  const nums = certs.flatMap(c => String(c.age || '').match(/\d+/g) || []).map(Number).filter(n => n > 3 && n < 25);
  return nums.length ? [Math.min(...nums), Math.max(...nums)] : [8, 17];
};

export function openMkSchool() {
  const st = getState();
  const agg = activeAgg(st);
  const place = placeOfAgg(agg);
  const school = (st.scheduleGen?.schools || {})[place || '_'] || {};
  const prof = st.mkSchool || {};
  const fio = st.salary?.requisites?.fio || st.plan?.teacher || accountName();
  const loaded = ['1', '2', '3'].filter(s => agg.schedules?.[s]?.dates?.length);

  const f = {
    shift: loaded.at(-1) || '1',
    rectorPost: prof.rectorPost || 'Ректору',
    rectorOrg: prof.rectorOrg || 'ГАУ ДПО «АмИРО»',
    rectorName: prof.rectorName || '',
    greeting: prof.greeting || '',
    mtNo: prof.mtNo || '',
    school: school.name ? school.name.replace(/^[А-ЯЁ]{3,6}\s+(?=«)/, '') : '',
    directorName: school.director || '',
    executor: initials(fio),
    children: '', pages: '',
    others: (prof.others || []).map(o => ({ name: o, hours: '' })),
    ageFrom: '', ageTo: '',
    myHours: 0, period: '', picked: new Set(),
  };

  const range = () => {
    const sc = agg.schedules?.[f.shift];
    return sc?.dates?.length ? [sc.dates[0], sc.dates.at(-1)] : null;
  };
  /** Справки о МК, проведённых в этом заезде. */
  const certsInShift = () => {
    const r = range();
    return (getState().mkCerts || []).filter(c => !r || c.sessions.some(s => s.date >= r[0] && s.date <= r[1]));
  };
  function recalc(resetPick = false) {
    const certs = certsInShift();
    if (resetPick) f.picked = new Set(certs.map(c => c.id));
    const chosen = certs.filter(c => f.picked.has(c.id));
    const r = range();
    const sessions = chosen.flatMap(c => c.sessions.filter(s => !r || (s.date >= r[0] && s.date <= r[1])).map(s => ({ ...s, len: c.len || 1 })));
    f.myHours = sessions.reduce((a, s) => a + s.len, 0);
    const dates = sessions.map(s => s.date).sort();
    f.period = dates.length ? (dates[0] === dates.at(-1) ? short(dates[0]) : `${short(dates[0])}-${short(dates.at(-1))}`) : (r ? `${short(r[0])}-${short(r[1])}` : '');
    const [a, b] = ageRange(chosen);
    if (resetPick || !f.ageFrom) { f.ageFrom = String(a); f.ageTo = String(b); }
  }
  recalc(true);

  const body = h('div', { class: 'mkc' });
  const inp = (key, ph, extra = {}) => h('input', { type: 'text', value: f[key], placeholder: ph || '', ...extra, onInput: (e) => { f[key] = e.target.value; } });
  const field = (label, key, ph, extra) => h('label', { class: 'field' }, h('span', {}, label), inp(key, ph, extra));

  function draw() {
    const certs = certsInShift();
    body.replaceChildren(...[
      h('p', { class: 'muted', style: { marginTop: 0, fontSize: '13px' } },
        'Письмо от школы ректору о проведённых мастер-классах. Слева сверху остаётся место под бланк школы — у каждой своя шапка. Ваши часы считаются по информационным справкам о МК за выбранный заезд.'),

      h('h4', { class: 'sg-h' }, 'Мастер-классы'),
      loaded.length ? h('label', { class: 'field', style: { maxWidth: '320px' } }, h('span', {}, 'Заезд'),
        h('select', { onChange: (e) => { f.shift = e.target.value; recalc(true); draw(); } },
          ...loaded.map(s => h('option', { value: s, selected: s === f.shift }, `${s} заезд · ${short(agg.schedules[s].dates[0])}–${short(agg.schedules[s].dates.at(-1))}`)))) : null,
      certs.length
        ? h('div', { class: 'mkc-cands', style: { marginTop: '10px' } }, ...certs.map(c => h('label', { class: 'check-pill' + (f.picked.has(c.id) ? ' on' : '') },
            h('input', { type: 'checkbox', checked: f.picked.has(c.id), style: { width: 'auto', margin: 0 }, onChange: (e) => { e.target.checked ? f.picked.add(c.id) : f.picked.delete(c.id); recalc(); draw(); } }),
            h('span', {}, `«${c.title}» · ${c.sessions.length}×${c.len || 1} ч`))))
        : h('p', { class: 'sg-issues' }, icon('alert', 15), 'За этот заезд нет информационных справок о МК — ваши часы впишите вручную.'),

      h('h4', { class: 'sg-h', style: { marginTop: '16px' } }, 'Педагоги и часы'),
      h('div', { class: 'mks-teacher' }, h('span', {}, fio || 'Вы'),
        h('input', { type: 'text', inputmode: 'numeric', value: String(f.myHours), onInput: (e) => { f.myHours = Number(e.target.value) || 0; } }), h('span', { class: 'muted' }, 'ч')),
      ...f.others.map((o, i) => h('div', { class: 'mks-teacher' },
        h('input', { type: 'text', value: o.name, placeholder: 'Фамилия Имя Отчество', onInput: (e) => { o.name = e.target.value; } }),
        h('input', { type: 'text', inputmode: 'numeric', value: o.hours, placeholder: '0', onInput: (e) => { o.hours = e.target.value; } }),
        h('button', { type: 'button', class: 'btn sm ghost icon-btn', title: 'Убрать', 'aria-label': 'Убрать педагога', onClick: () => { f.others.splice(i, 1); draw(); } }, icon('x', 14)))),
      h('button', { type: 'button', class: 'btn sm ghost', onClick: () => { f.others.push({ name: '', hours: '' }); draw(); } }, icon('plus', 14), 'Добавить педагога'),

      h('div', { class: 'row', style: { marginTop: '14px' } },
        field('Период', 'period', '15.10.26-17.10.26'),
        field('Возраст от', 'ageFrom', '8', { inputmode: 'numeric' }),
        field('до', 'ageTo', '17', { inputmode: 'numeric' }),
        field('Детей всего', 'children', '0', { inputmode: 'numeric' }),
        field('Приложение, листов', 'pages', 'нет', { inputmode: 'numeric' })),

      h('details', { class: 'acc', style: { marginTop: '16px' }, open: !f.rectorName || !f.school || null },
        h('summary', {}, 'Адресат, школа, подписи'),
        h('div', { class: 'acc-body' },
          h('div', { class: 'row' }, field('Кому (должность)', 'rectorPost'), field('Организация', 'rectorOrg'), field('ФИО', 'rectorName', 'И. О. Фамилия')),
          h('div', { style: { height: '8px' } }),
          h('div', { class: 'row' }, field('Обращение', 'greeting', 'Уважаемый(ая) Имя Отчество!'), field('Номер МТ', 'mtNo', 'например: 2')),
          h('div', { style: { height: '8px' } }),
          h('div', { class: 'row' }, field('Школа (в тексте)', 'school', '«Увальская СОШ»'), field('Директор (И. О. Фамилия)', 'directorName'), field('Исполнитель', 'executor'))),
      ),
    ].filter(Boolean));
  }
  draw();

  modal({
    wide: true,
    title: [icon('award', 18), ' Справка о мастер-классах для школы'],
    body,
    okText: 'Скачать Word',
    onOk: () => {
      const teachers = [{ name: fio, hours: f.myHours }, ...f.others.map(o => ({ name: o.name.trim(), hours: Number(o.hours) || 0 }))];
      if (!teachers.some(t => t.hours > 0)) { toast('Укажите часы хотя бы у одного педагога', 'err'); return false; }
      update(x => {
        x.mkSchool = { rectorPost: f.rectorPost, rectorOrg: f.rectorOrg, rectorName: f.rectorName, greeting: f.greeting, mtNo: f.mtNo, others: f.others.map(o => o.name.trim()).filter(Boolean) };
      });
      buildMkSchoolDocx({
        to: [f.rectorPost, f.rectorOrg, f.rectorName].filter(Boolean), greeting: f.greeting, school: f.school, period: f.period,
        ageFrom: f.ageFrom, ageTo: f.ageTo, mtNo: f.mtNo, teachers, children: f.children, pages: f.pages,
        directorName: f.directorName, executor: f.executor,
      }).then(blob => { download(`Справка МК для школы ${f.period}.docx`, blob); toast('Справка для школы скачана'); })
        .catch(e => { console.error(e); toast('Ошибка выгрузки: ' + e.message, 'err'); });
    },
  });
}
