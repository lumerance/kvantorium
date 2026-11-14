// «Оформление»: цвет акцента, тема, жидкое стекло, свечение, фоновая
// подсветка и анимации. Всё применяется сразу и запоминается на устройстве.
import { h, switchToggle } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { ACCENTS, DEFAULT_APPEARANCE, getAppearance, setAppearance } from '../core/appearance.js';
import { currentTheme, setTheme } from '../core/theme.js';

export function render(root) {
  const wrap = h('div', {});
  root.append(wrap);

  function draw() {
    const a = getAppearance();
    const theme = currentTheme();
    const sw = (acc) => h('button', {
      type: 'button', class: 'accent-swatch' + (a.accent === acc.key ? ' on' : ''), role: 'radio', 'aria-checked': String(a.accent === acc.key),
      style: `--c:${theme === 'light' ? acc.light : acc.dark}`,
      onClick: () => { setAppearance({ accent: acc.key }); draw(); },
    }, h('span', { class: 'accent-dot' }, a.accent === acc.key ? icon('check', 16) : null), h('span', {}, acc.name));

    const opt = (key, title, text) => h('div', { class: 'ap-opt' },
      h('div', {}, h('div', { class: 'ap-opt-title' }, title), h('div', { class: 'muted ap-opt-text' }, text)),
      switchToggle(a[key], '', (v) => { setAppearance({ [key]: v }); draw(); }, { title }));

    const themeBtn = (t, label, ic) => h('button', {
      type: 'button', class: 'tab' + (theme === t ? ' active' : ''), onClick: () => { setTheme(t); draw(); },
    }, icon(ic, 16), label);

    const changed = Object.keys(DEFAULT_APPEARANCE).some(k => a[k] !== DEFAULT_APPEARANCE[k]);

    wrap.replaceChildren(
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Оформление'), h('p', {}, 'Настройте вид сайта под себя — меняется сразу и запоминается на этом устройстве.')),
        changed ? h('div', { class: 'head-actions' },
          h('button', { class: 'btn', onClick: () => { setAppearance({ ...DEFAULT_APPEARANCE }); draw(); } }, icon('reset', 16), 'Как было')) : null),
      h('div', { class: 'grid cols-2' },
        h('div', { class: 'card' },
          h('h3', {}, 'Основной цвет'),
          h('div', { class: 'card-sub' }, 'Кнопки, активные пункты меню, подсветка и цифры в плитках. Фон и линии слегка подстраиваются под цвет.'),
          h('div', { class: 'accent-grid', role: 'radiogroup', 'aria-label': 'Основной цвет' }, ...ACCENTS.map(sw)),
          h('h3', { style: { marginTop: '20px' } }, 'Тема'),
          h('div', { class: 'tabs' }, themeBtn('dark', 'Тёмная', 'moon'), themeBtn('light', 'Светлая', 'sun'))),
        h('div', { class: 'card' },
          h('h3', {}, 'Эффекты'),
          opt('glass', 'Жидкое стекло', 'Полупрозрачные панели с размытием фона. Без него — сплошные панели: строже и быстрее на слабых компьютерах.'),
          opt('glow', 'Свечение', 'Неоновый ореол у цифр, кнопок и отметок. Без него — чистые цвета без засветки.'),
          opt('bglight', 'Подсветка фона', 'Мягкие цветные пятна света за панелями.'),
          opt('motion', 'Анимации', 'Плавные появления и переходы. Выключите, если отвлекают.'))),
      h('div', { class: 'card ap-preview', style: { marginTop: '16px' } },
        h('h3', {}, 'Как это выглядит'),
        h('div', { class: 'ap-preview-row' },
          h('div', { class: 'card' }, h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Пример плитки'), h('div', { class: 'value' }, '88 324 ₽'), h('div', { class: 'sub' }, 'на руки'))),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
            h('button', { class: 'btn primary', type: 'button' }, icon('save', 16), 'Главная кнопка'),
            h('button', { class: 'btn', type: 'button' }, 'Обычная'),
            h('span', { class: 'pill ok' }, 'метка'),
            ...[['m-p', '✓'], ['m-5', '5'], ['m-4', '4']].map(([c, t]) => h('span', { class: 'mark ' + c, style: { width: '44px', display: 'inline-grid', placeItems: 'center' } }, t))),
          h('div', { class: 'progress', style: { width: '220px' } }, h('i', { style: { width: '62%' } })))));
  }

  draw();
  const onTheme = () => { if (wrap.isConnected) draw(); else window.removeEventListener('themechange', onTheme); };
  window.addEventListener('themechange', onTheme);
}
