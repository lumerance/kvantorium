// Переключатель светлой/тёмной темы. По умолчанию — тёмная (как и было
// всегда), пока педагог явно не выберет светлую кнопкой в шапке; выбор
// запоминается в localStorage и не зависит от системной темы устройства —
// чтобы вид сайта не подменился неожиданно. Начальное состояние уже
// выставлено инлайн-скриптом в <head> (до отрисовки, без вспышки тёмной
// темы при повторном заходе со светлой) — этот модуль только обслуживает
// саму кнопку и держит её иконку в согласии с текущей темой.
const KEY = 'kvantorium28.theme';
const THEME_COLOR = { dark: '#04070a', light: '#eef3f1' };

function current() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function apply(theme) {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[theme]);
}

export function initThemeToggle(btn) {
  if (!btn) return;
  const render = () => {
    const t = current();
    btn.textContent = t === 'light' ? '🌙' : '☀️';
    btn.title = t === 'light' ? 'Тёмная тема' : 'Светлая тема';
  };
  render();
  btn.addEventListener('click', () => {
    const next = current() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(KEY, next); } catch { /* localStorage недоступен — тема просто не запомнится */ }
    apply(next);
    render();
  });
}
