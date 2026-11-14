// Разбор docx с расписанием занятий (МТ «Кванториум-28»).
// Документ = один заезд (2 учебные недели). Таблицы: по неделям, внутри — секции педагогов.
import { readDocx, isMergedRow } from '../lib/docx.js';

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const WD = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

function parseDate(s) {
  const m = /(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/.exec(s || '');
  if (!m) return null;
  let y = parseInt(m[3], 10);
  if (y < 100) y += 2000;
  const d = String(parseInt(m[1], 10)).padStart(2, '0');
  const mo = String(parseInt(m[2], 10)).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

const isTeacherRow = (row) => {
  if (!isMergedRow(row)) return false;
  const t = norm(row[0]);
  return /\(/.test(t) && !/неделя/i.test(t) && !/^№/.test(t);
};

function splitTeacher(text) {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(norm(text));
  return m ? { direction: norm(m[1]), teacher: norm(m[2]) } : { direction: norm(text), teacher: '' };
}

const lessonHead = (t) => {
  const m = /^(\d{1,2})\s*[.)]\s*(.*)$/.exec(norm(t));
  return m ? { no: parseInt(m[1], 10), time: norm(m[2]) } : null;
};

/** Номер заезда и город из шапки документа. */
function readMeta(paragraphs) {
  const all = paragraphs.join('\n');
  const shift = /(\d)\s*заезд/i.exec(all);
  const city = /г\.\s*([А-ЯЁ][А-Яа-яЁё-]+)/.exec(all);
  const year = /(\d{4})\s*[-–—]\s*(\d{4})\s*уч/i.exec(all);
  return {
    shift: shift ? parseInt(shift[1], 10) : null,
    city: city ? city[1] : '',
    year: year ? `${year[1]}-${year[2]}` : '',
    notes: paragraphs.filter(p => /^[ТДИУП]\s|^[ТДИУП]\s*[РВ]?\s*[–-]/.test(p)),
  };
}

export function parseScheduleDoc(docxData) {
  const meta = readMeta(docxData.paragraphs);
  const lessons = [];
  const weeks = [];
  const teachers = new Set();
  const codes = new Set();

  docxData.tables.forEach((table, ti) => {
    const rows = table.rows;
    // ищем строку с днями недели / датами
    let dayRowIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
      const r = rows[i];
      const hasWd = r.slice(1).some(c => WD.some(w => norm(c).toLowerCase().includes(w)));
      if (hasWd) { dayRowIdx = i; break; }
    }
    if (dayRowIdx < 0) return;

    const dayRow = rows[dayRowIdx];
    const weekLabel = norm(dayRow[0]) || `Неделя ${weeks.length + 1}`;
    const weekNo = (/(\d+)\s*недел/i.exec(weekLabel)?.[1]) ? parseInt(/(\d+)\s*недел/i.exec(weekLabel)[1], 10) : weeks.length + 1;
    const cols = [];
    for (let j = 1; j < dayRow.length; j++) {
      const raw = norm(dayRow[j]);
      const wd = WD.find(w => raw.toLowerCase().includes(w)) || '';
      cols[j] = { weekday: wd, date: parseDate(raw) };
    }
    weeks.push({ index: weekNo, label: weekLabel, tableIndex: ti, days: cols.filter(Boolean) });

    let current = { direction: '', teacher: '' };
    for (let i = dayRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (isTeacherRow(row)) { current = splitTeacher(row[0]); if (current.teacher) teachers.add(current.teacher); continue; }
      const head = lessonHead(row[0]);
      if (!head) continue;
      for (let j = 1; j < row.length; j++) {
        const code = norm(row[j]);
        if (!code) continue;
        const col = cols[j];
        if (!col || !col.date) continue;
        codes.add(code);
        lessons.push({
          date: col.date, weekday: col.weekday, week: weekNo,
          no: head.no, time: head.time,
          teacher: current.teacher, direction: current.direction,
          code, kind: /^мк$/i.test(code) ? 'event' : 'group',
        });
      }
    }
  });

  // дедупликация: одна группа не может иметь два занятия на одном уроке в один день
  const seen = new Set();
  const unique = lessons.filter(l => {
    const k = `${l.date}|${l.no}|${l.teacher}|${l.code}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  unique.sort((a, b) => a.date.localeCompare(b.date) || a.no - b.no);

  return {
    ...meta,
    lessons: unique,
    weeks,
    teachers: [...teachers],
    codes: [...codes].filter(c => !/^мк$/i.test(c)).sort(),
    dates: [...new Set(unique.map(l => l.date))].sort(),
  };
}

export async function importScheduleFile(file) {
  const docx = await readDocx(await file.arrayBuffer());
  const res = parseScheduleDoc(docx);
  if (!res.lessons.length) throw new Error('В документе расписания не найдено ни одного занятия.');
  res.sourceName = file.name;
  return res;
}

/**
 * Автосопоставление кода расписания («Т1 РШ7») с группой из списка обучающихся.
 * Т — труд, И — информатика, Д/У — дополнительное образование; цифра сразу после буквы — номер группы;
 * последняя цифра хвоста — класс.
 */
export function parseCode(code) {
  const c = norm(code);
  const m = /^([А-ЯЁA-Z]+)\s*(\d+)\s*(.*)$/i.exec(c);
  if (!m) return null;
  const tail = m[3] || '';
  const gradeM = /(\d{1,2})\s*$/.exec(tail);
  return {
    code: c,
    prefix: m[1].toUpperCase(),
    group: parseInt(m[2], 10),
    tail: tail.trim(),
    grade: gradeM ? parseInt(gradeM[1], 10) : null,
  };
}

// Сетевые предметы из списков школ идут под Т (труд) и И (информатика).
// Остальные буквы (Д, У, П …) — группы дополнительного образования из
// «Набора»: их нельзя сопоставлять с сетевыми группами по номеру.
export const isDoCode = (code) => !/^\s*[ТИ]/i.test(String(code || ''));

export function autoMatch(code, subjects) {
  const p = parseCode(code);
  if (!p || isDoCode(code)) return null;
  const byGrade = p.grade ? subjects.filter(s => s.grade === p.grade) : [];
  let pool = byGrade;
  if (!pool.length) {
    if (p.prefix.startsWith('И')) pool = subjects.filter(s => /информат|алгоритм|программир/i.test(s.title));
    else if (p.prefix.startsWith('Т')) pool = subjects.filter(s => /робот|промдизайн|промробо|технолог/i.test(s.title));
    else pool = subjects.filter(s => /вводн|модул|техно|презентац|код|движен/i.test(s.title));
  }
  if (!pool.length) pool = subjects;
  for (const s of pool) {
    const g = s.groups.find(g => g.index === p.group);
    if (g) return { subjectId: s.id, groupId: g.id, confidence: byGrade.length ? 'high' : 'guess' };
  }
  return null;
}
