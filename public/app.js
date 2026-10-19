// Tab shell. To add a feature later: create public/tabs/<name>.js exporting
// { mount(el), show(arg) } and add one line to TABS below. Nothing else changes.
// Links can pass an argument to a tab: #spending/2026-09 -> spending.show('2026-09').

import upload from './tabs/upload.js';
import spending from './tabs/spending.js';
import trends from './tabs/trends.js';
import settings from './tabs/settings.js';

const TABS = [
  { id: 'upload',   label: 'Upload',   module: upload },
  { id: 'spending', label: 'Spending', module: spending },
  { id: 'trends',   label: 'Trends',   module: trends },
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
