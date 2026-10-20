import { json, fail } from '../../../_lib/util.js';
import { loadStatement } from '../../../_lib/statements.js';
import { saveReconciliation } from '../../../_lib/reconcile.js';

// POST /api/statements/:id/save -> apply all decisions in one go
export async function onRequestPost({ params, env }) {
  const s = await env.DB.prepare('SELECT status, matched_at FROM statements WHERE id = ?').bind(params.id).first();
  if (!s) return fail('Not found', 404);
  if (s.status === 'saved') return fail('This statement is already saved');
  if (!s.matched_at) return fail('Run matching first');
  const counts = await saveReconciliation(env, params.id);
  return json({ ...(await loadStatement(env, params.id)), saved_counts: counts });
}
