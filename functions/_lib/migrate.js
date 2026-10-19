import { canonCurrency } from './util.js';
import { evaluate } from './status.js';

// Adds columns introduced after the first release. Runs once per worker instance;
// safe to run repeatedly and concurrently.
let done = false;

export async function ensureSchema(db) {
  if (done) return;
  const { results } = await db.prepare('PRAGMA table_info(receipts)').all();
  const cols = new Set(results.map((c) => c.name));

  if (!cols.has('foreign_currency') || !cols.has('foreign_amount')) {
    for (const sql of [
      'ALTER TABLE receipts ADD COLUMN foreign_currency TEXT',
      'ALTER TABLE receipts ADD COLUMN foreign_amount REAL',
    ]) {
      try { await db.prepare(sql).run(); } catch (e) { if (!/duplicate column/i.test(String(e.message))) throw e; }
    }

    // Move receipts saved in another currency into the foreign fields.
    const home = (await db.prepare(`SELECT value FROM settings WHERE key = 'default_currency'`).first())?.value || 'RM';
    const { results: rows } = await db.prepare(
      `SELECT * FROM receipts WHERE currency IS NOT NULL AND foreign_amount IS NULL`
    ).all();
    const moves = rows
      .filter((r) => canonCurrency(r.currency) !== canonCurrency(home))
      .map((r) => {
        const next = { ...r, foreign_currency: r.currency, foreign_amount: r.total, total: null, currency: home };
        const s = r.status === 'failed' || r.status === 'processing' ? { status: r.status, error: r.error } : evaluate(next);
        return db.prepare(
          `UPDATE receipts SET foreign_currency = ?, foreign_amount = ?, total = NULL, currency = ?, status = ?, error = ? WHERE id = ?`
        ).bind(next.foreign_currency, next.foreign_amount, home, s.status, s.error, r.id);
      });
    if (moves.length) await db.batch(moves);
  }
  done = true;
}
