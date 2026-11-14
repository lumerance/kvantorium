// Хеш-роутер. О смене страницы сообщает событием 'routechange' на window —
// его слушает оболочка (боковая панель, «хлебные крошки», см. shell.js).
// Появление страницы — одна CSS-анимация её блоков (.page > *), без
// View Transition поверх: две анимации входа подряд только тормозят.
const routes = new Map();
let currentCleanup = null;

export function route(name, render) { routes.set(name, render); }

export function parseHash() {
  const h = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [path, query] = h.split('?');
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  return { name: path.split('/')[0] || 'dashboard', params };
}

function paint() {
  let { name, params } = parseHash();
  if (!routes.has(name)) name = 'dashboard';
  const view = document.getElementById('view');
  if (currentCleanup) { try { currentCleanup(); } catch { /* страница уже снята */ } }
  view.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'page';
  view.appendChild(el);
  currentCleanup = routes.get(name)(el, params) || null;
  window.scrollTo({ top: 0, behavior: 'instant' });
  window.dispatchEvent(new CustomEvent('routechange', { detail: { name, params } }));
}

export function startRouter() {
  window.addEventListener('hashchange', paint);
  if (!location.hash) location.hash = '#/dashboard';
  paint();
}

export function go(name, params) {
  const qs = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  location.hash = `#/${name}${qs}`;
}
export function repaint() { paint(); }
