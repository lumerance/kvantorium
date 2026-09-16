// Мелкие помощники интерфейса: DOM, тосты, модалки, зоны загрузки файлов, форматирование.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(9)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function toast(msg, kind = 'ok', ms = 4200) {
  const root = document.getElementById('toasts');
  const el = h('div', { class: `toast ${kind === 'err' ? 'err' : ''}` }, msg);
  root.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
}

export function modal({ title, body, okText = 'Готово', cancelText = 'Отмена', onOk, wide }) {
  const root = document.getElementById('modal-root');
  const box = h('div', { class: 'modal', style: wide ? { width: 'min(1100px,96vw)' } : null });
  box.append(h('h3', {}, title));
  box.append(body);
  const close = () => { back.remove(); };
  const actions = h('div', { class: 'modal-actions' },
    h('button', { class: 'btn ghost', onClick: close }, cancelText),
    onOk ? h('button', { class: 'btn primary', onClick: () => { if (onOk() !== false) close(); } }, okText) : null,
  );
  box.append(actions);
  const back = h('div', { class: 'modal-back', onClick: (e) => { if (e.target === back) close(); } }, box);
  root.append(back);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  return { close, box };
}

export function confirmBox(text, onYes) {
  modal({ title: 'Подтверждение', body: h('p', { class: 'muted' }, text), okText: 'Да, выполнить', onOk: onYes });
}

/** Зона загрузки файла: клик + drag&drop. */
export function fileDrop({ title, hint, accept, onFile }) {
  const input = h('input', { type: 'file', accept, style: { display: 'none' }, onChange: (e) => {
    const f = e.target.files[0]; if (f) onFile(f); e.target.value = '';
  }});
  const zone = h('div', { class: 'file-drop', onClick: () => input.click() },
    h('strong', {}, title), h('span', {}, hint || ''), input);
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('over'); }));
  zone.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) onFile(f); });
  return zone;
}

export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Копирование в буфер обмена: clipboard API, а где его нет (http, старый
 *  браузер) — через скрытую textarea и execCommand. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', top: '-1000px', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function pickFile(accept, onFile) {
  const input = h('input', { type: 'file', accept, style: { display: 'none' }, onChange: (e) => {
    const f = e.target.files[0]; if (f) onFile(f);
  }});
  document.body.append(input); input.click(); setTimeout(() => input.remove(), 60000);
}

/* ---------- форматирование ---------- */
export const money = (n) => (isFinite(n) ? n : 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
export const money0 = (n) => Math.round(isFinite(n) ? n : 0).toLocaleString('ru-RU') + ' ₽';
export const hoursFmt = (n) => {
  const v = Math.round((n + Number.EPSILON) * 100) / 100;
  return (Number.isInteger(v) ? v : v.toFixed(2).replace(/0$/, '')) + ' ч';
};
export const dateRu = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y.slice(2)}`;
};
export const WEEKDAY_SHORT = { 'понедельник': 'пн', 'вторник': 'вт', 'среда': 'ср', 'четверг': 'чт', 'пятница': 'пт', 'суббота': 'сб', 'воскресенье': 'вс' };
export const MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];

export function progressBar(done, plan, extraClass = '') {
  const pct = plan > 0 ? Math.min(100, (done / plan) * 100) : 0;
  const over = plan > 0 && done > plan;
  return h('div', { class: `progress ${over ? 'over' : ''} ${extraClass}` }, h('i', { style: { width: pct + '%' } }));
}

export function statCard(label, value, sub, tone = '') {
  return h('div', { class: 'card' }, h('div', { class: 'stat' },
    h('div', { class: 'label' }, label),
    h('div', { class: `value ${tone}` }, value),
    sub ? h('div', { class: 'sub' }, sub) : null,
  ));
}

export function emptyState(icon, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'big' }, icon), h('div', {}, text), action ? h('div', { style: { marginTop: '16px' } }, action) : null);
}

/* ---------- сохранение фокуса при полной перерисовке (redraw) ---------- */
// Страницы с «живым» пересчётом на onInput перерисовывают весь блок на каждое
// нажатие клавиши — без этого поле теряло бы фокус (и вставка из буфера
// срабатывала бы только один раз, пока курсор ещё стоит в исходном узле).
// captureFocus запоминает путь от container до активного поля (индексы детей
// на каждом уровне) и позицию курсора; restoreFocus после перерисовки находит
// узел на том же пути в новом дереве и возвращает фокус с тем же выделением.

/** @returns {{path:number[], sel:{start:number,end:number}|null}|null} */
export function captureFocus(container) {
  const active = document.activeElement;
  if (!active || !container.contains(active) || active === container) return null;
  const path = [];
  let node = active;
  while (node && node !== container) {
    const parent = node.parentNode;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.children, node));
    node = parent;
  }
  const sel = typeof active.selectionStart === 'number'
    ? { start: active.selectionStart, end: active.selectionEnd } : null;
  // Сырой текст поля на момент нажатия клавиши: редрав ниже покажет значение,
  // «канонизированное» из состояния (например, распарсенное число без хвостовой
  // точки) — без этого набор дробного числа обрывался бы на разделителе.
  const rawValue = 'value' in active ? active.value : undefined;
  return { path, sel, rawValue };
}

export function restoreFocus(container, token) {
  if (!token) return;
  let node = container;
  for (const idx of token.path) {
    node = node && node.children && node.children[idx];
    if (!node) return;
  }
  if (node && typeof node.focus === 'function') {
    if (token.rawValue !== undefined && 'value' in node && node.value !== token.rawValue) node.value = token.rawValue;
    node.focus();
    if (token.sel && typeof node.setSelectionRange === 'function') {
      try { node.setSelectionRange(token.sel.start, token.sel.end); } catch { /* поле без выделения текста */ }
    }
  }
}

/* ---------- печать произвольного узла в обход модалок и оверлеев ---------- */
// window.print() печатает всю страницу как она есть — из открытой модалки
// (fixed-оверлей поверх контента) это даёт мешанину или пустой лист. Поэтому
// печатаемая разметка кладётся в отдельный узел прямо в <body> (а не внутрь
// модалки), и на печать через CSS показывается только он — модалка и все
// обычные блоки страницы в этот момент скрыты (.no-print / #modal-root).
let printRoot = null;
export function printElement(node) {
  if (!printRoot) {
    printRoot = document.createElement('div');
    printRoot.id = 'global-print-root';
    printRoot.className = 'print-only';
    document.body.appendChild(printRoot);
  }
  printRoot.innerHTML = '';
  printRoot.appendChild(node);
  window.print();
}
