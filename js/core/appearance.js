// Оформление: цвет акцента, жидкое стекло, свечение, фоновая подсветка,
// анимации. Хранится отдельно от данных (как и тема) — это настройка вида
// на конкретном устройстве. Начальные атрибуты ставит инлайн-скрипт в <head>
// до отрисовки (без вспышки зелёного при другом цвете).
const KEY = 'kvantorium28.appearance';

export const ACCENTS = [
  { key: 'green', name: 'Зелёный', dark: '#2bff8b', light: '#059669' },
  { key: 'sky', name: 'Голубой', dark: '#38d6ff', light: '#0284c7' },
  { key: 'blue', name: 'Синий', dark: '#6b8cff', light: '#2563eb' },
  { key: 'violet', name: 'Фиолетовый', dark: '#b18cff', light: '#7c3aed' },
  { key: 'pink', name: 'Розовый', dark: '#ff6fd0', light: '#be185d' },
  { key: 'red', name: 'Красный', dark: '#ff5c6c', light: '#dc2626' },
  { key: 'orange', name: 'Оранжевый', dark: '#ffa04a', light: '#c2410c' },
  { key: 'yellow', name: 'Жёлтый', dark: '#ffd84a', light: '#a16207' },
  { key: 'white', name: 'Белый', dark: '#f1f5f9', light: '#334155' },
];

export const DEFAULT_APPEARANCE = { accent: 'green', glass: true, glow: true, bglight: true, motion: true };

export function getAppearance() {
  try { return { ...DEFAULT_APPEARANCE, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULT_APPEARANCE }; }
}

export function applyAppearance(a = getAppearance()) {
  const el = document.documentElement;
  if (a.accent && a.accent !== 'green') el.setAttribute('data-accent', a.accent); else el.removeAttribute('data-accent');
  const flag = (name, on) => { if (on) el.removeAttribute(name); else el.setAttribute(name, 'off'); };
  flag('data-glass', a.glass); flag('data-glow', a.glow); flag('data-bglight', a.bglight); flag('data-motion', a.motion);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(el).getPropertyValue('--bg').trim() || '#030806');
}

export function setAppearance(patch) {
  const next = { ...getAppearance(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* только на этот сеанс */ }
  applyAppearance(next);
  window.dispatchEvent(new CustomEvent('appearancechange', { detail: next }));
  return next;
}

/** Без анимаций — по настройке сайта или по системному «уменьшить движение». */
export const motionOff = () => document.documentElement.getAttribute('data-motion') === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;
