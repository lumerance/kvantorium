// Облачное сохранение: вход через Яндекс ID и хранение данных в папке
// приложения на Яндекс.Диске самого педагога. Без своего сервера и базы —
// сайт остаётся статическим (GitHub Pages).
//
// Вход — OAuth «implicit flow»: переход на oauth.yandex.ru, Яндекс
// возвращает на этот же адрес с #access_token=… в адресе. Токен хранится
// только на этом устройстве (localStorage), пароль сайт не видит.
//
// Данные — один файл app:/kvantorium28.json: {savedAt, device, state}.
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
const FILE = 'app:/kvantorium28.json';
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
  const res = await fetch(path.startsWith('http') ? path : API + path, {
    ...opts, headers: { Authorization: `OAuth ${auth.token}`, Accept: 'application/json', ...(opts.headers || {}) },
  });
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

/** Метаданные файла в облаке или null, если файла ещё нет. */
async function remoteMeta() {
  const res = await api(`/resources?path=${encodeURIComponent(FILE)}&fields=modified,md5,size`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Яндекс.Диск: ${res.status}`);
  return res.json();
}

async function download() {
  const res = await api(`/resources/download?path=${encodeURIComponent(FILE)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Яндекс.Диск: ${res.status}`);
  const { href } = await res.json();
  const file = await fetch(href);
  if (!file.ok) throw new Error(`Яндекс.Диск (скачивание): ${file.status}`);
  return JSON.parse(await file.text());
}

async function upload(text) {
  const res = await api(`/resources/upload?path=${encodeURIComponent(FILE)}&overwrite=true`);
  if (!res.ok) throw new Error(`Яндекс.Диск: ${res.status}`);
  const { href } = await res.json();
  const put = await fetch(href, { method: 'PUT', body: new Blob([text], { type: 'application/json' }) });
  if (!put.ok && put.status !== 201 && put.status !== 202) throw new Error(`Яндекс.Диск (загрузка): ${put.status}`);
  return remoteMeta();
}

/* ---------------- синхронизация ---------------- */
let pushTimer = null;
let applying = false;          // идёт подстановка облачной версии — это не «правка»
let busy = false;
let conflictHandler = null;    // (remote) => Promise<'cloud'|'local'>
let onApplied = null;          // перерисовать страницу после подстановки облачной версии

const device = () => `${navigator.platform || 'устройство'} · ${(navigator.userAgent.match(/(Chrome|Firefox|Safari|Edg)\/[\d.]+/) || [''])[0]}`;
const localDirty = () => !!read(SYNC_KEY)?.dirty;
const markSynced = (meta) => write(SYNC_KEY, { lastSync: new Date().toISOString(), remoteModified: meta?.modified || null, remoteMd5: meta?.md5 || null, dirty: false });

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
      await pushNow(true);
      return;
    }
    const remoteChanged = meta.md5 !== sync.remoteMd5;
    if (!remoteChanged) {
      if (localDirty()) await pushNow(true); else { markSynced(meta); setStatus('idle'); }
      return;
    }
    const remote = await download();
    const hasLocal = (getState().agglomerations || []).some(a => a.students || Object.keys(a.journal || {}).length) || (getState().salary?.history || []).length;
    if (!sync.lastSync && hasLocal && remote) {
      // первое подключение устройства, где уже есть свои данные
      const pick = conflictHandler ? await conflictHandler(remote, 'first') : 'cloud';
      if (pick === 'local') { await pushNow(true); return; }
      if (pick === 'later') { setStatus('conflict'); return; }
    } else if (localDirty() && remote) {
      const pick = conflictHandler ? await conflictHandler(remote, 'conflict') : 'cloud';
      if (pick === 'local') { await pushNow(true); return; }
      if (pick === 'later') { setStatus('conflict'); return; }
    }
    if (remote) applyRemote(remote);
    markSynced(meta);
    setStatus('idle');
  } catch (e) { handleError(e); } finally { busy = false; }
}

/** Отправка текущих данных в облако. force — без проверки на чужие изменения. */
async function pushNow(force = false) {
  clearTimeout(pushTimer);
  if (!read(AUTH_KEY)?.token) return;
  const wasBusy = busy;
  busy = true;
  setStatus('saving');
  try {
    if (!force) {
      const meta = await remoteMeta();
      const sync = read(SYNC_KEY) || {};
      if (meta && sync.remoteMd5 && meta.md5 !== sync.remoteMd5) {
        // кто-то сохранил с другого устройства — не затираем молча
        busy = wasBusy;
        await syncNowUnlocked();
        return;
      }
    }
    const text = JSON.stringify({ app: 'kvantorium28', savedAt: new Date().toISOString(), device: device(), state: JSON.parse(exportBackup()).state });
    const meta = await upload(text);
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
