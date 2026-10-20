import { json, fail, safeParse } from '../../../../_lib/util.js';
import { loadStatement } from '../../../../_lib/statements.js';

// PUT /api/statements/:id/records/:receiptId { decision: 'keep' | 'delete' } for records not on the statement
export async function onRequestPut({ params, request, env }) {
  const st = await env.DB.prepare('SELECT status, record_decisions FROM statements WHERE id = ?').bind(params.id).first();
  if (!st) return fail('Not found', 404);
  if (st.status === 'saved') return fail('This statement is already saved');
  const { decision } = await request.json();
  if (!['keep', 'delete'].includes(decision)) return fail('Invalid decision');
  const d = safeParse(st.record_decisions, {}) || {};
  if (decision === 'keep') delete d[params.receiptId]; else d[params.receiptId] = decision;
  await env.DB.prepare('UPDATE statements SET record_decisions = ? WHERE id = ?').bind(JSON.stringify(d), params.id).run();
  return json(await loadStatement(env, params.id));
}
