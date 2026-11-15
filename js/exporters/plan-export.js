// Выгрузка фактически списанных часов в xlsx по форме «Отчёт по индивидуальному плану работы».
import { buildXlsx, S, colName } from '../lib/xlsx-write.js';
import { getState } from '../core/store.js';
import { worksCatalog } from '../pages/hours.js';

const NO_NAME = 'Без указания группы';

/** Группировка списаний по наименованию строки; порядок — как в плане, затем прочие. */
function rowsFor(kind, works, log, plan) {
  const byName = new Map();
  for (const e of log) {
    if ((e.kind === 'teaching' ? 'teaching' : 'method') !== kind) continue;
    const name = (e.subject || e.note || '').trim() || NO_NAME;
    if (!byName.has(name)) byName.set(name, { name, period: e.period || '', hours: new Map(), count: 0 });
    const rec = byName.get(name);
    if (e.period && !rec.period) rec.period = e.period;
    rec.hours.set(e.workId, (rec.hours.get(e.workId) || 0) + (Number(e.hours) || 0));
    rec.count++;
  }
  // порядок строк: сперва как в исходном плане, потом всё остальное
  const order = [];
  for (const sh of (plan?.sheets || [])) {
    if (sh.kind !== kind) continue;
    for (const en of sh.entries) if (byName.has(en.name) && !order.includes(en.name)) order.push(en.name);
  }
  for (const n of byName.keys()) if (!order.includes(n)) order.push(n);
  return order.map(n => byName.get(n));
}

function buildSheet({ title, kind, works, log, plan, meta }) {
  const firstCol = 4;                       // A..D — №, наименование, сроки, форма
  const headers = ['№ п/п', 'Наименование группы, мероприятия', 'Сроки проведения', 'Форма / примечание'];
  const rows = [];
  const merges = [];
  const put = (r, c, v, s) => { (rows[r] = rows[r] || []).push(null); rows[r][c] = { v, s }; };
  const setRow = (r, arr) => { rows[r] = arr; };

  const lastCol = firstCol + works.length;   // колонка «Итого по строке»
  const colLetter = (i) => colName(i);

  // ---- шапка документа ----
  setRow(0, []); put(0, lastCol - 2, 'УТВЕРЖДАЮ', S.BOLD);
  put(1, lastCol - 2, 'Директор ДТ "Кванториум-28"', S.PLAIN);
  put(2, lastCol - 2, '_______________ / _______________', S.PLAIN);
  put(3, lastCol - 2, '«____» ______________ 20__ г.', S.PLAIN);

  put(5, 1, 'ОТЧЁТ ПО ИНДИВИДУАЛЬНОМУ ПЛАНУ РАБОТЫ (фактически выполнено)', S.TITLE);
  merges.push(`B6:${colLetter(Math.min(lastCol, 10))}6`);
  put(8, 1, 'на', S.PLAIN); put(8, 2, meta.year || '', S.BOLD); put(8, 4, 'уч. год', S.PLAIN);
  put(11, 0, 'Преподаватель', S.PLAIN); put(11, 2, meta.teacher || '', S.BOLD);
  put(12, 0, 'Направление (квантум)', S.PLAIN); put(12, 2, meta.direction || '', S.BOLD);
  put(13, 0, 'Выгружено', S.PLAIN); put(13, 2, new Date().toLocaleDateString('ru-RU'), S.PLAIN);

  // ---- шапка таблицы (строки 15..17 в человеческой нумерации) ----
  const H1 = 14, H2 = 15, H3 = 16;           // индексы строк 15,16,17
  const r1 = []; const r2 = []; const r3 = [];
  headers.forEach((t, i) => { r1[i] = { v: t, s: S.HEAD }; r2[i] = { v: '', s: S.HEAD }; r3[i] = { v: '', s: S.HEAD }; });
  r1[firstCol] = { v: 'Число часов', s: S.HEAD };
  for (let i = firstCol + 1; i < lastCol; i++) r1[i] = { v: '', s: S.HEAD };
  r1[lastCol] = { v: 'Итого', s: S.HEAD };

  // категории (строка 16) — объединяются по одинаковым соседним значениям
  let catStart = firstCol;
  works.forEach((w, i) => {
    const c = firstCol + i;
    r2[c] = { v: '', s: S.HEAD };
    const prev = i > 0 ? works[i - 1].category : null;
    if (i === 0 || w.category !== prev) {
      if (i > 0) { if (c - 1 > catStart) merges.push(`${colLetter(catStart)}${H2 + 1}:${colLetter(c - 1)}${H2 + 1}`); catStart = c; }
      r2[c] = { v: w.category || title, s: S.HEAD };
    }
  });
  if (lastCol - 1 > catStart) merges.push(`${colLetter(catStart)}${H2 + 1}:${colLetter(lastCol - 1)}${H2 + 1}`);
  r2[lastCol] = { v: '', s: S.HEAD };

  works.forEach((w, i) => { r3[firstCol + i] = { v: w.title, s: S.HEAD_V }; });
  r3[lastCol] = { v: '', s: S.HEAD };

  setRow(H1, r1); setRow(H2, r2); setRow(H3, r3);
  // вертикальные объединения A..D и колонки «Итого» на три строки шапки
  for (let i = 0; i < firstCol; i++) merges.push(`${colLetter(i)}${H1 + 1}:${colLetter(i)}${H3 + 1}`);
  merges.push(`${colLetter(lastCol)}${H1 + 1}:${colLetter(lastCol)}${H3 + 1}`);
  merges.push(`${colLetter(firstCol)}${H1 + 1}:${colLetter(lastCol - 1)}${H1 + 1}`);
  rows[H3] = r3; rows[H3].h = 150;

  // ---- данные ----
  const data = rowsFor(kind, works, log, plan);
  const totals = new Map();
  let grand = 0;
  data.forEach((rec, idx) => {
    const r = H3 + 1 + idx;
    const arr = [
      { v: idx + 1, s: S.CELL_C },
      { v: rec.name, s: S.CELL },
      { v: rec.period, s: S.CELL_C },
      { v: '', s: S.CELL_C },
    ];
    let sum = 0;
    works.forEach((w, i) => {
      const hv = rec.hours.get(w.id) || 0;
      if (hv) { totals.set(w.id, (totals.get(w.id) || 0) + hv); sum += hv; }
      arr[firstCol + i] = { v: hv || '', s: S.NUM };
    });
    arr[lastCol] = { v: sum || '', s: S.TOTAL };
    grand += sum;
    setRow(r, arr);
  });

  // ---- итоги ----
  const tr = H3 + 1 + data.length;
  const tArr = [{ v: 'Итого по видам работ', s: S.TOTAL_L }, { v: '', s: S.TOTAL_L }, { v: '', s: S.TOTAL_L }, { v: '', s: S.TOTAL_L }];
  merges.push(`A${tr + 1}:${colLetter(firstCol - 1)}${tr + 1}`);
  works.forEach((w, i) => { tArr[firstCol + i] = { v: totals.get(w.id) || 0, s: S.TOTAL }; });
  tArr[lastCol] = { v: grand, s: S.TOTAL };
  setRow(tr, tArr);

  const pr = tr + 1;
  const pArr = [{ v: 'План по документу', s: S.TOTAL_L }, { v: '', s: S.TOTAL_L }, { v: '', s: S.TOTAL_L }, { v: '', s: S.TOTAL_L }];
  merges.push(`A${pr + 1}:${colLetter(firstCol - 1)}${pr + 1}`);
  let planSum = 0;
  works.forEach((w, i) => { pArr[firstCol + i] = { v: w.planned || 0, s: S.NUM }; planSum += w.planned || 0; });
  pArr[lastCol] = { v: planSum, s: S.TOTAL };
  setRow(pr, pArr);

  const dr = pr + 1;
  const dArr = [{ v: 'Осталось закрыть', s: S.TOTAL_L }, { v: '', s: S.TOTAL_L }, { v: '', s: S.TOTAL_L }, { v: '', s: S.TOTAL_L }];
  merges.push(`A${dr + 1}:${colLetter(firstCol - 1)}${dr + 1}`);
  works.forEach((w, i) => {
    const left = (w.planned || 0) - (totals.get(w.id) || 0);
    dArr[firstCol + i] = { v: Math.round(left * 100) / 100, s: S.NUM };
  });
  dArr[lastCol] = { v: Math.round((planSum - grand) * 100) / 100, s: S.TOTAL };
  setRow(dr, dArr);

  // подпись
  setRow(dr + 2, [{ v: 'Преподаватель', s: S.PLAIN }, null, null, { v: meta.teacher || '', s: S.PLAIN }]);
  setRow(dr + 3, [{ v: '', s: S.PLAIN }, { v: 'подпись', s: S.PLAIN }, null, { v: 'Ф.И.О.', s: S.PLAIN }]);

  const cols = [6, 34, 20, 16, ...works.map(() => 5.5), 8];
  return { name: title, cols, rows, merges };
}

/** Готовит Blob с отчётом по фактически списанным часам. */
export async function buildPlanReport(st = getState()) {
  const works = worksCatalog(st);
  const plan = st.plan;
  const meta = {
    teacher: plan?.teacher || '',
    direction: plan?.direction || '',
    year: plan?.year || '',
  };
  const teaching = works.filter(w => w.kind === 'teaching');
  const method = works.filter(w => w.kind === 'method');
  const sheets = [];
  if (teaching.length) sheets.push(buildSheet({ title: 'учебная', kind: 'teaching', works: teaching, log: st.hoursLog, plan, meta }));
  if (method.length) sheets.push(buildSheet({ title: 'Метод, Восп', kind: 'method', works: method, log: st.hoursLog, plan, meta }));
  return buildXlsx(sheets);
}
