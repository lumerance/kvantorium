// Чтение PDF без сторонних библиотек — только «текстовых» PDF (сохранённых из
// Word, LibreOffice и т.п.), не сканов: в скане вместо текста картинка.
//
// Из каждой страницы достаются фрагменты текста с координатами и линии рамок.
// По рамкам таблица собирается обратно в сетку ячеек — того же вида, что
// отдаёт readDocx ({rows, width}): объединённая по горизонтали ячейка
// повторяется в каждой колонке, по вертикали — в каждой строке. Поэтому
// дальше таблицы разбирает тот же код, что и для docx (js/parsers/ktp.js).
// Таблицы без нарисованных рамок не распознаются.

/* ===================== лексер и объекты PDF ===================== */

const WS = new Uint8Array(256);
[0, 9, 10, 12, 13, 32].forEach(c => { WS[c] = 1; });
const DL = new Uint8Array(256);
'()<>[]{}/%'.split('').forEach(c => { DL[c.charCodeAt(0)] = 1; });

class Ref { constructor(num) { this.num = num; } }
class PStr { constructor(bytes) { this.bytes = bytes; } }
class Op { constructor(name) { this.name = name; } }
class PStream { constructor(dict, raw) { this.dict = dict; this.raw = raw; } }
const EOF = { eof: true };
// Имена хранятся строкой с «/» в начале ('/Font'), ключи словарей — без неё.

class Lexer {
  constructor(bytes, pos = 0) { this.b = bytes; this.p = pos; }

  skip() {
    const b = this.b, n = b.length;
    for (;;) {
      while (this.p < n && WS[b[this.p]]) this.p++;
      if (this.p < n && b[this.p] === 37) {          // % комментарий
        while (this.p < n && b[this.p] !== 10 && b[this.p] !== 13) this.p++;
        continue;
      }
      return;
    }
  }

  token() {
    this.skip();
    const b = this.b, n = b.length;
    if (this.p >= n) return EOF;
    const c = b[this.p];
    if (c === 40) return this.literal();
    if (c === 60) {
      if (b[this.p + 1] === 60) { this.p += 2; return '<<'; }
      return this.hex();
    }
    if (c === 62) {
      this.p += b[this.p + 1] === 62 ? 2 : 1;
      return '>>';
    }
    if (c === 91) { this.p++; return '['; }
    if (c === 93) { this.p++; return ']'; }
    if (c === 123 || c === 125 || c === 41) { this.p++; return this.token(); }
    if (c === 47) return this.name();
    const start = this.p;
    while (this.p < n && !WS[b[this.p]] && !DL[b[this.p]]) this.p++;
    let s = '';
    for (let i = start; i < this.p; i++) s += String.fromCharCode(b[i]);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return parseFloat(s);
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null') return null;
    return new Op(s);
  }

  name() {
    const b = this.b, n = b.length;
    this.p++;
    let s = '/';
    while (this.p < n && !WS[b[this.p]] && !DL[b[this.p]]) {
      if (b[this.p] === 35 && this.p + 2 < n) {     // #xx
        const v = parseInt(String.fromCharCode(b[this.p + 1], b[this.p + 2]), 16);
        if (isFinite(v)) { s += String.fromCharCode(v); this.p += 3; continue; }
      }
      s += String.fromCharCode(b[this.p++]);
    }
    return s;
  }

  literal() {
    const b = this.b, n = b.length;
    const out = [];
    let depth = 1;
    this.p++;
    while (this.p < n) {
      let c = b[this.p++];
      if (c === 92) {
        c = b[this.p++];
        if (c === 110) out.push(10);
        else if (c === 114) out.push(13);
        else if (c === 116) out.push(9);
        else if (c === 98) out.push(8);
        else if (c === 102) out.push(12);
        else if (c === 13) { if (b[this.p] === 10) this.p++; }
        else if (c === 10) { /* перенос строки внутри строки — пропускается */ }
        else if (c >= 48 && c <= 55) {
          let v = c - 48;
          for (let k = 0; k < 2 && b[this.p] >= 48 && b[this.p] <= 55; k++) v = v * 8 + b[this.p++] - 48;
          out.push(v & 255);
        } else out.push(c);
        continue;
      }
      if (c === 40) depth++;
      else if (c === 41 && --depth === 0) break;
      out.push(c);
    }
    return new PStr(Uint8Array.from(out));
  }

  hex() {
    const b = this.b, n = b.length;
    this.p++;
    let s = '';
    while (this.p < n && b[this.p] !== 62) {
      const c = b[this.p++];
      if (!WS[c]) s += String.fromCharCode(c);
    }
    this.p++;
    if (s.length % 2) s += '0';
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16) || 0;
    return new PStr(out);
  }
}

function parseValue(lx, tok = lx.token(), refs = true) {
  if (tok === '[') {
    const arr = [];
    for (;;) {
      const t = lx.token();
      if (t === ']' || t === EOF) return arr;
      arr.push(parseValue(lx, t, refs));
    }
  }
  if (tok === '<<') {
    const dict = {};
    for (;;) {
      const k = lx.token();
      if (k === '>>' || k === EOF) return dict;
      if (typeof k !== 'string' || k[0] !== '/') continue;
      dict[k.slice(1)] = parseValue(lx, lx.token(), refs);
    }
  }
  if (refs && typeof tok === 'number' && Number.isInteger(tok) && tok >= 0) {
    const save = lx.p;
    const gen = lx.token();
    if (typeof gen === 'number' && Number.isInteger(gen)) {
      const r = lx.token();
      if (r instanceof Op && r.name === 'R') return new Ref(tok);
    }
    lx.p = save;
  }
  return tok;
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

/* ===================== фильтры потоков ===================== */

async function runDecompress(bytes, format) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)).getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } catch (e) {
    // битый хвост потока (нет контрольной суммы, мусор в конце) — частое
    // дело у генераторов PDF; всё, что успело распаковаться, годится
    if (!total) throw e;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function inflate(bytes) {
  try { return await runDecompress(bytes, 'deflate'); }
  catch { return runDecompress(bytes.subarray(2), 'deflate-raw'); }   // без заголовка zlib
}

function asciiHex(bytes) {
  const s = String.fromCharCode(...bytes).replace(/[^0-9a-f]/gi, '');
  const out = new Uint8Array(Math.ceil(s.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt((s.substr(i * 2, 2) + '0').slice(0, 2), 16);
  return out;
}

function ascii85(bytes) {
  const out = [];
  let group = [];
  for (const c of bytes) {
    if (c === 126) break;                        // ~>
    if (WS[c]) continue;
    if (c === 122 && !group.length) { out.push(0, 0, 0, 0); continue; }   // z
    group.push(c - 33);
    if (group.length === 5) {
      let v = 0;
      for (const d of group) v = v * 85 + d;
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      group = [];
    }
  }
  if (group.length > 1) {
    const n = group.length;
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const d of group) v = v * 85 + d;
    const tail = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...tail.slice(0, n - 1));
  }
  return Uint8Array.from(out);
}

/* ===================== документ ===================== */

class PdfDoc {
  constructor(bytes) {
    this.b = bytes;
    // windows-1252 — однобайтовая: позиции в строке совпадают с байтами
    this.text = new TextDecoder('windows-1252').decode(bytes);
    this.index = new Map();   // номер объекта -> позиции «N G obj» (последняя — самая новая)
    this.cache = new Map();
    const re = /(?:^|[\s>\]])(\d+)\s+\d+\s+obj\b/g;
    let m;
    while ((m = re.exec(this.text))) {
      const n = +m[1];
      if (!this.index.has(n)) this.index.set(n, []);
      this.index.get(n).push(m.index + m[0].length);
    }
    this.fonts = new Map();
  }

  get(n) {
    if (this.cache.has(n)) return this.cache.get(n);
    this.cache.set(n, null);                     // защита от циклов
    let val = null;
    const list = this.index.get(n) || [];
    for (let k = list.length - 1; k >= 0; k--) {
      try { val = this.parseAt(list[k]); break; } catch { /* битый кандидат — пробуем более ранний */ }
    }
    this.cache.set(n, val);
    return val;
  }

  resolve(v) {
    for (let guard = 0; v instanceof Ref && guard < 32; guard++) v = this.get(v.num);
    return v instanceof Ref ? null : v;
  }

  parseAt(pos) {
    const lx = new Lexer(this.b, pos);
    const v = parseValue(lx);
    const save = lx.p;
    const t = lx.token();
    if (!(t instanceof Op && t.name === 'stream')) { lx.p = save; return v; }
    let s = lx.p;
    if (this.b[s] === 13) s++;
    if (this.b[s] === 10) s++;
    const len = this.resolve(v.Length);
    let end = typeof len === 'number' ? s + len : -1;
    const okEnd = end >= s && /^\s*endstream/.test(this.text.slice(end, end + 32));
    if (!okEnd) {
      end = this.text.indexOf('endstream', s);
      if (end < 0) end = this.b.length;
      while (end > s && (this.b[end - 1] === 10 || this.b[end - 1] === 13)) end--;
    }
    return new PStream(v, this.b.subarray(s, end));
  }

  async decode(st) {
    let data = st.raw;
    let filters = this.resolve(st.dict.Filter);
    if (!filters) return data;
    if (!Array.isArray(filters)) filters = [filters];
    for (let f of filters) {
      f = this.resolve(f);
      if (f === '/FlateDecode' || f === '/Fl') data = await inflate(data);
      else if (f === '/ASCIIHexDecode' || f === '/AHx') data = asciiHex(data);
      else if (f === '/ASCII85Decode' || f === '/A85') data = ascii85(data);
      else throw new Error('Неподдерживаемое сжатие в PDF: ' + f);
    }
    return data;
  }

  /** Объекты, упакованные в потоки объектов (PDF 1.5+). */
  async loadObjectStreams() {
    for (const n of [...this.index.keys()]) {
      const o = this.get(n);
      if (!(o instanceof PStream) || o.dict.Type !== '/ObjStm') continue;
      let data;
      try { data = await this.decode(o); } catch { continue; }
      const count = num(this.resolve(o.dict.N));
      const first = num(this.resolve(o.dict.First));
      const lx = new Lexer(data);
      const pairs = [];
      for (let i = 0; i < count; i++) {
        const objNum = lx.token(), off = lx.token();
        if (typeof objNum !== 'number' || typeof off !== 'number') break;
        pairs.push([objNum, off]);
      }
      for (const [objNum, off] of pairs) {
        if (this.index.has(objNum)) continue;    // есть и обычная копия — она главнее
        try { this.cache.set(objNum, parseValue(new Lexer(data, first + off))); } catch { /* пропуск */ }
      }
    }
  }

  catalog() {
    const roots = [...this.text.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g)];
    for (let k = roots.length - 1; k >= 0; k--) {
      const c = this.get(+roots[k][1]);
      if (c && c.Pages) return c;
    }
    for (const n of this.index.keys()) {
      const o = this.get(n);
      if (o && !(o instanceof PStream) && o.Type === '/Catalog') return o;
    }
    return null;
  }

  pages() {
    const out = [];
    const seen = new Set();
    const walk = (ref, inh, depth) => {
      if (ref instanceof Ref) { if (seen.has(ref.num)) return; seen.add(ref.num); }
      const node = this.resolve(ref);
      if (!node || depth > 64 || node instanceof PStream) return;
      const cur = {
        res: node.Resources ?? inh.res,
        box: node.CropBox ?? node.MediaBox ?? inh.box,
        rot: node.Rotate ?? inh.rot,
      };
      const kids = this.resolve(node.Kids);
      if (Array.isArray(kids)) kids.forEach(k => walk(k, cur, depth + 1));
      else out.push({ node, ...cur });
    };
    const cat = this.catalog();
    if (cat) walk(cat.Pages, {}, 0);
    return out;
  }

  async font(ref) {
    const key = ref instanceof Ref ? ref.num : ref;
    if (!this.fonts.has(key)) this.fonts.set(key, buildFont(this, this.resolve(ref)).catch(() => null));
    return this.fonts.get(key);
  }
}

/* ===================== шрифты: коды -> текст ===================== */

const CP1252 = Array.from(new TextDecoder('windows-1252').decode(Uint8Array.from({ length: 256 }, (_, i) => i)));

// Самые частые имена глифов из стандартного списка Adobe.
const GLYPHS = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&',
  quotesingle: "'", parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-',
  period: '.', slash: '/', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>',
  question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', underscore: '_',
  braceleft: '{', bar: '|', braceright: '}', quoteleft: '‘', quoteright: '’', quotedblleft: '“',
  quotedblright: '”', quotedblbase: '„', guillemotleft: '«', guillemotright: '»', endash: '–',
  emdash: '—', bullet: '•', ellipsis: '…', nbspace: ' ', degree: '°', afii61352: '№', minus: '−',
};

function glyphToUnicode(name) {
  const n = name.replace(/^\//, '').replace(/\..*$/, '');
  if (GLYPHS[n]) return GLYPHS[n];
  if (/^[A-Za-z]$/.test(n)) return n;
  let m = /^uni([0-9A-F]{4})/i.exec(n);
  if (m) return String.fromCharCode(parseInt(m[1], 16));
  m = /^u([0-9A-F]{4,6})$/i.exec(n);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  m = /^afii(\d{5})$/.exec(n);                   // кириллица в шрифтах Type1
  if (m) {
    const v = +m[1];
    if (v >= 10017 && v <= 10022) return String.fromCharCode(0x410 + v - 10017);
    if (v === 10023) return 'Ё';
    if (v >= 10024 && v <= 10049) return String.fromCharCode(0x416 + v - 10024);
    if (v >= 10065 && v <= 10070) return String.fromCharCode(0x430 + v - 10065);
    if (v === 10071) return 'ё';
    if (v >= 10072 && v <= 10097) return String.fromCharCode(0x436 + v - 10072);
  }
  return '';
}

function utf16hex(hex) {
  if (hex.length <= 2) return String.fromCharCode(parseInt(hex || '0', 16));
  const h = hex.length % 4 ? hex.padStart(hex.length + 4 - (hex.length % 4), '0') : hex;
  const units = [];
  for (let i = 0; i < h.length; i += 4) units.push(parseInt(h.substr(i, 4), 16));
  return String.fromCharCode(...units);
}

/** CMap (ToUnicode или встроенная кодировка): коды -> юникод и диапазоны длин кодов. */
function parseCMap(text) {
  const map = new Map();
  const codespace = [];
  const hexes = (s) => [...s.matchAll(/<([0-9a-fA-F\s]*)>/g)].map(m => m[1].replace(/\s/g, ''));
  for (const blk of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    const h = hexes(blk[1]);
    for (let i = 0; i + 1 < h.length; i += 2) {
      codespace.push({ len: Math.max(1, Math.ceil(h[i].length / 2)), lo: parseInt(h[i], 16), hi: parseInt(h[i + 1], 16) });
    }
  }
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    const h = hexes(blk[1]);
    for (let i = 0; i + 1 < h.length; i += 2) map.set(parseInt(h[i], 16), utf16hex(h[i + 1]));
  }
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const toks = [...blk[1].matchAll(/<([0-9a-fA-F\s]*)>|\[|\]/g)];
    let i = 0;
    while (i + 2 < toks.length) {
      const lo = parseInt(toks[i][1].replace(/\s/g, ''), 16);
      const hi = parseInt(toks[i + 1][1].replace(/\s/g, ''), 16);
      if (toks[i + 2][0] === '[') {
        let j = i + 3, c = lo;
        for (; j < toks.length && toks[j][0] !== ']'; j++) map.set(c++, utf16hex(toks[j][1].replace(/\s/g, '')));
        i = j + 1;
      } else {
        const base = utf16hex(toks[i + 2][1].replace(/\s/g, ''));
        const units = [...base].map(ch => ch.charCodeAt(0));
        for (let c = lo; c <= hi && c - lo < 65536; c++) {
          const u = units.slice();
          u[u.length - 1] += c - lo;
          map.set(c, String.fromCharCode(...u));
        }
        i += 3;
      }
    }
  }
  return { map, codespace };
}

const latin1 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
};

async function buildFont(doc, fd) {
  if (!fd) return null;
  const isType0 = fd.Subtype === '/Type0';
  const desc = isType0 ? doc.resolve((doc.resolve(fd.DescendantFonts) || [])[0]) || {} : null;

  let toUni = null;
  let codespace = [];
  const tu = doc.resolve(fd.ToUnicode);
  if (tu instanceof PStream) {
    try { const cm = parseCMap(latin1(await doc.decode(tu))); toUni = cm.map; codespace = cm.codespace; } catch { /* без ToUnicode */ }
  }
  const enc = doc.resolve(fd.Encoding);
  if (isType0 && enc instanceof PStream) {
    try { const cm = parseCMap(latin1(await doc.decode(enc))); if (cm.codespace.length) codespace = cm.codespace; } catch { /* оставляем как есть */ }
  }
  if (isType0 && !codespace.length) codespace = [{ len: 2, lo: 0, hi: 0xffff }];
  if (!isType0) codespace = [{ len: 1, lo: 0, hi: 255 }];
  const lens = [...new Set(codespace.map(c => c.len))].sort((a, b) => a - b);

  // однобайтовые шрифты: базовая кодировка + /Differences
  let table = null;
  if (!isType0) {
    table = CP1252.slice();
    const diffs = enc && typeof enc === 'object' && !(enc instanceof PStream) ? doc.resolve(enc.Differences) : null;
    if (Array.isArray(diffs)) {
      let code = 0;
      for (const d of diffs) {
        if (typeof d === 'number') code = d;
        else if (typeof d === 'string') { const u = glyphToUnicode(d); if (u && code < 256) table[code] = u; code++; }
      }
    }
  }

  // ширины глифов, в долях кегля
  const scale = fd.Subtype === '/Type3' ? Math.abs(num((doc.resolve(fd.FontMatrix) || [])[0])) || 0.001 : 0.001;
  let width;
  if (isType0) {
    const dw = num(doc.resolve(desc.DW)) || 1000;
    const wmap = new Map();
    const w = doc.resolve(desc.W) || [];
    for (let i = 0; i < w.length;) {
      const first = doc.resolve(w[i]);
      const next = doc.resolve(w[i + 1]);
      if (Array.isArray(next)) { next.forEach((v, k) => wmap.set(first + k, num(doc.resolve(v)))); i += 2; }
      else { const ww = num(doc.resolve(w[i + 2])); for (let c = first; c <= next && c - first < 65536; c++) wmap.set(c, ww); i += 3; }
    }
    width = (c) => (wmap.has(c) ? wmap.get(c) : dw) * scale;
  } else {
    const first = num(doc.resolve(fd.FirstChar));
    const widths = doc.resolve(fd.Widths);
    const fdesc = doc.resolve(fd.FontDescriptor) || {};
    const missing = num(doc.resolve(fdesc.MissingWidth));
    width = Array.isArray(widths)
      ? (c) => { const v = widths[c - first]; return (v === undefined ? missing : num(doc.resolve(v))) * scale; }
      : (c) => (c === 32 ? 250 : 500) * scale;   // стандартные 14 шрифтов без таблицы ширин
  }

  return {
    decode(bytes) {
      const out = [];
      for (let i = 0; i < bytes.length;) {
        let code = bytes[i], len = 1;
        for (const L of lens) {
          if (i + L > bytes.length) continue;
          let c = 0;
          for (let k = 0; k < L; k++) c = c * 256 + bytes[i + k];
          if (codespace.some(r => r.len === L && c >= r.lo && c <= r.hi)) { code = c; len = L; break; }
        }
        i += len;
        let ch = toUni && toUni.has(code) ? toUni.get(code) : (table ? table[code] || '' : '');
        if (ch === '\u0000') ch = '';
        out.push({ ch, w: width(code), space: len === 1 && code === 32 });
      }
      return out;
    },
  };
}

/* ===================== содержимое страницы ===================== */

const IDM = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Исполняет поток содержимого: текст — в sink.text, линии — в sink.rule. */
async function interpret(doc, bytes, resources, initGs, sink, depth = 0) {
  const lx = new Lexer(bytes);
  const fonts = doc.resolve(resources?.Font) || {};
  const xobjects = doc.resolve(resources?.XObject) || {};
  let gs = { ctm: IDM, font: null, size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, ...initGs };
  const stack = [];
  let tm = IDM, tlm = IDM;
  let args = [];
  let subs = [];          // подпути: [{pts:[[x,y]...], closed}]
  let cur = null;

  const newLine = () => { tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm; };

  const show = (arr) => {
    const f = gs.font;
    if (!f) return;
    let run = null;
    const flush = () => { if (run && run.str.trim()) sink.text(run); run = null; };
    for (const el of arr) {
      if (typeof el === 'number') {
        tm = mul([1, 0, 0, 1, -el / 1000 * gs.size * gs.th, 0], tm);
        if (el < -1500) flush();                   // большой отступ внутри TJ — разрыв фрагмента
        continue;
      }
      if (!(el instanceof PStr)) continue;
      for (const g of f.decode(el.bytes)) {
        const m0 = mul(tm, gs.ctm);
        const [x, y] = apply(m0, 0, gs.rise);
        tm = mul([1, 0, 0, 1, (g.w * gs.size + gs.tc + (g.space ? gs.tw : 0)) * gs.th, 0], tm);
        const [x2, y2] = apply(mul(tm, gs.ctm), 0, gs.rise);
        if (!run) run = { str: '', x, y, size: Math.abs(gs.size * Math.hypot(m0[2], m0[3])) || gs.size };
        run.str += g.ch;
        run.x2 = x2; run.y2 = y2;
      }
    }
    flush();
  };

  const paint = (stroke, fill) => {
    for (const s of subs) {
      if (fill && s.pts.length >= 2) {
        const xs = s.pts.map(p => p[0]), ys = s.pts.map(p => p[1]);
        sink.box(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
      }
      if (stroke) {
        for (let i = 1; i < s.pts.length; i++) sink.segment(s.pts[i - 1], s.pts[i]);
        if (s.closed && s.pts.length > 2) sink.segment(s.pts[s.pts.length - 1], s.pts[0]);
      }
    }
    subs = []; cur = null;
  };

  for (;;) {
    const t = lx.token();
    if (t === EOF) break;
    if (!(t instanceof Op)) { args.push(parseValue(lx, t, false)); continue; }
    const a = args;
    args = [];
    switch (t.name) {
      case 'q': stack.push(gs); gs = { ...gs }; break;
      case 'Q': if (stack.length) gs = stack.pop(); break;
      case 'cm': if (a.length >= 6) gs.ctm = mul(a.slice(-6).map(num), gs.ctm); break;
      case 'BT': tm = tlm = IDM; break;
      case 'Tf': gs.size = num(a[1]); gs.font = typeof a[0] === 'string' ? await doc.font(fonts[a[0].slice(1)]) : null; break;
      case 'Tc': gs.tc = num(a[0]); break;
      case 'Tw': gs.tw = num(a[0]); break;
      case 'Tz': gs.th = num(a[0]) / 100; break;
      case 'TL': gs.tl = num(a[0]); break;
      case 'Ts': gs.rise = num(a[0]); break;
      case 'Td': tlm = mul([1, 0, 0, 1, num(a[0]), num(a[1])], tlm); tm = tlm; break;
      case 'TD': gs.tl = -num(a[1]); tlm = mul([1, 0, 0, 1, num(a[0]), num(a[1])], tlm); tm = tlm; break;
      case 'Tm': if (a.length >= 6) { tlm = a.slice(-6).map(num); tm = tlm; } break;
      case 'T*': newLine(); break;
      case 'Tj': show([a[0]]); break;
      case 'TJ': show(Array.isArray(a[0]) ? a[0] : []); break;
      case "'": newLine(); show([a[0]]); break;
      case '"': gs.tw = num(a[0]); gs.tc = num(a[1]); newLine(); show([a[2]]); break;
      case 'm': cur = { pts: [apply(gs.ctm, num(a[0]), num(a[1]))], closed: false }; subs.push(cur); break;
      case 'l': if (cur) cur.pts.push(apply(gs.ctm, num(a[0]), num(a[1]))); break;
      case 'c': if (cur && a.length >= 6) cur.pts.push(apply(gs.ctm, num(a[4]), num(a[5]))); break;
      case 'v': case 'y': if (cur && a.length >= 4) cur.pts.push(apply(gs.ctm, num(a[2]), num(a[3]))); break;
      case 'h': if (cur) cur.closed = true; break;
      case 're': {
        const [x, y, w, hh] = a.map(num);
        subs.push({ pts: [apply(gs.ctm, x, y), apply(gs.ctm, x + w, y), apply(gs.ctm, x + w, y + hh), apply(gs.ctm, x, y + hh)], closed: true });
        cur = null;
        break;
      }
      case 'S': case 's': paint(true, false); break;
      case 'f': case 'F': case 'f*': paint(false, true); break;
      case 'B': case 'B*': case 'b': case 'b*': paint(true, false); break;
      case 'n': subs = []; cur = null; break;
      case 'ID': {                                 // встроенная картинка: пропускаем данные до EI
        const b = lx.b;
        let p = lx.p + 1;
        while (p < b.length - 2 && !(WS[b[p - 1]] && b[p] === 69 && b[p + 1] === 73 && (p + 2 >= b.length || WS[b[p + 2]]))) p++;
        lx.p = p + 2;
        break;
      }
      case 'Do': {
        const xo = typeof a[0] === 'string' ? doc.resolve(xobjects[a[0].slice(1)]) : null;
        if (!(xo instanceof PStream) || xo.dict.Subtype !== '/Form' || depth >= 4) break;
        const m = doc.resolve(xo.dict.Matrix);
        const ctm = Array.isArray(m) && m.length === 6 ? mul(m.map(num), gs.ctm) : gs.ctm;
        let data;
        try { data = await doc.decode(xo); } catch { break; }
        await interpret(doc, data, doc.resolve(xo.dict.Resources) || resources, { ...gs, ctm }, sink, depth + 1);
        break;
      }
      default: break;
    }
  }
}

/** Матрица, которая переводит координаты страницы в «как видно на экране»
 *  (начало — левый нижний угол, с учётом /Rotate). */
function pageMatrix(box, rotate) {
  const [x0, y0, x1, y1] = (Array.isArray(box) && box.length === 4 ? box : [0, 0, 595, 842]).map(num);
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  const shift = [1, 0, 0, 1, -Math.min(x0, x1), -Math.min(y0, y1)];
  const r = ((num(rotate) % 360) + 360) % 360;
  const rot = r === 90 ? [0, -1, 1, 0, 0, w] : r === 180 ? [-1, 0, 0, -1, w, h] : r === 270 ? [0, 1, -1, 0, h, 0] : IDM;
  return mul(shift, rot);
}

/* ===================== текст и таблицы страницы ===================== */

const THIN = 2.5;     // толщина, до которой залитый прямоугольник считается линией
const SNAP = 2.5;     // допуск совпадения координат линий

function collectRules(sink) {
  const hs = [], vs = [];
  sink.segment = (p, q) => {
    const dx = Math.abs(q[0] - p[0]), dy = Math.abs(q[1] - p[1]);
    if (dy < 1 && dx >= 2) hs.push({ pos: (p[1] + q[1]) / 2, a: Math.min(p[0], q[0]), b: Math.max(p[0], q[0]) });
    else if (dx < 1 && dy >= 2) vs.push({ pos: (p[0] + q[0]) / 2, a: Math.min(p[1], q[1]), b: Math.max(p[1], q[1]) });
  };
  sink.box = (x0, y0, x1, y1) => {
    const w = x1 - x0, h = y1 - y0;
    if (h <= THIN && w >= 2) hs.push({ pos: (y0 + y1) / 2, a: x0, b: x1 });
    else if (w <= THIN && h >= 2) vs.push({ pos: (x0 + x1) / 2, a: y0, b: y1 });
  };
  return { hs, vs };
}

/** Склеивает соосные отрезки в сплошные линии. */
function mergeRules(list) {
  const sorted = list.slice().sort((p, q) => p.pos - q.pos || p.a - q.a);
  const groups = [];
  for (const r of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(r.pos - g.pos) <= 1.2) g.items.push(r);
    else groups.push({ pos: r.pos, items: [r] });
  }
  const out = [];
  for (const g of groups) {
    const items = g.items.sort((p, q) => p.a - q.a);
    let curr = null;
    for (const r of items) {
      if (curr && r.a <= curr.b + 2) curr.b = Math.max(curr.b, r.b);
      else { curr = { pos: g.pos, a: r.a, b: r.b }; out.push(curr); }
    }
  }
  return out;
}

const cluster = (values, tol) => {
  const out = [];
  for (const v of values.slice().sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && v - last.max <= tol) { last.max = v; last.sum += v; last.n++; }
    else out.push({ max: v, sum: v, n: 1 });
  }
  return out.map(c => c.sum / c.n);
};

/** Фрагменты текста -> строки (сверху вниз), фрагменты в строке — слева направо. */
function joinItems(items) {
  const lines = [];
  for (const it of items.slice().sort((p, q) => q.y - p.y || p.x - q.x)) {
    const line = lines.find(l => Math.abs(l.y - it.y) <= Math.max(l.size, it.size) * 0.45);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, size: it.size, items: [it] });
  }
  lines.sort((p, q) => q.y - p.y);
  return lines.map(l => {
    let s = '';
    let prev = null;
    for (const it of l.items.sort((p, q) => p.x - q.x)) {
      if (prev && !/\s$/.test(s) && !/^\s/.test(it.str) && it.x - prev.x2 > it.size * 0.12) s += ' ';
      s += it.str;
      prev = it;
    }
    return s.replace(/\s+/g, ' ').trim();
  }).filter(Boolean);
}

/** Таблицы страницы по линиям рамок; использованные фрагменты помечаются. */
function buildTables(hsRaw, vsRaw, texts) {
  const hs = mergeRules(hsRaw), vs = mergeRules(vsRaw);
  const nodes = [...hs.map(r => ({ r, h: true })), ...vs.map(r => ({ r, h: false }))];
  const touches = (h, v) => v.pos >= h.a - SNAP && v.pos <= h.b + SNAP && h.pos >= v.a - SNAP && h.pos <= v.b + SNAP;

  // связные группы пересекающихся линий — отдельные таблицы
  const comp = new Array(nodes.length).fill(-1);
  let nComp = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (comp[i] >= 0) continue;
    const queue = [i];
    comp[i] = nComp;
    while (queue.length) {
      const k = queue.pop();
      for (let j = 0; j < nodes.length; j++) {
        if (comp[j] >= 0 || nodes[j].h === nodes[k].h) continue;
        const [h, v] = nodes[k].h ? [nodes[k].r, nodes[j].r] : [nodes[j].r, nodes[k].r];
        if (touches(h, v)) { comp[j] = nComp; queue.push(j); }
      }
    }
    nComp++;
  }

  const tables = [];
  for (let c = 0; c < nComp; c++) {
    const H = nodes.filter((n, i) => comp[i] === c && n.h).map(n => n.r);
    const V = nodes.filter((n, i) => comp[i] === c && !n.h).map(n => n.r);
    if (H.length < 2 || V.length < 2) continue;
    const X = cluster(V.map(v => v.pos), SNAP);
    const Y = cluster(H.map(h => h.pos), SNAP).reverse();     // сверху вниз
    if (X.length < 2 || Y.length < 2) continue;
    const R = Y.length - 1, C = X.length - 1;

    const hasV = (j, i) => { const mid = (Y[i] + Y[i + 1]) / 2; return V.some(v => Math.abs(v.pos - X[j]) <= SNAP && v.a - 1 <= mid && mid <= v.b + 1); };
    const hasH = (i, j) => { const mid = (X[j] + X[j + 1]) / 2; return H.some(h => Math.abs(h.pos - Y[i]) <= SNAP && h.a - 1 <= mid && mid <= h.b + 1); };

    // объединённые ячейки: где между соседними клетками нет линии — это одна ячейка
    const parent = Array.from({ length: R * C }, (_, k) => k);
    const find = (k) => { while (parent[k] !== k) k = parent[k] = parent[parent[k]]; return k; };
    const unite = (p, q) => { parent[find(p)] = find(q); };
    for (let i = 0; i < R; i++) for (let j = 1; j < C; j++) if (!hasV(j, i)) unite(i * C + j - 1, i * C + j);
    for (let i = 1; i < R; i++) for (let j = 0; j < C; j++) if (!hasH(i, j)) unite((i - 1) * C + j, i * C + j);

    const regionItems = new Map();
    for (const it of texts) {
      if (it.used) continue;
      const ax = it.x + Math.min(2, Math.max(0, (it.x2 - it.x) / 2));
      const ay = it.y + it.size * 0.3;
      if (ax < X[0] || ax > X[C] || ay > Y[0] || ay < Y[R]) continue;
      let j = 0; while (j < C - 1 && ax >= X[j + 1]) j++;
      let i = 0; while (i < R - 1 && ay <= Y[i + 1]) i++;
      const root = find(i * C + j);
      if (!regionItems.has(root)) regionItems.set(root, []);
      regionItems.get(root).push(it);
      it.used = true;
    }
    const regionText = new Map();
    for (const [root, items] of regionItems) regionText.set(root, joinItems(items).join('\n'));

    const rows = [];
    for (let i = 0; i < R; i++) {
      if (Y[i] - Y[i + 1] < 2) continue;
      const row = [];
      for (let j = 0; j < C; j++) row.push(regionText.get(find(i * C + j)) || '');
      rows.push(row);
    }
    if (rows.length) tables.push({ type: 'table', rows, width: C, top: Y[0] });
  }
  return tables.sort((p, q) => q.top - p.top);
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<{tables:Array<{rows:string[][], width:number}>, paragraphs:string[], pageCount:number}>}
 */
export async function readPdf(arrayBuffer) {
  const doc = new PdfDoc(new Uint8Array(arrayBuffer));
  if (!doc.text.startsWith('%PDF') && doc.text.indexOf('%PDF') < 0) throw new Error('Это не PDF-файл.');
  if (/\/Encrypt\s/.test(doc.text)) throw new Error('PDF защищён паролем или шифрованием — откройте его и сохраните заново без защиты.');
  await doc.loadObjectStreams();
  const pages = doc.pages();
  if (!pages.length) throw new Error('Не удалось прочитать страницы PDF.');

  const tables = [];
  const paragraphs = [];
  let textCount = 0;
  for (const pg of pages) {
    let contents = doc.resolve(pg.node.Contents);
    if (!contents) continue;
    if (!Array.isArray(contents)) contents = [contents];
    const parts = [];
    for (const c of contents) {
      const st = doc.resolve(c);
      if (!(st instanceof PStream)) continue;
      try { parts.push(await doc.decode(st)); } catch { /* пропуск битого куска */ }
    }
    const total = parts.reduce((a, p) => a + p.length + 1, 0);
    const data = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { data.set(p, o); o += p.length; data[o++] = 10; }

    const texts = [];
    const sink = { text: (run) => texts.push(run) };
    const rules = collectRules(sink);
    await interpret(doc, data, doc.resolve(pg.res) || {}, { ctm: pageMatrix(doc.resolve(pg.box), doc.resolve(pg.rot)) }, sink);
    textCount += texts.length;
    tables.push(...buildTables(rules.hs, rules.vs, texts));
    paragraphs.push(...joinItems(texts.filter(t => !t.used)));
  }
  if (!textCount) throw new Error('В PDF нет текста — похоже, это скан (картинка). Нужен PDF, сохранённый из Word, или сам .docx.');
  return { tables, paragraphs, pageCount: pages.length };
}
