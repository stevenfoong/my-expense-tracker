// Tab shell. To add a feature later: create public/tabs/<name>.js exporting
// { mount(el), show(arg) } and add one line to TABS below. Nothing else changes.
// Links can pass an argument to a tab: #spending/2026-09 -> spending.show('2026-09').

import upload from './tabs/upload.js';
import spending from './tabs/spending.js';
import trends from './tabs/trends.js';
import statements from './tabs/statements.js';
import settings from './tabs/settings.js';
import { VERSION, onlineVersion } from './version.js';

const TABS = [
  { id: 'upload',   label: 'Upload',   module: upload },
  { id: 'spending', label: 'Spending', module: spending },
  { id: 'trends',   label: 'Trends',   module: trends },
  { id: 'statements', label: 'Statements', module: statements },
  { id: 'settings', label: 'Settings', module: settings },
];

const nav = document.getElementById('tabs');
const views = document.getElementById('views');
const mounted = new Set();

for (const t of TABS) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.role = 'tab';
  btn.dataset.tab = t.id;
  btn.textContent = t.label;
  btn.addEventListener('click', () => (location.hash = t.id));
  nav.append(btn);

  const view = document.createElement('section');
  view.id = 'view-' + t.id;
  view.className = 'view';
  view.hidden = true;
  views.append(view);
}

async function route() {
  const [rawId, arg] = location.hash.slice(1).split('/');
  const id = rawId || TABS[0].id;
  const tab = TABS.find((t) => t.id === id) || TABS[0];
  for (const t of TABS) {
    document.getElementById('view-' + t.id).hidden = t !== tab;
    nav.querySelector(`[data-tab="${t.id}"]`).setAttribute('aria-selected', String(t === tab));
  }
  const el = document.getElementById('view-' + tab.id);
  if (!mounted.has(tab.id)) {
    mounted.add(tab.id);
    await tab.module.mount(el);
  }
  tab.module.show?.(arg);
}

window.addEventListener('hashchange', route);
route();

// Tell the user when a newer version has gone online (checked on start and when the app comes back to the screen)
let lastCheck = 0;
async function checkForUpdate() {
  if (Date.now() - lastCheck < 60_000) return;
  lastCheck = Date.now();
  const online = await onlineVersion();
  if (!online || online === VERSION || document.getElementById('update-banner')) return;
  const bar = document.createElement('button');
  bar.id = 'update-banner';
  bar.type = 'button';
  bar.className = 'update-banner';
  bar.textContent = `New version ${online} is available. Tap to update.`;
  bar.onclick = () => location.reload();
  document.body.prepend(bar);
}
checkForUpdate();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
