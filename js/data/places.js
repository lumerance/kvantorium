// Места агломераций по коду в названии группы: «Т2 РШ7» — Шимановск,
// «Д1 НуВ» — Новокиевский Увал. Сетевые группы (Т, И) и группы ДО (Д, У)
// одного места в индивидуальном плане помечаются разными буквами (НуР / НуВ,
// РШ / ВШ), поэтому оба варианта — одно и то же место.
export const PLACES = {
  'НуР': 'Новокиевский Увал',
  'НуВ': 'Новокиевский Увал',
  'РШ': 'Шимановск',
  'ВШ': 'Шимановск',
  'РТ': 'Талакан',
};

/** «Т2 НуР5» -> «НуР», «Д1 НуВ» -> «НуВ», «Д Р1» -> null. */
export function placeCodeOf(code) {
  const parts = String(code || '').trim().split(/\s+/);
  if (parts.length < 2) return null;
  const m = /^([А-ЯЁа-яё]+)/.exec(parts[1]);
  return m ? m[1] : null;
}

export const placeOf = (code) => PLACES[placeCodeOf(code)] || null;

/** Место агломерации — чаще всего встречающееся среди кодов её групп. */
export function placeOfAgg(agg) {
  const codes = new Set(Object.keys(agg.mapping || {}));
  for (const sh of ['1', '2', '3']) for (const c of agg.schedules?.[sh]?.codes || []) codes.add(c);
  for (const g of agg.enroll?.groups || []) if (g.code) codes.add(g.code);
  const count = new Map();
  for (const c of codes) { const p = placeOf(c); if (p) count.set(p, (count.get(p) || 0) + 1); }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

/** Блоки индивидуального плана: строки групп одной агломерации идут под
 *  одним периодом («4.12.2026 - 16.02.2027»). */
export function planBlocks(plan) {
  const sheet = (plan?.sheets || []).find(s => s.kind === 'teaching') || plan?.sheets?.[0];
  if (!sheet) return [];
  const key = (p) => String(p || '').replace(/\s+/g, '');
  const blocks = [];
  for (const e of sheet.entries) {
    let b = blocks.find(x => x.key === key(e.period));
    if (!b) { b = { key: key(e.period), period: e.period, names: [] }; blocks.push(b); }
    b.names.push(e.name);
  }
  for (const b of blocks) {
    const count = new Map();
    for (const n of b.names) { const p = placeOf(n); if (p) count.set(p, (count.get(p) || 0) + 1); }
    b.place = [...count.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || null;
  }
  return blocks;
}

// тип населённого пункта для шапок документов
const PLACE_KIND = { 'Новокиевский Увал': 'с.', 'Шимановск': 'г.', 'Талакан': 'пгт' };
/** «Новокиевский Увал» -> «с. Новокиевский Увал», «Шимановск» -> «г. Шимановск». */
export const placeTitle = (place) => (place ? `${PLACE_KIND[place] || 'с.'} ${place}` : '');
