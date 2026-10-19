import { json, fail, normaliseDate, toNumber } from '../../../_lib/util.js';
import { evaluate } from '../../../_lib/status.js';

const EDITABLE = ['txn_date', 'merchant', 'total', 'category', 'area', 'payment_method', 'notes', 'foreign_currency', 'foreign_amount'];

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
  const body = await request.json();
  const row = await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(params.id).first();
  if (!row) return fail('Not found', 404);

  const next = { ...row };
  for (const k of EDITABLE) if (k in body) next[k] = body[k] === '' ? null : body[k];
  if ('txn_date' in body && body.txn_date) {
    next.txn_date = normaliseDate(body.txn_date);
    if (!next.txn_date) return fail('Invalid date');
  }
  for (const k of ['total', 'foreign_amount']) {
    if (k in body && body[k] !== '' && body[k] !== null) {
      next[k] = toNumber(String(body[k]));
      if (next[k] === null) return fail(`Invalid ${k === 'total' ? 'RM amount' : 'foreign amount'}`);
    }
  }
  next.foreign_currency = next.foreign_currency ? String(next.foreign_currency).trim().toUpperCase() : null;
  if (!next.foreign_currency) next.foreign_amount = null;

  const { status, error } = evaluate(next);

  await env.DB.prepare(
    `UPDATE receipts SET txn_date = ?, merchant = ?, total = ?, category = ?, area = ?,
       payment_method = ?, notes = ?, foreign_currency = ?, foreign_amount = ?,
       status = ?, error = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(next.txn_date, next.merchant, next.total, next.category, next.area,
    next.payment_method, next.notes, next.foreign_currency, next.foreign_amount,
    status, error, params.id).run();

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
