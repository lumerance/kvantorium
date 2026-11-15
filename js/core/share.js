// «Поделиться с коллегами»: педагог публикует свои группы и составленные
// расписания по постоянной публичной ссылке на своём Яндекс.Диске, а коллега
// один раз вставляет ссылку — и его генератор расписания подтягивает их сам.
//
// Как хранится. В публичной папке надёжно читаются только имена вложенных
// папок, поэтому данные лежат прямо в именах: JSON сжимается (gzip),
// кодируется в base64url и режется на куски по 200 символов; каждый кусок —
// пустая папка «<версия>.<номер>.<всего>.<данные>» в app:/share.
// Публикуется только то, что нужно для расписания: коды групп, часы, даты и
// уроки, строка «Направление (педагог)», названия мест. Без детей и оценок.
import { getState, update, subscribe } from './store.js';
import { cloudState, diskApi, pack, unpack, fnv } from './cloud.js';
import { placeOfAgg } from '../data/places.js';
import { groupsOfAgg } from '../pages/schedule-gen.js';

const ROOT = 'app:/share';
const PUBLIC_API = 'https://cloud-api.yandex.net/v1/disk/public/resources';
const PART = 200;
const q = (p) => `path=${encodeURIComponent(p)}`;
const toUrl64 = (s) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrl64 = (s) => { const b = s.slice(1).replace(/-/g, '+').replace(/_/g, '/'); return s[0] + b + '='.repeat((4 - b.length % 4) % 4); };

/** Строка над уроками в расписании: «Квантум (Фамилия И.)». */
export function directionOf(st = getState()) {
  if (st.scheduleGen?.direction) return st.scheduleGen.direction;
  const kv = st.docsProfile?.kvantum || st.plan?.direction || '';
  const [last, first] = String(st.docsProfile?.teacher || st.plan?.teacher || '').trim().split(/\s+/);
  const t = last ? `${last}${first ? ' ' + first[0] + '.' : ''}` : '';
  return kv ? `${kv}${t ? ` (${t})` : ''}` : t;
}

/** Что публикуется. */
export function buildSharePayload(st = getState()) {
  const aggs = [];
  for (const agg of st.agglomerations || []) {
    const shifts = {};
    for (const sh of [1, 2, 3]) {
      const groups = groupsOfAgg(agg, sh).filter(g => g.on).map(g => ({ code: g.code, hours: g.hours, isDo: !!g.isDo }));
      const sc = agg.schedules?.[String(sh)];
      const d = (st.scheduleDrafts || {})[`${agg.id}|${sh}`];
      const grid = d?.grid ? Object.fromEntries(Object.entries(d.grid).filter(([, row]) => row.some(Boolean))) : null;
      if (!groups.length && !grid) continue;
      shifts[sh] = {
        from: d?.from || sc?.dates?.[0] || null, to: d?.to || sc?.dates?.at(-1) || null,
        groups, draft: grid ? { grid, savedAt: d.savedAt || null } : null,
      };
    }
    if (Object.keys(shifts).length) aggs.push({ name: agg.name, place: placeOfAgg(agg), shifts });
  }
  return { v: 1, direction: directionOf(st), updatedAt: new Date().toISOString(), aggs };
}

/* ---------------- публикация ---------------- */
let busy = false;

async function listOwn() {
  const out = [];
  for (let offset = 0; ; offset += 200) {
    const r = await diskApi(`/resources?${q(ROOT)}&limit=200&offset=${offset}&fields=_embedded.items.name,_embedded.total`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Яндекс.Диск: ${r.status}`);
    const emb = (await r.json())._embedded || {};
    out.push(...(emb.items || []).map(i => i.name));
    if (!(emb.items || []).length || out.length >= (emb.total || 0)) return out;
  }
}
async function pool(tasks, n = 6) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => { while (i < tasks.length) await tasks[i++](); }));
}

/** Выложить актуальные данные (если изменились) и вернуть публичную ссылку. */
export async function publishShare({ force = false } = {}) {
  if (busy || !cloudState().signedIn) return getState().share?.url || null;
  busy = true;
  try {
    const json = JSON.stringify({ ...buildSharePayload(), updatedAt: undefined });
    const ver = fnv(json);
    const st = getState();
    if (!force && st.share?.ver === ver && st.share?.url) return st.share.url;
    const data = toUrl64((await pack(JSON.stringify(buildSharePayload()))));
    const n = Math.max(1, Math.ceil(data.length / PART));
    let names = await listOwn();
    if (names === null) {
      const r = await diskApi(`/resources?${q(ROOT)}`, { method: 'PUT' });
      if (!r.ok && r.status !== 409) throw new Error(`Яндекс.Диск (папка): ${r.status}`);
      names = [];
    }
    const want = Array.from({ length: n }, (_, i) => `${ver}.${i}.${n}.${data.slice(i * PART, (i + 1) * PART)}`);
    const have = new Set(names);
    await pool(want.filter(w => !have.has(w)).map(w => async () => {
      const r = await diskApi(`/resources?${q(`${ROOT}/${w}`)}`, { method: 'PUT' });
      if (!r.ok && r.status !== 409) throw new Error(`Яндекс.Диск (запись): ${r.status}`);
    }));
    // публикация папки (один раз) и ссылка
    let url = st.share?.url;
    if (!url) {
      const p = await diskApi(`/resources/publish?${q(ROOT)}`, { method: 'PUT' });
      if (!p.ok) throw new Error(`Яндекс.Диск (публикация): ${p.status}`);
      const m = await diskApi(`/resources?${q(ROOT)}&fields=public_url,public_key`);
      url = (await m.json()).public_url;
      if (!url) throw new Error('Яндекс.Диск не выдал публичную ссылку');
    }
    // старые версии — удалить (после записи новой: читатель всегда найдёт целую)
    const old = names.filter(nm => !nm.startsWith(ver + '.'));
    await pool(old.map(nm => () => diskApi(`/resources?${q(`${ROOT}/${nm}`)}&permanently=true`, { method: 'DELETE' }).catch(() => null)));
    update(x => { x.share = { ...(x.share || {}), enabled: true, url, ver, publishedAt: new Date().toISOString() }; });
    return url;
  } finally { busy = false; }
}

/** Отменить публикацию: ссылка перестанет работать. */
export async function unpublishShare() {
  if (cloudState().signedIn) {
    await diskApi(`/resources/unpublish?${q(ROOT)}`, { method: 'PUT' }).catch(() => null);
    await diskApi(`/resources?${q(ROOT)}&permanently=true`, { method: 'DELETE' }).catch(() => null);
  }
  update(x => { x.share = { enabled: false }; });
}

/** Автообновление опубликованных данных после правок (раз в ~20 с). */
export function initShare() {
  let t = null;
  const kick = () => {
    if (!getState().share?.enabled || !cloudState().signedIn) return;
    clearTimeout(t);
    t = setTimeout(() => publishShare().catch(e => console.warn('share', e)), 20000);
  };
  subscribe(kick);
  setTimeout(kick, 3000);
}

/* ---------------- чтение данных коллеги ---------------- */
/** Данные по публичной ссылке коллеги (без входа, через публичный API Диска). */
export async function readShare(url) {
  const items = [];
  for (let offset = 0; ; offset += 200) {
    let r;
    try { r = await fetch(`${PUBLIC_API}?public_key=${encodeURIComponent(url)}&limit=200&offset=${offset}`); }
    catch (e) { throw new Error(`Яндекс.Диск не ответил (${e.message})`); }
    if (r.status === 404) throw new Error('По ссылке ничего нет — коллега мог отменить публикацию');
    if (!r.ok) throw new Error(`Яндекс.Диск: ${r.status}`);
    const emb = (await r.json())._embedded || {};
    items.push(...(emb.items || []));
    if (!(emb.items || []).length || items.length >= (emb.total || 0)) break;
  }
  // версии: «ver.i.n.data»; берём самую свежую целую
  const vers = new Map();
  for (const it of items) {
    const m = /^([0-9a-f]{8})\.(\d+)\.(\d+)\.(.*)$/.exec(it.name || '');
    if (!m) continue;
    const v = vers.get(m[1]) || { n: Number(m[3]), parts: [], created: '' };
    v.parts[Number(m[2])] = m[4];
    if ((it.created || '') > v.created) v.created = it.created || '';
    vers.set(m[1], v);
  }
  const whole = [...vers.values()].filter(v => v.parts.filter(p => p !== undefined).length === v.n).sort((a, b) => b.created.localeCompare(a.created));
  if (!whole.length) throw new Error('Данные коллеги ещё не готовы — попробуйте через минуту');
  const json = await unpack(fromUrl64(whole[0].parts.join('')));
  return JSON.parse(json);
}
