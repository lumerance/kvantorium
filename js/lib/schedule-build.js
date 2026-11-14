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

const mondayOf = (d) => { const dt = parse(d); dt.setDate(dt.getDate() - weekdayIdx(d)); return iso(dt); };

/** Учебные дни, разбитые по неделям (пн–сб). */
export function daysByWeek(days) {
  const weeks = [];
  for (const d of days) {
    const m = mondayOf(d);
    let w = weeks.find(x => x.monday === m);
    if (!w) { w = { monday: m, days: [] }; weeks.push(w); }
    w.days.push(d);
  }
  return weeks;
}

/**
 * План группы по неделям: в каждой неделе — k занятий по s уроков (s = 2 или 3,
 * в одной неделе размер один и тот же). Сумма = часам группы. Часы делятся
 * между неделями пропорционально числу учебных дней.
 * @returns {Array<{size, count}>|null}
 */
export function weekPlan(hours, weekLens, rnd = Math.random) {
  const D = weekLens.reduce((a, b) => a + b, 0);
  const opts = weekLens.map(n => {
    const o = [{ size: 0, count: 0 }];
    for (const size of [2, 3]) for (let count = 1; count <= n; count++) o.push({ size, count });
    return o;
  });
  let best = null, bestScore = Infinity;
  const pick = [];
  const rec = (i, sum) => {
    if (sum > hours) return;
    if (i === opts.length) {
      if (sum !== hours) return;
      let score = 0;
      pick.forEach((p, w) => {
        const share = hours * weekLens[w] / D;
        score += Math.abs(p.size * p.count - share);
        if (!p.count && weekLens[w] >= 2) score += 3;           // неделя без занятий — плохо
        if (p.count === weekLens[w] && weekLens[w] > 2) score += 0.8;   // каждый день подряд — тяжело
      });
      score += rnd() * 1.5;
      if (score < bestScore) { bestScore = score; best = pick.map(p => ({ ...p })); }
      return;
    }
    for (const o of opts[i]) { pick.push(o); rec(i + 1, sum + o.size * o.count); pick.pop(); }
  };
  rec(0, 0);
  return best;
}

function combos(arr, k) {
  const out = [];
  const rec = (start, cur) => {
    if (cur.length === k) { out.push([...cur]); return; }
    for (let i = start; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); }
  };
  rec(0, []);
  return out;
}

/** Одна попытка расстановки. */
function attempt(days, groups, slotsPerDay, rnd) {
  const weeks = daysByWeek(days);
  const load = Object.fromEntries(days.map(d => [d, 0]));
  const dayPlan = Object.fromEntries(days.map(d => [d, []]));
  const placed = Object.fromEntries(groups.map(g => [g.code, 0]));
  const problems = [];
  let penalty = 0;

  const plans = groups.filter(g => g.hours > 0).map(g => {
    let plan = weekPlan(g.hours, weeks.map(w => w.days.length), rnd);
    if (!plan) {
      // ровно по неделям не делится (например, 5 ч в короткий заезд) — блоки как получится
      problems.push(`${g.code}: ${g.hours} ч не делятся на недели блоками одного размера — проверьте вручную.`);
      const blocks = splitBlocks(g.hours);
      plan = weeks.map(() => ({ size: 0, count: 0, blocks: [] }));
      blocks.forEach((b, i) => { const w = plan[i % plan.length]; w.blocks.push(b); });
      plan.forEach(w => { w.count = w.blocks.length; });
    }
    return { g, plan };
  });
  // сначала группы с самыми «плотными» неделями
  plans.sort((a, b) => (Math.max(...b.plan.map(p => p.count)) - Math.max(...a.plan.map(p => p.count))) || (rnd() - 0.5));

  for (const { g, plan } of plans) {
    plan.forEach((p, wi) => {
      if (!p.count) return;
      const wd = weeks[wi].days;
      const sizes = p.blocks || Array(p.count).fill(p.size);
      const k = Math.min(sizes.length, wd.length);
      let best = null, bestScore = Infinity;
      for (const set of combos(wd, k)) {
        if (set.some((d, i) => load[d] + sizes[i] > slotsPerDay)) continue;
        let score = set.reduce((a, d, i) => a + (load[d] + sizes[i]) ** 2, 0) / 10;
        for (let i = 1; i < set.length; i++) if (days.indexOf(set[i]) - days.indexOf(set[i - 1]) === 1) score += 1.2;
        score += rnd() * 0.6;
        if (score < bestScore) { bestScore = score; best = set; }
      }
      if (!best) { problems.push(`${g.code}: в ${wi + 1}-й неделе не хватило места.`); penalty += 100; return; }
      best.forEach((d, i) => { load[d] += sizes[i]; dayPlan[d].push({ code: g.code, size: sizes[i], isDo: !!g.isDo }); placed[g.code] += sizes[i]; });
    });
  }
  const loads = Object.values(load);
  penalty += Math.max(...loads) - Math.min(...loads) + problems.length * 50;
  return { dayPlan, placed, problems, penalty };
}

/**
 * @param {{days:string[], groups:Array<{code, hours, isDo}>, slotsPerDay?:number, variant?:number}} o
 * @returns {{grid: Object<string, string[]>, placed: Object<string, number>, problems: string[]}}
 *   grid[date][slot] = код группы или ''.
 *
 * Правила: блоки по 2–3 урока подряд, у группы в неделю все блоки одного
 * размера (либо по 2, либо по 3), не больше одного блока группы в день;
 * у педагога в день нет «окон»: уроки идут подряд, школьные группы — с утра,
 * группы ДО — следом; если в день только ДО — ближе к вечеру.
 */
export function buildSchedule({ days, groups, slotsPerDay = 13, variant = 0 }) {
  const rnd = rng(variant + 1);
  const grid = Object.fromEntries(days.map(d => [d, Array(slotsPerDay).fill('')]));
  if (!days.length) return { grid, placed: {}, problems: ['Нет учебных дней в выбранном периоде.'] };

  let best = null;
  for (let t = 0; t < 40; t++) {
    const r = attempt(days, groups, slotsPerDay, rnd);
    if (!best || r.penalty < best.penalty) best = r;
    if (best.penalty <= 1) break;
  }

  const doStart = Math.min(8, slotsPerDay - 1);              // 9-й урок, 15:00
  for (const d of days) {
    const school = best.dayPlan[d].filter(b => !b.isDo).sort(() => rnd() - 0.5);
    const extra = best.dayPlan[d].filter(b => b.isDo).sort(() => rnd() - 0.5);
    const total = [...school, ...extra].reduce((a, b) => a + b.size, 0);
    let pos = school.length ? 0 : Math.max(0, Math.min(doStart, slotsPerDay - total));
    for (const b of [...school, ...extra]) { for (let j = 0; j < b.size; j++) grid[d][pos + j] = b.code; pos += b.size; }
  }

  const problems = [...best.problems];
  for (const g of groups) if (g.hours > 0 && best.placed[g.code] < g.hours && !problems.some(p => p.startsWith(g.code + ':'))) {
    problems.push(`${g.code}: поставлено ${best.placed[g.code]} из ${g.hours} ч.`);
  }
  return { grid, placed: best.placed, problems };
}

/** Сколько уроков каждой группы стоит в сетке (после ручной правки). */
export function countPlaced(grid) {
  const out = {};
  for (const row of Object.values(grid)) for (const c of row) if (c) out[c] = (out[c] || 0) + 1;
  return out;
}

/** Нарушения правил в сетке: больше 3 уроков группы в день, уроки не подряд,
 *  разные размеры блоков у группы в одну неделю, «окна» у педагога. */
export function checkGrid(grid) {
  const issues = [];
  const runsOf = (row) => {
    const per = {};
    row.forEach((c, i) => { if (c) (per[c] = per[c] || []).push(i); });
    return per;
  };
  for (const [d, row] of Object.entries(grid)) {
    for (const [c, idx] of Object.entries(runsOf(row))) {
      if (idx.length > 3) issues.push({ date: d, code: c, text: `${c}: ${idx.length} уроков в день (больше 3)` });
      if (idx[idx.length - 1] - idx[0] + 1 !== idx.length) issues.push({ date: d, code: c, text: `${c}: уроки в этот день не подряд` });
    }
    const filled = row.map((c, i) => (c ? i : -1)).filter(i => i >= 0);
    if (filled.length && filled[filled.length - 1] - filled[0] + 1 !== filled.length) {
      issues.push({ date: d, code: '', text: 'окно в расписании педагога' });
    }
  }
  for (const w of daysByWeek(Object.keys(grid).sort())) {
    const sizes = {};
    for (const d of w.days) for (const [c, idx] of Object.entries(runsOf(grid[d]))) (sizes[c] = sizes[c] || new Set()).add(idx.length);
    for (const [c, set] of Object.entries(sizes)) if (set.size > 1) {
      issues.push({ date: w.days[0], code: c, text: `${c}: в одну неделю и по ${[...set].sort().join(', и по ')} урока — должно быть одинаково` });
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
