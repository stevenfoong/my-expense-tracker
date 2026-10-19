import { extractReceipt } from './ai.js';

/** Runs AI extraction for a receipt row and saves the outcome. Returns the updated row. */
export async function processReceipt(env, settings, id) {
  const row = await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(id).first();
  if (!row) throw new Error('Receipt not found');

  const obj = await env.BUCKET.get(row.file_key);
  if (!obj) throw new Error('Stored file not found');
  const buffer = await obj.arrayBuffer();

  let result;
  try {
    result = await extractReceipt(env, settings, buffer, row.file_type, row.file_name);
  } catch (e) {
    await env.DB.prepare(
      `UPDATE receipts SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(String(e.message || e), id).run();
    return env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(id).first();
  }

  const f = result.fields;
  const stmts = [
    env.DB.prepare(
      `UPDATE receipts SET txn_date = ?, merchant = ?, total = ?, currency = ?, category = ?,
         area = ?, payment_method = ?, status = ?, error = ?, raw_ai = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(f.txn_date, f.merchant, f.total, f.currency, f.category, f.area, f.payment_method,
      result.status, result.error, JSON.stringify(result.raw), id),
    env.DB.prepare('DELETE FROM receipt_items WHERE receipt_id = ?').bind(id),
    ...result.items.map((i) =>
      env.DB.prepare(
        'INSERT INTO receipt_items (receipt_id, item_name, quantity, line_total) VALUES (?, ?, ?, ?)'
      ).bind(id, i.item_name, i.quantity, i.line_total)
    ),
  ];
  await env.DB.batch(stmts);
  return env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(id).first();
}
