import * as assistant from './pages/assistant.js';
import * as trips from './pages/trips.js';
import * as appearance from './pages/appearance.js';
import { route, startRouter, repaint } from './core/router.js';
import { handleRedirect, initCloud } from './core/cloud.js';
import { toast } from './core/ui.js';
import { askConflict } from './core/account.js';
import { initShell } from './core/shell.js';
import * as dashboard from './pages/dashboard.js';
import * as journal from './pages/journal.js';
import * as enroll from './pages/enroll.js';
import * as hours from './pages/hours.js';
import * as salary from './pages/salary.js';
import * as data from './pages/data.js';
import * as vedomost from './pages/vedomost.js';
import * as documents from './pages/documents.js';

route('dashboard', dashboard.render);
route('journal', journal.render);
route('enroll', enroll.render);
route('hours', hours.render);
route('salary', salary.render);
route('data', data.render);
route('vedomost', vedomost.render);
route('documents', documents.render);
route('appearance', appearance.render);
route('trips', trips.render);
route('assistant', assistant.render);

// вернулись со страницы входа Яндекса — забрать токен до запуска роутера
const auth = handleRedirect();
initShell();
startRouter();
initCloud({ onConflict: askConflict, onRemoteApplied: () => { repaint(); toast('Загружены данные из облака'); } });
if (auth) toast(auth.ok ? 'Вы вошли через Яндекс — данные будут сохраняться на ваш Яндекс.Диск' : `Вход не выполнен: ${auth.error}`, auth.ok ? 'ok' : 'err', 6000);

// телефон: длинные пояснения свёрнуты до двух строк — тап раскрывает
document.addEventListener('click', (e) => {
  const el = e.target.closest?.('.page-head p, .card-sub');
  if (el && matchMedia('(max-width:600px)').matches) el.classList.toggle('open');
});
