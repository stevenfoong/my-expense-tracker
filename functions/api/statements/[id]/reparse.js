import { json, fail } from '../../../_lib/util.js';
import { loadStatement, storeParsed, parseRaw } from '../../../_lib/statements.js';

// POST /api/statements/:id/reparse -> read the stored text again (after a parser update). Manual edits are discarded.
export async function onRequestPost({ params, env }) {
  const s = await env.DB.prepare('SELECT raw_text, status FROM statements WHERE id = ?').bind(params.id).first();
  if (!s) return fail('Not found', 404);
  if (s.status === 'saved') return fail('This statement is already saved');
  await storeParsed(env, params.id, parseRaw(s.raw_text));
  return json(await loadStatement(env, params.id));
}
