// Reconcile section of a statement: match results, decisions and save.
import { api, esc, money, fmtDate, toast, getSettings } from '../lib.js';

const MODE_LABEL = { match: 'Match with records', record: 'Record only', skip: 'Skip' };
const rm = (n) => money(n, 'RM');
const short = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};
let categories = [];
getSettings().then((s) => (categories = s.categories)).catch(() => {});

/** Counts of what Save will do and what is still undecided. */
export function plan(r) {
  const possibleOpen = r.possible.filter((p) => p.line.decision !== 'confirm').length;
  return {
    link: r.matched.length + r.possible.filter((p) => p.line.decision === 'confirm').length,
    add: r.unmatched.filter((l) => l.decision === 'add').length + r.record_only.filter((l) => l.decision === 'add').length,
    del: r.not_on_statement.filter((x) => x.decision === 'delete').length,
    undecided: r.unmatched.filter((l) => !l.decision).length + possibleOpen,
    possibleOpen,
    noCategory: [...r.unmatched, ...r.record_only].filter((l) => l.decision === 'add' && !l.category).length,
  };
}

export function reconcileSection(s) {
  const ready = s.checks_ok || s.accepted;
  if (s.status === 'saved') return savedSection(s);
  if (!ready) return '';
  const r = s.reconcile;
  const cards = s.cards.map((c) => c.last4);

  if (!r) {
    return `
      <div class="card">
        <h3>Reconcile with your records</h3>
        <p class="muted">Matches each purchase with your receipts and entries (same amount, within 3 days), finds near-matches, and lists what is missing on either side. Nothing changes until you press Save.</p>
        <div class="mode-list" data-sec="modes"></div>
        <button type="button" class="btn primary" data-act="match">Match with my records</button>
      </div>`;
  }

  const p = plan(r);
  const recordCards = [...new Set(r.record_only.map((l) => l.card))];

  return `
    <div class="card">
      <div class="list-head">
        <h3>Reconcile with your records</h3>
        <button type="button" class="btn ghost small" data-act="rematch">Match again</button>
      </div>
      <div class="chips">
        <span class="chip ok">${r.matched.length} matched</span>
        ${r.possible.length ? `<span class="chip ${p.possibleOpen ? 'warn' : 'ok'}">${r.possible.length} possible</span>` : ''}
        <span class="chip ${r.unmatched.some((l) => !l.decision) ? 'warn' : ''}">${r.unmatched.length} no record</span>
        <span class="chip">${r.not_on_statement.length} not on statement</span>
        ${r.record_only.length ? `<span class="chip">${r.record_only.length} to import</span>` : ''}
      </div>
      <div class="mode-list" data-sec="modes"></div>
    </div>

    ${r.possible.length ? `
    <div class="card">
      <h3>Possible matches</h3>
      <p class="muted small">Close in amount or date. Confirm if they are the same purchase; the statement amount will be used.</p>
      <ul class="list">${r.possible.map(possibleRow).join('')}</ul>
    </div>` : ''}

    <div class="card">
      <h3>On the statement, no record</h3>
      ${r.unmatched.length ? `
        <p class="muted small">Add as an expense, ignore it, or link it to a record below.</p>
        <ul class="list">${r.unmatched.map((l) => unmatchedRow(l, r)).join('')}</ul>
        ${r.unmatched.length > 1 ? `<div class="inline-actions"><button type="button" class="btn ghost small" data-act="add-all">Add all undecided</button></div>` : ''}`
      : '<p class="muted small">Every purchase on the statement has a record.</p>'}
    </div>

    <div class="card">
      <h3>Recorded, not on the statement</h3>
      ${r.not_on_statement.length ? `
        <p class="muted small">Records in this period that no statement line matched (cash entries are left out). Usually another card, or an amount to fix.</p>
        <ul class="list">${r.not_on_statement.map(recordRow).join('')}</ul>`
      : '<p class="muted small">None: every record in this period is on the statement.</p>'}
    </div>

    ${recordCards.map((card) => recordOnlySection(card, r.record_only.filter((l) => l.card === card))).join('')}

    <details class="card fold">
      <summary><h3>Matched (${r.matched.length})</h3></summary>
      <ul class="list">${r.matched.map(matchedRow).join('') || '<li class="empty muted">No matches.</li>'}</ul>
    </details>

    <div class="card save-card">
      <div class="save-row">
        <div class="save-text small">
          <span>Link <strong>${p.link}</strong> · Add <strong>${p.add}</strong>${p.del ? ` · Delete <strong>${p.del}</strong>` : ''}</span>
          ${p.undecided ? `<span class="warn-text">${p.undecided} undecided (skipped)</span>` : '<span class="ok-text">All decided</span>'}
          ${p.noCategory ? `<span class="warn-text">${p.noCategory} without category</span>` : ''}
        </div>
        <button type="button" class="btn primary" data-act="save">Save</button>
      </div>
    </div>`;
}

function savedSection(s) {
  const r = s.reconcile;
  return `
    <div class="card">
      <h3>Reconciled</h3>
      <p class="banner ok">Saved on ${fmtDate((s.saved_at || '').slice(0, 10))}. ${r ? `${r.matched.length + r.possible.filter((x) => x.line.decision === 'confirm').length} purchases linked to your records.` : ''}</p>
    </div>`;
}

function categorySelect(l) {
  const src = { history: 'from past records', ai: 'suggested by AI', user: '' }[l.category_source] || '';
  return `
    <label class="cat">
      <select data-cat="${l.id}" aria-label="Category">
        <option value="">Category…</option>
        ${categories.map((c) => `<option ${c === l.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select>
      ${src ? `<small class="muted">${src}</small>` : ''}
    </label>`;
}

function lineInfo(l) {
  return `
    <div class="row-main">
      <span class="row-title">${esc(l.merchant)}</span>
      <span class="row-sub">${short(l.txn_date)}${l.location ? ' · ' + esc(l.location) : ''}${l.foreign_currency ? ` · ${esc(l.foreign_currency)} ${money(l.foreign_amount)}` : ''}</span>
    </div>`;
}

function seg(lineId, value, current, label, kind = '') {
  return `<button type="button" class="seg-btn ${kind} ${current === value ? 'on' : ''}" data-decide="${lineId}" data-value="${value}">${label}</button>`;
}

function possibleRow({ line, record }) {
  const diff = Math.round((line.amount - record.total) * 100) / 100;
  return `
    <li class="pair">
      <div class="pair-side"><span class="tag">Statement</span>${lineInfo(line)}<span class="amount">${money(line.amount)}</span></div>
      <div class="pair-side"><span class="tag">Your record</span>
        <div class="row-main"><span class="row-title link" data-open="${record.id}">${esc(record.merchant || 'Record')}</span>
          <span class="row-sub">${short(record.txn_date)}${diff ? ` · differs by ${rm(Math.abs(diff))}` : ''}</span></div>
        <span class="amount">${money(record.total)}</span></div>
      <div class="decide">
        ${seg(line.id, 'confirm', line.decision, 'Same purchase', 'ok')}
        <button type="button" class="seg-btn" data-unmatch="${line.id}">Not the same</button>
      </div>
    </li>`;
}

function unmatchedRow(l, r) {
  const near = r.not_on_statement.filter((x) => x.txn_date && l.txn_date &&
    Math.abs(Date.parse(x.txn_date) - Date.parse(l.txn_date)) <= 7 * 86400_000);
  return `
    <li class="decide-row ${l.decision ? 'decided' : ''}">
      <div class="row">${lineInfo(l)}<span class="amount">${money(l.amount)}</span></div>
      <div class="decide">
        ${categorySelect(l)}
        ${seg(l.id, 'add', l.decision, 'Add', 'ok')}
        ${seg(l.id, 'ignore', l.decision, 'Ignore')}
        ${near.length ? `
          <select class="link-select" data-link="${l.id}" aria-label="Link to one of your records">
            <option value="">Link…</option>
            ${near.map((x) => `<option value="${x.id}">${short(x.txn_date)} · ${esc(x.merchant || 'Record')} · ${money(x.total ?? x.foreign_amount, x.total != null ? 'RM' : x.foreign_currency)}</option>`).join('')}
          </select>` : ''}
      </div>
    </li>`;
}

function recordRow(x) {
  return `
    <li class="decide-row ${x.decision === 'delete' ? 'decided del' : ''}">
      <div class="row">
        <div class="row-main">
          <span class="row-title link" data-open="${x.id}">${esc(x.merchant || 'Record')}</span>
          <span class="row-sub">${short(x.txn_date)}${x.payment_method ? ' · ' + esc(x.payment_method) : ''}${x.category ? ' · ' + esc(x.category) : ''}</span>
        </div>
        <span class="amount">${x.total != null ? money(x.total) : money(x.foreign_amount, x.foreign_currency)}</span>
      </div>
      <div class="decide">
        <button type="button" class="seg-btn ${x.decision !== 'delete' ? 'on' : ''}" data-record="${x.id}" data-value="keep">Keep</button>
        <button type="button" class="seg-btn bad ${x.decision === 'delete' ? 'on' : ''}" data-record="${x.id}" data-value="delete">Delete</button>
      </div>
    </li>`;
}

function recordOnlySection(card, lines) {
  const included = lines.filter((l) => l.decision === 'add');
  return `
    <div class="card">
      <h3>Import from **${esc(card)}</h3>
      <p class="muted small">Record-only card: these purchases are added as expenses for your spending totals. Untick any you don't want.</p>
      <ul class="list">
        ${lines.map((l) => `
          <li class="decide-row ${l.decision === 'add' ? '' : 'skipped'}">
            <div class="row">
              <input type="checkbox" class="include" data-include="${l.id}" ${l.decision === 'add' ? 'checked' : ''} aria-label="Include">
              ${lineInfo(l)}<span class="amount">${money(l.amount)}</span>
            </div>
            <div class="decide">${categorySelect(l)}</div>
          </li>`).join('')}
      </ul>
      <p class="muted small">${included.length} of ${lines.length} included · ${rm(included.reduce((t, l) => t + l.amount, 0))}</p>
    </div>`;
}

function matchedRow({ line, record }) {
  return `
    <li class="row">
      ${lineInfo(line)}
      <div class="row-end">
        <span class="amount">${money(line.amount)}</span>
        <span class="row-sub link" data-open="${record.id}">${esc(record.merchant || 'Record')}${record.total == null ? ' · RM will be filled' : ''}${line.match_type === 'manual' ? ' · linked by you' : ''}</span>
        <button type="button" class="btn ghost small" data-unmatch="${line.id}">Unmatch</button>
      </div>
    </li>`;
}

/* ---------------- Events ---------------- */

export async function wireReconcile(root, s, refresh, openRecord) {
  const put = async (path, body) => {
    try { refresh(await api(path, { method: 'PUT', body: JSON.stringify(body) })); }
    catch (e) { toast(e.message, 'bad'); }
  };
  const lineDecision = (id, body) => put(`/statements/${s.id}/lines/${id}/decision`, body);

  // Card modes
  const modes = root.querySelector('[data-sec="modes"]');
  if (modes) {
    const settings = await getSettings(true).catch(() => ({ card_modes: {} }));
    modes.innerHTML = s.cards.map((c) => `
      <label class="mode-row"><span>${esc(c.name || 'Card')} **${esc(c.last4)}</span>
        <select data-mode="${c.last4}">
          ${Object.entries(MODE_LABEL).map(([v, t]) => `<option value="${v}" ${(settings.card_modes[c.last4] || 'match') === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </label>`).join('');
    modes.querySelectorAll('[data-mode]').forEach((sel) => sel.addEventListener('change', async () => {
      try {
        await api('/settings', { method: 'PUT', body: JSON.stringify({ card_modes: { [sel.dataset.mode]: sel.value } }) });
        await getSettings(true);
        if (s.reconcile) refresh(await api(`/statements/${s.id}/match`, { method: 'POST' }));
        toast('Card setting saved', 'ok');
      } catch (e) { toast(e.message, 'bad'); }
    }));
  }

  const runMatch = async (btn) => {
    btn.disabled = true;
    btn.textContent = 'Matching… (asking AI for categories)';
    try { refresh(await api(`/statements/${s.id}/match`, { method: 'POST' })); }
    catch (e) { toast(e.message, 'bad'); btn.disabled = false; btn.textContent = 'Match with my records'; }
  };
  root.querySelector('[data-act="match"]')?.addEventListener('click', (e) => runMatch(e.target));
  root.querySelector('[data-act="rematch"]')?.addEventListener('click', (e) => {
    if (confirm('Match again? Your choices on this statement will be reset.')) runMatch(e.target);
  });

  root.querySelectorAll('[data-decide]').forEach((b) => b.addEventListener('click', () => {
    const line = s.lines.find((l) => String(l.id) === b.dataset.decide);
    lineDecision(b.dataset.decide, { decision: line?.decision === b.dataset.value ? null : b.dataset.value });
  }));
  root.querySelectorAll('[data-unmatch]').forEach((b) => b.addEventListener('click', () => lineDecision(b.dataset.unmatch, { unmatch: true })));
  root.querySelectorAll('[data-cat]').forEach((sel) => sel.addEventListener('change', () => lineDecision(sel.dataset.cat, { category: sel.value })));
  root.querySelectorAll('[data-link]').forEach((sel) => sel.addEventListener('change', () => sel.value && lineDecision(sel.dataset.link, { link_receipt_id: sel.value })));
  root.querySelectorAll('[data-include]').forEach((cb) => cb.addEventListener('change', () => lineDecision(cb.dataset.include, { decision: cb.checked ? 'add' : 'ignore' })));
  root.querySelectorAll('[data-record]').forEach((b) => b.addEventListener('click', () => put(`/statements/${s.id}/records/${b.dataset.record}`, { decision: b.dataset.value })));
  root.querySelectorAll('[data-open]').forEach((t) => t.addEventListener('click', (e) => { e.stopPropagation(); openRecord(t.dataset.open); }));

  root.querySelector('[data-act="add-all"]')?.addEventListener('click', async () => {
    const open = s.reconcile.unmatched.filter((l) => !l.decision);
    for (const l of open) {
      try { await api(`/statements/${s.id}/lines/${l.id}/decision`, { method: 'PUT', body: JSON.stringify({ decision: 'add' }) }); }
      catch (e) { toast(e.message, 'bad'); break; }
    }
    refresh(await api('/statements/' + s.id));
  });

  root.querySelector('[data-act="save"]')?.addEventListener('click', async (e) => {
    const p = plan(s.reconcile);
    const msg = `Save this reconciliation?\n\nLink ${p.link} records, add ${p.add} expenses${p.del ? `, delete ${p.del} records` : ''}.` +
      (p.undecided ? `\n${p.undecided} undecided items will be skipped.` : '');
    if (!confirm(msg)) return;
    e.target.disabled = true;
    try {
      const res = await api(`/statements/${s.id}/save`, { method: 'POST' });
      const c = res.saved_counts || {};
      toast(`Saved: ${c.linked || 0} linked, ${c.added || 0} added${c.deleted ? `, ${c.deleted} deleted` : ''}`, 'ok');
      refresh(res);
    } catch (err) { toast(err.message, 'bad'); e.target.disabled = false; }
  });
}
