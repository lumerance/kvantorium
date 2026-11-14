import * as appearance from './pages/appearance.js';
import { route, startRouter } from './core/router.js';
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

initShell();
startRouter();
