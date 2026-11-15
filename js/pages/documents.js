// «Документы» — всё, что педагог формирует на выход: ведомости, справки,
// расписания. Каждый документ — карточка; готовые открываются, будущие
// помечены «скоро», чтобы было видно, что здесь появится.
import { h } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { getState, viewedAgg } from '../core/store.js';
import { go } from '../core/router.js';
import { openVedomostDo } from './vedomost-do.js';
import { openScheduleGenerator } from './schedule-gen.js';
import { openMkCert } from './mk-cert.js';

export function render(root) {
  const agg = viewedAgg(getState());
  const vedGroups = (agg.vedomostGroups || []).length;
  const hasStudents = !!agg.students?.subjects?.length;
  const doGroups = (agg.enroll?.groups || []).filter(g => g.students?.length).length;

  const DOCS = [
    {
      icon: 'sheet', title: 'Итоговая ведомость (сетевые группы)',
      text: 'Оценки за три заезда и итоговая по выбранным группам — автоматически из журнала, с ручной правкой. Выгрузка в Word по форме технопарка и печать.',
      status: hasStudents ? (vedGroups ? `групп в ведомости: ${vedGroups}` : 'группы ещё не выбраны') : 'нужен список обучающихся',
      ready: true, open: () => go('vedomost'),
    },
    {
      icon: 'sheet', title: 'Ведомость групп ДО (Excel)',
      text: 'Итоговый контроль групп дополнительного образования по форме технопарка: каждая группа «Набора» на своём листе, баллы по семи компетенциям раздаются в заданном диапазоне.',
      status: doGroups ? `групп «Набора»: ${doGroups}` : 'нужны группы в «Наборе»',
      ready: true, open: () => openVedomostDo(),
    },
    {
      icon: 'calendar', title: 'Расписание занятий',
      text: 'Расписание заезда в стиле образца: уроки по часам КТП блоками по 2–3, с шапкой «Согласовано» для школы. Перед скачиванием — редактируемый предпросмотр.',
      status: 'Word (.docx)', ready: true, open: () => openScheduleGenerator(),
    },
    {
      icon: 'award', title: 'Информационная справка о мастер-классе',
      text: 'Для методиста: название, цель и аннотацию заполнит ИИ (из чата «Помощника» или по теме), даты и время сайт подберёт по расписанию заезда после ваших уроков.',
      status: 'Word (.docx)', ready: true, open: () => openMkCert(),
    },
    {
      icon: 'award', title: 'Справка о проведении мастер-класса (для школы)',
      text: 'Справка по шаблону организации: дата, тема, место, число участников — заполняется из ваших данных и сразу уходит в Word.',
      status: 'появится после загрузки шаблона', ready: false,
    },
  ];

  root.append(h('div', { class: 'page-head' },
    h('div', {},
      h('h1', {}, 'Документы'),
      h('p', {}, 'Всё, что формируется на выход: ведомости, справки, расписания.'))));

  root.append(h('div', { class: 'doc-grid' }, ...DOCS.map(d => h(d.ready ? 'button' : 'div', {
    class: 'card doc-card' + (d.ready ? '' : ' soon'),
    type: d.ready ? 'button' : null,
    onClick: d.ready ? d.open : null,
  },
    h('div', { class: 'doc-ico' }, icon(d.icon, 22)),
    h('div', { class: 'doc-body' },
      h('div', { class: 'doc-title' }, d.title, d.ready ? null : h('span', { class: 'pill' }, 'скоро')),
      h('p', {}, d.text),
      h('div', { class: 'doc-status' + (d.ready ? '' : ' muted') }, d.status)),
    d.ready ? h('span', { class: 'doc-go' }, icon('chevron', 18)) : null))));
}
