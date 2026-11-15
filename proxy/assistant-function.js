// Посредник для помощника сайта «Кванториум-28» — облачная функция
// (Yandex Cloud Functions, среда Node.js 18+). Ключ Cloud.ru хранится только
// здесь, в переменных окружения функции, и никогда не попадает на сайт.
//
// Что делает:
//  1. Проверяет, что вопрос задаёт педагог, вошедший на сайт через Яндекс ID,
//     и его логин есть в списке ALLOWED_LOGINS (чужие не потратят ваши деньги).
//  2. Ограничивает размер запроса и число запросов в день на педагога.
//  3. Отправляет переписку модели в Cloud.ru (Foundation Models) и возвращает ответ.
//
// Переменные окружения функции:
//   CLOUDRU_API_KEY  — API-ключ сервисного аккаунта Cloud.ru (обязательно)
//   ALLOWED_LOGINS   — логины Яндекса через запятую: ivanov,petrova (обязательно)
//   ALLOWED_ORIGIN   — адрес сайта, например https://lumerance.github.io (по умолчанию *)
//   MODEL            — модель (по умолчанию ai-sage/GigaChat3.5-432B-A28B)
//   DAILY_LIMIT      — запросов в сутки на педагога (по умолчанию 150)
//   STATS_BUCKET     — бакет Object Storage для статистики (необязательно; см. README)
//   ADMIN_LOGINS     — кто видит статистику (по умолчанию — первый логин из ALLOWED_LOGINS)

const API = 'https://foundation-models.api.cloud.ru/v1/chat/completions';
const MODEL = process.env.MODEL || 'ai-sage/GigaChat3.5-432B-A28B';
const ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT) || 150;
const MAX_CHARS = 24000;          // на весь запрос (~8 тыс. токенов)
const STATS_BUCKET = process.env.STATS_BUCKET || '';

// режимы: chat — общий чат сайта (и вопросы по данным, и мастер-классы),
// data / creative — на случай отдельных запросов
const MODES = {
  chat: { temperature: 0.4, max_tokens: 1500, presence_penalty: 0.1 },
  data: { temperature: 0.1, max_tokens: 400 },
  creative: { temperature: 0.7, max_tokens: 1500, presence_penalty: 0.3 },
};

const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Yandex-Token',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin',
};
const reply = (statusCode, obj) => ({ statusCode, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj) });

// кэши живут, пока функция «тёплая» — этого достаточно
const tokenCache = new Map();      // token -> { login, until }
const daily = new Map();           // `${login}|${YYYY-MM-DD}` -> count

async function loginOf(token) {
  const hit = tokenCache.get(token);
  if (hit && hit.until > Date.now()) return hit.login;
  const r = await fetch('https://login.yandex.ru/info?format=json', { headers: { Authorization: `OAuth ${token}` } });
  if (!r.ok) return null;
  const login = String((await r.json()).login || '').toLowerCase();
  if (login) tokenCache.set(token, { login, until: Date.now() + 10 * 60 * 1000 });
  return login || null;
}

/* ---------- статистика: Object Storage, файл stats/ГГГГ-ММ.json ----------
 * { logins: { login: { n, in, out, last, days: { 'ДД': n } } } }
 * Доступ — IAM-токеном сервисного аккаунта функции (context.token), роль
 * storage.editor на бакет. Без STATS_BUCKET статистика просто не ведётся. */
const statsUrl = (month) => `https://storage.yandexcloud.net/${STATS_BUCKET}/stats/${month}.json`;
async function readStats(month, iam) {
  const r = await fetch(statsUrl(month), { headers: { Authorization: `Bearer ${iam}` } });
  if (r.status === 404) return { logins: {} };
  if (!r.ok) throw new Error(`Object Storage: ${r.status}`);
  return r.json();
}
async function writeStats(month, data, iam) {
  const r = await fetch(statsUrl(month), { method: 'PUT', headers: { Authorization: `Bearer ${iam}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!r.ok) throw new Error(`Object Storage: ${r.status}`);
}
async function recordUsage(login, usage, iam) {
  const now = new Date();
  const month = now.toISOString().slice(0, 7), day = now.toISOString().slice(8, 10);
  const data = await readStats(month, iam);
  const u = (data.logins[login] ||= { n: 0, in: 0, out: 0, days: {} });
  u.n += 1; u.in += usage?.prompt_tokens || 0; u.out += usage?.completion_tokens || 0;
  u.days[day] = (u.days[day] || 0) + 1; u.last = now.toISOString();
  await writeStats(month, data, iam);
}

const header = (event, name) => {
  const hs = event.headers || {};
  const key = Object.keys(hs).find(k => k.toLowerCase() === name);
  return key ? hs[key] : '';
};

module.exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Только POST' });
  if (!process.env.CLOUDRU_API_KEY) return reply(500, { error: 'В функции не задан CLOUDRU_API_KEY' });

  // 1. кто спрашивает
  const token = header(event, 'x-yandex-token');
  if (!token) return reply(401, { error: 'Войдите на сайт через Яндекс' });
  const login = await loginOf(token).catch(() => null);
  if (!login) return reply(401, { error: 'Вход устарел — войдите на сайт заново' });
  const allowed = String(process.env.ALLOWED_LOGINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(login)) return reply(403, { error: `Логин «${login}» не добавлен в помощника. Попросите владельца сайта добавить его в ALLOWED_LOGINS.` });

  // 2. что спрашивает
  let body;
  try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '{}')); }
  catch { return reply(400, { error: 'Некорректный запрос' }); }
  const admins = String(process.env.ADMIN_LOGINS || allowed[0] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const isAdmin = admins.includes(login);
  const iam = context?.token?.access_token || '';

  // статистика — только для владельца
  if (body.mode === 'stats') {
    if (!isAdmin) return reply(403, { error: 'Статистика доступна только владельцу помощника (ADMIN_LOGINS).' });
    if (!STATS_BUCKET || !iam) return reply(200, { enabled: false, months: {} });
    const now = new Date();
    const months = [0, 1, 2].map(k => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)).toISOString().slice(0, 7));
    const out = {};
    try { for (const m of months) out[m] = (await readStats(m, iam)).logins || {}; }
    catch (e) { return reply(502, { error: `Статистика: ${e.message}` }); }
    return reply(200, { enabled: true, months: out, allowed, model: MODEL });
  }

  const mode = MODES[body.mode] ? body.mode : 'chat';
  const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  if (!messages.length || messages.some(m => !['system', 'user', 'assistant'].includes(m?.role) || typeof m.content !== 'string')) {
    return reply(400, { error: 'Некорректный запрос' });
  }
  const size = messages.reduce((a, m) => a + m.content.length, 0);
  if (size > MAX_CHARS) return reply(413, { error: 'Слишком длинный запрос' });

  // 3. лимит в сутки
  const dayKey = `${login}|${new Date().toISOString().slice(0, 10)}`;
  const used = daily.get(dayKey) || 0;
  if (used >= DAILY_LIMIT) return reply(429, { error: `На сегодня лимит помощника исчерпан (${DAILY_LIMIT} запросов). Продолжим завтра.` });
  daily.set(dayKey, used + 1);

  // 4. к модели
  let r;
  try {
    r = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.CLOUDRU_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, top_p: 0.95, ...MODES[mode] }),
    });
  } catch (e) {
    return reply(502, { error: 'Модель не ответила — попробуйте ещё раз' });
  }
  if (!r.ok) {
    const hint = r.status === 402 ? 'на счёте Cloud.ru закончились средства или сервис не подключён'
      : r.status === 401 || r.status === 403 ? 'ключ Cloud.ru недействителен или у него нет прав'
      : r.status === 429 ? 'модель перегружена или достигнут лимит ключа' : `ошибка ${r.status}`;
    return reply(502, { error: `Cloud.ru: ${hint}` });
  }
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content || '';
  if (STATS_BUCKET && iam) await recordUsage(login, j.usage, iam).catch(e => console.error('stats', e.message));
  console.log(JSON.stringify({ login, mode, in: j.usage?.prompt_tokens || 0, out: j.usage?.completion_tokens || 0 }));
  return reply(200, { text, usage: j.usage || null, model: MODEL, mode, admin: isAdmin || undefined });
};
