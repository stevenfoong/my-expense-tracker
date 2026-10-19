import { json, fail } from '../../../_lib/util.js';
import { applyEdit } from '../../../_lib/edit.js';


// GET /api/receipts/:id -> receipt with line items
export async function onRequestGet({ params, env }) {
  const row = await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(params.id).first();
  if (!row) return fail('Not found', 404);
  const { results: items } = await env.DB.prepare(
    'SELECT item_name, quantity, line_total FROM receipt_items WHERE receipt_id = ? ORDER BY id'
  ).bind(params.id).all();
  return json({ ...row, items });
}

// PUT /api/receipts/:id -> manual edit. Status is recalculated from the fields.
export async function onRequestPut({ params, request, env }) {
  const row = await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(params.id).first();
  if (!row) return fail('Not found', 404);
  const result = await applyEdit(env, row, await request.json());
  return result.error ? fail(result.error) : json(result.row);
}

// DELETE /api/receipts/:id -> removes the row, its items and the stored file
export async function onRequestDelete({ params, env }) {
  const row = await env.DB.prepare('SELECT file_key FROM receipts WHERE id = ?').bind(params.id).first();
  if (!row) return fail('Not found', 404);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM receipt_items WHERE receipt_id = ?').bind(params.id),
    env.DB.prepare('DELETE FROM receipts WHERE id = ?').bind(params.id),
  ]);
  if (row.file_key) await env.BUCKET.delete(row.file_key);
  return json({ deleted: params.id });
}
