// Помощник: короткая сводка данных сайта для модели и запрос к посреднику.
//
// Модель ничего не считает сама: все числа (часы, остатки, РВ, суммы) сайт
// считает заранее и отдаёт готовой выжимкой. Модели остаётся найти нужную
// строку и ответить по-человечески — так меньше ошибок и меньше токенов.
// Личные данные детей (ФИО) в сводку не попадают — только цифры.
import { getState, activeAgg, allGroups } from './store.js';
import { cloudState } from './cloud.js';
import { MONTHS } from './ui.js';
import { computeHours } from '../pages/hours.js';
import { calcAll, RATE_LABELS } from '../pages/salary.js';
import { myTrips, myTeam, myMk } from '../pages/trips.js';
import { legInfo, rvByMonth, weekday } from '../data/trips.js';
import { receivedOf, gphOf } from '../pages/salary-history.js';
import { placeOfAgg } from '../data/places.js';

const AUTH_KEY = 'kvantorium28.auth';
const USAGE_KEY = 'kvantorium28.assistantUsage';
// цены GigaChat3.5-432B-A28B за 1 млн токенов (вход, выход), ₽ — для счётчика расходов
export const PRICE = { in: 96.22, out: 288.6 };

const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const ddmm = (s) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
const rub = (n) => `${Math.round(n || 0).toLocaleString('ru-RU')} ₽`;
const hrs = (n) => `${Math.round((n || 0) * 10) / 10} ч`;

export const SYSTEM = [
  'Ты — помощник педагога дополнительного образования мобильного технопарка «Кванториум-28» (робототехника, VR/AR, 3D-моделирование, программирование, промышленный дизайн). Ведёшь с ним чат.',
  '',
  'Если вопрос о его работе — часах, видах работ, заездах, РВ, зарплате, группах, — отвечай по сводке данных ниже:',
  '— Числа бери из сводки как есть, ничего не пересчитывай и не округляй по-своему. «ЗАКРЫТО» значит, что вид работ выполнен.',
  '— Если нужных данных в сводке нет, так и скажи: «В данных сайта этого нет» — и подскажи, где это внести. Ничего не выдумывай.',
  '— Отвечай коротко: 1–3 предложения или короткий список.',
  '',
  'Если просят придумать мастер-класс, название, анонс, идеи, описание или текст для справки:',
  '— Пиши простым живым языком, без штампов («уникальная возможность», «погрузитесь в мир», «увлекательный»), без пафосных метафор и лишних восклицаний.',
  '— Учитывай возраст детей, длительность и оборудование технопарка: ноутбуки, 3D-принтер, VR-очки, наборы для робототехники.',
  '— Точно соблюдай требования к количеству пунктов и объёму. Если не хватает важного (возраст, длительность), сделай разумное допущение и коротко его назови.',
  '',
  'Сокращения: МК — мастер-классы, РВ — работа в выходной день, ГПХ — договор гражданско-правового характера, ДО — дополнительное образование.',
  'Пиши по-русски.',
].join('\n');

/** Сводка данных сайта на сегодня (текст, ~1–2 тыс. токенов). */
export function buildSummary(st = getState()) {
  const out = [];
  const today = new Date().toISOString().slice(0, 10);
  out.push(`Сегодня: ${ddmm(today)} (${WD[weekday(today)]}).`);
  if (st.plan?.teacher) out.push(`Педагог: ${st.plan.teacher}${st.plan.direction ? ', квантум ' + st.plan.direction : ''}.`);

  /* --- часы по индивидуальному плану --- */
  const c = computeHours(st);
  out.push('', '## Часы по индивидуальному плану');
  out.push(`Годовая норма: ${hrs(c.norm)}; списано всего ${hrs(c.total.done)}, осталось ${hrs(c.norm - c.total.done)}.`);
  out.push(`Учебные: норма ${hrs(c.target.teaching)}, списано ${hrs(c.done.teaching)}, осталось ${hrs(c.left.teaching)}.`);
  out.push(`Методические: норма ${hrs(c.target.method)}, списано ${hrs(c.done.method)}, осталось ${hrs(c.left.method)}.`);
  const lines = [];
  for (const w of c.works) {
    const rec = c.byWork.get(w.id) || { done: 0 };
    if (!w.planned && !rec.done) continue;
    const left = (w.planned || 0) - rec.done;
    const kind = w.kind === 'teaching' ? 'учебн.' : 'метод.';
    lines.push(`— ${w.title} (${kind}): план ${hrs(w.planned || 0)}, списано ${hrs(rec.done)}, ` +
      (w.planned ? (left <= 0 ? 'ЗАКРЫТО' : `осталось ${hrs(left)}`) : 'в плане не указано'));
  }
  out.push(lines.length ? 'По видам работ:\n' + lines.join('\n') : 'Индивидуальный план не загружен, списаний нет.');

  /* --- агломерация --- */
  const agg = activeAgg(st);
  const groups = allGroups(agg);
  const enroll = agg.enroll?.groups || [];
  out.push('', '## Текущая агломерация');
  out.push(`«${agg.name}»${placeOfAgg(agg) ? ', ' + placeOfAgg(agg) : ''}${agg.completedAt ? ' — завершена' : ''}. ` +
    `Сетевых групп: ${groups.length} (детей ${groups.reduce((a, g) => a + g.group.students.length, 0)}), групп ДО в «Наборе»: ${enroll.length} (детей ${enroll.reduce((a, g) => a + (g.students?.length || 0), 0)}).`);
  for (const sh of ['1', '2', '3']) {
    const sc = agg.schedules?.[sh];
    out.push(sc ? `Расписание ${sh} заезда: ${sc.lessons.length} занятий, ${sc.dates.length ? ddmm(sc.dates[0]) + '–' + ddmm(sc.dates.at(-1)) : 'без дат'}.` : `Расписание ${sh} заезда не загружено.`);
  }

  /* --- заезды и РВ --- */
  const trips = myTrips(st);
  out.push('', `## Заезды (${myMk(st) === 'mk1' ? 'МК-1' : 'МК-2'}, команда ${myTeam(st)}); выезд — за день до начала`);
  for (const t of trips) {
    const legs = t.parts.map(legInfo);
    const end = legs.at(-1).to;
    const status = end < today ? 'прошёл' : legs[0].depart <= today ? 'идёт сейчас' : 'впереди';
    const rv = legs.flatMap(l => l.rv).map(r => `${ddmm(r.date)} — ${r.reason}`);
    out.push(`— ${t.place}: ${t.parts.map(p => `${ddmm(p.from)}–${ddmm(p.to)}`).join(' + ')}, выезд ${ddmm(legs[0].depart)} (${WD[weekday(legs[0].depart)]}), ${status}; ` +
      `будних ${legs.reduce((a, l) => a + l.weekdays, 0)}, выходных ${legs.reduce((a, l) => a + l.weekends + l.holidays, 0)}; РВ: ${rv.length ? rv.join('; ') : 'нет'}.`);
  }
  const rvm = rvByMonth(trips);
  out.push('РВ по месяцам по графику: ' + (Object.keys(rvm).length
    ? Object.keys(rvm).sort().map(k => `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)} — ${rvm[k].length}`).join('; ')
    : 'нет') + '.');

  /* --- зарплата --- */
  const s = st.salary;
  out.push('', '## Зарплата');
  if (!s.base) out.push('Суммы зарплаты не заполнены (страница «Зарплата» → «Постоянные величины»).');
  else {
    const p = { base: s.base, intensive: s.intensive, quality: s.quality, gph: s.gph, ndfl: s.ndfl, district: s.district, north: s.north,
      workDays: s.workDays, rv: s.rv, factDays: s.partialMonth ? s.factDays : null, rate: s.rate, hasGph: s.hasGph };
    const r = calcAll(p);
    out.push(`Расчёт на ${MONTHS[s.month - 1]} ${s.year}: формат ${RATE_LABELS[r.rate]}${r.hasGph ? ' + ГПХ' : ''}, рабочих дней ${s.workDays}, РВ ${s.rv}.`);
    out.push(`На руки ${rub(r.withGph)} (по ставке ${rub(r.current.net)}${r.hasGph ? `, ГПХ после НДФЛ ${rub(r.gphNet)}` : ''}); до НДФЛ по ставке ${rub(r.current.gross)}.`);
    out.push(`Один дополнительный РВ даёт +${rub(r.current.rvMarginalNet)} на руки.`);
  }
  const hist = [...(s.history || [])].sort((a, b) => (b.year - a.year) || (b.month - a.month)).slice(0, 12);
  if (hist.length) {
    out.push('Сохранённые расчёты (получено всего; в скобках по ставке, для отпускных):');
    for (const e of hist) out.push(`— ${MONTHS[e.month - 1]} ${e.year}: ${rub(receivedOf(e))}${gphOf(e).on ? ` (ставка ${rub(e.net)} + ГПХ)` : ''}`);
  }
  return out.join('\n');
}

/* ---------------- запрос к посреднику ---------------- */
export const assistantUrl = (st = getState()) => String(st.assistant?.url || '').trim();

function token() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null')?.token || null; } catch { return null; }
}

/** Счётчик токенов за месяц на этом устройстве — для оценки расходов. */
export function usageThisMonth() {
  try {
    const u = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}');
    const key = new Date().toISOString().slice(0, 7);
    return u.month === key ? u : { month: key, in: 0, out: 0, n: 0 };
  } catch { return { month: new Date().toISOString().slice(0, 7), in: 0, out: 0, n: 0 }; }
}
function addUsage(usage) {
  const u = usageThisMonth();
  u.in += usage?.prompt_tokens || 0; u.out += usage?.completion_tokens || 0; u.n += 1;
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch { /* без счётчика */ }
}
export const usageCost = (u) => (u.in / 1e6) * PRICE.in + (u.out / 1e6) * PRICE.out;

const HISTORY = 12;   // сколько последних сообщений переписки отправлять модели

/**
 * Сообщение в чат. history — переписка [{role:'user'|'assistant', content}],
 * последнее сообщение — вопрос педагога. Сводка данных добавляется к
 * системному сообщению заново при каждом вопросе (цифры всегда свежие).
 */
export async function askAssistant(history) {
  const url = assistantUrl();
  if (!url) throw new Error('Помощник не подключён — укажите адрес функции: кнопка «Настройка» вверху страницы.');
  if (!cloudState().signedIn || !token()) throw new Error('Чтобы пользоваться помощником, войдите через Яндекс (кнопка «Войти» вверху).');
  const system = `${SYSTEM}\n\n# СВОДКА ДАННЫХ САЙТА\n${buildSummary()}`;
  const messages = [{ role: 'system', content: system }, ...history.slice(-HISTORY).map(m => ({ role: m.role, content: m.content }))];
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Yandex-Token': token() },
      body: JSON.stringify({ mode: 'chat', messages }),
    });
  } catch (e) {
    throw new Error(`Помощник недоступен (${e.message}). Проверьте интернет и адрес функции.`);
  }
  let data = null;
  try { data = await res.json(); } catch { /* не JSON */ }
  if (!res.ok) throw new Error(data?.error || `Помощник ответил ошибкой ${res.status}`);
  addUsage(data.usage);
  return data;
}
