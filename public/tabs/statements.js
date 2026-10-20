import { api, esc, money, fmtDate, toast } from '../lib.js';
import { openLineEditor } from '../components/line-editor.js';
import { openEditor } from '../components/editor.js';
import { reconcileSection, wireReconcile } from './statements-reconcile.js';

let el, current = null;

const shortDate = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};
const rm = (n) => money(n, 'RM');

function mount(root) {
  el = root;
}

function show(id) {
  if (id) loadDetail(id);
  else loadList();
}

/* ---------------- List ---------------- */

async function loadList() {
  current = null;
  el.innerHTML = `
    <div class="card">
      <h2>Card statements</h2>
      <p class="muted">Upload the UOB statement PDF. The app reads every transaction and checks it against the bank's own totals before anything is used.</p>
      <label class="btn primary big">
        <input type="file" accept="application/pdf" hidden data-in="pdf">
        Upload statement PDF
      </label>
      <p class="muted small" id="upload-status" hidden></p>
    </div>
    <div class="card" data-sec="list" hidden>
      <h3>Statements</h3>
      <ul class="list" id="stmt-list"></ul>
    </div>`;

  el.querySelector('[data-in="pdf"]').addEventListener('change', (e) => upload(e.target.files[0], e.target));

  try {
    const { statements } = await api('/statements');
    const list = el.querySelector('#stmt-list');
    el.querySelector('[data-sec="list"]').hidden = statements.length === 0;
    list.replaceChildren(...statements.map((s) => {
      const li = document.createElement('li');
      li.className = 'row clickable';
      const [cls, label] = s.status === 'saved' ? ['ok', 'Saved']
        : s.checks_ok ? ['ok', 'Totals match']
        : s.accepted ? ['warn', 'Accepted']
        : ['bad', 'Check totals'];
      li.innerHTML = `
        <div class="row-main">
          <span class="row-title">Statement ${s.statement_date ? fmtDate(s.statement_date) : '(no date)'}</span>
          <span class="row-sub">${s.period ? `${fmtDate(s.period.start)} – ${fmtDate(s.period.end)} · ` : ''}${s.purchases} transactions</span>
        </div>
        <div class="row-end"><span class="pill ${cls}">${label}</span></div>`;
      li.onclick = () => (location.hash = 'statements/' + s.id);
      return li;
    }));
  } catch (e) {
    toast(e.message, 'bad');
  }
}

async function upload(file, input) {
  if (!file) return;
  const status = el.querySelector('#upload-status');
  const btn = input.closest('label');
  status.hidden = false;
  status.textContent = 'Reading statement… this takes a few seconds.';
  btn.classList.add('disabled');
  try {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const s = await api('/statements', { method: 'POST', body: fd });
    location.hash = 'statements/' + s.id;
  } catch (e) {
    status.textContent = e.message;
    status.classList.add('bad-text');
    toast(e.message, 'bad');
  } finally {
    btn.classList.remove('disabled');
    input.value = '';
  }
}

/* ---------------- Detail ---------------- */

async function loadDetail(id) {
  el.innerHTML = '<div class="card"><p class="muted">Loading statement…</p></div>';
  try {
    render(await api('/statements/' + id));
  } catch (e) {
    el.innerHTML = `<div class="card"><p class="bad-text">${esc(e.message)}</p><a class="btn ghost" href="#statements">Back</a></div>`;
  }
}

function render(s) {
  current = s;
  const editable = s.status !== 'saved';
  const failed = s.checks.filter((c) => c.ok === false);

  el.innerHTML = `
    <div class="card">
      <div class="detail-head">
        <a class="icon-btn" href="#statements" aria-label="Back to statements">‹</a>
        <div class="detail-title">
          <h2>Statement ${s.statement_date ? fmtDate(s.statement_date) : ''}</h2>
          <span class="muted small">${s.period ? `${fmtDate(s.period.start)} – ${fmtDate(s.period.end)}` : 'Statement date not found'}</span>
        </div>
        <a class="btn ghost small" href="/api/statements/${s.id}/file" target="_blank" rel="noopener">PDF</a>
      </div>
      ${!s.statement_date ? `
        <label>Statement date<input type="date" data-act="date"></label>` : ''}
      ${s.warnings.length ? `<p class="banner warn">${s.warnings.map(esc).join('. ')}.</p>` : ''}
    </div>

    <div class="card">
      <h3>Check against bank totals</h3>
      <ul class="checks">${s.checks.map(checkRow).join('')}</ul>
      ${s.checks_ok
        ? `<p class="banner ok">All totals match. Every transaction was read correctly.</p>`
        : failed.length
          ? `<p class="banner ${s.accepted ? 'warn' : 'bad'}">${s.accepted
              ? 'Differences accepted. You can still fix the lines below.'
              : 'Totals do not match. Use the hints above to fix, add or delete lines below, or accept the difference.'}</p>
             ${editable ? `<button type="button" class="btn ${s.accepted ? 'ghost' : ''}" data-act="accept">${s.accepted ? 'Undo accept' : 'Accept as is'}</button>` : ''}`
          : ''}
    </div>

    ${reconcileSection(s)}

    ${s.reconcile
      ? `<details class="card fold"><summary><h3>Statement lines (${s.lines.length})</h3></summary>${s.cards.map((c) => cardSection(s, c, editable)).join('')}</details>`
      : s.cards.map((c) => cardSection(s, c, editable)).join('')}

    <div class="card">
      <details class="raw">
        <summary>Show text read from the PDF</summary>
        <pre>${esc(s.raw_text || '')}</pre>
      </details>
      <div class="inline-actions">
        ${editable ? '<button type="button" class="btn ghost" data-act="reparse">Read again</button>' : ''}
        <button type="button" class="btn ghost danger" data-act="delete">Delete statement</button>
        ${s.status === 'saved' ? '<span class="muted small">Deleting a saved statement also removes the expenses it added and unlinks matched records.</span>' : ''}
      </div>
    </div>`;

  wire(s, editable);
}

function checkRow(c) {
  const icon = c.ok === true ? '<span class="check-icon ok" aria-label="Matches">✓</span>'
    : c.ok === false ? '<span class="check-icon bad" aria-label="Does not match">✕</span>'
    : '<span class="check-icon muted" aria-label="Not checked">–</span>';
  const numbers = c.expected != null
    ? `<span class="muted small">Statement ${rm(c.expected)} · Read ${rm(c.actual)}${c.ok ? '' : ` · <strong class="bad-text">Difference ${rm(Math.abs(c.diff))}</strong>`}</span>`
    : `<span class="muted small">${esc(c.message || '')}</span>`;
  return `
    <li>
      ${icon}
      <div class="check-body">
        <span class="check-label">${esc(c.label)}</span>
        ${numbers}
        ${c.detail && !c.ok ? `<span class="muted small">${esc(c.detail)}</span>` : ''}
        ${c.hint ? `<span class="hint">${esc(c.hint)}</span>` : ''}
      </div>
    </li>`;
}

function cardSection(s, c, editable) {
  const lines = s.lines.filter((l) => l.card === c.last4);
  const purchases = lines.filter((l) => !l.is_credit);
  const total = purchases.reduce((t, l) => t + l.amount, 0);
  const check = s.checks.find((k) => k.scope === c.last4);
  return `
    <div class="card" data-card="${c.last4}">
      <div class="list-head">
        <h3>${esc(c.name || 'Card')} **${esc(c.last4)}</h3>
        ${check ? `<span class="pill ${check.ok ? 'ok' : check.ok === false ? 'bad' : ''}">${check.ok ? 'Matches' : check.ok === false ? 'Difference' : 'Not checked'}</span>` : ''}
      </div>
      <p class="muted small">${purchases.length} purchases · ${rm(total)}${c.previous_balance != null ? ` · Previous balance ${rm(c.previous_balance)}` : ''}${c.subtotal != null ? ` · Sub-total ${rm(c.subtotal)}` : ''}</p>
      <ul class="list stmt-lines">
        ${lines.map((l) => lineRow(l, editable)).join('') || '<li class="empty muted">No transactions read for this card.</li>'}
      </ul>
      ${editable ? `<button type="button" class="btn ghost" data-act="add" data-card="${c.last4}">+ Add missing line</button>` : ''}
    </div>`;
}

function lineRow(l, editable) {
  const sub = [l.location, l.country].filter(Boolean).join(' · ');
  const pills = [
    l.is_credit ? `<span class="pill">${l.kind === 'payment' ? 'Payment' : 'Refund'}</span>` : '',
    l.kind === 'fee' ? '<span class="pill">Fee</span>' : '',
    l.suspect ? '<span class="pill warn">Check</span>' : '',
    l.manual ? '<span class="pill busy">Edited</span>' : '',
  ].join('');
  return `
    <li class="row ${editable ? 'clickable' : ''} ${l.is_credit ? 'credit' : ''} ${l.suspect ? 'suspect' : ''}" data-line="${l.id}">
      <span class="line-date">${shortDate(l.txn_date)}</span>
      <div class="row-main">
        <span class="row-title">${esc(l.merchant || l.description)}</span>
        <span class="row-sub">${esc(sub)}${l.foreign_currency ? `${sub ? ' · ' : ''}${esc(l.foreign_currency)} ${money(l.foreign_amount)}` : ''}</span>
      </div>
      <div class="row-end">
        <span class="amount">${money(l.amount)}${l.is_credit ? ' CR' : ''}</span>
        ${pills}
      </div>
    </li>`;
}

function wire(s, editable) {
  const refresh = (next) => { if (next) render(next); };
  wireReconcile(el, s, refresh, (id) => openEditor(id, () => loadDetail(s.id)));

  el.querySelector('[data-act="date"]')?.addEventListener('change', async (e) => {
    try { refresh(await api('/statements/' + s.id, { method: 'PUT', body: JSON.stringify({ statement_date: e.target.value }) })); }
    catch (err) { toast(err.message, 'bad'); }
  });

  el.querySelector('[data-act="accept"]')?.addEventListener('click', async () => {
    try { refresh(await api('/statements/' + s.id, { method: 'PUT', body: JSON.stringify({ accepted: !s.accepted }) })); }
    catch (err) { toast(err.message, 'bad'); }
  });

  el.querySelector('[data-act="reparse"]')?.addEventListener('click', async () => {
    if (!confirm('Read the statement text again? Any lines you edited, added or deleted will be reset.')) return;
    try { refresh(await api(`/statements/${s.id}/reparse`, { method: 'POST' })); toast('Read again', 'ok'); }
    catch (err) { toast(err.message, 'bad'); }
  });

  el.querySelector('[data-act="delete"]').addEventListener('click', async () => {
    if (!confirm(s.status === 'saved'
      ? 'Delete this saved statement? The expenses it added are removed and matched records are unlinked.'
      : 'Delete this statement and its PDF?')) return;
    try { await api('/statements/' + s.id, { method: 'DELETE' }); toast('Statement deleted', 'ok'); location.hash = 'statements'; }
    catch (err) { toast(err.message, 'bad'); }
  });

  if (!editable) return;

  el.querySelectorAll('[data-act="add"]').forEach((b) =>
    b.addEventListener('click', () => openLineEditor({ statement: s, card: b.dataset.card, line: null, onChange: refresh }))
  );
  el.querySelectorAll('[data-line]').forEach((li) =>
    li.addEventListener('click', () => {
      const line = s.lines.find((l) => String(l.id) === li.dataset.line);
      openLineEditor({ statement: s, card: line.card, line, onChange: refresh });
    })
  );
}

export default { mount, show };
