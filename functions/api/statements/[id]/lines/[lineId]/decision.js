import { json, fail, getSettings } from '../../../../../_lib/util.js';
import { loadStatement } from '../../../../../_lib/statements.js';

// PUT /api/statements/:id/lines/:lineId/decision
//   { decision: 'add' | 'ignore' | 'confirm' | null }   choice for this line
//   { category }                                         category to use when added
//   { unmatch: true }                                     drop the paired record (it becomes "not on statement")
//   { link_receipt_id }                                   pair manually with a record
export async function onRequestPut({ params, request, env }) {
  const st = await env.DB.prepare('SELECT status, matched_at FROM statements WHERE id = ?').bind(params.id).first();
  if (!st) return fail('Not found', 404);
  if (st.status === 'saved') return fail('This statement is already saved');
  if (!st.matched_at) return fail('Run matching first');
  const line = await env.DB.prepare('SELECT * FROM statement_lines WHERE id = ? AND statement_id = ?').bind(params.lineId, params.id).first();
  if (!line) return fail('Line not found', 404);

  const b = await request.json();
  const settings = await getSettings(env.DB);
  const next = { decision: line.decision, category: line.category, category_source: line.category_source,
    match_receipt_id: line.match_receipt_id, match_type: line.match_type };

  if ('decision' in b) {
    if (![null, 'add', 'ignore', 'confirm'].includes(b.decision)) return fail('Invalid decision');
    if (b.decision === 'confirm' && next.match_type !== 'possible') return fail('Nothing to confirm');
    next.decision = b.decision;
  }
  if ('category' in b) {
    if (b.category && !settings.categories.includes(b.category)) return fail('Unknown category');
    next.category = b.category || null;
    next.category_source = b.category ? 'user' : null;
  }
  if (b.unmatch) {
    next.match_receipt_id = null; next.match_type = null; next.decision = null;
  }
  if (b.link_receipt_id) {
    const r = await env.DB.prepare('SELECT id, statement_line_id FROM receipts WHERE id = ?').bind(b.link_receipt_id).first();
    if (!r) return fail('Record not found', 404);
    if (r.statement_line_id) return fail('That record is already linked to a statement');
    const taken = await env.DB.prepare('SELECT id FROM statement_lines WHERE statement_id = ? AND match_receipt_id = ? AND id != ?')
      .bind(params.id, b.link_receipt_id, line.id).first();
    if (taken) return fail('That record is already matched to another line');
    next.match_receipt_id = r.id; next.match_type = 'manual'; next.decision = null;
  }

  await env.DB.prepare(
    `UPDATE statement_lines SET decision = ?, category = ?, category_source = ?, match_receipt_id = ?, match_type = ? WHERE id = ?`
  ).bind(next.decision, next.category, next.category_source, next.match_receipt_id, next.match_type, line.id).run();
  return json(await loadStatement(env, params.id));
}
