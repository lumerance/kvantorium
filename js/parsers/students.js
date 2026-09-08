// Разбор docx со списком обучающихся -> предметы -> группы -> ученики.
import { readDocx } from '../lib/docx.js';

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
// «Группа 4», «Группа №4» и опечатка «Группы 5» — она реально встречается в списках.
const isGroupRow = (t) => /^групп[аы]\s*№?\s*\d+/i.test(norm(t));
const isSchoolRow = (t) => /наименование\s+школы/i.test(t);
const isHeaderRow = (row) => /№\s*п\/?п/i.test(norm(row[0] || '')) || row.some(c => /^ФИО$/i.test(norm(c)));
const DATE_RE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\.?$/;
const NUM_RE = /^\d{1,3}\.?$/;
// ФИО: с заглавной, минимум два слова, без цифр — так отсекаются и заголовки
// («Группа 4», «Промробо/Промдизайн (5 класс)»), и даты рождения.
const looksLikeFio = (v) => !/\d/.test(v) && /^[А-ЯЁ][А-Яа-яЁё'’ʼ-]+(\s+[А-ЯЁ][А-Яа-яЁё.'’ʼ-]*){1,3}/.test(norm(v));

/**
 * Ячейки строки -> осмысленные значения. В реальных docx колонки разорваны
 * служебными столбцами по 12 твипов и склеены gridSpan-ами: одно и то же
 * значение приходит 2-3 раза подряд, а номер колонки «плывёт» от строки к
 * строке (в одной группе ФИО лежит в 3-й ячейке, в следующей — уже в 4-й).
 * Схлопываем повторы и пустоты, а поля дальше ищем по содержимому, не по индексу.
 */
function cellValues(row) {
  const out = [];
  for (const c of row) {
    const v = norm(c);
    if (!v || out[out.length - 1] === v) continue;
    out.push(v);
  }
  return out;
}

function splitFio(fio) {
  const parts = norm(fio).split(' ').filter(Boolean);
  return {
    last: parts[0] || '',
    first: parts[1] || '',
    middle: parts.slice(2).join(' '),
    short: [parts[0], parts[1]].filter(Boolean).join(' '),
    full: norm(fio),
  };
}

const gradeOf = (title) => {
  const m = /(\d{1,2})\s*класс/i.exec(title || '');
  return m ? parseInt(m[1], 10) : null;
};

let uid = 0;
const nextId = (p) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

/** Есть ли в строке ученик: ФИО + (необязательно) дата рождения. */
function fioOf(vals) {
  const birth = vals.find(v => DATE_RE.test(v)) || '';
  const fio = vals.find(v => v !== birth && looksLikeFio(v));
  return fio ? { fio, birth } : null;
}

function studentOf(vals) {
  const f = fioOf(vals);
  if (!f) return null;
  const nums = vals.slice(0, vals.indexOf(f.fio)).filter(v => NUM_RE.test(v)).map(v => v.replace(/\.$/, ''));
  const p = splitFio(f.fio);
  return {
    id: nextId('st_'),
    no: nums[0] || '', noInGroup: nums[1] || '',
    fio: p.full, last: p.last, first: p.first, middle: p.middle, short: p.short,
    birth: f.birth.replace(/\.$/, ''),
  };
}

/** Группа с таким номером могла начаться в предыдущей таблице (Word рвёт
 *  длинные таблицы по страницам) — тогда продолжаем её, а не заводим дубль. */
function ensureGroup(subject, label) {
  const num = parseInt(/(\d+)/.exec(label)?.[1] || String(subject.groups.length + 1), 10);
  const found = subject.groups.find(g => g.index === num);
  if (found) return found;
  const g = { id: nextId('grp_'), name: `Группа ${num}`, index: num, students: [] };
  subject.groups.push(g);
  return g;
}

/**
 * @returns {{subjects:Array<{id,title,grade,school,groups:Array<{id,name,index,students:Array}>}>, stats:object}}
 */
export function parseStudentsDoc(docxData) {
  const subjects = [];
  let subject = null;
  let group = null;

  for (const table of docxData.tables) {
    const rows = table.rows;
    if (!rows.length) continue;

    // Заголовок предмета — строка во всю ширину до первой группы/ученика.
    // Если её нет, таблица является продолжением предыдущей (перенос на новую
    // страницу) и вливается в тот же предмет и ту же группу.
    let title = '';
    for (const row of rows) {
      const vals = cellValues(row);
      if (!vals.length) continue;
      if (isSchoolRow(vals[0]) || isHeaderRow(row)) continue;
      if (isGroupRow(vals[0]) || fioOf(vals)) break;
      if (vals.length === 1) { title = vals[0]; break; }
    }

    if (title) {
      subject = { id: nextId('sub_'), title, grade: gradeOf(title), school: '', groups: [] };
      subjects.push(subject);
      group = null;
    }
    if (!subject) {
      subject = { id: nextId('sub_'), title: 'Без названия', grade: null, school: '', groups: [] };
      subjects.push(subject);
    }

    for (const row of rows) {
      const vals = cellValues(row);
      if (!vals.length) continue;
      if (isSchoolRow(vals[0])) {
        if (!subject.school) subject.school = norm(vals[0].split(':').slice(1).join(':')) || vals[0];
        continue;
      }
      if (isGroupRow(vals[0])) { group = ensureGroup(subject, vals[0]); continue; }
      if (isHeaderRow(row)) continue;
      const student = studentOf(vals);
      if (!student) continue;
      if (!group) group = ensureGroup(subject, 'Группа 1');
      // на разрыве страницы Word повторяет часть строк — не задваиваем ребёнка
      if (group.students.some(x => x.fio === student.fio && x.birth === student.birth)) continue;
      group.students.push(student);
    }
  }

  for (const s of subjects) s.groups = s.groups.filter(g => g.students.length);
  const withGroups = subjects.filter(s => s.groups.length);

  const stats = {
    subjects: withGroups.length,
    groups: withGroups.reduce((a, s) => a + s.groups.length, 0),
    students: withGroups.reduce((a, s) => a + s.groups.reduce((b, g) => b + g.students.length, 0), 0),
  };
  return { subjects: withGroups, stats };
}

export async function importStudentsFile(file) {
  const buf = await file.arrayBuffer();
  const docx = await readDocx(buf);
  const res = parseStudentsDoc(docx);
  if (!res.subjects.length) throw new Error('В документе не найдено ни одной группы обучающихся.');
  res.sourceName = file.name;
  return res;
}

/** Экспорт учеников в CSV (Excel-совместимый, разделитель — точка с запятой). */
export function studentsToCsv(subjects) {
  const rows = [['Предмет', 'Класс', 'Школа', 'Группа', '№ в группе', 'Фамилия', 'Имя', 'Отчество', 'Дата рождения']];
  for (const s of subjects) for (const g of s.groups) for (const st of g.students) {
    rows.push([s.title, s.grade ?? '', s.school, g.name, st.noInGroup, st.last, st.first, st.middle, st.birth]);
  }
  return '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
}

/* ---------- импорт учеников из CSV (обратная операция к экспорту) ---------- */
function splitCsvLine(line, sep) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(v => v.trim());
}

export function parseStudentsCsv(text) {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const lines = clean.split('\n').filter(l => l.trim());
  if (!lines.length) throw new Error('Файл пуст.');
  const sep = (lines[0].split(';').length >= lines[0].split(',').length) ? ';' : ',';
  const head = splitCsvLine(lines[0], sep).map(x => x.toLowerCase());
  const col = (...names) => head.findIndex(hh => names.some(n => hh.includes(n)));
  const iSubject = col('предмет', 'программ');
  const iGrade = col('класс');
  const iSchool = col('школ');
  const iGroup = col('группа');
  const iNo = col('№ в группе', 'номер');
  const iLast = col('фамилия');
  const iFirst = col('имя');
  const iMid = col('отчество');
  const iFio = col('фио');
  const iBirth = col('рожден');
  if (iSubject < 0 || iGroup < 0 || (iLast < 0 && iFio < 0)) {
    throw new Error('В CSV нужны колонки «Предмет», «Группа» и «Фамилия» (или «ФИО»).');
  }
  const subjects = [];
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line, sep);
    const subTitle = c[iSubject]; if (!subTitle) continue;
    let sub = subjects.find(s => s.title === subTitle);
    if (!sub) {
      sub = { id: nextId('sub_'), title: subTitle, grade: iGrade >= 0 && c[iGrade] ? parseInt(c[iGrade], 10) : gradeOf(subTitle), school: iSchool >= 0 ? c[iSchool] : '', groups: [] };
      subjects.push(sub);
    }
    const gName = c[iGroup] || 'Группа 1';
    let grp = sub.groups.find(g => g.name === gName);
    if (!grp) {
      grp = { id: nextId('grp_'), name: gName, index: parseInt(/(\d+)/.exec(gName)?.[1] || sub.groups.length + 1, 10), students: [] };
      sub.groups.push(grp);
    }
    const fio = iFio >= 0 && c[iFio] ? c[iFio] : [c[iLast], c[iFirst], iMid >= 0 ? c[iMid] : ''].filter(Boolean).join(' ');
    if (!norm(fio)) continue;
    const pp = splitFio(fio);
    grp.students.push({
      id: nextId('st_'), no: String(grp.students.length + 1), noInGroup: iNo >= 0 ? c[iNo] : String(grp.students.length + 1),
      fio: pp.full, last: pp.last, first: pp.first, middle: pp.middle, short: pp.short,
      birth: iBirth >= 0 ? c[iBirth] : '',
    });
  }
  const withStudents = subjects.filter(s => (s.groups = s.groups.filter(g => g.students.length)).length);
  if (!withStudents.length) throw new Error('В CSV не найдено ни одного ученика.');
  return {
    subjects: withStudents,
    stats: {
      subjects: withStudents.length,
      groups: withStudents.reduce((a, s) => a + s.groups.length, 0),
      students: withStudents.reduce((a, s) => a + s.groups.reduce((b, g) => b + g.students.length, 0), 0),
    },
  };
}

export async function importStudentsCsvFile(file) {
  const res = parseStudentsCsv(await file.text());
  res.sourceName = file.name;
  return res;
}
