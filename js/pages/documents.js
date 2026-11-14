// «Документы» — всё, что педагог формирует на выход: ведомости, справки,
// расписания. Каждый документ — карточка; готовые открываются, будущие
// помечены «скоро», чтобы было видно, что здесь появится.
import { h } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { getState, viewedAgg } from '../core/store.js';
import { go } from '../core/router.js';

export function render(root) {
  const agg = viewedAgg(getState());
  const vedGroups = (agg.vedomostGroups || []).length;
  const hasStudents = !!agg.students?.subjects?.length;

  const DOCS = [
    {
      icon: 'sheet', title: 'Итоговая ведомость',
      text: 'Оценки за три заезда и итоговая по выбранным группам — автоматически из журнала, с ручной правкой. Выгрузка в Word по форме технопарка и печать.',
      status: hasStudents ? (vedGroups ? `групп в ведомости: ${vedGroups}` : 'группы ещё не выбраны') : 'нужен список обучающихся',
      ready: true, open: () => go('vedomost'),
    },
    {
      icon: 'award', title: 'Справка о проведении мастер-класса',
      text: 'Справка по шаблону организации: дата, тема, место, число участников — заполняется из ваших данных и сразу уходит в Word.',
      status: 'появится после загрузки шаблона', ready: false,
    },
    {
      icon: 'calendar', title: 'Расписание занятий',
      text: 'Расписание заезда в стиле образца: дни, уроки, группы и кабинеты собираются из ваших данных, остаётся проверить и распечатать.',
      status: 'в разработке', ready: false,
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
