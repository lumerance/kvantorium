// «Помощник» — чат с нейросетью GigaChat (Cloud.ru, через посредника
// proxy/assistant-function.js). В одном чате — и вопросы о своих данных
// (часы, заезды, РВ, зарплата: цифры сайт считает сам и прикладывает
// сводку к каждому вопросу), и помощь с мастер-классами.
// Переписка хранится на этом устройстве (localStorage).
import { h, toast, copyText, modal } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { getState, update } from '../core/store.js';
import { cloudState } from '../core/cloud.js';
import { loginDialog } from '../core/account.js';
import { askAssistant, assistantUrl, buildSummary, usageThisMonth, usageCost, isAssistantAdmin, fetchAssistantStats, tokenCost } from '../core/assistant.js';
import { MONTHS } from '../core/ui.js';
import { openMkCert, isMkAnswer } from './mk-cert.js';
import { ASSISTANT_URL } from '../config.js';
import { extractAction, applyLogHours, undoLogHours, actionNote } from '../core/assistant-actions.js';
import { worksCatalog } from './hours.js';
import { go } from '../core/router.js';

const CHAT_KEY = 'kvantorium28.chat';
const SUGGEST = [
  'Сколько часов МК у меня осталось?',
  'Что ещё не закрыто по методическим часам?',
  'Когда следующий заезд и будут ли РВ?',
  'Сколько я получу в этом месяце?',
  'Придумай 5 названий мастер-класса по робототехнике для 5 класса',
  'Предложи 3 идеи мастер-класса на стыке VR и истории для 7 класса',
];

const loadChat = () => { try { return JSON.parse(localStorage.getItem(CHAT_KEY) || '[]'); } catch { return []; } };
const saveChat = (msgs) => { try { localStorage.setItem(CHAT_KEY, JSON.stringify(msgs.slice(-60))); } catch { /* без памяти */ } };

export function render(root) {
  let msgs = loadChat();          // [{role:'user'|'assistant', content, err?, tokens?}]
  let pending = false;

  const list = h('div', { class: 'chat-list', role: 'log', 'aria-live': 'polite' });
  const input = h('textarea', { class: 'chat-input', rows: 1, placeholder: 'Сообщение помощнику…', 'aria-label': 'Сообщение' });
  const sendBtn = h('button', { class: 'btn primary chat-send', type: 'button', title: 'Отправить (Enter)', 'aria-label': 'Отправить' }, icon('arrowUp', 18));
  const notes = h('div', {});
  const usage = h('span', { class: 'muted chat-usage' });

  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  sendBtn.addEventListener('click', () => send());

  async function send(text) {
    const q = (text ?? input.value).trim();
    if (!q || pending) return;
    input.value = ''; grow();
    msgs.push({ role: 'user', content: q });
    pending = true;
    draw(true);
    try {
      const history = msgs.filter(m => !m.err).map(m => ({ role: m.role, content: m.content + actionNote(m.action) }));
      const r = await askAssistant(history);
      const { text, action } = extractAction(r.text || '');
      msgs.push({ role: 'assistant', content: text || (action ? 'Проверьте и подтвердите списание:' : '(пустой ответ)'), action, tokens: (r.usage?.prompt_tokens || 0) + (r.usage?.completion_tokens || 0) });
    } catch (e) {
      msgs.push({ role: 'assistant', content: e.message, err: true });
    }
    pending = false;
    saveChat(msgs);
    draw(true);
    input.focus();
  }

  async function regenerate() {
    if (pending) return;
    // убрать последний ответ и спросить заново
    while (msgs.length && msgs[msgs.length - 1].role === 'assistant') msgs.pop();
    const last = msgs.pop();
    if (last) await send(last.content);
  }

  function bubble(m, i) {
    const isLast = i === msgs.length - 1;
    if (m.role === 'user') return h('div', { class: 'chat-msg user' }, h('div', { class: 'chat-bubble' }, m.content));
    return h('div', { class: 'chat-msg bot' + (m.err ? ' err' : '') },
      h('div', { class: 'chat-avatar' }, icon(m.err ? 'alert' : 'sparkle', 16)),
      h('div', { class: 'chat-body' },
        h('div', { class: 'chat-bubble' }, m.err ? m.content : renderText(m.content), m.action ? actionCard(m) : null),
        m.err ? null : h('div', { class: 'chat-tools' },
          h('button', { class: 'chat-tool', type: 'button', title: 'Копировать', onClick: async () => toast(await copyText(m.content) ? 'Скопировано' : 'Не удалось скопировать') }, icon('copy', 14), 'Копировать'),
          isLast ? h('button', { class: 'chat-tool', type: 'button', title: 'Ответить по-другому', onClick: regenerate }, icon('refresh', 14), 'Другой вариант') : null,
          isMkAnswer(msgs, i) ? h('button', {
            class: 'chat-tool accent', type: 'button', title: 'Информационная справка о проведении мастер-класса для методиста',
            onClick: () => openMkCert({ chat: msgs.slice(0, i + 1).filter(x => !x.err).map(x => ({ role: x.role, content: x.content })) }),
          }, icon('award', 14), 'Оформить справку') : null,
          m.tokens ? h('span', { class: 'chat-tok' }, `${m.tokens} ток.`) : null)));
  }

  /** Карточка «Списать часы»: проверить вид работы, часы и дату — и подтвердить. */
  function actionCard(m) {
    const a = m.action;
    const works = worksCatalog();
    const save = () => saveChat(msgs);
    const total = () => a.entries.reduce((x, e) => x + (Number(e.hours) || 0), 0);
    const fmt = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
    const ddmm = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
    const box = h('div', { class: 'ai-act' + (a.status !== 'pending' ? ' ' + a.status : '') });
    const paint = () => {
      const pending = a.status === 'pending';
      const okToApply = a.entries.length && a.entries.every(e => e.workId && e.hours > 0 && e.date);
      box.className = 'ai-act' + (pending ? '' : ' ' + a.status);
      box.replaceChildren(
        h('div', { class: 'ai-act-head' }, icon('hours', 16), h('b', {}, 'Списать часы'),
          h('span', { class: 'muted' }, pending ? 'проверьте перед подтверждением' : a.status === 'done' ? 'списано' : 'отменено')),
        ...a.entries.map((e, k) => pending
          ? h('div', { class: 'ai-act-row' },
              h('select', { 'aria-label': 'Вид работы', class: e.workId ? '' : 'bad', onChange: (ev) => { e.workId = ev.target.value; save(); paint(); } },
                h('option', { value: '', selected: !e.workId }, e.asked ? `Не нашёл «${e.asked}» — выберите вид работы` : 'Выберите вид работы'),
                ...['teaching', 'method'].map(kind => h('optgroup', { label: kind === 'teaching' ? 'Учебная работа' : 'Методическая работа' },
                  ...works.filter(w => w.kind === kind).map(w => h('option', { value: w.id, selected: w.id === e.workId }, w.title))))),
              h('input', { type: 'text', inputmode: 'decimal', 'aria-label': 'Часов', value: fmt(e.hours), onChange: (ev) => { e.hours = Math.max(0, Number(ev.target.value.replace(',', '.')) || 0); save(); paint(); } }),
              h('span', { class: 'muted' }, 'ч'),
              h('input', { type: 'date', 'aria-label': 'Дата', value: e.date, onChange: (ev) => { e.date = ev.target.value; save(); paint(); } }),
              a.entries.length > 1 ? h('button', { type: 'button', class: 'btn sm ghost icon-btn', title: 'Убрать строку', 'aria-label': 'Убрать строку', onClick: () => { a.entries.splice(k, 1); save(); paint(); } }, icon('x', 14)) : null)
          : h('div', { class: 'ai-act-line' }, `${fmt(e.hours)} ч · ${works.find(w => w.id === e.workId)?.title || e.asked} · ${ddmm(e.date)}${e.note ? ` · ${e.note}` : ''}`)),
        h('div', { class: 'ai-act-btns' }, ...(pending ? [
          h('button', {
            type: 'button', class: 'btn sm primary', disabled: !okToApply || null,
            onClick: () => { a.ids = applyLogHours(a.entries); a.status = 'done'; save(); paint(); toast(`Списано ${fmt(total())} ч — запись в «Часах по плану»`); },
          }, icon('check', 14), `Списать ${fmt(total())} ч`),
          h('button', { type: 'button', class: 'btn sm ghost', onClick: () => { a.status = 'cancel'; save(); paint(); } }, 'Отмена'),
        ] : a.status === 'done' ? [
          h('button', { type: 'button', class: 'btn sm ghost', onClick: () => go('hours') }, icon('arrowRight', 14), 'Часы по плану'),
          h('button', { type: 'button', class: 'btn sm ghost', title: 'Удалить эти записи', onClick: () => { undoLogHours(a.ids); a.status = 'undone'; save(); paint(); toast('Списание отменено'); } }, icon('undo', 14), 'Отменить'),
        ] : [])));
    };
    paint();
    return box;
  }

  function draw(scroll = false) {
    const st = getState();
    const configured = !!assistantUrl(st);
    const signedIn = cloudState().signedIn;
    notes.replaceChildren(...[
      !configured ? h('div', { class: 'card ai-note' }, icon('alert', 18),
        h('div', {}, h('b', {}, 'Помощник ещё не подключён. '), 'Нужен адрес облачной функции-посредника (код и инструкция — в папке proxy репозитория сайта).'),
        h('button', { class: 'btn', type: 'button', onClick: () => setupDialog(() => draw()) }, icon('settings', 16), 'Настройка')) : null,
      configured && !signedIn ? h('div', { class: 'card ai-note' }, icon('user', 18),
        h('div', {}, h('b', {}, 'Войдите через Яндекс. '), 'Помощник отвечает только педагогам, вошедшим на сайт.'),
        h('button', { class: 'btn primary', type: 'button', onClick: () => loginDialog() }, icon('cloud', 16), 'Войти')) : null,
    ].filter(Boolean));

    const items = msgs.map(bubble);
    if (pending) items.push(h('div', { class: 'chat-msg bot' }, h('div', { class: 'chat-avatar' }, icon('sparkle', 16)),
      h('div', { class: 'chat-body' }, h('div', { class: 'chat-bubble chat-typing', 'aria-label': 'Помощник печатает' }, h('i'), h('i'), h('i')))));
    if (!msgs.length && !pending) {
      items.push(h('div', { class: 'chat-empty' },
        h('div', { class: 'chat-empty-ico' }, icon('sparkle', 26)),
        h('p', {}, 'Спросите о своих часах, заездах и зарплате — или попросите придумать мастер-класс.'),
        h('div', { class: 'chat-suggest' }, ...SUGGEST.map(q => h('button', { type: 'button', class: 'check-pill', onClick: () => send(q) }, q)))));
    }
    list.replaceChildren(...items);
    sendBtn.disabled = pending;

    const u = usageThisMonth();
    usage.textContent = u.n ? `За месяц: ${u.n} запр. · ≈ ${usageCost(u).toFixed(2).replace('.', ',')} ₽` : '';
    if (scroll) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  }

  root.append(
    h('div', { class: 'page-head chat-head' },
      h('div', {}, h('h1', {}, 'Помощник')),
      h('div', { class: 'head-actions' },
        h('button', {
          class: 'btn', type: 'button', title: 'Начать новый чат',
          onClick: () => { if (!msgs.length || pending) return; msgs = []; saveChat(msgs); draw(); input.focus(); },
        }, icon('plus', 16), 'Новый чат'),
        isAssistantAdmin() ? h('button', { class: 'btn', type: 'button', title: 'Кто сколько пользуется помощником', onClick: statsDialog }, icon('compare', 16), 'Статистика') : null,
        h('button', { class: 'btn icon-btn', type: 'button', title: 'Настройка и данные помощника', 'aria-label': 'Настройка', onClick: () => setupDialog(() => draw()) }, icon('settings', 16)))),
    notes,
    h('div', { class: 'card chat' },
      list,
      h('div', { class: 'chat-compose' }, input, sendBtn),
      h('div', { class: 'chat-foot' }, h('span', { class: 'muted' }, 'Enter — отправить, Shift+Enter — новая строка. Цифры сайт считает сам; тексты — нейросеть GigaChat, проверяйте их.'), usage)));
  draw(true);
}

/** Показ ответа: заголовки «###», списки «-» / «1.», **жирный**, абзацы. */
function renderText(text) {
  const box = h('div', {});
  const inline = (str) => str.split(/(\*\*[^*]+\*\*)/).map(p => (/^\*\*[^*]+\*\*$/.test(p) ? h('b', {}, p.slice(2, -2)) : p.replace(/(^|\s)\*([^*\s][^*]*)\*/g, '$1$2')));
  let list = null, para = null;
  const flush = () => { list = null; para = null; };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    const head = /^\s*#{1,6}\s+(.*)$/.exec(line);
    const item = /^\s*(?:[-*•—]|\d+[.)])\s+(.*)$/.exec(line);
    if (head) { flush(); box.append(h('h4', {}, ...inline(head[1]))); }
    else if (item) {
      para = null;
      if (!list) { list = h(/^\s*\d/.test(line) ? 'ol' : 'ul', {}); box.append(list); }
      list.append(h('li', {}, ...inline(item[1])));
    } else {
      list = null;
      if (!para) { para = h('p', {}); box.append(para); } else para.append(h('br'));
      para.append(...inline(line));
    }
  }
  return box;
}

/** Настройка: адрес функции-посредника и просмотр данных, которые видит помощник. */
function setupDialog(redraw) {
  const input = h('input', { type: 'url', value: getState().assistant?.url || '', placeholder: ASSISTANT_URL || 'https://functions.yandexcloud.net/…' });
  modal({
    wide: true,
    title: [icon('settings', 18), ' Помощник'],
    body: h('div', {},
      h('p', { class: 'muted', style: { marginTop: 0, fontSize: '13px' } },
        'Помощник работает через облачную функцию-посредника: в ней хранится ключ Cloud.ru, и она пускает только разрешённых педагогов. Как её создать — в файле proxy/README.md репозитория сайта.'),
      h('label', { class: 'field' }, h('span', {}, ASSISTANT_URL ? 'Свой адрес функции (необязательно — общий уже задан)' : 'Адрес функции'), input),
      h('details', { class: 'ai-summary' },
        h('summary', {}, 'Какие данные видит помощник (прикладываются к каждому вопросу)'),
        h('pre', {}, buildSummary()))),
    okText: 'Сохранить',
    onOk: () => {
      const v = input.value.trim();
      if (v && !/^https:\/\//.test(v)) { toast('Адрес должен начинаться с https://', 'err'); return false; }
      update(x => { x.assistant = { ...(x.assistant || {}), url: v }; });
      toast(v ? 'Помощник подключён' : ASSISTANT_URL ? 'Используется общий адрес' : 'Адрес удалён'); redraw();
    },
  });
}

/** Статистика по педагогам: запросы, токены, примерная стоимость (данные — из облачной функции). */
function statsDialog() {
  const body = h('div', { class: 'ai-stats' }, h('p', { class: 'muted' }, 'Загружаю…'));
  modal({ wide: true, title: [icon('compare', 18), ' Статистика помощника'], body, cancelText: 'Закрыть' });
  const rub = (n) => `${n.toFixed(2).replace('.', ',')} ₽`;
  const monthName = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  let cur = null;
  fetchAssistantStats().then((data) => {
    if (!data.enabled) {
      body.replaceChildren(h('p', { class: 'muted' }, 'Статистика ещё не включена в облачной функции: нужен бакет Object Storage (переменная STATS_BUCKET) и сервисный аккаунт с ролью storage.editor. Пошагово — в proxy/README.md, раздел «Статистика».'));
      return;
    }
    const months = Object.keys(data.months).sort().reverse();
    cur = months[0];
    const draw = () => {
      const rows = Object.entries(data.months[cur] || {}).map(([login, u]) => ({ login, ...u, cost: tokenCost(u.in || 0, u.out || 0) })).sort((a, b) => b.n - a.n);
      const silent = (data.allowed || []).filter(l => !rows.some(r => r.login === l));
      const total = rows.reduce((a, r) => ({ n: a.n + r.n, cost: a.cost + r.cost }), { n: 0, cost: 0 });
      const max = Math.max(1, ...rows.map(r => r.n));
      body.replaceChildren(
        h('div', { class: 'tabs', role: 'tablist', style: { marginBottom: '12px' } }, ...months.map(m => h('button', { type: 'button', class: 'tab' + (m === cur ? ' active' : ''), onClick: () => { cur = m; draw(); } }, monthName(m)))),
        rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'compact' },
          h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Педагог (логин)'), h('th', { class: 'num' }, 'Запросов'), h('th', {}, ''), h('th', { class: 'num' }, 'Токенов'), h('th', { class: 'num' }, '≈ Стоимость'), h('th', {}, 'Последний'))),
          h('tbody', {}, ...rows.map((r, i) => h('tr', {},
            h('td', { class: 'muted mono' }, i + 1), h('td', {}, h('b', {}, r.login)),
            h('td', { class: 'num mono' }, r.n),
            h('td', { style: { width: '30%' } }, h('div', { class: 'ai-bar' }, h('i', { style: `width:${(r.n / max) * 100}%` }))),
            h('td', { class: 'num mono muted' }, ((r.in || 0) + (r.out || 0)).toLocaleString('ru-RU')),
            h('td', { class: 'num mono' }, rub(r.cost)),
            h('td', { class: 'muted', style: { fontSize: '12px' } }, r.last ? new Date(r.last).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')))),
          h('tfoot', {}, h('tr', {}, h('td', {}), h('td', {}, 'Всего'), h('td', { class: 'num mono' }, total.n), h('td', {}), h('td', {}), h('td', { class: 'num mono' }, rub(total.cost)), h('td', {})))))
          : h('p', { class: 'muted' }, 'В этом месяце запросов не было.'),
        silent.length ? h('p', { class: 'muted', style: { fontSize: '12.5px', marginTop: '10px' } }, `Не пользовались: ${silent.join(', ')}`) : null,
        h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '8px' } }, 'Стоимость — оценка по тарифу модели; точная сумма — в личном кабинете Cloud.ru.'),
      );
    };
    draw();
  }).catch(e => body.replaceChildren(h('p', { class: 'sg-issues' }, icon('alert', 15), e.message)));
}
