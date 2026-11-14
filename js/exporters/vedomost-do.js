// Ведомость итогового контроля групп дополнительного образования (Excel).
// Повторяет бланк технопарка: каждая группа «Набора» — отдельный лист,
// у каждого ребёнка 7 компетенций по 1–4 балла, итог, уровень (в/с/н),
// внизу — суммы и средние по компетенциям и распределение по уровням.
// Итоги и уровни записаны формулами — если педагог поправит балл в Excel,
// всё пересчитается само.
import { buildXlsx, S, colName } from '../lib/xlsx-write.js';

export const COMPETENCIES = [
  { col: 'F', title: 'Практические умения и навыки' },
  { col: 'G', title: 'Владение специальным оборудованием, инструментом' },
  { col: 'H', title: 'Творчество и мастерство' },
  { col: 'I', title: 'Умение пользоваться источниками информации' },      // I:J объединены
  { col: 'K', title: 'Умение осуществлять учебно-исследовательскую деятельность' },
  { col: 'L', title: 'Умение самостоятельно планировать пути достижения целей' },
  { col: 'M', title: 'Умение работать в команде' },
];
const COL_INDEX = { F: 5, G: 6, H: 7, I: 8, K: 10, L: 11, M: 12 };
const LEVEL_HEAD = 'Компетенции обучающегося\nНизкий уровень (1 балл)\nСредний уровень (2-3 балла)\nВысокий уровень (4 балла)';

export const levelOf = (total) => (total >= 22 ? 'в' : total <= 13 ? 'н' : 'с');

/**
 * Случайные баллы по компетенциям в диапазоне [min, max]. Если у ребёнка
 * есть средний балл журнала (2–5), разброс смещается к нему: отличник
 * получает в основном верх диапазона, троечник — середину и низ.
 */
export function randomScores(min, max, avg = null, rnd = Math.random) {
  const lo = Math.max(1, Math.min(4, Math.round(min)));
  const hi = Math.max(lo, Math.min(4, Math.round(max)));
  return COMPETENCIES.map(() => {
    if (avg == null || hi === lo) return lo + Math.floor(rnd() * (hi - lo + 1));
    const center = lo + (Math.max(2, Math.min(5, avg)) - 2) / 3 * (hi - lo);
    const v = Math.round(center + (rnd() - 0.5) * 1.6);
    return Math.max(lo, Math.min(hi, v));
  });
}

const dateRu = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || '');
};

/** Один лист. g: {sheetName, code, program, students:[{name, scores:[7]}]} */
function groupSheet(g, hd) {
  const rows = [];
  const merges = [];
  const put = (r, c, v) => { (rows[r] = rows[r] || { cells: [] }).cells[c] = v; };
  const height = (r, ht) => { (rows[r] = rows[r] || { cells: [] }).h = ht; };

  put(0, 0, { v: 'Мобильный технопарк «Кванториум - 28»', s: S.TITLE16 }); merges.push('A1:N1'); height(0, 21);
  put(1, 0, { v: 'Итоговый контроль обучающихся по', s: S.TEXT12 });
  put(1, 3, { v: g.program ? `«${g.program.replace(/^[«"]|[»"]$/g, '')}»` : '', s: S.BOLD12 });
  put(1, 11, { v: hd.place || '', s: S.BOLD12 }); merges.push('L2:N2'); height(1, 19);
  put(2, 0, { v: 'Квантум:', s: S.TEXT12 }); put(2, 2, { v: hd.kvantum || '', s: S.BOLD12 }); merges.push('A3:B3'); height(2, 19);
  put(3, 0, { v: 'Педагог:', s: S.TEXT12 }); put(3, 2, { v: hd.teacher || '', s: S.BOLD12 }); merges.push('A4:B4'); height(3, 19);
  put(4, 0, { v: 'Форма отчетности ПДО по результатам аттестации обучающихся.', s: S.TEXT12 });

  // шапка таблицы: строки 6–7
  const H = S.HEAD;
  put(5, 0, { v: '№ п/п', s: H }); put(6, 0, { v: '', s: H }); merges.push('A6:A7');
  put(5, 1, { v: 'ФИ обучающегося', s: H }); put(6, 1, { v: '', s: H }); merges.push('B6:B7');
  put(5, 2, { v: '№ группы', s: H }); put(6, 2, { v: '', s: H }); merges.push('C6:C7');
  put(5, 3, { v: 'Учебный год', s: H }); put(6, 3, { v: '', s: H }); merges.push('D6:D7');
  put(5, 4, { v: 'Дата проведения контроля', s: H }); put(6, 4, { v: '', s: H }); merges.push('E6:E7');
  for (let c = 5; c <= 7; c++) put(5, c, { v: c === 5 ? LEVEL_HEAD : '', s: H });
  merges.push('F6:H6');
  for (let c = 8; c <= 12; c++) put(5, c, { v: c === 8 ? LEVEL_HEAD : '', s: H });
  merges.push('I6:M6');
  put(5, 13, { v: 'Итого', s: H }); put(6, 13, { v: '', s: H }); merges.push('N6:N7');
  put(5, 14, { v: 'Уровень', s: H }); put(6, 14, { v: '', s: H }); merges.push('O6:O7');
  for (const k of COMPETENCIES) put(6, COL_INDEX[k.col], { v: k.title, s: S.HEAD_V10 });
  put(6, 9, { v: '', s: S.HEAD_V10 }); merges.push('I7:J7');
  height(5, 94); height(6, 200);

  // дети
  const first = 8;                       // номер первой строки с ребёнком (Excel, с 1)
  const n = g.students.length;
  const last = first + Math.max(n, 1) - 1;
  g.students.forEach((st, i) => {
    const r = first - 1 + i;
    const R = r + 1;
    const total = st.scores.reduce((a, b) => a + b, 0);
    put(r, 0, { v: i + 1, s: S.NUM });
    put(r, 1, { v: st.name, s: S.CELL });
    put(r, 2, { v: g.code, s: S.CELL_C });
    put(r, 3, { v: hd.year || '', s: S.CELL_C });
    put(r, 4, { v: dateRu(hd.date), s: S.CELL_C });
    COMPETENCIES.forEach((k, j) => put(r, COL_INDEX[k.col], { v: st.scores[j], s: S.NUM }));
    put(r, 9, { v: '', s: S.NUM }); merges.push(`I${R}:J${R}`);
    put(r, 13, { v: total, f: `SUM(F${R}:M${R})`, s: S.NUM });
    put(r, 14, { v: levelOf(total), f: `IF(N${R}>=22,"в",IF(N${R}<=13,"н","с"))`, s: S.NUM });
    height(r, 16);
  });

  // итоги по компетенциям
  let r = first - 1 + Math.max(n, 1);
  const sumRow = r + 1, avgRow = r + 2, cntRow = r + 3;
  const cntRef = `$D$${cntRow}`;
  put(r, 0, { v: 'Итого по компетенциям', s: S.TOTAL_L });
  for (let c = 1; c <= 4; c++) put(r, c, { v: '', s: S.TOTAL_L });
  merges.push(`A${sumRow}:E${sumRow}`);
  put(r + 1, 0, { v: 'Средний балл по компетенциям', s: S.TOTAL_L });
  for (let c = 1; c <= 4; c++) put(r + 1, c, { v: '', s: S.TOTAL_L });
  merges.push(`A${avgRow}:E${avgRow}`);
  COMPETENCIES.forEach((k, j) => {
    const c = COL_INDEX[k.col];
    const sum = g.students.reduce((a, st) => a + st.scores[j], 0);
    put(r, c, { v: sum, f: `SUM(${k.col}${first}:${k.col}${last})`, s: S.TOTAL });
    put(r + 1, c, { v: n ? Math.round(sum / n * 100) / 100 : 0, f: `IF(${cntRef}=0,0,${k.col}${sumRow}/${cntRef})`, s: S.NUM2 });
  });
  put(r, 9, { v: '', s: S.TOTAL }); merges.push(`I${sumRow}:J${sumRow}`);
  put(r + 1, 9, { v: '', s: S.NUM2 }); merges.push(`I${avgRow}:J${avgRow}`);

  r += 2;
  put(r, 0, { v: 'Всего аттестовано', s: S.TEXT12 });
  put(r, 3, { v: n, f: `COUNTA(B${first}:B${last})`, s: S.BOLD12 });
  put(r, 5, { v: 'обучающихся', s: S.TEXT12 });
  put(r + 1, 0, { v: 'Из них по результатам аттестации:', s: S.TEXT12 });
  const levels = [
    ['высокий уровень - (22-28 Б)', 22, 28],
    ['средний уровень - (14-21 Б)', 14, 21],
    ['низкий уровень - (0-13 Б)', 0, 13],
  ];
  levels.forEach(([label, lo, hi], i) => {
    const rr = r + 2 + i, RR = rr + 1;
    const cnt = g.students.filter(st => { const t = st.scores.reduce((a, b) => a + b, 0); return t >= lo && t <= hi; }).length;
    put(rr, 0, { v: label, s: S.TEXT12 });
    put(rr, 4, { v: cnt, f: `COUNTIFS(N${first}:N${last},">=${lo}",N${first}:N${last},"<=${hi}")`, s: S.BOLD12 });
    put(rr, 5, { v: 'чел', s: S.TEXT12 });
    put(rr, 6, { v: n ? Math.round(cnt * 1000 / n) / 10 : 0, f: `IF(${cntRef}=0,0,E${RR}*100/${cntRef})`, s: S.NUM1 });
    put(rr, 7, { v: '%', s: S.TEXT12 });
  });
  r += 6;
  put(r, 0, { v: 'Подпись педагога', s: S.TEXT12 });
  put(r, 3, { v: '______________________', s: S.TEXT12 });

  // строки — плотный массив
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || { cells: [] };
    const cells = [];
    for (let c = 0; c < row.cells.length; c++) cells[c] = row.cells[c] ?? null;
    out.push({ cells, h: row.h });
  }
  return {
    name: g.sheetName,
    cols: [6, 27, 12, 12, 14, 12, 13, 13, 7, 5, 10, 12, 12, 9, 9],
    rows: out,
    merges,
  };
}

/** Имя листа: «Д1 НуВ» -> «Д1», без запрещённых символов и без повторов. */
function sheetNames(groups) {
  const used = new Set();
  return groups.map(g => {
    let base = String(g.code || g.name || 'Группа').trim().split(/\s+/)[0].replace(/[\\/?*[\]:]/g, '').slice(0, 28) || 'Группа';
    let name = base, i = 2;
    while (used.has(name.toLowerCase())) name = `${base} (${i++})`;
    used.add(name.toLowerCase());
    return name;
  });
}

/**
 * @param {{teacher, kvantum, place, year, date}} hd
 * @param {Array<{code, name, program, students:[{name, scores}]}>} groups
 */
export async function buildVedomostDoXlsx(hd, groups) {
  const names = sheetNames(groups);
  return buildXlsx(groups.map((g, i) => groupSheet({ ...g, sheetName: names[i], code: g.code || g.name }, hd)));
}

export { colName };
