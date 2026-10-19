import { api, esc, money, fmtDate, toast, getSettings } from '../lib.js';
import { openEditor } from '../components/editor.js';

let el, monthInput, rows = [], homeCurrency = 'RM';

const pad = (n) => String(n).padStart(2, '0');

/** Which statement month a date falls in, given the cycle end day. */
function cycleMonthFor(date, endDay) {
  let y = date.getFullYear(), m = date.getMonth() + 1;
  const last = new Date(y, m, 0).getDate();
  if (date.getDate() > Math.min(endDay, last)) { m += 1; if (m > 12) { m = 1; y += 1; } }
  return `${y}-${pad(m)}`;
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

async function mount(root) {
  el = root;
  el.innerHTML = `
    <div class="card">
      <div class="month-bar">
        <button class="icon-btn" data-step="-1" aria-label="Previous month">‹</button>
        <input type="month" id="month">
        <button class="icon-btn" data-step="1" aria-label="Next month">›</button>
      </div>
      <p class="period muted" id="period"></p>
      <div class="totals" id="totals"></div>
    </div>
    <div class="card" id="by-cat-card" hidden>
      <h3>By category</h3>
      <div id="by-cat"></div>
    </div>
    <div class="card">
      <div class="list-head">
        <h3>Receipts</h3>
        <select id="filter" aria-label="Filter by category"><option value="">All categories</option></select>
      </div>
      <ul class="list" id="list"></ul>
    </div>`;

  monthInput = el.querySelector('#month');
  const s = await getSettings().catch(() => ({ cycle_end_day: 25, default_currency: 'RM' }));
  homeCurrency = s.default_currency || 'RM';
  monthInput.value = cycleMonthFor(new Date(), s.cycle_end_day);

  monthInput.addEventListener('change', load);
  el.querySelectorAll('[data-step]').forEach((b) =>
    b.addEventListener('click', () => { monthInput.value = shiftMonth(monthInput.value, +b.dataset.step); load(); })
  );
  el.querySelector('#filter').addEventListener('change', renderList);
}

function show(month) {
  if (month && /^\d{4}-\d{2}$/.test(month) && monthInput) monthInput.value = month;
  if (monthInput?.value) load();
}

async function load() {
  if (!monthInput.value) return;
  try {
    const data = await api('/receipts?month=' + monthInput.value);
    rows = data.receipts;
    el.querySelector('#period').textContent = `${fmtDate(data.period.start)} – ${fmtDate(data.period.end)}`;
    renderSummary();
    renderList();
  } catch (e) {
    toast(e.message, 'bad');
  }
}

function renderSummary() {
  const main = homeCurrency;
  const priced = rows.filter((r) => r.total !== null);
  const total = priced.reduce((s, r) => s + r.total, 0);
  const review = rows.filter((r) => r.status === 'review' || r.status === 'failed').length;

  // Foreign amounts still waiting for their RM figure, grouped by currency
  const pend = {};
  for (const r of rows) if (r.total === null && r.foreign_amount !== null) {
    pend[r.foreign_currency] = (pend[r.foreign_currency] || 0) + r.foreign_amount;
  }
  const pendCount = rows.filter((r) => r.total === null && r.foreign_amount !== null).length;

  el.querySelector('#totals').innerHTML = `
    <div class="total"><span class="big-num">${priced.length ? money(total, main) : '—'}</span></div>
    <div class="total-meta muted">${rows.length} receipt${rows.length === 1 ? '' : 's'}${review ? ` · <span class="warn-text">${review} need review</span>` : ''}</div>
    ${pendCount ? `<div class="total-meta warn-text">${pendCount} pending conversion (${Object.entries(pend).map(([c, v]) => money(v, c)).join(', ')}), not in total</div>` : ''}`;

  // Category breakdown (home currency amounts only)
  const byCat = {};
  for (const r of priced) byCat[r.category || 'Uncategorised'] = (byCat[r.category || 'Uncategorised'] || 0) + r.total;
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] || 1;

  el.querySelector('#by-cat-card').hidden = entries.length === 0;
  el.querySelector('#by-cat').innerHTML = entries.map(([c, v]) => `
    <div class="bar-row">
      <span class="bar-label">${esc(c)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(v / max) * 100}%"></span></span>
      <span class="bar-value">${money(v, main)}</span>
    </div>`).join('');

  const filter = el.querySelector('#filter');
  const current = filter.value;
  const cats = [...new Set(rows.map((r) => r.category || 'Uncategorised'))].sort();
  filter.innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option ${c === current ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

function renderList() {
  const f = el.querySelector('#filter').value;
  const list = el.querySelector('#list');
  const shown = f ? rows.filter((r) => (r.category || 'Uncategorised') === f) : rows;
  if (!shown.length) {
    list.innerHTML = '<li class="empty muted">No receipts in this period.</li>';
    return;
  }
  list.innerHTML = '';
  for (const r of shown) {
    const li = document.createElement('li');
    li.className = 'row clickable';
    li.innerHTML = `
      <div class="row-main">
        <span class="row-title">${esc(r.merchant || 'Unknown merchant')}</span>
        <span class="row-sub">${esc([fmtDate(r.txn_date), r.category, r.area].filter(Boolean).join(' · '))}</span>
      </div>
      <div class="row-end">
        <span class="amount">${r.total !== null ? money(r.total, homeCurrency) : money(r.foreign_amount, r.foreign_currency)}</span>
        ${r.total !== null && r.foreign_amount !== null ? `<span class="row-sub">${money(r.foreign_amount, r.foreign_currency)}</span>` : ''}
        ${r.status === 'pending' ? `<span class="pill warn">${homeCurrency} pending</span>` : r.status !== 'ok' ? `<span class="pill ${r.status === 'failed' ? 'bad' : 'warn'}">Review</span>` : ''}
      </div>`;
    li.onclick = () => openEditor(r.id, () => load());
    list.append(li);
  }
}

export default { mount, show };
