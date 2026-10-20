import { json, fail } from '../../../_lib/util.js';
import { loadStatement } from '../../../_lib/statements.js';
import { runMatching } from '../../../_lib/reconcile.js';

// POST /api/statements/:id/match -> match lines with records and suggest categories (resets earlier decisions)
export async function onRequestPost({ params, env }) {
  const s = await env.DB.prepare('SELECT status FROM statements WHERE id = ?').bind(params.id).first();
  if (!s) return fail('Not found', 404);
  if (s.status === 'saved') return fail('This statement is already saved');
  await runMatching(env, params.id);
  return json(await loadStatement(env, params.id));
}
