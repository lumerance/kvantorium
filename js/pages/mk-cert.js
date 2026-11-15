// Информационная справка о проведении мастер-класса (для методиста).
// Текст (название, цель, аннотация, возраст) — от ИИ по переписке в чате или
// по теме; даты и время — сайт подбирает сам по расписанию заезда: свободные
// уроки после последнего урока педагога в этот день, не позже 13-го (19:00).
// После скачивания — предложение списать часы на «Проведение мастер-классов».
import { h, toast, modal, download } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { getState, update, activeAgg } from '../core/store.js';
import { accountName } from '../core/cloud.js';
import { askAssistant, assistantUrl } from '../core/assistant.js';
import { DEFAULT_TIMES, weekdayIdx } from '../lib/schedule-build.js';
import { placeOfAgg, placeTitle } from '../data/places.js';
import { worksCatalog } from './hours.js';
import { buildMkCertDocx, datesLines } from '../exporters/mk-cert-docx.js';

const LAST_SLOT = 13;
const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const shortDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;
const slotStart = (n) => DEFAULT_TIMES[n - 1].split('-')[0].replace('.', ':');
const slotEnd = (n) => DEFAULT_TIMES[n - 1].split('-')[1].replace('.', ':');
export const timeRange = (slot, len) => `${slotStart(slot)}-${slotEnd(Math.min(LAST_SLOT, slot + len - 1))}`;

/** Расписание заезда: занятия педагога (после «Оставить только свои»). */
const lessonsOf = (sched) => (sched?.lessons || []).filter(l => l.kind !== 'event');

/**
 * Свободные окна: в каждый день заезда — сразу после последнего урока,
 * если до 13-го урока помещается len уроков. Возвращает count дат,
 * равномерно разнесённых по заезду.
 */
export function pickSessions(sched, count, len) {
  const lessons = lessonsOf(sched);
  const dates = [...new Set(lessons.map(l => l.date))].sort();
  const cand = [];
  for (const d of dates) {
    const last = Math.max(0, ...lessons.filter(l => l.date === d).map(l => Number(l.no) || 0));
    const slot = last + 1;
    if (slot + len - 1 <= LAST_SLOT) cand.push({ date: d, slot });
  }
  if (cand.length <= count) return cand;
  if (count === 1) return [cand[Math.floor((cand.length - 1) / 2)]];
  const out = [];
  for (let i = 0; i < count; i++) out.push(cand[Math.round(i * (cand.length - 1) / (count - 1))]);
  return out;
}

/** Заезд по умолчанию: тот, что идёт сейчас или ближайший впереди, иначе последний загруженный. */
function defaultShift(agg) {
  const today = new Date().toISOString().slice(0, 10);
  const loaded = ['1', '2', '3'].filter(s => agg.schedules?.[s]?.dates?.length);
  return Number(loaded.find(s => agg.schedules[s].dates.at(-1) >= today) || loaded.at(-1) || 1);
}

/** Похоже ли, что в переписке шла речь о мастер-классе (для кнопки в чате). */
// Вопрос о своих данных (часы, заезды, зарплата), а не о содержании МК.
// (\b в JS не видит границ русских слов — границы через (?<![а-яё]) / (?![а-яё]))
const DATA_Q = /сколько|остал|закры|списа|(?<![а-яё])час(?:а|ов)?(?![а-яё])|зарплат|получу|заезд|(?<![а-яё])рв(?![а-яё])|отпуск|ставк/i;
// Просьба что-то придумать / написать.
const CREATIVE_Q = /придума|предлож|иде[июяйе]|назван|анонс|аннотац|сценари|(?<![а-яё])план|опиш|напиш|сочин|(?<![а-яё])тем[аыуе]?(?![а-яё])|(?<![а-яё])цел[ьи](?![а-яё])|программ|вариант|перепиш|короче|подробн|измени|добав/i;
const MK_TOPIC = /мастер[-\s]?класс|(?<![а-яё])мк(?![а-яё])/i;

/**
 * Показывать ли «Оформить справку» под ответом msgs[i]: ответ на просьбу
 * придумать/описать мастер-класс или уточнение к такому ответу
 * («сделай короче», «другие названия»). Под ответами о часах МК, заездах
 * и зарплате кнопки нет.
 */
export function isMkAnswer(msgs, i) {
  const a = msgs[i];
  if (!a || a.role !== 'assistant' || a.err) return false;
  let qi = i - 1;
  while (qi >= 0 && msgs[qi].role !== 'user') qi--;
  if (qi < 0) return false;
  const q = msgs[qi].content || '';
  const creative = CREATIVE_Q.test(q);
  if (DATA_Q.test(q) && !(creative && MK_TOPIC.test(q))) return false;
  if (MK_TOPIC.test(q) && creative) return true;
  // уточнение без слова «мастер-класс»: продолжение, если предыдущий ответ был про МК
  if (creative || q.length < 80) {
    let pi = qi - 1;
    while (pi >= 0 && (msgs[pi].role !== 'assistant' || msgs[pi].err)) pi--;
    return pi >= 0 && isMkAnswer(msgs, pi);
  }
  return false;
}
/** Была ли в переписке работа над мастер-классом (для совместимости). */
export const isMkChat = (history) => history.some((m, i) => isMkAnswer(history, i));

/**
 * @param {{chat?: Array<{role, content}>}} opts — переписка из чата помощника
 */
export function openMkCert({ chat = null } = {}) {
  const st = getState();
  const agg = activeAgg(st);
  const place = placeOfAgg(agg);
  const school = (st.scheduleGen?.schools || {})[place || '_'] || {};
  const prof = st.mkCert || {};
  const fio = st.salary?.requisites?.fio || st.plan?.teacher || accountName();

  const f = {
    title: '', goal: '', annotation: '', age: '',
    organizer: prof.organizer || 'ГАУ ДПО «АмИРО», мобильный технопарк «Кванториум-28»',
    theme: school.name ? `Мастер-класс для обучающихся ${school.name}` : 'Мастер-класс для обучающихся',
    audience: `обучающиеся ${school.name || 'школы'}${place ? ' ' + placeTitle(place) : ''}`,
    form: 'очно',
    author: prof.authorRole ? `${prof.authorRole} ${fio}`.trim() : `Педагог дополнительного образования мобильного технопарка «Кванториум-28» ${fio}`.trim(),
    contacts: prof.contacts || '',
    extra: prof.extra || '-',
    shift: defaultShift(agg), count: prof.count || 3, len: prof.len || 1,
    sessions: [],
  };
  const sched = () => agg.schedules?.[String(f.shift)];
  f.sessions = pickSessions(sched(), f.count, f.len);

  let candidates = [];
  let aiBusy = false;
  const body = h('div', { class: 'mkc' });

  const inp = (key, ph, area) => h(area ? 'textarea' : 'input', {
    type: 'text', rows: area || null, value: area ? null : f[key], placeholder: ph || '',
    onInput: (e) => { f[key] = e.target.value; },
  }, area ? f[key] : null);
  const field = (label, key, ph, area) => h('label', { class: 'field' }, h('span', {}, label), inp(key, ph, area));

  async function aiFill() {
    if (!assistantUrl()) { toast('Помощник не подключён — заполните поля вручную или подключите его на странице «Помощник»', 'err'); return; }
    const base = chat?.length ? chat.slice(-10) : [];
    const topic = f.title || f.theme;
    if (!base.length && !f.title.trim()) { toast('Впишите название или тему мастер-класса — ИИ заполнит остальное', 'err'); return; }
    const ask = [
      `Подготовь данные для информационной справки о проведении мастер-класса${base.length ? ' по нашей переписке' : ` «${topic}»`}.`,
      f.age ? `Возраст участников: ${f.age}.` : '',
      'Верни ТОЛЬКО JSON без пояснений и без markdown: {"items":[{"title":"…","goal":"…","annotation":"…","age":"…"}]}.',
      'Если в переписке несколько мастер-классов (идей, вариантов) — верни каждый отдельным элементом, не больше 5.',
      'title — название без кавычек.',
      'goal — одна фраза с маленькой буквы, например: «формирование первичных навыков сборки электрических цепей через выполнение мини-проекта под руководством наставника».',
      'annotation — 2–3 предложения в стиле: «Мастер-класс знакомит с … По итогам проведения дети получат …». Без названия в начале.',
      'age — диапазон возраста, например «11–13 лет».',
    ].filter(Boolean).join('\n');
    aiBusy = true; draw();
    try {
      const r = await askAssistant([...base, { role: 'user', content: ask }]);
      const m = /\{[\s\S]*\}/.exec(r.text || '');
      const data = m ? JSON.parse(m[0]) : null;
      candidates = (data?.items || []).filter(x => x && x.title).slice(0, 5);
      if (!candidates.length) throw new Error('ИИ ответил не в том формате — попробуйте ещё раз');
      apply(candidates[0]);
      toast(candidates.length > 1 ? `ИИ предложил ${candidates.length} мастер-класса — выберите нужный` : 'Название, цель и аннотация заполнены');
    } catch (e) { toast(e.message, 'err'); }
    aiBusy = false; draw();
  }
  const apply = (c) => {
    f.title = String(c.title || '').replace(/^[«"]|[»"]$/g, '');
    f.goal = c.goal || ''; f.annotation = c.annotation || ''; if (c.age) f.age = c.age;
  };

  function sessionRow(s, i) {
    return h('div', { class: 'mkc-session' },
      h('input', { type: 'date', value: s.date, onChange: (e) => { s.date = e.target.value; draw(); } }),
      h('select', { onChange: (e) => { s.slot = Number(e.target.value); draw(); } },
        ...Array.from({ length: LAST_SLOT - f.len + 1 }, (_, k) => k + 1).map(n => h('option', { value: n, selected: n === s.slot }, `с ${n}-го урока · ${timeRange(n, f.len)}`))),
      h('span', { class: 'muted mkc-wd' }, s.date ? WD[weekdayIdx(s.date)] : ''),
      h('button', { type: 'button', class: 'btn sm ghost icon-btn', title: 'Убрать', 'aria-label': 'Убрать дату', onClick: () => { f.sessions.splice(i, 1); draw(); } }, icon('x', 14)));
  }

  function draw() {
    const sc = sched();
    const loaded = ['1', '2', '3'].filter(s => agg.schedules?.[s]?.dates?.length);
    const preview = f.sessions.filter(s => s.date).map(s => ({ date: s.date, time: timeRange(s.slot, f.len) }));
    body.replaceChildren(...[
      h('div', { class: 'mkc-head' },
        h('h4', { class: 'sg-h', style: { margin: 0 } }, 'Мастер-класс'),
        h('button', { type: 'button', class: 'btn sm', disabled: aiBusy || null, onClick: aiFill },
          icon('sparkle', 15), aiBusy ? 'ИИ думает…' : (chat?.length ? 'Заполнить по переписке' : 'Заполнить с помощью ИИ'))),
      candidates.length > 1 ? h('div', { class: 'mkc-cands' }, ...candidates.map(c => h('button', {
        type: 'button', class: 'check-pill' + (c.title.replace(/^[«"]|[»"]$/g, '') === f.title ? ' on' : ''), onClick: () => { apply(c); draw(); },
      }, c.title.replace(/^[«"]|[»"]$/g, '')))) : null,
      h('div', { class: 'row' }, field('Название', 'title', 'например: Сетевая мафия'), h('label', { class: 'field', style: { flex: '0 1 160px' } }, h('span', {}, 'Возраст участников'), inp('age', '8–17 лет'))),
      h('div', { style: { marginTop: '10px' } }, field('Цель', 'goal', 'формирование первичных навыков…', 2)),
      h('div', { style: { marginTop: '10px' } }, field('Краткая аннотация', 'annotation', 'Мастер-класс знакомит с … По итогам проведения дети получат …', 3)),

      h('h4', { class: 'sg-h', style: { marginTop: '18px' } }, 'Даты и время — по расписанию'),
      loaded.length ? h('div', { class: 'row mkc-pick' },
        h('label', { class: 'field' }, h('span', {}, 'Заезд'),
          h('select', { onChange: (e) => { f.shift = Number(e.target.value); f.sessions = pickSessions(sched(), f.count, f.len); draw(); } },
            ...loaded.map(s => h('option', { value: s, selected: Number(s) === f.shift }, `${s} заезд · ${shortDate(agg.schedules[s].dates[0])}–${shortDate(agg.schedules[s].dates.at(-1))}`)))),
        h('label', { class: 'field' }, h('span', {}, 'Проведений'),
          h('select', { onChange: (e) => { f.count = Number(e.target.value); f.sessions = pickSessions(sched(), f.count, f.len); draw(); } },
            ...[1, 2, 3, 4, 5, 6].map(n => h('option', { value: n, selected: n === f.count }, n)))),
        h('label', { class: 'field' }, h('span', {}, 'Длительность'),
          h('select', { onChange: (e) => { f.len = Number(e.target.value); f.sessions = pickSessions(sched(), f.count, f.len); draw(); } },
            ...[1, 2, 3].map(n => h('option', { value: n, selected: n === f.len }, `${n} ${n === 1 ? 'урок' : 'урока'}`))))) :
        h('p', { class: 'muted', style: { fontSize: '13px' } }, 'Расписание заезда не загружено — даты добавьте вручную.'),
      sc && f.sessions.length < f.count ? h('p', { class: 'sg-issues' }, icon('alert', 15),
        `После уроков свободного времени нашлось только в ${f.sessions.length} ${f.sessions.length === 1 ? 'день' : 'дня(ей)'} — добавьте дату вручную или уменьшите длительность.`) : null,
      h('div', { class: 'mkc-sessions' }, ...f.sessions.map(sessionRow)),
      h('button', { type: 'button', class: 'btn sm ghost', onClick: () => { f.sessions.push({ date: sc?.dates?.[0] || new Date().toISOString().slice(0, 10), slot: 9 }); draw(); } }, icon('plus', 14), 'Добавить дату'),
      preview.length ? h('div', { class: 'mkc-preview' }, h('span', { class: 'muted' }, 'В справке: '), `Мастер-класс «${f.title || '…'}» · `, datesLines(preview).join(' · ')) : null,

      h('details', { class: 'acc', style: { marginTop: '16px' } },
        h('summary', {}, 'Шапка, автор и контакты'),
        h('div', { class: 'acc-body' },
          field('Организатор', 'organizer'),
          h('div', { style: { height: '8px' } }),
          h('div', { class: 'row' }, field('Тема (строка «Тема»)', 'theme'), field('Целевая аудитория', 'audience')),
          h('div', { style: { height: '8px' } }),
          field('Сведения об авторе (ФИО, должность)', 'author', '', 2),
          h('div', { style: { height: '8px' } }),
          field('Контактные данные организаторов', 'contacts', 'телефон: … – ФИО\nе-mail: …', 2),
          h('div', { style: { height: '8px' } }),
          h('div', { class: 'row' }, field('Форма проведения', 'form'), field('Дополнительная информация', 'extra')))),
    ].filter(Boolean));
  }

  draw();
  if (chat?.length && assistantUrl()) aiFill();

  modal({
    wide: true,
    title: [icon('award', 18), ' Информационная справка о мастер-классе'],
    body,
    okText: 'Скачать Word',
    onOk: () => {
      const sessions = f.sessions.filter(s => s.date).map(s => ({ date: s.date, time: timeRange(s.slot, f.len) }));
      if (!f.title.trim()) { toast('Укажите название мастер-класса', 'err'); return false; }
      if (!sessions.length) { toast('Добавьте хотя бы одну дату проведения', 'err'); return false; }
      const roleOnly = f.author.replace(fio, '').trim();
      update(x => {
        x.mkCert = { organizer: f.organizer, contacts: f.contacts, extra: f.extra, count: f.count, len: f.len, authorRole: roleOnly || x.mkCert?.authorRole };
        x.mkCerts = [{ id: Date.now(), title: f.title, age: f.age, sessions, len: f.len, createdAt: new Date().toISOString() }, ...(x.mkCerts || [])].slice(0, 50);
      });
      buildMkCertDocx({ ...f, sessions }).then(blob => {
        download(`Информационная справка МК «${f.title.replace(/[\\/:*?"<>|]/g, '')}».docx`, blob);
        setTimeout(() => offerHours(f.title, f.sessions.filter(s => s.date), f.len), 300);
      }).catch(e => { console.error(e); toast('Ошибка выгрузки: ' + e.message, 'err'); });
    },
  });
}

/** После справки: списать часы на «Проведение мастер-классов» — по уроку за час. */
function offerHours(title, sessions, len) {
  const st = getState();
  const work = worksCatalog(st).find(w => /проведение мастер-класс/i.test(w.title)) || { id: 'teaching:H', kind: 'teaching', title: 'Проведение мастер-классов' };
  const total = sessions.length * len;
  const { close } = modal({
    title: 'Списать часы?',
    body: h('div', {},
      h('p', { style: { marginTop: 0 } }, `Справка скачана. Списать ${total} ч на «${work.title}» — по ${len} ч за каждое проведение (${sessions.map(s => shortDate(s.date)).join(', ')})?`),
      h('p', { class: 'muted', style: { fontSize: '12.5px', margin: 0 } }, 'Записи появятся в «Часах по плану», их можно удалить там же.'),
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' } },
        h('button', {
          class: 'btn primary', type: 'button', onClick: () => {
            update(x => {
              for (const s of sessions) x.hoursLog.push({
                id: Date.now() + Math.floor(Math.random() * 100000), date: s.date, kind: work.kind, workId: work.id, title: work.title,
                hours: len, note: `МК «${title}»`, subject: '', period: '',
              });
            });
            close(); toast(`Списано ${total} ч на мастер-классы`);
          },
        }, icon('check', 16), `Списать ${total} ч`))),
    cancelText: 'Не сейчас',
  });
}
