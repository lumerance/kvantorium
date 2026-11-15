// Аккаунт в верхней строке: «Войти через Яндекс» или аватар с именем и
// состоянием синхронизации; меню — синхронизировать, выйти.
import { h, modal, contextMenu } from './ui.js';
import { icon } from './icons.js';
import { cloudState, onCloud, login, logout, syncNow, accountShort, avatarUrl } from './cloud.js';

const STATUS = {
  idle: ['Сохранено в облаке', 'ok'],
  dirty: ['Есть несохранённые правки', 'wait'],
  saving: ['Сохраняю на Яндекс.Диск…', 'wait'],
  loading: ['Сверяю с облаком…', 'wait'],
  offline: ['Нет интернета — сохраню, когда появится', 'warn'],
  error: ['Ошибка синхронизации', 'err'],
  conflict: ['Нужно выбрать версию', 'warn'],
};

const fmt = (iso) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

export function accountChip() {
  const el = h('div', { class: 'tb-account' });
  const draw = () => {
    const c = cloudState();
    if (!c.signedIn) {
      el.replaceChildren(h('button', {
        type: 'button', class: 'tb-login', title: c.error || 'Войти, чтобы данные были на всех ваших устройствах',
        onClick: () => loginDialog(),
      }, icon('cloud', 16), h('span', { class: 'tb-login-text' }, 'Войти')));
      return;
    }
    const [label, tone] = STATUS[c.status] || STATUS.idle;
    const av = avatarUrl(c.user);
    el.replaceChildren(h('button', {
      type: 'button', class: 'tb-user', title: `${label}${c.error ? ': ' + c.error : ''}`, 'aria-label': `Аккаунт: ${accountShort() || 'Яндекс'}. ${label}`,
      onClick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        contextMenu(r.right - 240, r.bottom + 6, [
          { title: c.user ? (c.user.real_name || c.user.display_name || c.user.login) : 'Яндекс ID' },
          { title: `${label}${c.error ? ' — ' + c.error : ''} · синхр. ${fmt(c.lastSync)}` },
          { label: 'Синхронизировать сейчас', icon: icon('refresh', 16), onClick: () => syncNow() },
          'sep',
          { label: 'Выйти', icon: icon('logout', 16), onClick: () => logoutDialog() },
        ]);
      },
    },
      av ? h('img', { class: 'tb-avatar', src: av, alt: '', width: 26, height: 26, referrerpolicy: 'no-referrer' }) : h('span', { class: 'tb-avatar ph' }, icon('user', 15)),
      h('span', { class: 'tb-user-name' }, accountShort() || 'Яндекс'),
      h('span', { class: 'sync-dot ' + tone })));
  };
  draw();
  onCloud(draw);
  return el;
}

export function loginDialog() {
  modal({
    title: [icon('cloud', 18), ' Сохранение в облаке'],
    body: h('div', { class: 'login-body' },
      h('p', {}, 'Войдите через Яндекс ID — и ваши данные (журналы, расчёты, настройки) будут храниться на вашем Яндекс.Диске. Откройте сайт на другом компьютере или телефоне, войдите тем же аккаунтом — всё будет на месте.'),
      h('ul', {},
        h('li', {}, 'Пароль вводится только на странице Яндекса — сайт его не видит.'),
        h('li', {}, 'Данные лежат в отдельной папке приложения на вашем Диске («Приложения»), другие файлы сайту недоступны.'),
        h('li', {}, 'Из профиля берутся только имя и фамилия — чтобы подставлять их в документы.'),
        h('li', {}, 'Без интернета всё работает как раньше и досохраняется, когда связь появится.'))),
    okText: 'Войти через Яндекс',
    onOk: () => { login(); },
  });
}

function logoutDialog() {
  const { close } = modal({
    title: 'Выйти из аккаунта?',
    body: h('div', {},
      h('p', { class: 'muted' }, 'Данные в облаке останутся. Если это чужой или общий компьютер — выйдите с удалением данных с этого устройства.'),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' } },
        h('button', { class: 'btn', type: 'button', onClick: () => { close(); logout(); } }, icon('logout', 16), 'Выйти, данные оставить'),
        h('button', { class: 'btn danger', type: 'button', onClick: () => { close(); logout({ wipe: true }); } }, icon('trash', 16), 'Выйти и удалить с устройства'))),
    cancelText: 'Отмена',
  });
}

/** Конфликт версий: на этом устройстве есть свои правки, а в облаке — другая версия. */
export function askConflict(remote, kind) {
  return new Promise((resolve) => {
    let done = false;
    const pick = (v) => { if (done) return; done = true; resolve(v); close(); };
    const when = remote?.savedAt ? new Date(remote.savedAt).toLocaleString('ru-RU') : 'неизвестно когда';
    const { close } = modal({
      title: kind === 'first' ? 'В облаке уже есть данные' : 'Данные изменились на другом устройстве',
      body: h('div', {},
        h('p', {}, kind === 'first'
          ? `На вашем Яндекс.Диске уже есть сохранённые данные (${when}${remote?.device ? ', ' + remote.device : ''}). На этом устройстве тоже есть свои. Какие оставить?`
          : `В облаке более новая версия (${when}${remote?.device ? ', ' + remote.device : ''}), а здесь есть несохранённые правки. Какую версию оставить?`),
        h('p', { class: 'muted', style: { fontSize: '12.5px' } }, 'Вторая версия будет заменена. Если сомневаетесь — сначала скачайте резервную копию на странице «Данные».'),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' } },
          h('button', { class: 'btn primary', type: 'button', onClick: () => pick('cloud') }, icon('cloud', 16), 'Взять из облака'),
          h('button', { class: 'btn', type: 'button', onClick: () => pick('local') }, icon('upload', 16), 'Оставить с этого устройства'))),
      cancelText: 'Решу позже',
    });
    // закрыли окно без выбора — ничего не трогаем, спросим при следующей синхронизации
    const obs = new MutationObserver(() => { if (!document.querySelector('.modal-back') && !done) { done = true; obs.disconnect(); resolve('later'); } });
    setTimeout(() => obs.observe(document.getElementById('modal-root'), { childList: true }), 0);
  });
}
