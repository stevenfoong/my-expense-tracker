import { json, fail } from '../../../../../_lib/util.js';
import { loadStatement } from '../../../../../_lib/statements.js';
import { lineValues } from '../../../../../_lib/statement-line.js';
import { resetMatchingStmt } from '../../../../../_lib/reconcile.js';

async function getLine(env, params) {
  const s = await env.DB.prepare('SELECT status FROM statements WHERE id = ?').bind(params.id).first();
  if (!s) return { error: fail('Not found', 404) };
  if (s.status === 'saved') return { error: fail('This statement is already saved') };
  const line = await env.DB.prepare('SELECT * FROM statement_lines WHERE id = ? AND statement_id = ?')
    .bind(params.lineId, params.id).first();
  if (!line) return { error: fail('Line not found', 404) };
  return { line };
}

// PUT /api/statements/:id/lines/:lineId -> edit a line
export async function onRequestPut({ params, request, env }) {
  const { line, error: notFound } = await getLine(env, params);
  if (notFound) return notFound;
  const { values: v, error } = lineValues(await request.json(), line);
  if (error) return fail(error);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE statement_lines SET txn_date = ?, description = ?, merchant = ?, location = ?, amount = ?, is_credit = ?,
         kind = ?, foreign_currency = ?, foreign_amount = ?, manual = 1 WHERE id = ?`
    ).bind(v.txn_date, v.description, v.merchant, v.location, v.amount, v.is_credit, v.kind,
      v.foreign_currency, v.foreign_amount, line.id),
    env.DB.prepare(`UPDATE statements SET accepted = 0, updated_at = datetime('now') WHERE id = ?`).bind(params.id),
    ...resetMatchingStmt(env, params.id),
  ]);
  return json(await loadStatement(env, params.id));
}

// DELETE /api/statements/:id/lines/:lineId
export async function onRequestDelete({ params, env }) {
  const { line, error } = await getLine(env, params);
  if (error) return error;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM statement_lines WHERE id = ?').bind(line.id),
    env.DB.prepare(`UPDATE statements SET accepted = 0, updated_at = datetime('now') WHERE id = ?`).bind(params.id),
    ...resetMatchingStmt(env, params.id),
  ]);
  return json(await loadStatement(env, params.id));
}
