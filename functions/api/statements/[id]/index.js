import { json, fail, normaliseDate } from '../../../_lib/util.js';
import { loadStatement } from '../../../_lib/statements.js';

// GET /api/statements/:id
export async function onRequestGet({ params, env }) {
  const s = await loadStatement(env, params.id);
  return s ? json(s) : fail('Not found', 404);
}

// PUT /api/statements/:id  { statement_date?, accepted? }
export async function onRequestPut({ params, request, env }) {
  const body = await request.json();
  const s = await env.DB.prepare('SELECT id FROM statements WHERE id = ?').bind(params.id).first();
  if (!s) return fail('Not found', 404);

  if ('statement_date' in body) {
    const d = normaliseDate(body.statement_date);
    if (!d) return fail('Invalid statement date');
    await env.DB.prepare(`UPDATE statements SET statement_date = ?, updated_at = datetime('now') WHERE id = ?`).bind(d, params.id).run();
  }
  if ('accepted' in body) {
    await env.DB.prepare(`UPDATE statements SET accepted = ?, updated_at = datetime('now') WHERE id = ?`).bind(body.accepted ? 1 : 0, params.id).run();
  }
  return json(await loadStatement(env, params.id));
}

// DELETE /api/statements/:id -> removes the statement, its lines and the PDF
export async function onRequestDelete({ params, env }) {
  const s = await env.DB.prepare('SELECT file_key FROM statements WHERE id = ?').bind(params.id).first();
  if (!s) return fail('Not found', 404);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM statement_lines WHERE statement_id = ?').bind(params.id),
    env.DB.prepare('DELETE FROM statements WHERE id = ?').bind(params.id),
  ]);
  await env.BUCKET.delete(s.file_key);
  return json({ deleted: params.id });
}
