// Выгрузка расписания заезда в Word по образцу технопарка: альбомный лист,
// два блока «СОГЛАСОВАНО» (школа и технопарк), заголовок, по таблице на
// каждую неделю (№ урока/время × дни с датами), комментарий внизу.
import { p, table, buildDocx } from '../lib/docx-write.js';
import { weeksOf } from '../lib/schedule-build.js';

const short = (iso) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y.slice(2)}`; };
const dm = (iso) => { const [, m, d] = iso.split('-'); return `${d}.${m}`; };

/**
 * @param {object} o
 *  {school:{name, locality, director}, kv:{title, head}, yearLabel, place, shift,
 *   direction, days, fiveDay, grid, times, comment,
 *   second:{enabled, direction, first} — пустой блок второго педагога}
 */
export async function buildScheduleDocx(o) {
  const blocks = [];
  const W = 24.6;                                    // ширина рабочей области альбомного A4 при полях 2,54 см

  // шапка «СОГЛАСОВАНО» — таблица без рамок
  const year = (o.days[0] || '').slice(0, 4);
  blocks.push(table([1, 1], [[
    { text: ['СОГЛАСОВАНО', `Директор ${o.school.name || '________________'}`, o.school.locality || '', `${o.school.director || ''} ______________`, ` _______________${year} г.`].join('\n'), size: 12 },
    { text: ['СОГЛАСОВАНО', o.kv.title || '', `______________ ${o.kv.head || ''}`, `______________${year} г.`].join('\n'), size: 12 },
  ]], { widthCm: W, noBorders: true }));

  blocks.push(p('', { size: 6, spacingAfter: 0 }));
  blocks.push(p('РАСПИСАНИЕ ЗАНЯТИЙ', { bold: true, size: 14, align: 'center', spacingAfter: 0 }));
  blocks.push(p('МТ «Кванториум-28»', { bold: true, size: 14, align: 'center', spacingAfter: 0 }));
  blocks.push(p(`на ${o.yearLabel} уч. год`, { bold: true, size: 14, align: 'center', spacingAfter: 0 }));
  blocks.push(p(`${o.place ? o.place + ', ' : ''}${o.shift} заезд`, { bold: true, size: 14, align: 'center', spacingAfter: 8 }));

  const weeks = weeksOf(o.days, o.fiveDay);
  const cols = o.fiveDay ? 5 : 6;
  const widths = [1, ...Array(cols).fill(1)];
  for (const w of weeks) {
    const rows = [];
    rows.push([
      { text: '№ урока/\nвремя', bold: true, align: 'center', size: 12 },
      { text: 'Направление/Педагог/Дни недели/Даты', bold: true, align: 'center', size: 12, span: cols },
    ]);
    rows.push([
      { text: `${w.no} неделя\n${dm(w.from)}-${short(w.to)}`, bold: true, size: 12 },
      ...w.days.map(d => ({ text: d.date ? `${d.weekday}\n${short(d.date)}` : d.weekday, bold: true, align: 'center', size: 12 })),
    ]);
    // блок педагога: строка «Направление (Педагог)» и уроки; у второго педагога — пустые клетки
    const section = (direction, grid) => {
      rows.push([{ text: direction || '', bold: true, align: 'center', size: 12, span: cols + 1 }]);
      o.times.forEach((t, i) => {
        rows.push([
          { text: `${i + 1}. ${t}`, size: 12 },
          ...w.days.map(d => ({ text: (grid && d.date) ? (grid[d.date]?.[i] || '') : '', align: 'center', size: 12 })),
        ]);
      });
    };
    const mine = () => section(o.direction, o.grid);
    const other = () => section(o.second.direction || 'Направление (Педагог)', null);
    if (o.second?.enabled && o.second.first) { other(); mine(); }
    else { mine(); if (o.second?.enabled) other(); }
    blocks.push(table(widths, rows, { widthCm: W, header: 2 }));
    blocks.push(p('', { size: 8, spacingAfter: 6 }));
  }

  for (const line of String(o.comment || '').split('\n')) blocks.push(p(line, { size: 12, spacingAfter: 0 }));

  return buildDocx(blocks, { landscape: true, margins: { top: 1134, right: 1134, bottom: 851, left: 1134 } });
}
