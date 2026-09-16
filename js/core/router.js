// Хеш-роутер с плавными переходами между страницами.
const routes = new Map();
let currentCleanup = null;

export function route(name, render) { routes.set(name, render); }

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [path, query] = h.split('?');
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  return { name: path.split('/')[0] || 'dashboard', params };
}

async function paint() {
  const { name, params } = parseHash();
  const render = routes.get(name) || routes.get('dashboard');
  const view = document.getElementById('view');

  document.querySelectorAll('.nav-btn').forEach(a => a.classList.toggle('active', a.dataset.route === name));

  const run = () => {
    if (currentCleanup) { try { currentCleanup(); } catch {} }
    view.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'page';
    view.appendChild(el);
    currentCleanup = render(el, params) || null;
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  };

  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(run);
  } else run();
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
