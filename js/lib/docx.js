// Чтение .docx: превращаем word/document.xml в линейный список блоков
// [{type:'p', text}, {type:'table', rows:[[cell,...]], merged:[bool,...]}]
import { unzip, textOf, parseXml } from './zip.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const attr = (el, name) => el?.getAttributeNS(W, name) ?? el?.getAttribute('w:' + name) ?? null;
const kids = (el, tag) => Array.from(el.children).filter(c => c.localName === tag);
const kid = (el, tag) => Array.from(el.children).find(c => c.localName === tag) || null;

function paraText(p) {
  let s = '';
  for (const node of p.getElementsByTagName('*')) {
    if (node.localName === 't') s += node.textContent;
    else if (node.localName === 'tab') s += '\t';
    else if (node.localName === 'br' || node.localName === 'cr') s += '\n';
  }
  return s.replace(/ /g, ' ').replace(/​/g, '').trim();
}

function cellText(tc) {
  return kids(tc, 'p').map(paraText).filter(Boolean).join('\n').trim();
}

/** Строит прямоугольную сетку таблицы: gridSpan разворачивается, vMerge наследует значение сверху. */
function readTable(tbl) {
  const rowsEls = kids(tbl, 'tr');
  const grid = [];
  const mergedFlags = [];
  // настоящие ячейки строки с их положением в сетке: {text, col, span} —
  // нужны там, где в Word колонки «поехали» (узкая служебная колонка
  // в шапке относится к одному дню, а в строках уроков — к соседнему)
  const cells = [];
  const tblGrid = kid(tbl, 'tblGrid');
  const gridW = tblGrid ? kids(tblGrid, 'gridCol').map(g => parseInt(attr(g, 'w'), 10) || 0) : [];
  rowsEls.forEach((tr, ri) => {
    const row = [];
    const flags = [];
    const rowCells = [];
    const trPr = kid(tr, 'trPr');
    const before = parseInt(trPr && attr(kid(trPr, 'gridBefore'), 'val') || '0', 10) || 0;
    for (const tc of kids(tr, 'tc')) {
      const pr = kid(tc, 'tcPr');
      const span = Math.max(1, parseInt(pr && attr(kid(pr, 'gridSpan'), 'val') || '1', 10) || 1);
      const vm = pr ? kid(pr, 'vMerge') : null;
      const vmVal = vm ? (attr(vm, 'val') || 'continue') : null;
      let text = cellText(tc);
      if (vmVal === 'continue' && ri > 0) {
        const above = grid[ri - 1];
        if (above && above[row.length] !== undefined) text = above[row.length];
      }
      rowCells.push({ text, col: before + row.length, span });
      for (let k = 0; k < span; k++) { row.push(text); flags.push(span > 1); }
    }
    grid.push(row);
    cells.push(rowCells);
    mergedFlags.push(flags);
  });
  const width = Math.max(0, ...grid.map(r => r.length));
  grid.forEach(r => { while (r.length < width) r.push(''); });
  return { type: 'table', rows: grid, width, cells, gridW };
}

/** @returns {Promise<{blocks:Array, paragraphs:string[], tables:Array}>} */
export async function readDocx(arrayBuffer) {
  const zip = await unzip(arrayBuffer);
  const xml = textOf(zip, 'word/document.xml');
  if (!xml) throw new Error('Это не .docx (не найден word/document.xml).');
  const doc = parseXml(xml);
  const body = doc.getElementsByTagName('*');
  let bodyEl = null;
  for (const el of body) if (el.localName === 'body') { bodyEl = el; break; }
  if (!bodyEl) throw new Error('Пустой документ Word.');

  const blocks = [];
  for (const el of Array.from(bodyEl.children)) {
    if (el.localName === 'p') {
      const t = paraText(el);
      blocks.push({ type: 'p', text: t });
    } else if (el.localName === 'tbl') {
      blocks.push(readTable(el));
    }
  }
  return {
    blocks,
    paragraphs: blocks.filter(b => b.type === 'p').map(b => b.text).filter(Boolean),
    tables: blocks.filter(b => b.type === 'table'),
  };
}

/** Строка полностью объединена (все ячейки одинаковы и непусты). */
export function isMergedRow(row) {
  const v = (row[0] || '').trim();
  if (!v) return false;
  return row.every(c => (c || '').trim() === v);
}
