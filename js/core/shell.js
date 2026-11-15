// Оболочка приложения: боковая панель с разделами, «перетекающая» подсветка
// активного пункта, верхняя строка с «хлебными крошками» и агломерацией.
//
// Подсветка — один слой на всю высоту меню, видимая часть которого задаётся
// clip-path: inset(t r b l). При переходе её края едут с разной скоростью:
// передний (в сторону движения) быстро и с замедлением в конце, задний —
// чуть дольше и плавнее. Пока задний догоняет, подсветка вытягивается, а
// потом «стекает» на новый пункт. Анимация прерываемая: новый клик
// продолжает движение с текущего положения краёв, а не с начала.
import { h } from './ui.js';
import { icon } from './icons.js';
import { initThemeToggle } from './theme.js';
import { motionOff } from './appearance.js';
import { accountChip } from './account.js';
import { getState, subscribe, viewedAgg, isViewingArchive } from './store.js';

// Пункты меню: key — что подсвечивать, match — какие маршруты к нему относятся.
const NAV = [
  { key: 'dashboard', href: '#/dashboard', label: 'Обзор', icon: 'dashboard' },
  { section: 'Работа с детьми' },
  { key: 'journal', href: '#/journal', label: 'Журнал', icon: 'journal', hint: 'официальный' },
  { key: 'journal-actual', href: '#/journal?kind=actual', label: 'Фактический журнал', icon: 'journalActual' },
  { key: 'enroll', href: '#/enroll', label: 'Набор и классы', icon: 'enroll' },
  { section: 'Учёт' },
  { key: 'trips', href: '#/trips', label: 'Заезды', icon: 'bus' },
  { key: 'hours', href: '#/hours', label: 'Часы по плану', icon: 'hours' },
  { key: 'salary', href: '#/salary', label: 'Зарплата', icon: 'salary' },
  { section: 'Бумаги' },
  { key: 'documents', href: '#/documents', label: 'Документы', icon: 'documents' },
  { key: 'assistant', href: '#/assistant', label: 'Помощник', icon: 'sparkle' },
  { spacer: true },
  { key: 'data', href: '#/data', label: 'Данные и импорт', icon: 'data' },
  { key: 'appearance', href: '#/appearance', label: 'Оформление', icon: 'palette' },
];

// маршрут -> пункт меню и «хлебные крошки»
function locate(name, params) {
  if (name === 'journal') return params.kind === 'actual'
    ? { key: 'journal-actual', crumbs: ['Работа с детьми', 'Фактический журнал'] }
    : { key: 'journal', crumbs: ['Работа с детьми', 'Журнал'] };
  if (name === 'vedomost') return { key: 'documents', crumbs: ['Документы', 'Итоговая ведомость'] };
  const item = NAV.find(n => n.key === name);
  const section = { enroll: 'Работа с детьми', trips: 'Учёт', hours: 'Учёт', salary: 'Учёт', documents: 'Бумаги', assistant: 'Бумаги', appearance: 'Настройки' }[name];
  return { key: name, crumbs: [section, item?.label || 'Обзор'].filter(Boolean) };
}

const SIDEBAR_KEY = 'kvantorium28.sidebar';
const reduceMotion = motionOff;

const easeOut3 = (t) => 1 - Math.pow(1 - t, 3);                                   // power3.out
const easeInOut3 = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // power3.inOut
const LEAD = 260, TRAIL = 420;   // мс: передний край быстрее заднего — отсюда «перетекание»

function createPill(nav) {
  const pill = h('span', { class: 'sb-pill', 'aria-hidden': 'true' });
  nav.prepend(pill);
  let cur = null;          // текущие края {t, r, b, l}
  let raf = 0;

  const paint = (e) => { pill.style.clipPath = `inset(${e.t}px ${e.r}px ${e.b}px ${e.l}px round 12px)`; };
  const edgesOf = (el) => {
    const H = nav.scrollHeight, W = nav.clientWidth;
    pill.style.height = H + 'px';
    return { t: el.offsetTop, b: H - (el.offsetTop + el.offsetHeight), l: el.offsetLeft, r: W - (el.offsetLeft + el.offsetWidth) };
  };

  return function move(el, instant = false) {
    if (!el) { pill.style.opacity = '0'; return; }
    const to = edgesOf(el);
    pill.style.opacity = '1';
    cancelAnimationFrame(raf);
    if (!cur || instant || reduceMotion()) { cur = to; paint(cur); return; }
    const from = { ...cur };
    const fwd = to.t > from.t;                           // вниз по меню или вверх
    const lead = fwd ? 'b' : 't', trail = fwd ? 't' : 'b';
    const t0 = performance.now();
    const step = (now) => {
      const dt = now - t0;
      const pl = Math.min(1, dt / LEAD), pt = Math.min(1, dt / TRAIL);
      const k = easeOut3(pl), kt = easeInOut3(pt);
      cur = {
        [lead]: from[lead] + (to[lead] - from[lead]) * k,
        [trail]: from[trail] + (to[trail] - from[trail]) * kt,
        l: from.l + (to.l - from.l) * k,
        r: from.r + (to.r - from.r) * k,
      };
      paint(cur);
      if (pt < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
}

export function initShell() {
  const sidebar = document.getElementById('sidebar');
  const topbar = document.getElementById('topbar');
  const app = document.getElementById('app');

  /* ---------- боковая панель ---------- */
  const nav = h('nav', { class: 'sb-nav', 'aria-label': 'Разделы' });
  const links = new Map();
  for (const n of NAV) {
    if (n.section) { nav.append(h('div', { class: 'sb-section' }, n.section)); continue; }
    if (n.spacer) { nav.append(h('div', { class: 'sb-spacer' })); continue; }
    const a = h('a', { class: 'sb-link', href: n.href, 'data-key': n.key, title: n.label },
      icon(n.icon, 19), h('span', { class: 'sb-label' }, n.label));
    a.addEventListener('click', () => app.classList.remove('nav-open'));
    links.set(n.key, a);
    nav.append(a);
  }
  const movePill = createPill(nav);

  const collapseBtn = h('button', { class: 'sb-link sb-collapse', type: 'button' });
  const renderCollapse = () => {
    const c = app.classList.contains('sb-collapsed');
    collapseBtn.replaceChildren(icon(c ? 'expand' : 'collapse', 19), h('span', { class: 'sb-label' }, 'Свернуть панель'));
    collapseBtn.title = c ? 'Развернуть панель' : 'Свернуть панель';
  };
  collapseBtn.addEventListener('click', () => {
    app.classList.toggle('sb-collapsed');
    try { localStorage.setItem(SIDEBAR_KEY, app.classList.contains('sb-collapsed') ? 'collapsed' : 'open'); } catch { /* без запоминания */ }
    renderCollapse();
  });
  try { if (localStorage.getItem(SIDEBAR_KEY) === 'collapsed') app.classList.add('sb-collapsed'); } catch { /* по умолчанию развёрнута */ }
  renderCollapse();

  sidebar.append(
    h('a', { class: 'sb-brand', href: '#/dashboard', title: 'Кванториум-28' },
      h('img', { class: 'brand-logo', src: 'assets/logo.svg', alt: '', width: 36, height: 36 }),
      h('span', { class: 'sb-label sb-brand-text' }, h('strong', {}, 'Кванториум-28'), h('small', {}, 'инструмент педагога'))),
    nav,
    h('div', { class: 'sb-foot' }, collapseBtn));

  // после сворачивания/разворачивания размеры пунктов меняются — подсветку
  // ставим на место сразу, без анимации
  let activeKey = null;
  sidebar.addEventListener('transitionend', (e) => { if (e.target === sidebar) movePill(links.get(activeKey), true); });
  window.addEventListener('resize', () => movePill(links.get(activeKey), true));

  /* ---------- нижняя панель (телефон) ---------- */
  // Главные разделы — всегда под пальцем; остальное — в листе «Ещё».
  const MAIN = ['dashboard', 'journal', 'trips', 'salary'];
  const SHORT = { dashboard: 'Обзор', journal: 'Журнал', trips: 'Заезды', salary: 'Зарплата' };
  const bottom = h('nav', { class: 'bottom-nav', 'aria-label': 'Разделы' });
  const bLinks = new Map();
  for (const key of MAIN) {
    const n = NAV.find(x => x.key === key);
    const a = h('a', { class: 'bn-item', href: n.href, 'data-key': key }, icon(n.icon, 22), h('span', {}, SHORT[key]));
    bLinks.set(key, a);
    bottom.append(a);
  }
  const moreBtn = h('button', { type: 'button', class: 'bn-item', 'aria-haspopup': 'dialog' }, icon('menu', 22), h('span', {}, 'Ещё'));
  bottom.append(moreBtn);
  const sheet = h('div', { class: 'bn-sheet', role: 'dialog', 'aria-label': 'Все разделы' });
  const sheetBack = h('div', { class: 'bn-sheet-back' });
  const closeSheet = () => { app.classList.remove('sheet-open'); };
  sheetBack.addEventListener('click', closeSheet);
  const drawSheet = () => {
    const showActual = !!getState().ui.showActualJournal;
    sheet.replaceChildren(h('div', { class: 'bn-grip' }), h('div', { class: 'bn-grid' },
      ...NAV.filter(n => n.key && !MAIN.includes(n.key) && (n.key !== 'journal-actual' || showActual)).map(n => h('a', {
        class: 'bn-tile' + (n.key === activeKey ? ' active' : ''), href: n.href, onClick: closeSheet,
      }, icon(n.icon, 22), h('span', {}, n.label)))));
  };
  moreBtn.addEventListener('click', () => { drawSheet(); app.classList.toggle('sheet-open'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  app.append(bottom, sheetBack, sheet);

  /* ---------- верхняя строка ---------- */
  const crumbs = h('div', { class: 'tb-crumbs' });
  const aggChip = h('a', { class: 'tb-agg', href: '#/data', title: 'Агломерации — на странице «Данные»' });
  const themeBtn = h('button', { class: 'tb-icon', type: 'button', id: 'theme-toggle' });
  const menuBtn = h('button', { class: 'tb-icon tb-menu', type: 'button', title: 'Меню', onClick: () => app.classList.toggle('nav-open') }, icon('menu', 19));
  topbar.append(menuBtn, crumbs, h('div', { class: 'tb-spacer' }), aggChip, accountChip(), themeBtn);
  initThemeToggle(themeBtn, (t) => themeBtn.replaceChildren(icon(t === 'light' ? 'moon' : 'sun', 18)));
  document.getElementById('nav-backdrop')?.addEventListener('click', () => app.classList.remove('nav-open'));

  const renderAgg = () => {
    const st = getState();
    const agg = viewedAgg(st);
    const archive = isViewingArchive(st);
    aggChip.className = 'tb-agg' + (archive ? ' archive' : '') + (agg.completedAt ? ' done' : '');
    aggChip.replaceChildren(icon(archive || agg.completedAt ? 'lock' : 'layers', 15),
      h('span', {}, agg.name + (archive ? ' · архив' : agg.completedAt ? ' · завершена' : '')));
  };
  renderAgg();
  subscribe(renderAgg);

  // «Фактический журнал» — по тумблеру на странице «Данные»
  const actualLink = links.get('journal-actual');
  const syncActual = () => {
    const show = !!getState().ui.showActualJournal;
    if (actualLink.hidden === !show) return;
    actualLink.hidden = !show;
    movePill(links.get(activeKey), true);
  };
  syncActual();
  subscribe(syncActual);

  window.addEventListener('routechange', (e) => {
    const { key, crumbs: list } = locate(e.detail.name, e.detail.params);
    activeKey = key;
    for (const [k, a] of links) {
      a.classList.toggle('active', k === key);
      if (k === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    movePill(links.get(key));
    closeSheet();
    for (const [k, a] of bLinks) a.classList.toggle('active', k === key);
    moreBtn.classList.toggle('active', !MAIN.includes(key));
    crumbs.replaceChildren(...list.flatMap((c, i) => [
      i ? icon('chevron', 14) : null,
      h('span', { class: i === list.length - 1 ? 'cur' : '' }, c),
    ]).filter(Boolean));
    document.title = `${list[list.length - 1]} · Кванториум-28`;
  });
}
