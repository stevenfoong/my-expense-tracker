import { json, fail, normaliseDate, toNumber } from '../../../_lib/util.js';

const EDITABLE = ['txn_date', 'merchant', 'total', 'currency', 'category', 'area', 'payment_method', 'notes'];

// GET /api/receipts/:id -> receipt with line items
export async function onRequestGet({ params, env }) {
  const row = await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(params.id).first();
  if (!row) return fail('Not found', 404);
  const { results: items } = await env.DB.prepare(
    'SELECT item_name, quantity, line_total FROM receipt_items WHERE receipt_id = ? ORDER BY id'
  ).bind(params.id).all();
  return json({ ...row, items });
}

// PUT /api/receipts/:id -> manual edit. Saving marks the receipt as ok if the key fields are present.
export async function onRequestPut({ params, request, env }) {
  const body = await request.json();
  const row = await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(params.id).first();
  if (!row) return fail('Not found', 404);

  const next = { ...row };
  for (const k of EDITABLE) if (k in body) next[k] = body[k] === '' ? null : body[k];
  if ('txn_date' in body && body.txn_date) {
    next.txn_date = normaliseDate(body.txn_date);
    if (!next.txn_date) return fail('Invalid date');
  }
  if ('total' in body && body.total !== '' && body.total !== null) {
    next.total = toNumber(String(body.total));
    if (next.total === null) return fail('Invalid total');
  }

  const missing = [];
  if (!next.merchant) missing.push('merchant missing');
  if (!next.txn_date) missing.push('date missing');
  if (next.total === null || next.total === undefined) missing.push('total missing');
  if (!next.category) missing.push('category not set');

  await env.DB.prepare(
    `UPDATE receipts SET txn_date = ?, merchant = ?, total = ?, currency = ?, category = ?, area = ?,
       payment_method = ?, notes = ?, status = ?, error = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(next.txn_date, next.merchant, next.total, next.currency, next.category, next.area,
    next.payment_method, next.notes, missing.length ? 'review' : 'ok',
    missing.length ? missing.join(', ') : null, params.id).run();

  const saved = await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(params.id).first();
  delete saved.raw_ai;
  return json(saved);
}

// DELETE /api/receipts/:id -> removes the row, its items and the stored file
export async function onRequestDelete({ params, env }) {
  const row = await env.DB.prepare('SELECT file_key FROM receipts WHERE id = ?').bind(params.id).first();
  if (!row) return fail('Not found', 404);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM receipt_items WHERE receipt_id = ?').bind(params.id),
    env.DB.prepare('DELETE FROM receipts WHERE id = ?').bind(params.id),
  ]);
  await env.BUCKET.delete(row.file_key);
  return json({ deleted: params.id });
}
