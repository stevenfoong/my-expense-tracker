import { extractReceipt } from './ai.js';

/** Runs AI extraction for a receipt row and saves the outcome. Returns the updated row. */
export async function processReceipt(env, settings, id) {
  const row = await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(id).first();
  if (!row) throw new Error('Receipt not found');

  const obj = await env.BUCKET.get(row.file_key);
  if (!obj) throw new Error('Stored file not found');
  const buffer = await obj.arrayBuffer();

  let result;
  // How long the AI took (including PDF conversion), kept to decide on background processing
  const started = Date.now();
  const elapsed = () => Math.round((Date.now() - started) / 100) / 10;
  try {
    // Local (UTC+8) upload date: the reference for spotting a misread year.
    const uploadedOn = new Date(Date.parse(row.created_at.replace(' ', 'T') + 'Z') + 8 * 3600_000).toISOString().slice(0, 10);
    result = await extractReceipt(env, settings, buffer, row.file_type, row.file_name, uploadedOn);
  } catch (e) {
    await env.DB.prepare(
      `UPDATE receipts SET status = 'failed', error = ?, ai_seconds = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(String(e.message || e), elapsed(), id).run();
    return env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(id).first();
  }

  const f = result.fields;
  const stmts = [
    env.DB.prepare(
      `UPDATE receipts SET txn_date = ?, merchant = ?, total = ?, currency = ?, category = ?,
         area = ?, payment_method = ?, status = ?, error = ?, raw_ai = ?,
         foreign_currency = ?, foreign_amount = ?, ai_seconds = ?,
         notes = COALESCE(?, notes), updated_at = datetime('now')
       WHERE id = ?`
    ).bind(f.txn_date, f.merchant, f.total, f.currency, f.category, f.area, f.payment_method,
      result.status, result.error, JSON.stringify(result.raw),
      f.foreign_currency, f.foreign_amount, elapsed(), f.notes, id),
    env.DB.prepare('DELETE FROM receipt_items WHERE receipt_id = ?').bind(id),
    ...result.items.map((i) =>
      env.DB.prepare(
        'INSERT INTO receipt_items (receipt_id, item_name, quantity, line_total) VALUES (?, ?, ?, ?)'
      ).bind(id, i.item_name, i.quantity, i.line_total)
    ),
  ];
  await env.DB.batch(stmts);
  await flagDuplicate(env, id);
  return env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(id).first();
}

/** Marks a receipt for review when another one has the same date and amount (e.g. the same receipt uploaded twice). */
async function flagDuplicate(env, id) {
  const r = await env.DB.prepare('SELECT id, txn_date, total, foreign_amount, status FROM receipts WHERE id = ?').bind(id).first();
  const amount = r?.total ?? r?.foreign_amount;
  if (!r || !r.txn_date || amount == null || r.status === 'failed') return;
  const other = await env.DB.prepare(
    `SELECT merchant, txn_date FROM receipts
     WHERE id != ? AND txn_date = ? AND ROUND(COALESCE(total, foreign_amount) * 100) = ROUND(? * 100)
     ORDER BY created_at LIMIT 1`
  ).bind(id, r.txn_date, amount).first();
  if (!other) return;
  const note = `Possible duplicate of ${other.merchant || 'another receipt'} (same date and amount). Delete this one if it is, or Save to keep both.`;
  await env.DB.prepare(
    `UPDATE receipts SET status = 'review', error = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(note, id).run();
}
