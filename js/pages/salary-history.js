// «История зарплат»: архив по сохранённым расчётам — годы колонками, внутри
// 12 месяцев с суммой на руки. Клик по месяцу открывает модалку с полной
// раскладкой (те же карточки, что и на вкладке расчёта), выгрузку в Word
// и точную печатную копию официального расчётного листка (печать / PDF).
import { icon } from '../core/icons.js';
import { h, carousel, money0, toast, download, confirmBox, modal, MONTHS, emptyState, printElement, switchToggle } from '../core/ui.js';
import { getState, update } from '../core/store.js';
import { comparisonCard, detailTableCard, applyBonus, RATE_LABELS } from './salary.js';
import { buildPayslipDocx } from '../exporters/payslip.js';
import { payslipPrintNode } from '../exporters/payslip-print.js';
import { go } from '../core/router.js';
import { accountName } from '../core/cloud.js';

const findEntry = (history, year, month) => history.find(h => h.year === year && h.month === month) || null;

/** ГПХ месяца: в истории хранятся официальные суммы (по ним считаются
 *  отпускные), а договор ГПХ включается тумблером и только добавляется к
 *  «получено всего». По умолчанию — как было сохранено в расчёте. */
export function gphOf(e) {
  const on = e.gphOn ?? !!e.params?.hasGph;
  const amount = Number(e.gphAmount ?? e.params?.gph ?? 0) || 0;
  const ndfl = Number(e.params?.ndfl ?? 13);
  return { on, amount, net: on ? amount * (1 - ndfl / 100) : 0 };
}
/** Всего получено за месяц: зарплата по ставке (с премией) + ГПХ, если включён. */
export const receivedOf = (e) => (Number(e.net) || 0) + gphOf(e).net;

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
      wrap.append(h('div', { class: 'card' }, emptyState(icon('history', 34),
        'Пока ничего не сохранено. Посчитайте месяц на вкладке «Расчёт по месяцам» и нажмите «Сохранить расчёт».',
        h('button', { class: 'btn primary', onClick: () => { update(x => { x.ui.salaryTab = 'calc'; }); go('salary'); } }, 'К расчёту зарплаты'))));
      return;
    }

    wrap.append(chartCard(s.history, years));

    // на компьютере — колонки годов в ряд, на телефоне — карусель по году (с последнего)
    wrap.append(carousel(years.map(y => yearColumn(y, s, redraw)), { trackClass: 'scroll-x year-row', start: years.length - 1 }));
  }

  function yearColumn(year, s, redraw) {
    const rows = [];
    let filled = 0, total = 0;
    for (let m = 1; m <= 12; m++) {
      const entry = findEntry(s.history, year, m);
      const g = entry ? gphOf(entry) : null;
      if (entry) { filled++; total += receivedOf(entry); }
      rows.push(h('div', {
        class: 'kv' + (entry ? ' month-row clickable' : ' month-row') + (g?.on ? ' gph' : ''),
        title: g?.on ? `ставка ${money0(entry.net)} + ГПХ ${money0(g.net)}` : null,
        onClick: entry ? () => openMonth(entry, redraw) : null,
      },
        h('span', { class: 'k' }, MONTHS[m - 1], g?.on ? h('span', { class: 'gph-tag' }, '+ГПХ') : null),
        h('span', { class: entry ? 'v' : 'v muted' }, entry ? money0(receivedOf(entry)) : '—')));
    }
    return h('div', { class: 'card year-col' },
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
    const rateLabel = RATE_LABELS[rate] || RATE_LABELS[1];

    const body = h('div', {});
    body.append(h('div', { class: 'grid cols-3', style: { marginBottom: '16px' } },
      h('div', { class: 'card' }, h('div', { class: 'stat' },
        h('div', { class: 'label' }, `На руки (${rateLabel})`),
        h('div', { class: 'value' }, money0(one.net)),
        h('div', { class: 'sub' }, `до НДФЛ ${money0(one.gross)}${bonus.amount ? ` · включая премию ${money0(bonus.amount)}` : ''}`))),
      gphTile(entry, outerRedraw, openMonth),
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
      }, icon('printer', 16), 'Печать / PDF (как оригинал)'),
      h('button', {
        class: 'btn', onClick: async () => {
          try {
            const blob = await buildPayslipDocx(entry, requisites);
            download(`Расчётный_листок_${MONTHS[entry.month - 1]}_${entry.year}.docx`, blob);
            toast('Расчётный листок выгружен');
          } catch (e) { console.error(e); toast('Ошибка выгрузки: ' + e.message, 'err'); }
        }
      }, icon('download', 16), 'Word (редактируемый)'),
      h('button', {
        class: 'btn', onClick: () => {
          update(x => {
            Object.assign(x.salary, entry.params, { partialMonth: entry.params.factDays != null, year: entry.year, month: entry.month });
            x.ui.salaryTab = 'calc';
          });
          go('salary');
        }
      }, icon('pen', 16), 'Открыть в расчёте'),
      h('button', {
        class: 'btn danger ghost', onClick: () => confirmBox(`Удалить сохранённый расчёт за ${MONTHS[entry.month - 1]} ${entry.year}?`, () => {
          update(x => { x.salary.history = x.salary.history.filter(h => h.id !== entry.id); });
          document.querySelector('.modal-back')?.remove();
          toast('Запись удалена'); outerRedraw();
        })
      }, icon('trash', 16), 'Удалить'),
    ));

    modal({ wide: true, title: `${MONTHS[entry.month - 1]} ${entry.year}`, body, okText: null, cancelText: 'Закрыть' });
  }
}

/** Плитка «Договор ГПХ» в окне месяца: тумблер и сумма. ГПХ добавляется к
 *  «получено всего» и графику, но не к сумме для отпускных. */
function gphTile(entry, outerRedraw, openMonth) {
  const g = gphOf(entry);
  const reopen = () => {
    document.querySelector('.modal-back')?.remove();
    outerRedraw();
    const fresh = findEntry(getState().salary.history, entry.year, entry.month);
    if (fresh) openMonth(fresh, outerRedraw);
  };
  const set = (patch) => { update(x => { const e = x.salary.history.find(z => z.id === entry.id); if (e) Object.assign(e, patch); }); reopen(); };
  const amount = h('input', {
    type: 'text', inputmode: 'decimal', value: String(g.amount || getState().salary.gph || ''), style: { maxWidth: '140px' },
    onChange: (e) => { const v = parseFloat(String(e.target.value).replace(/\s/g, '').replace(',', '.')) || 0; set({ gphAmount: v }); },
  });
  return h('div', { class: 'card' + (g.on ? ' gph-card' : '') }, h('div', { class: 'stat' },
    h('div', { class: 'label', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
      'Договор ГПХ',
      switchToggle(g.on, '', (v) => set({ gphOn: v, gphAmount: g.amount || getState().salary.gph || 0 }), { title: 'ГПХ в этом месяце' })),
    g.on
      ? [h('div', { class: 'value' }, money0(receivedOf(entry))),
         h('div', { class: 'sub' }, `получено всего · ГПХ после НДФЛ ${money0(g.net)}`),
         h('label', { class: 'field', style: { marginTop: '6px' } }, h('span', {}, 'ГПХ начислено, ₽'), amount)]
      : [h('div', { class: 'value muted' }, 'не было'),
         h('div', { class: 'sub' }, 'включите, если в этом месяце был договор ГПХ — сумма прибавится к «получено», но не к отпускным')]));
}

/** График «Получено за год»: столбик на месяц — зарплата по ставке и сверху
 *  ГПХ (штриховкой), если он был включён. */
function chartCard(history, years) {
  let year = years[years.length - 1];
  const card = h('div', { class: 'card', style: { marginBottom: '16px' } });
  const draw = () => {
    const months = Array.from({ length: 12 }, (_, i) => {
      const e = findEntry(history, year, i + 1);
      const g = e ? gphOf(e) : null;
      return { m: i + 1, e, base: e ? Number(e.net) || 0 : 0, gph: g?.net || 0 };
    });
    const max = Math.max(1, ...months.map(x => x.base + x.gph));
    // шаг сетки — круглое число
    const step = [5000, 10000, 20000, 25000, 50000].find(v => max / v <= 5) || 100000;
    const top = Math.ceil(max / step) * step;
    const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
    const sum = months.reduce((a, x) => a + x.base + x.gph, 0);
    const sumG = months.reduce((a, x) => a + x.gph, 0);
    const filled = months.filter(x => x.e).length;
    const tip = h('div', { class: 'chart-tip', role: 'status' });
    card.replaceChildren(
      h('div', { class: 'card-head' },
        h('div', {},
          h('h3', {}, 'Получено за год'),
          h('div', { class: 'card-sub' }, filled
            ? `${money0(sum)} за ${filled} мес.${sumG ? ` · из них ГПХ ${money0(sumG)}` : ''} · в среднем ${money0(sum / filled)} в месяц`
            : 'За этот год расчётов нет')),
        years.length > 1 ? h('div', { class: 'tabs' }, ...years.map(y => h('button', {
          type: 'button', class: 'tab' + (y === year ? ' active' : ''), onClick: () => { year = y; draw(); },
        }, String(y)))) : null),
      h('div', { class: 'chart-legend' },
        h('span', {}, h('i', { class: 'lg base' }), 'Зарплата по ставке'),
        h('span', {}, h('i', { class: 'lg gph' }), 'ГПХ')),
      h('div', { class: 'chart' },
        h('div', { class: 'chart-grid' }, ...ticks.map(t => h('div', { class: 'chart-tick', style: { bottom: `${t / top * 100}%` } },
          h('span', {}, t ? `${Math.round(t / 1000)} тыс.` : '0')))),
        h('div', { class: 'chart-bars' }, ...months.map(x => {
          const col = h('div', {
            class: 'chart-col' + (x.e ? '' : ' empty'), tabindex: x.e ? '0' : null,
            'aria-label': x.e ? `${MONTHS[x.m - 1]}: ${money0(x.base + x.gph)}` : `${MONTHS[x.m - 1]}: нет расчёта`,
          },
            h('div', { class: 'chart-stack', style: { height: `${(x.base + x.gph) / top * 100}%` } },
              x.gph ? h('div', { class: 'seg gph', style: { flex: `${x.gph} 0 0` } }) : null,
              x.base ? h('div', { class: 'seg base', style: { flex: `${x.base} 0 0` } }) : null),
            h('span', { class: 'chart-x' }, MONTHS[x.m - 1].slice(0, 3)));
          const show = () => {
            if (!x.e) { tip.hidden = true; return; }
            tip.hidden = false;
            tip.replaceChildren(h('b', {}, `${MONTHS[x.m - 1]} ${year}`),
              h('div', {}, h('i', { class: 'lg base' }), `ставка ${money0(x.base)}`),
              x.gph ? h('div', {}, h('i', { class: 'lg gph' }), `ГПХ ${money0(x.gph)}`) : null,
              h('div', { class: 'tip-total' }, `всего ${money0(x.base + x.gph)}`));
            const r = col.getBoundingClientRect(), pr = col.parentElement.parentElement.getBoundingClientRect();
            // сбоку от столбика, чтобы не закрывать его
            const x0 = r.left - pr.left;
            tip.style.left = `${x0 + r.width + 168 <= pr.width ? x0 + r.width + 6 : Math.max(0, x0 - 166)}px`;
          };
          col.addEventListener('pointerenter', show);
          col.addEventListener('focus', show);
          col.addEventListener('pointerleave', () => { tip.hidden = true; });
          col.addEventListener('blur', () => { tip.hidden = true; });
          return col;
        })),
        tip));
    tip.hidden = true;
  };
  draw();
  return card;
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
    h('h3', {}, icon('gift', 16), 'Премия / разовая доплата', h('span', { class: 'hint' }, ' — не входит в формулу расчёта')),
    h('div', { class: 'card-sub' }, 'Прибавляется к начислению этого месяца и облагается тем же НДФЛ — учитывается в сумме «на руки», сравнении форматов, расчётном листке и на вкладке «Отпускные».'),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Сумма премии, ₽'), amountInput),
      h('label', { class: 'field' }, h('span', {}, 'Комментарий'), noteInput),
      h('button', { class: 'btn primary fixed', onClick: save }, icon('save', 16), 'Сохранить')),
    bonus.amount ? h('p', { class: 'muted', style: { fontSize: '12.5px', marginTop: '10px', marginBottom: 0 } },
      `Сейчас учтено: +${money0(bonus.amount)} (${money0(bonus.amount * (1 - entry.params.ndfl / 100))} на руки после НДФЛ).`) : null);
}

function requisitesCard(redraw) {
  const st = getState();
  const r = st.salary.requisites || {};
  const fioValue = r.fio || st.plan?.teacher || accountName();

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
