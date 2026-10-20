import { json, fail } from '../../../../_lib/util.js';
import { loadStatement } from '../../../../_lib/statements.js';
import { lineValues } from '../../../../_lib/statement-line.js';
import { resetMatchingStmt } from '../../../../_lib/reconcile.js';

// POST /api/statements/:id/lines  { card, txn_date, merchant, location, amount, is_credit, foreign_currency, foreign_amount }
export async function onRequestPost({ params, request, env }) {
  const s = await env.DB.prepare('SELECT status FROM statements WHERE id = ?').bind(params.id).first();
  if (!s) return fail('Not found', 404);
  if (s.status === 'saved') return fail('This statement is already saved');

  const body = await request.json();
  if (!/^\d{4}$/.test(String(body.card || ''))) return fail('Card is required');
  const { values: v, error } = lineValues(body, { is_credit: 0 });
  if (error) return fail(error);

  // Place it after the last line of the same date on that card, so the list stays in order
  const after = await env.DB.prepare(
    `SELECT COALESCE(MAX(line_no), 0) AS n FROM statement_lines WHERE statement_id = ? AND card = ? AND (txn_date <= ? OR txn_date IS NULL)`
  ).bind(params.id, body.card, v.txn_date).first();
  const lineNo = (after?.n || 0) + 0.5;

  await env.DB.prepare(
    `INSERT INTO statement_lines (statement_id, card, line_no, txn_date, description, merchant, location, country,
       amount, is_credit, kind, foreign_currency, foreign_amount, manual) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 1)`
  ).bind(params.id, body.card, lineNo, v.txn_date, v.description, v.merchant, v.location,
    v.amount, v.is_credit, v.kind, v.foreign_currency, v.foreign_amount).run();
  await env.DB.batch([env.DB.prepare(`UPDATE statements SET accepted = 0, updated_at = datetime('now') WHERE id = ?`).bind(params.id), ...resetMatchingStmt(env, params.id)]);
  return json(await loadStatement(env, params.id), 201);
}
