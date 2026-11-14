// Расстановка уроков заезда по дням и урокам — без библиотек, детерминированно
// (при одинаковых входных данных и «варианте» получается то же расписание).
//
// Правила:
//  • каждая группа занимается блоками по 2–3 урока подряд, не больше одного
//    блока в день (не больше 3 уроков группы в день — как в образце);
//  • часы группы за заезд — из КТП (обычно 12 + 12 + 10 у сетевых групп,
//    12 + 12 + 12 у групп ДО);
//  • блоки одной группы разносятся по заезду равномерно, нагрузка по дням —
//    тоже ровная;
//  • у педагога один урок в одно время, в день не больше slotsPerDay уроков;
//  • школьные (сетевые) группы — с утра, группы ДО — ближе к вечеру.

export const DEFAULT_TIMES = [
  '08.00-08.40', '08.50-09.30', '09.40-10.20', '10.30-11.10', '11.20-12.00', '12.30-13.10', '13.20-14.00',
  '14.10-14.50', '15.00-15.40', '15.50-16.30', '16.40-17.20', '17.30-18.10', '18.20-19.00',
];
export const WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const weekdayIdx = (s) => (parse(s).getDay() + 6) % 7;   // пн = 0

/** Учебные дни заезда: без воскресений, без суббот при пятидневке. */
export function schoolDays(from, to, fiveDay) {
  const out = [];
  if (!from || !to || from > to) return out;
  for (let d = parse(from); iso(d) <= to; d.setDate(d.getDate() + 1)) {
    const w = (d.getDay() + 6) % 7;
    if (w === 6 || (fiveDay && w === 5)) continue;
    out.push(iso(d));
    if (out.length > 60) break;
  }
  return out;
}

/** 12 -> [3,3,3,3], 10 -> [3,3,2,2], 5 -> [3,2], 2 -> [2], 1 -> [1]. */
export function splitBlocks(hours) {
  const h = Math.max(0, Math.round(hours));
  if (h <= 3) return h ? [h] : [];
  const k = Math.ceil(h / 3);
  const out = Array(k).fill(2);
  let rest = h - 2 * k;
  for (let i = 0; i < k && rest > 0; i++, rest--) out[i]++;
  return out;
}

// простой детерминированный генератор случайных чисел для «вариантов»
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/**
 * @param {{days:string[], groups:Array<{code, hours, isDo}>, slotsPerDay?:number, variant?:number}} o
 * @returns {{grid: Object<string, string[]>, placed: Object<string, number>, problems: string[]}}
 *   grid[date][slot] = код группы или ''.
 */
export function buildSchedule({ days, groups, slotsPerDay = 13, variant = 0 }) {
  const rnd = rng(variant + 1);
  const D = days.length;
  const grid = Object.fromEntries(days.map(d => [d, Array(slotsPerDay).fill('')]));
  const placed = Object.fromEntries(groups.map(g => [g.code, 0]));
  const problems = [];
  if (!D) return { grid, placed, problems: ['Нет учебных дней в выбранном периоде.'] };

  // 1. блоки по группам; сначала те, у кого блоков больше (их сложнее разнести)
  const items = groups.filter(g => g.hours > 0).map(g => ({ ...g, blocks: splitBlocks(g.hours) }));
  for (const g of items) if (g.blocks.length > D) {
    problems.push(`${g.code}: ${g.hours} ч не помещаются в ${D} дн. по 3 урока — поставлено сколько вышло.`);
  }
  const order = [...items].sort((a, b) => (b.blocks.length - a.blocks.length) || (rnd() - 0.5));

  // 2. дни для каждого блока: равномерно по заезду + ровная нагрузка дней
  const load = Object.fromEntries(days.map(d => [d, 0]));
  const dayPlan = Object.fromEntries(days.map(d => [d, []]));   // [{code, size, isDo}]
  for (const g of order) {
    const k = Math.min(g.blocks.length, D);
    const used = new Set();
    const shift = rnd();
    for (let i = 0; i < k; i++) {
      const size = g.blocks[i];
      const ideal = (i + shift * 0.9 + 0.05) * D / k;   // куда «просится» блок, чтобы блоки шли через равные промежутки
      let best = null, bestScore = Infinity;
      days.forEach((d, di) => {
        if (used.has(d) || load[d] + size > slotsPerDay) return;
        const near = [...used].some(u => Math.abs(days.indexOf(u) - di) === 1) ? 1.5 : 0;
        const score = Math.abs(di + 0.5 - ideal) * 1.2 + load[d] * 0.9 + near + rnd() * 0.3;
        if (score < bestScore) { bestScore = score; best = d; }
      });
      if (!best) { problems.push(`${g.code}: не хватило места для блока из ${size} ур.`); continue; }
      used.add(best);
      load[best] += size;
      dayPlan[best].push({ code: g.code, size, isDo: !!g.isDo });
      placed[g.code] += size;
    }
  }

  // 3. порядок внутри дня: школьные группы с первого урока, группы ДО — ближе к вечеру
  const doStart = Math.min(8, slotsPerDay - 1);              // с 9-го урока (15:00)
  for (const d of days) {
    const school = dayPlan[d].filter(b => !b.isDo).sort(() => rnd() - 0.5);
    const extra = dayPlan[d].filter(b => b.isDo).sort(() => rnd() - 0.5);
    let pos = 0;
    for (const b of school) { for (let j = 0; j < b.size; j++) grid[d][pos + j] = b.code; pos += b.size; }
    const doTotal = extra.reduce((a, b) => a + b.size, 0);
    let start = Math.max(pos, Math.min(doStart, slotsPerDay - doTotal));
    for (const b of extra) { for (let j = 0; j < b.size; j++) grid[d][start + j] = b.code; start += b.size; }
  }

  for (const g of items) {
    if (placed[g.code] < g.hours && !problems.some(p => p.startsWith(g.code + ':'))) {
      problems.push(`${g.code}: поставлено ${placed[g.code]} из ${g.hours} ч.`);
    }
  }
  return { grid, placed, problems };
}

/** Сколько уроков каждой группы стоит в сетке (после ручной правки). */
export function countPlaced(grid) {
  const out = {};
  for (const row of Object.values(grid)) for (const c of row) if (c) out[c] = (out[c] || 0) + 1;
  return out;
}

/** Нарушения правил в сетке: больше 3 уроков группы в день, «одиночные» уроки. */
export function checkGrid(grid) {
  const issues = [];
  for (const [d, row] of Object.entries(grid)) {
    const per = {};
    row.forEach((c, i) => { if (c) (per[c] = per[c] || []).push(i); });
    for (const [c, idx] of Object.entries(per)) {
      if (idx.length > 3) issues.push({ date: d, code: c, text: `${c}: ${idx.length} уроков в день (больше 3)` });
      const runs = [];
      idx.forEach((v, i) => { if (i && v === idx[i - 1] + 1) runs[runs.length - 1]++; else runs.push(1); });
      if (runs.length > 1) issues.push({ date: d, code: c, text: `${c}: уроки в этот день не подряд` });
    }
  }
  return issues;
}

/** Недели (пн–сб) для выгрузки: [{no, days:[{weekday, date|null}], from, to}]. */
export function weeksOf(days, fiveDay) {
  const cols = fiveDay ? 5 : 6;
  const weeks = [];
  for (const d of days) {
    const dt = parse(d);
    dt.setDate(dt.getDate() - weekdayIdx(d));
    const monday = iso(dt);
    let w = weeks.find(x => x.monday === monday);
    if (!w) {
      w = { monday, no: weeks.length + 1, days: Array.from({ length: cols }, (_, i) => ({ weekday: WEEKDAYS[i], date: null })) };
      weeks.push(w);
    }
    w.days[weekdayIdx(d)].date = d;
  }
  for (const w of weeks) {
    const ds = w.days.map(x => x.date).filter(Boolean);
    w.from = ds[0]; w.to = ds[ds.length - 1];
  }
  return weeks;
}
