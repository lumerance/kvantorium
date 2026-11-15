// «Помощник»: вопросы по своим данным (часы, заезды, РВ, зарплата) и
// генератор для мастер-классов (названия, анонс, идеи, текст для справки).
// Модель — GigaChat3.5 в Cloud.ru через посредника (proxy/assistant-function.js).
import { h, toast, copyText, modal, switchToggle } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { getState, update } from '../core/store.js';
import { cloudState } from '../core/cloud.js';
import { loginDialog } from '../core/account.js';
import { askAssistant, assistantUrl, buildSummary, usageThisMonth, usageCost } from '../core/assistant.js';

const QUICK = [
  'Сколько часов МК у меня осталось?',
  'Что ещё не закрыто по методическим часам?',
  'Когда следующий заезд и будут ли РВ?',
  'Сколько я получу в этом месяце?',
  'Сколько РВ в этом месяце по графику?',
];

const CREATIVE_KINDS = [
  { key: 'titles', label: 'Названия', prompt: (f) => `Придумай 7 названий для мастер-класса. ${ctx(f)}\nТребования: названия короткие (до 5 слов), цепляющие, по теме, не повторяют друг друга по смыслу. Только список.` },
  { key: 'announce', label: 'Анонс', prompt: (f) => `Напиши анонс мастер-класса${f.title ? ` «${f.title}»` : ''} для школьной группы ВКонтакте. ${ctx(f)}\nОбъём — 4–5 предложений. Просто и по делу, без пафоса. В конце — призыв записаться.` },
  { key: 'ideas', label: 'Идеи', prompt: (f) => `Предложи 3 идеи мастер-класса. ${ctx(f)}\nДля каждой: название; что дети делают по шагам (3–4 шага); что уносят с собой; какое оборудование нужно.` },
  { key: 'report', label: 'Для справки', prompt: (f) => `Напиши описание проведённого мастер-класса${f.title ? ` «${f.title}»` : ''} для справки о проведении. ${ctx(f)}\nНужны: цель, задачи (3 пункта), краткое содержание, результат. Официальный стиль без воды, до 150 слов.` },
];
function ctx(f) {
  return [f.topic && `Тема или направление: ${f.topic}.`, f.age && `Участники: ${f.age}.`, f.duration && `Длительность: ${f.duration}.`, f.extra && `Пожелания: ${f.extra}.`]
    .filter(Boolean).join(' ');
}

// история ответов — на этом устройстве, в рамках вкладки
const session = { data: [], creative: [] };

export function render(root) {
  const wrap = h('div', {});
  root.append(wrap);
  let tab = 'data';
  const form = { kind: 'ideas', topic: '', age: '', duration: '', title: '', extra: '' };

  function draw() {
    const st = getState();
    const configured = !!assistantUrl(st);
    const signedIn = cloudState().signedIn;
    const u = usageThisMonth();

    const kids = [
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Помощник'),
          h('p', {}, 'Спросите о своих часах, заездах и зарплате или попросите придумать мастер-класс. Ответы — нейросеть GigaChat; числа сайт считает сам.')),
        h('div', { class: 'head-actions' },
          h('button', { class: 'btn', type: 'button', onClick: () => setupDialog(draw) }, icon('settings', 16), 'Настройка'))),

      !configured ? h('div', { class: 'card ai-note' }, icon('alert', 18),
        h('div', {}, h('b', {}, 'Помощник ещё не подключён. '),
          'Нужен адрес облачной функции-посредника (её код — в папке proxy репозитория сайта). Нажмите «Настройка».')) : null,
      configured && !signedIn ? h('div', { class: 'card ai-note' }, icon('user', 18),
        h('div', {}, h('b', {}, 'Войдите через Яндекс. '), 'Помощник отвечает только педагогам, вошедшим на сайт.'),
        h('button', { class: 'btn primary', type: 'button', onClick: () => loginDialog() }, icon('cloud', 16), 'Войти')) : null,

      h('div', { class: 'tabs', style: { marginBottom: '14px' } },
        h('button', { class: 'tab' + (tab === 'data' ? ' active' : ''), type: 'button', onClick: () => { tab = 'data'; draw(); } }, icon('hours', 16), 'Мои данные'),
        h('button', { class: 'tab' + (tab === 'creative' ? ' active' : ''), type: 'button', onClick: () => { tab = 'creative'; draw(); } }, icon('award', 16), 'Мастер-класс')),

      tab === 'data' ? dataPane() : creativePane(),

      h('p', { class: 'muted ai-usage' },
        `В этом месяце на этом устройстве: ${u.n} ${u.n % 10 === 1 && u.n % 100 !== 11 ? 'запрос' : 'запросов'}, ` +
        `${(u.in + u.out).toLocaleString('ru-RU')} токенов ≈ ${usageCost(u).toFixed(2).replace('.', ',')} ₽.`)];
    wrap.replaceChildren(...kids.filter(Boolean));
  }

  /* ---------- вопросы по данным ---------- */
  function dataPane() {
    const input = h('textarea', { rows: 2, placeholder: 'Например: сколько часов МК у меня осталось?', class: 'ai-input' });
    const send = async (q) => {
      q = (q ?? input.value).trim();
      if (!q) return;
      const item = { q, a: null, err: null, pending: true };
      session.data.unshift(item);
      draw();
      try {
        const r = await askAssistant('data', [{ role: 'user', content: q }]);
        item.a = r.text; item.usage = r.usage;
      } catch (e) { item.err = e.message; }
      item.pending = false;
      draw();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    return h('div', {},
      h('div', { class: 'card', style: { marginBottom: '12px' } },
        h('div', { class: 'ai-ask' }, input,
          h('button', { class: 'btn primary', type: 'button', onClick: () => send() }, icon('arrowRight', 16), 'Спросить')),
        h('div', { class: 'ai-chips' }, ...QUICK.map(q => h('button', { type: 'button', class: 'check-pill', onClick: () => send(q) }, q))),
        h('details', { class: 'ai-summary' },
          h('summary', {}, 'Какие данные видит помощник'),
          h('pre', {}, buildSummary()))),
      ...session.data.map(answerCard));
  }

  /* ---------- мастер-класс ---------- */
  function creativePane() {
    const field = (key, label, ph, area) => h('label', { class: 'field' }, h('span', {}, label),
      h(area ? 'textarea' : 'input', { type: 'text', rows: area ? 2 : null, value: area ? null : form[key], placeholder: ph, onInput: (e) => { form[key] = e.target.value; } }, area ? form[key] : null));
    const kind = CREATIVE_KINDS.find(k => k.key === form.kind);
    const run = async () => {
      if (!form.topic.trim() && !form.title.trim()) { toast('Укажите тему или название', 'err'); return; }
      const prompt = kind.prompt(form);
      const item = { q: `${kind.label}: ${form.title || form.topic}`, a: null, err: null, pending: true, prompt };
      session.creative.unshift(item);
      draw();
      try {
        const r = await askAssistant('creative', [{ role: 'user', content: prompt }]);
        item.a = r.text; item.usage = r.usage;
      } catch (e) { item.err = e.message; }
      item.pending = false;
      draw();
    };
    return h('div', {},
      h('div', { class: 'card', style: { marginBottom: '12px' } },
        h('div', { class: 'tabs', style: { marginBottom: '12px' } }, ...CREATIVE_KINDS.map(k => h('button', {
          type: 'button', class: 'tab' + (form.kind === k.key ? ' active' : ''), onClick: () => { form.kind = k.key; draw(); },
        }, k.label))),
        h('div', { class: 'row' },
          field('topic', 'Тема или направление', 'например: робототехника и экология'),
          (form.kind === 'announce' || form.kind === 'report') ? field('title', 'Название мастер-класса', 'если уже есть') : null),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          field('age', 'Кто участники', '5 класс / 12–14 лет'),
          field('duration', 'Длительность', '2 урока по 40 минут')),
        h('div', { style: { marginTop: '10px' } }, field('extra', 'Пожелания (необязательно)', 'например: без 3D-принтера, нужен результат, который можно унести домой', true)),
        h('div', { style: { marginTop: '12px', display: 'flex', justifyContent: 'flex-end' } },
          h('button', { class: 'btn primary', type: 'button', onClick: run }, icon('zap', 16), 'Придумать'))),
      ...session.creative.map(answerCard));
  }

  function answerCard(item) {
    return h('div', { class: 'card ai-answer' },
      h('div', { class: 'ai-q' }, icon('user', 15), item.q),
      item.pending ? h('div', { class: 'ai-pending' }, h('span', { class: 'sync-dot wait' }), 'Думаю…')
        : item.err ? h('div', { class: 'ai-err' }, icon('alert', 15), item.err)
        : h('div', { class: 'ai-a' }, renderText(item.a)),
      (!item.pending && item.a) ? h('div', { class: 'ai-actions' },
        h('button', { class: 'btn sm ghost', type: 'button', onClick: async () => { toast(await copyText(item.a) ? 'Скопировано' : 'Не удалось скопировать', 'ok'); } }, icon('copy', 14), 'Копировать'),
        item.prompt ? h('button', {
          class: 'btn sm ghost', type: 'button', onClick: async () => {
            item.pending = true; item.err = null; draw();
            try { const r = await askAssistant('creative', [{ role: 'user', content: item.prompt }]); item.a = r.text; }
            catch (e) { item.err = e.message; }
            item.pending = false; draw();
          },
        }, icon('refresh', 14), 'Другой вариант') : null,
        item.usage ? h('span', { class: 'muted ai-tok' }, `${(item.usage.prompt_tokens || 0) + (item.usage.completion_tokens || 0)} токенов`) : null) : null);
  }

  draw();
}

/** Простой показ ответа: заголовки «###», списки «-» / «1.», **жирный**, абзацы. */
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

/** Настройка: адрес функции-посредника. Хранится в данных (синхронизируется). */
function setupDialog(redraw) {
  const input = h('input', { type: 'url', value: assistantUrl(), placeholder: 'https://functions.yandexcloud.net/…' });
  modal({
    title: [icon('settings', 18), ' Подключение помощника'],
    body: h('div', {},
      h('p', { class: 'muted', style: { marginTop: 0, fontSize: '13px' } },
        'Помощник работает через облачную функцию-посредника: в ней хранится ключ Cloud.ru, и она пускает только разрешённых педагогов. Как её создать — в файле proxy/README.md репозитория сайта.'),
      h('label', { class: 'field' }, h('span', {}, 'Адрес функции'), input)),
    okText: 'Сохранить',
    onOk: () => {
      const v = input.value.trim();
      if (v && !/^https:\/\//.test(v)) { toast('Адрес должен начинаться с https://', 'err'); return false; }
      update(x => { x.assistant = { ...(x.assistant || {}), url: v }; });
      toast(v ? 'Помощник подключён' : 'Адрес удалён'); redraw();
    },
  });
}
