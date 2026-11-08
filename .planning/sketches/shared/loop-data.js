// Real loop from ~/dev/hiredby-app (.loop/feature_list.json), rewritten the way the pane would show it.
// `area` and `plain` do not exist in feature_list.json today: init would write them next to `description`.
window.LOOP = {
  name: 'get.offer stage 2 & 3',
  plain: 'Real accounts, dark mode and going live for get.offer',
  startedAt: '08:02',
  elapsed: '4 h 39 min', now: '12:41',
  left: 'about 1 h 30 min',
  finishAt: '14:10',
  spent: '$18.40',
  areas: [
    { key: 'accounts', name: 'Accounts', blurb: 'Sign up, log in and manage your account', color: '#d97757' },
    { key: 'dark', name: 'Dark mode', blurb: 'Everything follows the light/dark setting of your computer', color: '#8b7cf6' },
    { key: 'live', name: 'Going live', blurb: 'The landing site is ready to publish on Hostinger', color: '#4fa3e0' },
    { key: 'base', name: 'Behind the scenes', blurb: 'Database, email and settings the features run on', color: '#a0a0a0' },
    { key: 'safety', name: 'Safety checks', blurb: 'Making sure what worked before still works', color: '#5fbf6a' },
  ],
  // state: done | now | retry | next | waiting
  items: [
    { id: 'R0', area: 'safety', plain: 'Flaky tests no longer fail at random', state: 'done', at: '08:31' },
    { id: 'F7', area: 'base', plain: 'Local database and test inbox start with one command', state: 'done', at: '08:44' },
    { id: 'F8', area: 'base', plain: 'Settings are checked when the app starts', state: 'done', at: '08:52' },
    { id: 'F22', area: 'dark', plain: 'Dark colours are defined', state: 'done', at: '09:05' },
    { id: 'F1', area: 'live', plain: 'The site knows its real web address', state: 'done', at: '09:11' },
    { id: 'F3', area: 'live', plain: 'Icons show in browser tabs and on phones', state: 'done', at: '09:20' },
    { id: 'F5', area: 'live', plain: 'Hostinger serves the 404 page and redirects correctly', state: 'done', at: '09:31' },
    { id: 'F9', area: 'base', plain: 'The app has a database', state: 'done', at: '09:48' },
    { id: 'F10', area: 'base', plain: 'The app can send emails', state: 'done', at: '10:02' },
    { id: 'F23', area: 'dark', plain: 'Buttons, cards and forms switch between light and dark', state: 'done', at: '10:15' },
    { id: 'F2', area: 'live', plain: 'Pages have titles and previews when shared', state: 'done', at: '10:24' },
    { id: 'F4', area: 'live', plain: 'Google can find every page', state: 'done', at: '10:33' },
    { id: 'F11', area: 'accounts', plain: 'The login system is set up', state: 'done', at: '10:50' },
    { id: 'F6', area: 'live', plain: 'One command builds and uploads the site', state: 'done', at: '11:04' },
    { id: 'F12', area: 'accounts', plain: 'People can create an account', state: 'done', at: '11:21' },
    { id: 'F13', area: 'accounts', plain: 'New accounts confirm their email from a link', state: 'done', at: '11:39' },
    { id: 'F14', area: 'accounts', plain: 'People can log in', state: 'done', at: '11:52' },
    { id: 'F15', area: 'base', plain: 'Tests can sign in as a real user', state: 'done', at: '12:03' },
    { id: 'F16', area: 'accounts', plain: 'Pages stay private until you log in', state: 'done', at: '12:17' },
    { id: 'F17', area: 'accounts', plain: 'People can log out from the account menu', state: 'done', at: '12:26' },

    { id: 'F18', area: 'accounts', plain: 'People can reset a forgotten password', state: 'now', phase: 2, minutes: 14, usual: 15,
      doing: 'Checking that the reset email arrives and its link opens the new-password form',
      spec: "Password reset is live: /reset-password sends a reset email and always answers 'If an account exists for <email>…'; the link opens /reset-password/confirm, the new password works and the old one stops working." },
    { id: 'F24', area: 'dark', plain: 'The landing page works in dark mode', state: 'now', phase: 4, minutes: 22, usual: 18,
      doing: 'Opening the landing page in a browser with dark mode on and looking at every section',
      spec: 'Site in dark: every component and page of apps/site uses the semantic tokens, so the landing page (all sections, header, footer, 404) reads in both schemes.' },
    { id: 'E4', area: 'accounts', plain: 'Too many wrong passwords get slowed down', state: 'retry', tries: 1, maxTries: 3,
      why: 'The test expected a "too many tries" answer after 5 wrong passwords, but the 6th still went through.',
      spec: 'Rate limits: repeated wrong passwords from one client (more than the configured limit in a minute) answer 429, and the form says to wait.' },

    { id: 'F19', area: 'accounts', plain: 'People can change their password', state: 'next' },
    { id: 'F20', area: 'accounts', plain: 'People can delete their account', state: 'next' },
    { id: 'F25', area: 'dark', plain: 'The app works in dark mode', state: 'next' },
    { id: 'E1', area: 'live', plain: 'Uploading stops if a setting is missing', state: 'next' },
    { id: 'E2', area: 'live', plain: 'Shared links never break on a trailing slash', state: 'next' },
    { id: 'E3', area: 'accounts', plain: 'The same email in different capitals is one account', state: 'next' },
    { id: 'E6', area: 'accounts', plain: "Page scripts can't read the login cookie", state: 'next' },
    { id: 'E7', area: 'accounts', plain: 'After log-in you only land on pages of this site', state: 'next' },
    { id: 'E8', area: 'base', plain: 'Every bad setting is named at start-up', state: 'next' },
    { id: 'E9', area: 'accounts', plain: 'A clear message when the database is down', state: 'next' },
    { id: 'E10', area: 'accounts', plain: 'Sign-up still works when email is down', state: 'next' },
    { id: 'E11', area: 'accounts', plain: 'Login forms ignore requests from other sites', state: 'next' },
    { id: 'R1', area: 'safety', plain: 'The old app is untouched', state: 'next' },
    { id: 'E5', area: 'accounts', plain: 'Email links work once and expire after an hour', state: 'waiting', after: 'password reset' },
    { id: 'F21', area: 'accounts', plain: "Account pages are finished, no more 'not live yet' notices", state: 'waiting', after: 'change and delete account' },
    { id: 'E12', area: 'dark', plain: 'Open pages restyle when you change the setting', state: 'waiting', after: 'the app in dark mode' },
    { id: 'R2', area: 'safety', plain: 'Everything the app did before still works when logged in', state: 'waiting', after: 'the account pages' },
  ],
  // the six driver steps, in plain words
  phases: ['Reading the plan', 'Writing the code', 'Running the tests', 'Reviewing its own work', 'Checking it in a browser', 'Saving the work'],
};

// Sketch state: 'run' (on track), 'stuck' (needs you), 'done' (finished)
window.loopIn = mode => {
  const L = structuredClone(window.LOOP);
  if (mode === 'stuck') {
    const e4 = L.items.find(i => i.id === 'E4');
    Object.assign(e4, { state: 'stuck', tries: 3 });
  }
  if (mode === 'done') {
    L.items.forEach(i => { i.state = 'done'; i.at = i.at || '13:5' + (i.id.length % 10); });
    Object.assign(L, { elapsed: '6 h 02 min', left: null, spent: '$27.10' });
  }
  return L;
};

window.counts = (items, area) => {
  const xs = area ? items.filter(i => i.area === area) : items;
  return { total: xs.length, done: xs.filter(i => i.state === 'done').length, now: xs.filter(i => i.state === 'now' || i.state === 'retry').length, stuck: xs.filter(i => i.state === 'stuck').length };
};
