import { canonCurrency } from './util.js';
import { evaluate } from './status.js';

// Adds columns introduced after the first release. Runs once per worker instance;
// safe to run repeatedly and concurrently.
let done = false;

const STATEMENT_TABLES = [
  `CREATE TABLE IF NOT EXISTS statements (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    statement_date TEXT,
    file_key TEXT NOT NULL,
    file_name TEXT,
    raw_text TEXT,
    summary TEXT,
    cards TEXT,
    warnings TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    accepted INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_statements_date ON statements (statement_date)`,
  `CREATE TABLE IF NOT EXISTS statement_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    statement_id TEXT NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
    card TEXT NOT NULL,
    line_no REAL NOT NULL,
    txn_date TEXT,
    description TEXT,
    merchant TEXT,
    location TEXT,
    country TEXT,
    amount REAL NOT NULL,
    is_credit INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL,
    foreign_currency TEXT,
    foreign_amount REAL,
    manual INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_statement_lines_stmt ON statement_lines (statement_id)`,
];

// Columns added after a table was first created: [table, column, type]
const ADDED_COLUMNS = [
  ['receipts', 'statement_line_id', 'INTEGER'],
  ['statements', 'matched_at', 'TEXT'],
  ['statements', 'saved_at', 'TEXT'],
  ['statements', 'record_decisions', 'TEXT'],
  ['statement_lines', 'match_receipt_id', 'TEXT'],
  ['statement_lines', 'match_type', 'TEXT'],
  ['statement_lines', 'decision', 'TEXT'],
  ['statement_lines', 'category', 'TEXT'],
  ['statement_lines', 'category_source', 'TEXT'],
];

async function columnsOf(db, table) {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set(results.map((c) => c.name));
}

async function addMissingColumns(db) {
  const cache = {};
  for (const [table, col, type] of ADDED_COLUMNS) {
    cache[table] ??= await columnsOf(db, table);
    if (cache[table].has(col)) continue;
    try { await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run(); }
    catch (e) { if (!/duplicate column/i.test(String(e.message))) throw e; }
  }
}

export async function ensureSchema(db) {
  if (done) return;
  await db.batch(STATEMENT_TABLES.map((sql) => db.prepare(sql)));
  await addMissingColumns(db);
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_receipts_stmt_line ON receipts (statement_line_id)`).run();
  await db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('card_modes', '{}')`).run();
  const cols = await columnsOf(db, 'receipts');

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
