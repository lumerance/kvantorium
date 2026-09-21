import { route, startRouter } from './core/router.js';
import { initThemeToggle } from './core/theme.js';
import * as dashboard from './pages/dashboard.js';
import * as journal from './pages/journal.js';
import * as enroll from './pages/enroll.js';
import * as hours from './pages/hours.js';
import * as salary from './pages/salary.js';
import * as data from './pages/data.js';
import * as vedomost from './pages/vedomost.js';

route('dashboard', dashboard.render);
route('journal', journal.render);
route('enroll', enroll.render);
route('hours', hours.render);
route('salary', salary.render);
route('data', data.render);
route('vedomost', vedomost.render);

initThemeToggle(document.getElementById('theme-toggle'));
startRouter();

// подсветка курсора неоновым следом на кнопках (лёгкий эффект)
document.addEventListener('pointermove', (e) => {
  const t = e.target.closest?.('.btn, .nav-btn, .tab');
  if (!t) return;
  const r = t.getBoundingClientRect();
  t.style.setProperty('--mx', `${e.clientX - r.left}px`);
  t.style.setProperty('--my', `${e.clientY - r.top}px`);
}, { passive: true });
