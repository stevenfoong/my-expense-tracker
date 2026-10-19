/* Expense tracker schema (Cloudflare D1 / SQLite).
   No -- comments, so it also runs when pasted into the D1 dashboard console. */

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  txn_date TEXT,
  merchant TEXT,
  total REAL,
  currency TEXT,
  category TEXT,
  area TEXT,
  payment_method TEXT,
  notes TEXT,
  status TEXT NOT NULL,
  error TEXT,
  file_key TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_name TEXT,
  raw_ai TEXT,
  foreign_currency TEXT,
  foreign_amount REAL
);

CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts (txn_date);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts (status);

CREATE TABLE IF NOT EXISTS receipt_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  item_name TEXT,
  quantity REAL,
  line_total REAL
);

CREATE INDEX IF NOT EXISTS idx_items_receipt ON receipt_items (receipt_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS statements (
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
  );

CREATE INDEX IF NOT EXISTS idx_statements_date ON statements (statement_date);

CREATE TABLE IF NOT EXISTS statement_lines (
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
  );

CREATE INDEX IF NOT EXISTS idx_statement_lines_stmt ON statement_lines (statement_id);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('cycle_end_day', '25'),
  ('ai_url', ''),
  ('ai_model', 'gemma4:e4b'),
  ('default_currency', 'RM'),
  ('categories', '["Food & Drinks","Groceries","Transport","Fuel","Parking & Toll","Shopping","Bills & Utilities","Health","Entertainment","Travel","Others"]');
