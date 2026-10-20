// Statement reconciliation: match statement lines with records, suggest categories, save.
import { getSettings, safeParse, newId } from './util.js';
import { evaluate } from './status.js';
import { callOllama } from './ai.js';
import { periodOf } from './statements.js';

export const EXACT_DAYS = 3;
export const POSSIBLE_DAYS = 7;
export const POSSIBLE_RM = 1.0;
export const POSSIBLE_PCT = 0.05;

const DAY = 86400_000;
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;
const cents = (n) => Math.round(n * 100);

export const modeOf = (settings, card) => settings.card_modes[card] || 'match';
const isDebit = (l) => !l.is_credit && (l.kind === 'purchase' || l.kind === 'fee');

/** Merchant name similarity 0..1 using shared words (ignores punctuation and short words). */
export function similarity(a, b) {
  const words = (s) => new Set(String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3));
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w) || [...B].some((x) => x.startsWith(w) || w.startsWith(x))) shared++;
  return shared / Math.min(A.size, B.size);
}

/** Records that may appear on this statement: in the window, not cash, not already linked or created from a statement. */
async function candidateRecords(env, start, end) {
  const { results } = await env.DB.prepare(
    `SELECT id, txn_date, merchant, total, currency, foreign_currency, foreign_amount, payment_method, status, file_type, category
     FROM receipts
     WHERE txn_date BETWEEN ? AND ?
       AND statement_line_id IS NULL
       AND file_type != 'statement'
       AND status NOT IN ('failed', 'processing')
       AND (payment_method IS NULL OR UPPER(payment_method) NOT LIKE '%CASH%')`
  ).bind(start, end).all();
  return results;
}

/** Greedy one-to-one assignment of the best pairs first. */
function assign(pairs, usedLines, usedRecords) {
  pairs.sort((a, b) => a.score - b.score);
  const out = [];
  for (const p of pairs) {
    if (usedLines.has(p.line.id) || usedRecords.has(p.record.id)) continue;
    usedLines.add(p.line.id);
    usedRecords.add(p.record.id);
    out.push(p);
  }
  return out;
}

export function matchLines(lines, records) {
  const usedLines = new Set(), usedRecords = new Set();
  const exact = [], possible = [];

  // 1) Exact: same RM amount (or same foreign amount for RM-pending records), within 3 days
  for (const l of lines) {
    for (const r of records) {
      if (!l.txn_date || !r.txn_date) continue;
      const days = daysBetween(l.txn_date, r.txn_date);
      if (days > EXACT_DAYS) continue;
      const rmSame = r.total != null && cents(r.total) === cents(l.amount);
      const fxSame = r.total == null && r.foreign_amount != null && l.foreign_amount != null &&
        (r.foreign_currency || '').toUpperCase() === (l.foreign_currency || '').toUpperCase() &&
        cents(r.foreign_amount) === cents(l.foreign_amount);
      if (rmSame || fxSame) exact.push({ line: l, record: r, score: days * 10 - similarity(l.merchant, r.merchant) * 5 });
    }
  }
  const exactPairs = assign(exact, usedLines, usedRecords);

  // 2) Possible: amount within RM 1.00 or 5%, within 7 days
  for (const l of lines) {
    if (usedLines.has(l.id) || !l.txn_date) continue;
    for (const r of records) {
      if (usedRecords.has(r.id) || r.total == null || !r.txn_date) continue;
      const days = daysBetween(l.txn_date, r.txn_date);
      if (days > POSSIBLE_DAYS) continue;
      const diff = Math.abs(r.total - l.amount);
      if (diff > Math.max(POSSIBLE_RM, l.amount * POSSIBLE_PCT) + 0.001) continue;
      possible.push({ line: l, record: r, score: diff * 5 + days * 2 - similarity(l.merchant, r.merchant) * 10 });
    }
  }
  const possiblePairs = assign(possible, usedLines, usedRecords);
  return { exactPairs, possiblePairs };
}

/** Category for each line: past records with the same merchant first, then Gemma. Returns Map(lineId -> {category, source}). */
export async function suggestCategories(env, settings, lines) {
  const out = new Map();
  if (!lines.length) return out;

  const merchants = [...new Set(lines.map((l) => (l.merchant || '').toUpperCase()).filter(Boolean))];
  if (merchants.length) {
    const { results } = await env.DB.prepare(
      `SELECT UPPER(merchant) AS m, category, COUNT(*) AS n FROM receipts
       WHERE category IS NOT NULL AND UPPER(merchant) IN (${merchants.map(() => '?').join(',')})
       GROUP BY UPPER(merchant), category ORDER BY n DESC`
    ).bind(...merchants).all();
    const best = {};
    for (const r of results) best[r.m] ??= r.category;
    for (const l of lines) {
      const c = best[(l.merchant || '').toUpperCase()];
      if (c && settings.categories.includes(c)) out.set(l.id, { category: c, source: 'history' });
    }
  }

  const ask = lines.filter((l) => !out.has(l.id));
  if (!ask.length || !settings.ai_url) return out;
  try {
    const list = ask.map((l, i) => `${i + 1}. ${l.merchant}${l.location ? ` (${l.location}${l.country ? ', ' + l.country : ''})` : ''}`).join('\n');
    const reply = await callOllama(env, settings, {
      role: 'user',
      content: `Assign a spending category to each card transaction below (Malaysia). Allowed categories: ${JSON.stringify(settings.categories)}.
Return ONLY a JSON object mapping each number to one category from the list, e.g. {"1": "Groceries"}. Use "" if unsure.

${list}`,
    });
    ask.forEach((l, i) => {
      const c = reply?.[String(i + 1)];
      if (typeof c === 'string' && settings.categories.includes(c)) out.set(l.id, { category: c, source: 'ai' });
    });
  } catch {
    // Suggestions are optional; the user can pick categories manually.
  }
  return out;
}

/** Runs matching for a statement and stores the results on its lines. */
export async function runMatching(env, statementId) {
  const settings = await getSettings(env.DB);
  const st = await env.DB.prepare('SELECT * FROM statements WHERE id = ?').bind(statementId).first();
  const period = periodOf(st.statement_date);
  if (!period) throw new Error('Set the statement date first');

  const { results: allLines } = await env.DB.prepare('SELECT * FROM statement_lines WHERE statement_id = ?').bind(statementId).all();
  const lines = allLines.map((l) => ({ ...l, is_credit: Boolean(l.is_credit) }));
  const matchLinesList = lines.filter((l) => isDebit(l) && modeOf(settings, l.card) === 'match');
  const recordLines = lines.filter((l) => isDebit(l) && modeOf(settings, l.card) === 'record');

  const records = await candidateRecords(env, addDays(period.start, -POSSIBLE_DAYS), addDays(period.end, POSSIBLE_DAYS));
  const { exactPairs, possiblePairs } = matchLines(matchLinesList, records);
  const matched = new Map([...exactPairs.map((p) => [p.line.id, ['auto', p.record.id]]), ...possiblePairs.map((p) => [p.line.id, ['possible', p.record.id]])]);

  const needCategory = [...matchLinesList.filter((l) => !matched.has(l.id)), ...recordLines];
  const cats = await suggestCategories(env, settings, needCategory);

  const stmts = [
    env.DB.prepare(
      `UPDATE statement_lines SET match_receipt_id = NULL, match_type = NULL, decision = NULL, category = NULL, category_source = NULL
       WHERE statement_id = ?`
    ).bind(statementId),
  ];
  for (const l of lines) {
    const m = matched.get(l.id);
    const c = cats.get(l.id);
    const mode = modeOf(settings, l.card);
    const decision = m ? null : mode === 'record' && isDebit(l) ? 'add' : null;
    if (!m && !c && !decision) continue;
    stmts.push(env.DB.prepare(
      `UPDATE statement_lines SET match_receipt_id = ?, match_type = ?, decision = ?, category = ?, category_source = ? WHERE id = ?`
    ).bind(m?.[1] ?? null, m?.[0] ?? null, decision, c?.category ?? null, c?.source ?? null, l.id));
  }
  stmts.push(env.DB.prepare(`UPDATE statements SET matched_at = datetime('now'), record_decisions = '{}', updated_at = datetime('now') WHERE id = ?`).bind(statementId));
  await env.DB.batch(stmts);
}

/** Clears matching results (after lines change). */
export function resetMatchingStmt(env, statementId) {
  return [
    env.DB.prepare(
      `UPDATE statement_lines SET match_receipt_id = NULL, match_type = NULL, decision = NULL, category = NULL, category_source = NULL
       WHERE statement_id = ?`
    ).bind(statementId),
    env.DB.prepare(`UPDATE statements SET matched_at = NULL, record_decisions = NULL WHERE id = ?`).bind(statementId),
  ];
}

/** Reconcile view for the UI, built from stored match results. */
export async function reconcileView(env, st, lines) {
  if (!st.matched_at && st.status !== 'saved') return null;
  const settings = await getSettings(env.DB);
  const period = periodOf(st.statement_date);
  const decisions = safeParse(st.record_decisions, {}) || {};

  const linkedIds = [...new Set(lines.map((l) => l.match_receipt_id).filter(Boolean))];
  const linked = {};
  if (linkedIds.length) {
    const { results } = await env.DB.prepare(
      `SELECT id, txn_date, merchant, total, currency, foreign_currency, foreign_amount, payment_method, status, category, file_type
       FROM receipts WHERE id IN (${linkedIds.map(() => '?').join(',')})`
    ).bind(...linkedIds).all();
    for (const r of results) linked[r.id] = r;
  }

  const view = { matched: [], possible: [], unmatched: [], record_only: [], not_on_statement: [], cards: {} };
  for (const l of lines) {
    const mode = modeOf(settings, l.card);
    view.cards[l.card] = mode;
    if (!isDebit(l) || mode === 'skip') continue;
    const rec = l.match_receipt_id ? linked[l.match_receipt_id] || null : null;
    if (mode === 'record') view.record_only.push(l);
    else if (l.match_type === 'possible' && rec) view.possible.push({ line: l, record: rec });
    else if (l.match_type && rec) view.matched.push({ line: l, record: rec });
    else view.unmatched.push(l);
  }

  if (st.status !== 'saved' && period) {
    // Records in the statement period that no line matched
    const used = new Set(lines.map((l) => l.match_receipt_id).filter(Boolean));
    const recs = await candidateRecords(env, period.start, period.end);
    view.not_on_statement = recs.filter((r) => !used.has(r.id)).map((r) => ({ ...r, decision: decisions[r.id] || 'keep' }));
  }
  return view;
}

/** Applies the reconciliation: links matches, adds chosen lines as expenses, deletes chosen records. */
export async function saveReconciliation(env, statementId) {
  const settings = await getSettings(env.DB);
  const st = await env.DB.prepare('SELECT * FROM statements WHERE id = ?').bind(statementId).first();
  const { results: raw } = await env.DB.prepare('SELECT * FROM statement_lines WHERE statement_id = ?').bind(statementId).all();
  const lines = raw.map((l) => ({ ...l, is_credit: Boolean(l.is_credit) }));
  const view = await reconcileView(env, st, lines);
  const label = (card) => `UOB **${card}`;
  const stmts = [];
  const counts = { linked: 0, added: 0, deleted: 0, filled: 0 };

  const link = (line, record, useStatementAmount = false) => {
    const next = { ...record, statement_line_id: line.id };
    // RM-pending record matched by foreign amount: take the RM amount from the statement
    if (record.total == null) { next.total = line.amount; counts.filled++; }
    // Confirmed near-match or manual link: the statement amount is the one actually charged
    else if (useStatementAmount && cents(record.total) !== cents(line.amount)) { next.total = line.amount; counts.corrected = (counts.corrected || 0) + 1; }
    const { status, error } = evaluate({ ...next, category: record.category });
    stmts.push(env.DB.prepare(
      `UPDATE receipts SET statement_line_id = ?, total = ?, status = ?, error = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(line.id, next.total, status, error, record.id));
    counts.linked++;
  };

  for (const { line, record } of view.matched) link(line, record, line.match_type === 'manual');
  for (const { line, record } of view.possible) if (line.decision === 'confirm') link(line, record, true);

  const addLine = (line) => {
    const row = {
      id: newId(),
      txn_date: line.txn_date,
      merchant: line.merchant,
      total: line.amount,
      currency: settings.default_currency,
      category: line.category,
      area: line.location ? titleCase(line.location) : null,
      payment_method: label(line.card),
      foreign_currency: line.foreign_currency,
      foreign_amount: line.foreign_amount,
    };
    const { status, error } = evaluate(row);
    stmts.push(env.DB.prepare(
      `INSERT INTO receipts (id, txn_date, merchant, total, currency, category, area, payment_method, foreign_currency, foreign_amount,
         notes, status, error, file_key, file_type, file_name, statement_line_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'statement', NULL, ?)`
    ).bind(row.id, row.txn_date, row.merchant, row.total, row.currency, row.category, row.area, row.payment_method,
      row.foreign_currency, row.foreign_amount, `From statement ${st.statement_date}`, status, error, line.id));
    counts.added++;
  };

  for (const l of view.unmatched) if (l.decision === 'add') addLine(l);
  for (const l of view.record_only) if (l.decision === 'add') addLine(l);

  const deleteKeys = [];
  for (const r of view.not_on_statement) {
    if (r.decision !== 'delete') continue;
    const full = await env.DB.prepare('SELECT file_key FROM receipts WHERE id = ?').bind(r.id).first();
    if (full?.file_key) deleteKeys.push(full.file_key);
    stmts.push(env.DB.prepare('DELETE FROM receipt_items WHERE receipt_id = ?').bind(r.id));
    stmts.push(env.DB.prepare('DELETE FROM receipts WHERE id = ?').bind(r.id));
    counts.deleted++;
  }

  stmts.push(env.DB.prepare(`UPDATE statements SET status = 'saved', saved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(statementId));
  await env.DB.batch(stmts);
  for (const k of deleteKeys) await env.BUCKET.delete(k);
  return counts;
}

/** Undo a saved reconciliation: remove expenses created from it and unlink matched records. */
export function undoSavedStmts(env, statementId) {
  const lineIds = `SELECT id FROM statement_lines WHERE statement_id = ?`;
  return [
    env.DB.prepare(`DELETE FROM receipts WHERE file_type = 'statement' AND statement_line_id IN (${lineIds})`).bind(statementId),
    env.DB.prepare(`UPDATE receipts SET statement_line_id = NULL WHERE statement_line_id IN (${lineIds})`).bind(statementId),
  ];
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
