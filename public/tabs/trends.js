import { api, esc, money, fmtDate, toast } from '../lib.js';

let el, range = '12m';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym, withYear = false) => {
  const [y, m] = ym.split('-').map(Number);
  return withYear ? `${MONTH_SHORT[m - 1]} ${y}` : MONTH_SHORT[m - 1];
};

function mount(root) {
  el = root;
  try { range = localStorage.getItem('trends-range') || '12m'; } catch {}
  el.innerHTML = `
    <div class="card">
      <div class="segmented" role="tablist" aria-label="Range">
        <button type="button" data-range="year">This year</button>
        <button type="button" data-range="12m">Last 12 months</button>
      </div>
      <div class="stats" id="stats"></div>
    </div>
    <div class="card">
      <div class="list-head"><h3 id="chart-title">Monthly spending</h3></div>
      <div class="chart" id="chart"></div>
      <p class="muted small" id="chart-note"></p>
      <details class="table-view">
        <summary>Show as table</summary>
        <table id="table"></table>
      </details>
    </div>
    <div class="card" id="cats-card" hidden>
      <h3>By category</h3>
      <div id="cats"></div>
    </div>`;

  el.querySelectorAll('[data-range]').forEach((b) =>
    b.addEventListener('click', () => {
      range = b.dataset.range;
      try { localStorage.setItem('trends-range', range); } catch {}
      load();
    })
  );
}

function show() { load(); }

async function load() {
  el.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.range === range)));
  try {
    render(await api('/trends?range=' + range));
  } catch (e) {
    toast(e.message, 'bad');
  }
}

function render(d) {
  const cur = d.currency;
  const months = d.months;
  const yearSpan = months[0].month.slice(0, 4) !== months[months.length - 1].month.slice(0, 4);

  // Stat tiles
  el.querySelector('#stats').innerHTML = `
    <div class="stat"><span class="stat-label">Total</span><span class="stat-value">${money(d.total, cur)}</span></div>
    <div class="stat"><span class="stat-label">Monthly average</span><span class="stat-value">${money(d.average, cur)}</span></div>
    <div class="stat"><span class="stat-label">Highest month</span><span class="stat-value">${d.highest ? money(d.highest.total, cur) : '—'}</span>
      ${d.highest ? `<span class="stat-sub">${monthLabel(d.highest.month, true)}</span>` : ''}</div>`;

  // Bar chart (HTML): bars anchored to the baseline, average as a dashed reference line
  const max = Math.max(...months.map((m) => m.total), d.average, 1);
  const nice = niceMax(max);
  const ticks = [0, nice / 2, nice];
  const avgPct = (d.average / nice) * 100;

  el.querySelector('#chart-title').textContent = `Monthly spending (${cur})`;
  el.querySelector('#chart').innerHTML = `
    <div class="chart-plot" style="--cols:${months.length}">
      <div class="chart-grid">
        ${ticks.slice().reverse().map((t) => `<div class="grid-line"><span>${shortMoney(t)}</span></div>`).join('')}
      </div>
      ${d.average > 0 ? `<div class="avg-line" style="bottom:${avgPct}%"><span>avg</span></div>` : ''}
      <div class="bars">
        ${months.map((m) => {
          const h = (m.total / nice) * 100;
          const isCurrent = m.month === d.current_month;
          return `
          <button type="button" class="bar-col" data-month="${m.month}"
            aria-label="${monthLabel(m.month, true)}: ${money(m.total, cur)}, ${m.count} receipts">
            <span class="bar ${isCurrent ? 'current' : ''}" style="height:${h}%"></span>
            <span class="tip" role="tooltip">
              <strong>${monthLabel(m.month, true)}${isCurrent ? ' (so far)' : ''}</strong>
              <span>${money(m.total, cur)}</span>
              <span class="muted">${m.count} receipt${m.count === 1 ? '' : 's'} · ${fmtDate(m.start)} – ${fmtDate(m.end)}</span>
            </span>
          </button>`;
        }).join('')}
      </div>
      <div class="x-labels">
        ${months.map((m, i) => `<span>${monthLabel(m.month)}${yearSpan && (i === 0 || m.month.endsWith('-01')) ? `<br><small>${m.month.slice(0, 4)}</small>` : ''}</span>`).join('')}
      </div>
    </div>`;

  el.querySelectorAll('.bar-col').forEach((b) =>
    b.addEventListener('click', () => (location.hash = 'spending/' + b.dataset.month))
  );

  const notes = ['Months follow your statement cycle. Tap a bar to open that month.'];
  if (d.pending_conversion.length) {
    const n = d.pending_conversion.reduce((s, p) => s + p.count, 0);
    notes.push(`Not included yet: ${n} receipt${n === 1 ? '' : 's'} waiting for the ${cur} amount (` +
      d.pending_conversion.map((p) => money(p.total, p.currency)).join(', ') + ').');
  }
  el.querySelector('#chart-note').textContent = notes.join(' ');

  // Table view
  el.querySelector('#table').innerHTML = `
    <tr><th>Month</th><th class="num">Receipts</th><th class="num">Total</th></tr>
    ${months.map((m) => `<tr><td>${monthLabel(m.month, true)}</td><td class="num">${m.count}</td><td class="num">${money(m.total, cur)}</td></tr>`).join('')}`;

  // Category breakdown for the whole range
  const cats = d.categories;
  const cmax = cats[0]?.total || 1;
  el.querySelector('#cats-card').hidden = cats.length === 0;
  el.querySelector('#cats').innerHTML = cats.map((c) => `
    <div class="bar-row">
      <span class="bar-label">${esc(c.category)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(c.total / cmax) * 100}%"></span></span>
      <span class="bar-value">${money(c.total, cur)}</span>
    </div>`).join('');
}

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const s of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (s * p >= v) return s * p;
  return 10 * p;
}

function shortMoney(v) {
  if (v >= 1000) return (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k';
  return String(Math.round(v));
}

export default { mount, show };
