// «История зарплат»: архив по сохранённым расчётам — годы колонками, внутри
// 12 месяцев с суммой на руки. Клик по месяцу открывает модалку с полной
// раскладкой (те же карточки, что и на вкладке расчёта), выгрузку в Word
// и точную печатную копию официального расчётного листка (печать / PDF).
import { h, money0, toast, download, confirmBox, modal, MONTHS, emptyState, printElement } from '../core/ui.js';
import { getState, update } from '../core/store.js';
import { comparisonCard, detailTableCard, applyBonus, RATE_LABELS } from './salary.js';
import { buildPayslipDocx } from '../exporters/payslip.js';
import { payslipPrintNode } from '../exporters/payslip-print.js';
import { go } from '../core/router.js';

const findEntry = (history, year, month) => history.find(h => h.year === year && h.month === month) || null;

export function render(root) {
  // no-print: печать всегда идёт через отдельный узел (printElement), эта
  // страница сама на печать не выводится.
  const wrap = h('div', { class: 'no-print' });
  root.append(wrap);
  redraw();

  function redraw() {
    const st = getState();
    const s = st.salary;
    wrap.innerHTML = '';

    wrap.append(h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'История зарплат'),
        h('p', {}, 'Архив расчётов, сохранённых на вкладке «Расчёт по месяцам». Один месяц — одна запись: повторное сохранение заменяет прежнюю.'))));

    wrap.append(requisitesCard(redraw));

    const years = [...new Set(s.history.map(h => h.year))].sort((a, b) => a - b);
    if (!years.length) {
      wrap.append(h('div', { class: 'card' }, emptyState('📜',
        'Пока ничего не сохранено. Посчитайте месяц на вкладке «Расчёт по месяцам» и нажмите «💾 Сохранить расчёт».',
        h('button', { class: 'btn primary', onClick: () => { update(x => { x.ui.salaryTab = 'calc'; }); go('salary'); } }, 'К расчёту зарплаты'))));
      return;
    }

    const grid = h('div', {
      class: 'scroll-x',
      style: { display: 'flex', gap: '14px', alignItems: 'flex-start', paddingBottom: '4px' },
    });
    for (const y of years) grid.append(yearColumn(y, s, redraw));
    wrap.append(grid);
  }

  function yearColumn(year, s, redraw) {
    const rows = [];
    let filled = 0, total = 0;
    for (let m = 1; m <= 12; m++) {
      const entry = findEntry(s.history, year, m);
      if (entry) { filled++; total += entry.net; }
      rows.push(h('div', {
        class: 'kv' + (entry ? ' month-row clickable' : ' month-row'),
        onClick: entry ? () => openMonth(entry, redraw) : null,
      },
        h('span', { class: 'k' }, MONTHS[m - 1]),
        h('span', { class: entry ? 'v' : 'v muted' }, entry ? money0(entry.net) : '—')));
    }
    return h('div', { class: 'card', style: { flex: '0 0 240px', minWidth: '240px' } },
      h('h3', {}, String(year), h('span', { class: 'hint' }, ` ${filled}/12`)),
      ...rows,
      filled ? h('div', { class: 'kv total', style: { marginTop: '8px' } },
        h('span', { class: 'k' }, 'Сумма за год'), h('span', { class: 'v' }, money0(total))) : null);
  }

  function openMonth(entry, outerRedraw) {
    const st = getState();
    const requisites = st.salary.requisites || {};
    const bonus = entry.bonus || { amount: 0, note: '' };
    const calc = applyBonus(entry.calc, bonus, entry.params.ndfl);
    // calc.current — расчёт по ставке, на которой педагог был оформлен в этом
    // месяце (params.rate); у старых записей без этого поля равносильно «1 ставка».
    const one = calc.current || calc.one;
    const rate = calc.rate ?? entry.params.rate ?? 1;
    const hasGph = calc.hasGph ?? entry.params.hasGph ?? true;
    const rateLabel = RATE_LABELS[rate] || RATE_LABELS[1];

    const body = h('div', {});
    body.append(h('div', { class: 'grid cols-3', style: { marginBottom: '16px' } },
      h('div', { class: 'card' }, h('div', { class: 'stat' },
        h('div', { class: 'label' }, `На руки (${rateLabel})`),
        h('div', { class: 'value' }, money0(one.net)),
        h('div', { class: 'sub' }, `до НДФЛ ${money0(one.gross)}${bonus.amount ? ` · включая премию ${money0(bonus.amount)}` : ''}`))),
      hasGph ? h('div', { class: 'card' }, h('div', { class: 'stat' },
        h('div', { class: 'label' }, 'С ГПХ на руки'),
        h('div', { class: 'value cyan' }, money0(calc.withGph)),
        h('div', { class: 'sub' }, `ГПХ ${money0(entry.params.gph)} · после НДФЛ ${money0(calc.gphNet)}`))) : h('div', { class: 'card' }, h('div', { class: 'stat' },
        h('div', { class: 'label' }, 'Договор ГПХ'),
        h('div', { class: 'value muted' }, 'не подключен'),
        h('div', { class: 'sub' }, 'в этом расчёте — только зарплата по ставке'))),
      h('div', { class: 'card' }, h('div', { class: 'stat' },
        h('div', { class: 'label' }, 'Отработано'),
        h('div', { class: 'value plain' }, one.partial ? `${one.fact} из ${one.norm} дн.` : `${one.norm} дн. (полный)`),
        h('div', { class: 'sub' }, `РВ: ${entry.params.rv || 0} · сохранено ${new Date(entry.savedAt || entry.id).toLocaleString('ru-RU')}`))),
    ));

    body.append(bonusCard(entry, outerRedraw, openMonth));

    body.append(comparisonCard(calc, entry.params));
    body.append(detailTableCard(calc, entry.params));

    body.append(h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '4px' } },
      h('button', {
        class: 'btn primary',
        onClick: () => printElement(payslipPrintNode(entry, requisites)),
      }, '🖨 Печать / PDF (как оригинал)'),
      h('button', {
        class: 'btn', onClick: async () => {
          try {
            const blob = await buildPayslipDocx(entry, requisites);
            download(`Расчётный_листок_${MONTHS[entry.month - 1]}_${entry.year}.docx`, blob);
            toast('Расчётный листок выгружен');
          } catch (e) { console.error(e); toast('Ошибка выгрузки: ' + e.message, 'err'); }
        }
      }, '⤓ Word (редактируемый)'),
      h('button', {
        class: 'btn', onClick: () => {
          update(x => {
            Object.assign(x.salary, entry.params, { partialMonth: entry.params.factDays != null, year: entry.year, month: entry.month });
            x.ui.salaryTab = 'calc';
          });
          go('salary');
        }
      }, '✎ Открыть в расчёте'),
      h('button', {
        class: 'btn danger ghost', onClick: () => confirmBox(`Удалить сохранённый расчёт за ${MONTHS[entry.month - 1]} ${entry.year}?`, () => {
          update(x => { x.salary.history = x.salary.history.filter(h => h.id !== entry.id); });
          document.querySelector('.modal-back')?.remove();
          toast('Запись удалена'); outerRedraw();
        })
      }, '🗑 Удалить'),
    ));

    modal({ wide: true, title: `${MONTHS[entry.month - 1]} ${entry.year}`, body, okText: null, cancelText: 'Закрыть' });
  }
}

/** Разовая премия/матпомощь поверх формулы — редактируется прямо в модалке месяца. */
function bonusCard(entry, outerRedraw, openMonth) {
  const bonus = entry.bonus || { amount: 0, note: '' };
  const amountInput = h('input', { type: 'text', inputmode: 'decimal', value: bonus.amount || '', placeholder: '0' });
  const noteInput = h('input', { type: 'text', value: bonus.note || '', placeholder: 'например: премия к юбилею лицея' });

  const save = () => {
    const amount = parseFloat(String(amountInput.value).replace(',', '.')) || 0;
    const note = noteInput.value.trim();
    update(x => {
      const e = x.salary.history.find(h => h.id === entry.id);
      if (!e) return;
      e.bonus = amount || note ? { amount, note } : null;
      // плоские поля записи (их читают сетка годов и «Заполнить из истории» на
      // вкладке «Отпускные») пересчитываются заново от исходного calc + премии,
      // без накопления — так повторное сохранение с другой суммой не задваивает.
      const calc = applyBonus(e.calc, e.bonus, e.params.ndfl);
      const cur = calc.current || calc.one;
      e.gross = cur.gross; e.net = cur.net;
      e.withGph = calc.withGph; e.oneHalf = calc.oneHalf.net; e.benefit = calc.benefit;
    });
    document.querySelector('.modal-back')?.remove();
    toast(amount ? `Премия ${money0(amount)} сохранена` : 'Премия убрана');
    const fresh = findEntry(getState().salary.history, entry.year, entry.month);
    outerRedraw();
    if (fresh) openMonth(fresh, outerRedraw);
  };

  return h('div', { class: 'card', style: { marginBottom: '16px' } },
    h('h3', {}, '💰 Премия / разовая доплата', h('span', { class: 'hint' }, ' — не входит в формулу расчёта')),
    h('div', { class: 'card-sub' }, 'Прибавляется к начислению этого месяца и облагается тем же НДФЛ — учитывается в сумме «на руки», сравнении форматов, расчётном листке и на вкладке «Отпускные».'),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Сумма премии, ₽'), amountInput),
      h('label', { class: 'field' }, h('span', {}, 'Комментарий'), noteInput),
      h('button', { class: 'btn primary fixed', onClick: save }, '💾 Сохранить')),
    bonus.amount ? h('p', { class: 'muted', style: { fontSize: '12.5px', marginTop: '10px', marginBottom: 0 } },
      `Сейчас учтено: +${money0(bonus.amount)} (${money0(bonus.amount * (1 - entry.params.ndfl / 100))} на руки после НДФЛ).`) : null);
}

function requisitesCard(redraw) {
  const st = getState();
  const r = st.salary.requisites || {};
  const fioValue = r.fio || st.plan?.teacher || '';

  const field = (label, key, value, placeholder) => h('label', { class: 'field' },
    h('span', {}, label),
    h('input', {
      type: 'text', value, placeholder,
      onChange: (e) => { update(x => { x.salary.requisites = { ...(x.salary.requisites || {}), [key]: e.target.value }; }); redraw(); },
    }));

  return h('details', { class: 'acc', style: { marginBottom: '16px' } },
    h('summary', {}, 'Реквизиты для расчётного листка'),
    h('div', { class: 'acc-body' },
      h('div', { class: 'card-sub', style: { marginTop: 0 } }, 'Подставляются в шапку выгружаемого расчётного листка — заполните один раз.'),
      h('div', { class: 'row' },
        field('Организация', 'org', r.org || ''),
        field('Подразделение', 'unit', r.unit || '')),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        field('Должность', 'position', r.position || ''),
        field('Табельный номер', 'tabNo', r.tabNo || '')),
      h('div', { style: { marginTop: '10px' } },
        field('ФИО', 'fio', fioValue, 'подставится из «Часов» (Преподаватель), если оставить пустым')),
    ));
}
