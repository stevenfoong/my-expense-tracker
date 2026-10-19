import { normaliseDate, toNumber } from './util.js';
import { evaluate } from './status.js';

const EDITABLE = ['txn_date', 'merchant', 'total', 'category', 'area', 'payment_method', 'notes', 'foreign_currency', 'foreign_amount'];

/** Applies user-entered fields to a receipt row, recalculates its status and saves it.
 *  Returns { row } on success or { error } for invalid input. */
export async function applyEdit(env, row, body) {
  const next = { ...row };
  for (const k of EDITABLE) if (k in body) next[k] = body[k] === '' ? null : body[k];
  if ('txn_date' in body && body.txn_date) {
    next.txn_date = normaliseDate(body.txn_date);
    if (!next.txn_date) return { error: 'Invalid date' };
  }
  for (const k of ['total', 'foreign_amount']) {
    if (k in body && body[k] !== '' && body[k] !== null) {
      next[k] = toNumber(String(body[k]));
      if (next[k] === null) return { error: `Invalid ${k === 'total' ? 'RM amount' : 'foreign amount'}` };
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
    status, error, row.id).run();

  const saved = await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(row.id).first();
  delete saved.raw_ai;
  return { row: saved };
}
