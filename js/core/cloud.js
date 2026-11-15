// Облачное сохранение: вход через Яндекс ID и хранение данных в папке
// приложения на Яндекс.Диске самого педагога. Без своего сервера и базы —
// сайт остаётся статическим (GitHub Pages).
//
// Вход — OAuth «implicit flow»: переход на oauth.yandex.ru, Яндекс
// возвращает на этот же адрес с #access_token=… в адресе. Токен хранится
// только на этом устройстве (localStorage), пароль сайт не видит.
//
// Данные — в метаданных папок app:/kv/… (см. «хранилище на Диске» ниже).
// Синхронизация:
//  • при входе и при открытии сайта — скачиваем файл; если на устройстве
//    ничего не меняли с прошлой синхронизации — берём облачную версию;
//  • после каждой правки — через 3 с отправляем файл на Диск;
//  • если и здесь есть несохранённые правки, и в облаке появилась более
//    новая версия (с другого устройства) — спрашиваем, какую оставить.
import { getState, subscribe, exportBackup, importBackup } from './store.js';

export const CLIENT_ID = '8c4ada29b25c44849fedefc26300369a';
const AUTH_KEY = 'kvantorium28.auth';
const SYNC_KEY = 'kvantorium28.sync';
const API = 'https://cloud-api.yandex.net/v1/disk';
const PUSH_DELAY = 3000;

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* без памяти */ } };

/* ---------------- состояние для интерфейса ---------------- */
// status: 'off' (не вошли) | 'idle' (всё сохранено) | 'dirty' | 'saving' | 'loading' | 'offline' | 'error' | 'conflict'
let status = read(AUTH_KEY)?.token ? 'idle' : 'off';
let lastError = '';
const listeners = new Set();
export const onCloud = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(cloudState()); } catch (e) { console.error(e); } });
const setStatus = (s, err = '') => { status = s; lastError = err; emit(); };

export function cloudState() {
  const auth = read(AUTH_KEY);
  const sync = read(SYNC_KEY) || {};
  return { status, error: lastError, user: auth?.user || null, signedIn: !!auth?.token, lastSync: sync.lastSync || null };
}

/** «Фамилия Имя» вошедшего педагога (для подстановки в документы) или ''. */
export function accountName() {
  const u = read(AUTH_KEY)?.user;
  if (!u) return '';
  return [u.last_name, u.first_name].filter(Boolean).join(' ') || u.real_name || u.display_name || '';
}
export function accountShort() {
  const u = read(AUTH_KEY)?.user;
  if (!u) return '';
  if (u.last_name) return `${u.last_name}${u.first_name ? ' ' + u.first_name[0] + '.' : ''}`;
  return u.display_name || u.login || '';
}
export const avatarUrl = (u) => (u?.default_avatar_id && !u.is_avatar_empty ? `https://avatars.yandex.net/get-yapic/${u.default_avatar_id}/islands-68` : null);

/* ---------------- вход ---------------- */
const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

export function login() {
  const stateParam = Math.random().toString(36).slice(2);
  try {
    sessionStorage.setItem('kvantorium28.oauth', JSON.stringify({ state: stateParam, back: location.hash || '#/dashboard' }));
  } catch { /* вернёмся на главную */ }
  const q = new URLSearchParams({
    response_type: 'token', client_id: CLIENT_ID, redirect_uri: redirectUri(), state: stateParam, force_confirm: 'no',
  });
  location.href = `https://oauth.yandex.ru/authorize?${q}`;
}

/**
 * Вызывается до запуска роутера: если Яндекс вернул в адресе токен (или
 * ошибку) — забирает его и возвращает адрес страницы, с которой уходили.
 * @returns {{ok:boolean, error?:string}|null} null — в адресе ничего от Яндекса
 */
export function handleRedirect() {
  const raw = location.hash.replace(/^#/, '');
  if (!/(^|&)(access_token|error)=/.test(raw)) return null;
  const p = new URLSearchParams(raw);
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem('kvantorium28.oauth') || 'null'); sessionStorage.removeItem('kvantorium28.oauth'); } catch { /* нет */ }
  history.replaceState(null, '', location.pathname + location.search + (saved?.back || '#/dashboard'));
  if (p.get('error')) return { ok: false, error: p.get('error_description') || p.get('error') };
  if (saved && p.get('state') !== saved.state) return { ok: false, error: 'Ответ Яндекса не совпал с запросом — попробуйте войти ещё раз.' };
  const expiresIn = Number(p.get('expires_in')) || 365 * 24 * 3600;
  write(AUTH_KEY, { token: p.get('access_token'), expiresAt: Date.now() + expiresIn * 1000, user: null });
  write(SYNC_KEY, null);                               // новая привязка — сначала смотрим, что в облаке
  status = 'idle';
  return { ok: true };
}

export function logout({ wipe = false } = {}) {
  write(AUTH_KEY, null);
  write(SYNC_KEY, null);
  clearTimeout(pushTimer);
  setStatus('off');
  if (wipe) { try { localStorage.removeItem('kvantorium28.state.v1'); } catch { /* */ } location.reload(); }
}

/* ---------------- запросы ---------------- */
class AuthError extends Error {}

async function api(path, opts = {}) {
  const auth = read(AUTH_KEY);
  if (!auth?.token) throw new AuthError('Не выполнен вход');
  let res;
  try {
    res = await fetch(path.startsWith('http') ? path : API + path, {
      ...opts, headers: { Authorization: `OAuth ${auth.token}`, Accept: 'application/json', ...(opts.headers || {}) },
    });
  } catch (e) {
    const host = path.startsWith('http') ? new URL(path).host : 'cloud-api.yandex.net';
    throw new Error(`нет ответа от ${host} (${e.message})`);
  }
  if (res.status === 401 || res.status === 403) throw new AuthError('Вход устарел — войдите заново');
  return res;
}

async function fetchUser() {
  const res = await api('https://login.yandex.ru/info?format=json');
  if (!res.ok) throw new Error(`Яндекс ID: ${res.status}`);
  const u = await res.json();
  const auth = read(AUTH_KEY);
  if (auth) write(AUTH_KEY, { ...auth, user: u });
  return u;
}

/* ---------------- хранилище на Диске ----------------
 * Сервер скачивания Яндекс.Диска (downloader.disk.yandex.ru) не разрешает
 * браузеру читать файлы со стороннего сайта, поэтому данные лежат не файлом,
 * а в метаданных (custom_properties) маленьких папок — их отдаёт обычный
 * API Диска, с которым браузеру работать можно.
 *
 *   app:/kv/_meta        — {v: версия, at, dev, s: «раздел:хэш:кусков;…»}
 *   app:/kv/core.0 …     — общие данные (зарплата, часы, настройки)
 *   app:/kv/a<id>.0 …    — каждая агломерация отдельно
 *
 * Раздел сжимается (gzip) и режется на куски по ~950 символов base64 — лимит
 * метаданных одной папки 1 КБ. Отправляются только изменившиеся разделы:
 * отметка в журнале перезаписывает одну агломерацию, а не всё сразу. */
const ROOT = 'app:/kv';
const CHUNK = 950;

const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); };
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (str) => Uint8Array.from(atob(str), c => c.charCodeAt(0));
const canGzip = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
async function pack(text) {
  if (!canGzip) return 'r' + b64(new TextEncoder().encode(text));
  const buf = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return 'z' + b64(new Uint8Array(buf));
}
async function unpack(data) {
  const bytes = unb64(data.slice(1));
  if (data[0] === 'r') return new TextDecoder().decode(bytes);
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

/** Состояние -> разделы [{name, json}]; агломерации — отдельными разделами. */
function splitState(state) {
  const aggs = state.agglomerations || [];
  const name = (a) => 'a' + String(a.id).replace(/[^A-Za-z0-9_-]/g, '');
  const core = { ...state, agglomerations: undefined, __aggOrder: aggs.map(name) };
  return [{ name: 'core', json: JSON.stringify(core) }, ...aggs.map(a => ({ name: name(a), json: JSON.stringify(a) }))];
}
function joinState(parts) {
  const core = JSON.parse(parts.core);
  const order = core.__aggOrder || [];
  delete core.__aggOrder;
  core.agglomerations = order.filter(n => parts[n]).map(n => JSON.parse(parts[n]));
  return core;
}
const parseSections = (s) => Object.fromEntries(String(s || '').split(';').filter(Boolean).map(x => { const [n, h, c] = x.split(':'); return [n, { h, n: Number(c) }]; }));

/** Несколько запросов параллельно, но не больше limit одновременно. */
async function pool(tasks, limit = 6) {
  let i = 0;
  const run = async () => { while (i < tasks.length) { const t = tasks[i++]; await t(); } };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, run));
}

const q = (path) => `path=${encodeURIComponent(path)}`;
async function mkdir(path) {
  const res = await api(`/resources?${q(path)}`, { method: 'PUT' });
  if (!res.ok && res.status !== 409) throw new Error(`Яндекс.Диск (папка): ${res.status}`);
}
async function setProps(path, props, exists) {
  if (!exists) await mkdir(path);
  let res = await api(`/resources?${q(path)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ custom_properties: props }) });
  if (res.status === 404 && exists) { await mkdir(path); res = await api(`/resources?${q(path)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ custom_properties: props }) }); }
  if (!res.ok) throw new Error(`Яндекс.Диск (запись): ${res.status}`);
}
async function rm(path) {
  const res = await api(`/resources?${q(path)}&permanently=true`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404 && res.status !== 202) throw new Error(`Яндекс.Диск (удаление): ${res.status}`);
}

/** Описание версии в облаке или null, если там ещё ничего нет. */
async function remoteMeta() {
  const res = await api(`/resources?${q(ROOT + '/_meta')}&fields=custom_properties`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Яндекс.Диск: ${res.status}`);
  const p = (await res.json()).custom_properties || {};
  return p.v ? { v: p.v, at: p.at, dev: p.dev, s: p.s, sections: parseSections(p.s) } : null;
}

/** Все куски: имя папки -> custom_properties. */
async function listChunks() {
  const out = {};
  let offset = 0;
  for (;;) {
    const res = await api(`/resources?${q(ROOT)}&limit=200&offset=${offset}&fields=_embedded.items.name,_embedded.items.custom_properties,_embedded.total`);
    if (res.status === 404) break;
    if (!res.ok) throw new Error(`Яндекс.Диск (чтение): ${res.status}`);
    const emb = (await res.json())._embedded || {};
    for (const it of emb.items || []) out[it.name] = it.custom_properties || null;
    offset += (emb.items || []).length;
    if (!(emb.items || []).length || offset >= (emb.total || 0)) break;
  }
  return out;
}

async function download() {
  const meta = await remoteMeta();
  if (!meta) return null;
  const items = await listChunks();
  const parts = {};
  for (const [name, { h, n }] of Object.entries(meta.sections)) {
    let data = '';
    for (let i = 0; i < n; i++) {
      let p = items[`${name}.${i}`];
      if (p === null) {      // список пришёл без метаданных — запросим кусок отдельно
        const r = await api(`/resources?${q(`${ROOT}/${name}.${i}`)}&fields=custom_properties`);
        p = r.ok ? (await r.json()).custom_properties : undefined;
      }
      if (!p || p.h !== h) throw new Error('в облаке не хватает части данных — возможно, прямо сейчас идёт сохранение с другого устройства. Повторите через минуту');
      data += p.d;
    }
    parts[name] = await unpack(data);
    if (fnv(parts[name]) !== h) throw new Error('данные в облаке повреждены — повторите синхронизацию');
  }
  return { state: joinState(parts), savedAt: meta.at, device: meta.dev, v: meta.v };
}

/** Отправка: только разделы, которые отличаются от облачных. */
async function upload(state, remote) {
  await mkdir(ROOT);
  const old = remote?.sections || {};
  const sections = await Promise.all(splitState(state).map(async (sec) => {
    const h = fnv(sec.json);
    const data = old[sec.name]?.h === h ? null : await pack(sec.json);
    const n = data === null ? old[sec.name].n : Math.max(1, Math.ceil(data.length / CHUNK));
    return { ...sec, h, n, data };
  }));
  const tasks = [];
  for (const sec of sections) {
    if (sec.data === null) continue;
    const had = old[sec.name]?.n || 0;
    for (let i = 0; i < sec.n; i++) {
      const props = { d: sec.data.slice(i * CHUNK, (i + 1) * CHUNK), h: sec.h };
      tasks.push(() => setProps(`${ROOT}/${sec.name}.${i}`, props, i < had));
    }
  }
  await pool(tasks);
  // лишние куски: раздел стал короче или агломерацию удалили
  const del = [];
  for (const [name, { n }] of Object.entries(old)) {
    const now = sections.find(x => x.name === name);
    for (let i = now ? now.n : 0; i < n; i++) del.push(() => rm(`${ROOT}/${name}.${i}`));
  }
  const v = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const meta = { v, at: new Date().toISOString(), dev: device().slice(0, 80), s: sections.map(x => `${x.name}:${x.h}:${x.n}`).join(';') };
  await setProps(`${ROOT}/_meta`, meta, !!remote);
  await pool(del).catch(() => null);          // не удалилось — не страшно, лишние куски не читаются
  return { ...meta, sections: parseSections(meta.s) };
}

/* ---------------- синхронизация ---------------- */
let pushTimer = null;
let applying = false;          // идёт подстановка облачной версии — это не «правка»
let busy = false;
let conflictHandler = null;    // (remote) => Promise<'cloud'|'local'>
let onApplied = null;          // перерисовать страницу после подстановки облачной версии

const device = () => `${navigator.platform || 'устройство'} · ${(navigator.userAgent.match(/(Chrome|Firefox|Safari|Edg)\/[\d.]+/) || [''])[0]}`;
const localDirty = () => !!read(SYNC_KEY)?.dirty;
const markSynced = (meta) => write(SYNC_KEY, { lastSync: new Date().toISOString(), remoteV: meta?.v || null, dirty: false });

function handleError(e) {
  console.error(e);
  if (e instanceof AuthError) { write(AUTH_KEY, null); setStatus('off', e.message); return; }
  if (!navigator.onLine) { setStatus('offline'); return; }
  setStatus('error', e.message || String(e));
}

function applyRemote(remote) {
  applying = true;
  try { importBackup(JSON.stringify(remote.state)); } finally { applying = false; }
  onApplied?.();
}

/** Сверка с облаком: вызывается при входе, открытии сайта и вручную. */
export async function syncNow() {
  if (!read(AUTH_KEY)?.token || busy) return;
  busy = true;
  setStatus('loading');
  try {
    if (!read(AUTH_KEY)?.user) await fetchUser().catch(() => null);
    const meta = await remoteMeta();
    const sync = read(SYNC_KEY) || {};
    if (!meta) {                                    // в облаке пусто — кладём то, что есть здесь
      await pushNow(true, null);
      return;
    }
    const remoteChanged = meta.v !== sync.remoteV;
    if (!remoteChanged) {
      if (localDirty()) await pushNow(true, meta); else { markSynced(meta); setStatus('idle'); }
      return;
    }
    const remote = await download();
    const hasLocal = (getState().agglomerations || []).some(a => a.students || Object.keys(a.journal || {}).length) || (getState().salary?.history || []).length;
    if (!sync.lastSync && hasLocal && remote) {
      // первое подключение устройства, где уже есть свои данные
      const pick = conflictHandler ? await conflictHandler(remote, 'first') : 'cloud';
      if (pick === 'local') { await pushNow(true, meta); return; }
      if (pick === 'later') { setStatus('conflict'); return; }
    } else if (localDirty() && remote) {
      const pick = conflictHandler ? await conflictHandler(remote, 'conflict') : 'cloud';
      if (pick === 'local') { await pushNow(true, meta); return; }
      if (pick === 'later') { setStatus('conflict'); return; }
    }
    if (remote) applyRemote(remote);
    markSynced(meta);
    setStatus('idle');
  } catch (e) { handleError(e); } finally { busy = false; }
}

/** Отправка текущих данных в облако. force — без проверки на чужие изменения. */
async function pushNow(force = false, knownRemote) {
  clearTimeout(pushTimer);
  if (!read(AUTH_KEY)?.token) return;
  const wasBusy = busy;
  busy = true;
  setStatus('saving');
  try {
    const remote = knownRemote !== undefined ? knownRemote : await remoteMeta();
    if (!force) {
      const sync = read(SYNC_KEY) || {};
      if (remote && sync.remoteV && remote.v !== sync.remoteV) {
        // кто-то сохранил с другого устройства — не затираем молча
        busy = wasBusy;
        await syncNowUnlocked();
        return;
      }
    }
    const meta = await upload(JSON.parse(exportBackup()).state, remote);
    markSynced(meta);
    setStatus('idle');
  } catch (e) {
    const s = read(SYNC_KEY) || {};
    write(SYNC_KEY, { ...s, dirty: true });
    handleError(e);
  } finally { if (!wasBusy) busy = false; }
}

async function syncNowUnlocked() { busy = false; return syncNow(); }

/** Подключение к магазину данных: каждая правка — отложенная отправка. */
export function initCloud({ onConflict, onRemoteApplied } = {}) {
  conflictHandler = onConflict || null;
  onApplied = onRemoteApplied || null;
  subscribe(() => {
    if (applying || !read(AUTH_KEY)?.token) return;
    const s = read(SYNC_KEY) || {};
    write(SYNC_KEY, { ...s, dirty: true });
    if (status !== 'saving' && status !== 'loading') setStatus('dirty');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { if (navigator.onLine) pushNow(); else setStatus('offline'); }, PUSH_DELAY);
  });
  window.addEventListener('online', () => { if (read(AUTH_KEY)?.token) (localDirty() ? pushNow() : syncNow()); });
  window.addEventListener('offline', () => { if (read(AUTH_KEY)?.token) setStatus('offline'); });
  // вернулись на вкладку — вдруг с другого устройства что-то сохранили
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && read(AUTH_KEY)?.token && !localDirty()) syncNow();
  });
  // перед закрытием вкладки — попытаться дослать правки
  window.addEventListener('pagehide', () => { if (localDirty() && read(AUTH_KEY)?.token) pushNow(); });
  const auth = read(AUTH_KEY);
  if (auth?.token && auth.expiresAt && auth.expiresAt < Date.now()) { write(AUTH_KEY, null); setStatus('off', 'Вход устарел — войдите заново'); return; }
  if (auth?.token) syncNow();
}
