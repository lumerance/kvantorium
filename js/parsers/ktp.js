// Разбор учебной программы: из таблицы КТП (календарно-тематического
// планирования) берём тему, содержание, тип занятия и количество часов.
//
// Дальше КТП раскладывается по заездам — программа на 36 часов это 12+12+12,
// на 34 часа 12+12+10 (так делит методист, поэтому просто идти подряд по всем
// занятиям трёх заездов нельзя — сдвинется третий заезд). Внутри заезда часы
// КТП ложатся по порядку на занятия официального расписания: 3 урока в
// понедельник — это три подряд идущих часа КТП.
import { readDocx } from '../lib/docx.js';

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

/** Ячейки строки без повторов от gridSpan и без пустого хвоста. */
export function rowCells(row) {
  const out = [];
  for (const c of row) {
    const v = norm(c);
    if (out.length && out[out.length - 1] === v) continue;
    out.push(v);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

// Порядок важен: «Содержание темы» содержит слово «тема», поэтому содержание
// проверяется раньше самой темы.
// В шаблонах нет \b: в JS граница слова считается по [A-Za-z0-9_], для
// кириллицы она не срабатывает вовсе («Тип занятия» мимо /тип\b/).
const COLS = [
  ['no', /^\s*(№|n|номер|п\/?\s?п)/i],
  ['hours', /час/i],
  ['date', /дата|срок|календарн/i],
  ['content', /содержан|описан|краткое/i],
  ['type', /тип|форма|вид/i],
  ['theme', /тема|раздел|наименование/i],
];

/** По строке-шапке определяет, в какой колонке что лежит. */
export function detectColumns(headerCells) {
  const map = {};
  headerCells.forEach((c, i) => {
    const t = norm(c);
    if (!t) return;
    for (const [key, re] of COLS) {
      if (map[key] !== undefined) continue;
      if (re.test(t)) { map[key] = i; return; }
    }
  });
  return map;
}

const isHeaderMap = (m) => m.theme !== undefined && (m.content !== undefined || m.type !== undefined || m.hours !== undefined);

function rowFrom(cells, map) {
  if (cells.length < 2) return null;              // строка-раздел во всю ширину
  const get = (k) => (map[k] === undefined ? '' : norm(cells[map[k]] || ''));
  const theme = get('theme');
  const content = get('content');
  if (!theme && !content) return null;
  if (/^итого|^всего/i.test(theme)) return null;  // итоговая строка таблицы
  const hoursNum = parseFloat(get('hours').replace(',', '.'));
  const no = parseInt(get('no'), 10);
  return {
    no: isFinite(no) ? no : null,
    theme, content,
    type: get('type'),
    hours: Math.max(1, Math.round(isFinite(hoursNum) && hoursNum > 0 ? hoursNum : 1)),
  };
}

/** Строки КТП из таблиц документа. Шапка ищется в первых строках каждой
 *  таблицы; таблица без шапки считается продолжением предыдущей (Word рвёт
 *  длинные таблицы на границе страниц). */
export function parseKtpTables(tables) {
  const rows = [];
  let map = null;
  for (const t of tables) {
    const grid = (t.rows || []).map(rowCells);
    let start = 0;
    for (let i = 0; i < Math.min(grid.length, 4); i++) {
      const m = detectColumns(grid[i]);
      if (isHeaderMap(m)) { map = m; start = i + 1; break; }
    }
    if (!map) continue;   // до первой шапки таблицы КТП не относятся
    for (let i = start; i < grid.length; i++) {
      const rec = rowFrom(grid[i], map);
      if (rec) rows.push(rec);
    }
  }
  return rows;
}

/** Название программы — первый содержательный абзац документа. */
function guessName(docx) {
  const ps = (docx.paragraphs || []).map(norm).filter(Boolean);
  const named = ps.find(t => /программ|модул|курс/i.test(t) && t.length < 160);
  return (named || ps[0] || 'Учебная программа').slice(0, 120);
}

export async function importKtpFile(file) {
  const docx = await readDocx(await file.arrayBuffer());
  const rows = parseKtpTables(docx.tables);
  if (!rows.length) throw new Error('В документе не найдена таблица КТП — нужна колонка «Тема» и хотя бы одна из «Содержание» / «Тип занятия» / «Часы».');
  return { rows, sourceName: file.name, name: guessName(docx) };
}

/* ---------- вставка таблицы текстом (из PDF, Word, Excel) ---------- */

/** Текст -> матрица ячеек. Таблица из Word/Excel копируется с табами, из PDF —
 *  чаще колонками через несколько пробелов. */
export function splitPastedTable(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').filter(l => l.trim());
  const byTab = lines.some(l => l.includes('\t'));
  return lines
    .map(l => (byTab ? l.split('\t') : l.split(/\s{2,}/)).map(norm))
    .filter(r => r.some(Boolean));
}

/** Матрица + карта колонок -> строки КТП. */
export function rowsFromMatrix(matrix, map, skipFirst = false) {
  const out = [];
  matrix.slice(skipFirst ? 1 : 0).forEach(cells => {
    const rec = rowFrom(cells, map);
    if (rec) out.push(rec);
  });
  return out;
}

/* ---------- раскладка КТП по заездам и занятиям ---------- */

export const programHours = (program) => (program?.rows || []).reduce((a, r) => a + (Number(r.hours) || 1), 0);

/** 36 ч = 12+12+12, 34 ч = 12+12+10 — как делит методист. Иначе поровну. */
export function defaultShiftHours(total) {
  if (total === 36) return [12, 12, 12];
  if (total === 34) return [12, 12, 10];
  const base = Math.floor(total / 3);
  const rest = total - base * 3;
  return [base + (rest > 0 ? 1 : 0), base + (rest > 1 ? 1 : 0), base];
}

/** Часы КТП «по одному»: строка на 2 часа даёт два слота с той же темой. */
export function ktpSlots(program) {
  const slots = [];
  for (const r of program?.rows || []) {
    const n = Math.max(1, Math.round(Number(r.hours) || 1));
    for (let i = 0; i < n; i++) slots.push({ row: r, part: n > 1 ? i + 1 : 0, parts: n });
  }
  return slots.map((s, i) => ({ ...s, hourNo: i + 1 }));
}

/** Слоты, отведённые заезду, с учётом деления программы по заездам. */
export function slotsForShift(program, shift) {
  const all = ktpSlots(program);
  const split = (program?.shiftHours || defaultShiftHours(all.length)).map(n => Math.max(0, Number(n) || 0));
  const start = split.slice(0, shift - 1).reduce((a, b) => a + b, 0);
  return all.slice(start, start + (split[shift - 1] ?? 0));
}
