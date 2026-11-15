// Действия помощника: модель сама ничего не меняет — она добавляет к ответу
// блок ```action {...}```, а сайт показывает карточку, где педагог проверяет
// и подтверждает. Пока поддерживается одно действие — списать часы.
import { getState, update } from './store.js';
import { worksCatalog } from '../pages/hours.js';

/** Инструкция модели (добавляется к системному сообщению). */
export const ACTIONS_PROMPT = [
  'Если педагог просит списать (записать, внести, отметить) часы по плану — ты сам ничего не записываешь и не можешь записать.',
  'Ответь одной короткой фразой («Проверьте и подтвердите списание:») и добавь в конце ответа ровно такой блок:',
  '```action',
  '{"action":"log_hours","entries":[{"work":"вид работы — как в списке видов работ ниже","hours":4,"date":"ГГГГ-ММ-ДД","note":"пояснение, если педагог его дал, иначе пусто"}]}',
  '```',
  '— Дату бери из слов педагога («вчера», «в пятницу», «15 октября») относительно строки «Сегодня» в сводке; если дата не названа — сегодня.',
  '— Несколько разных списаний (разные виды работ или даты) — несколько элементов в entries.',
  '— Если не сказано, сколько часов, — спроси и блок не добавляй.',
  '— Никогда не пиши, что часы уже списаны: их спишет сайт, когда педагог нажмёт кнопку.',
  '— МК — это «Проведение мастер-классов»; «разработать/придумать МК» — «Разработка нового мастер-класса».',
].join('\n');

/** Виды работ для сводки помощника (чтобы модель называла их как на сайте). */
export function worksForPrompt(st = getState()) {
  const list = worksCatalog(st);
  return 'Виды работ (для списания часов):\n' + list.map(w => `— ${w.title} (${w.kind === 'teaching' ? 'учебная' : 'методическая'})`).join('\n');
}

const BLOCK = /```(?:action|json)?\s*(\{[\s\S]*?"action"[\s\S]*?\})\s*```/i;

/**
 * Достаёт из ответа модели блок действия.
 * @returns {{text:string, action:object|null}} text — ответ без блока
 */
export function extractAction(answer) {
  const m = BLOCK.exec(answer || '');
  if (!m) return { text: answer, action: null };
  let data = null;
  try { data = JSON.parse(m[1]); } catch { return { text: answer, action: null }; }
  const text = (answer.slice(0, m.index) + answer.slice(m.index + m[0].length)).trim();
  if (data?.action !== 'log_hours' || !Array.isArray(data.entries)) return { text: text || answer, action: null };
  const today = new Date().toISOString().slice(0, 10);
  const entries = data.entries.slice(0, 10).map(e => {
    const work = matchWork(String(e.work || ''));
    const hours = Math.max(0, Math.round((Number(String(e.hours).replace(',', '.')) || 0) * 10) / 10);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') ? e.date : today;
    return { workId: work?.id || '', asked: String(e.work || ''), hours, date, note: String(e.note || '').slice(0, 200) };
  }).filter(e => e.hours > 0);
  if (!entries.length) return { text: text || answer, action: null };
  return { text, action: { type: 'log_hours', entries, status: 'pending' } };
}

/* ---- сопоставление названия вида работы со справочником ---- */
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"().,;:!?–—-]/g, ' ').replace(/\s+/g, ' ').trim();
const stems = (s) => norm(s).split(' ').filter(w => w.length > 2).map(w => w.slice(0, 5));

export function matchWork(text, st = getState()) {
  const list = worksCatalog(st);
  const t = norm(text);
  if (!t) return null;
  const exact = list.find(w => norm(w.title) === t);
  if (exact) return exact;
  // сокращения
  if (/(^|\s)мк(\s|$)|мастер/.test(t)) {
    const dev = /разраб|придум|нов/.test(t);
    const hit = list.find(w => (dev ? /разработка нового мастер/i : /проведение мастер/i).test(w.title));
    if (hit) return hit;
  }
  const q = stems(t);
  let best = null, score = 0;
  for (const w of list) {
    const ws = stems(w.title);
    const s = q.filter(x => ws.includes(x)).length / Math.max(1, Math.min(q.length, ws.length));
    if (s > score) { score = s; best = w; }
  }
  return score >= 0.5 ? best : null;
}

/** Записать подтверждённые часы. Возвращает id созданных записей. */
export function applyLogHours(entries) {
  const list = worksCatalog();
  const ids = [];
  update(x => {
    for (const e of entries) {
      const w = list.find(z => z.id === e.workId);
      if (!w || !(e.hours > 0)) continue;
      const id = Date.now() + Math.floor(Math.random() * 100000);
      ids.push(id);
      x.hoursLog.push({ id, date: e.date, kind: w.kind, workId: w.id, title: w.title, hours: e.hours, note: e.note || 'через помощника', subject: '', period: '' });
    }
  });
  return ids;
}

/** Отменить списание (удалить созданные записи). */
export function undoLogHours(ids) {
  const set = new Set(ids || []);
  update(x => { x.hoursLog = x.hoursLog.filter(e => !set.has(e.id)); });
}

/** Пометка для истории переписки — чтобы модель знала, чем кончилось. */
export function actionNote(action) {
  if (!action) return '';
  const list = worksCatalog();
  const what = action.entries.map(e => `${e.hours} ч «${list.find(w => w.id === e.workId)?.title || e.asked}» ${e.date}`).join('; ');
  const st = { pending: 'ждёт подтверждения педагога', done: 'педагог подтвердил, часы списаны', cancel: 'педагог отменил', undone: 'списание отменено' }[action.status] || '';
  return `\n[Карточка списания: ${what} — ${st}]`;
}
