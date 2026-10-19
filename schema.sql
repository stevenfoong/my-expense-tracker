-- Expense tracker schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS receipts (
  id             TEXT PRIMARY KEY,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  txn_date       TEXT,              -- YYYY-MM-DD
  merchant       TEXT,
  total          REAL,
  currency       TEXT,              -- e.g. RM, SGD, THB
  category       TEXT,
  area           TEXT,              -- town / area from the receipt address
  payment_method TEXT,
  notes          TEXT,
  status         TEXT NOT NULL,     -- processing | ok | review | failed
  error          TEXT,              -- why it needs review / failed
  file_key       TEXT NOT NULL,     -- R2 object key
  file_type      TEXT NOT NULL,     -- mime type
  file_name      TEXT,
  raw_ai         TEXT               -- raw JSON returned by the AI
);

CREATE INDEX IF NOT EXISTS idx_receipts_date   ON receipts (txn_date);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts (status);

CREATE TABLE IF NOT EXISTS receipt_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id  TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  item_name   TEXT,
  quantity    REAL,
  line_total  REAL
);

CREATE INDEX IF NOT EXISTS idx_items_receipt ON receipt_items (receipt_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('cycle_end_day',    '25'),
  ('ai_url',           ''),
  ('ai_model',         'gemma4:e4b'),
  ('default_currency', 'RM'),
  ('categories',       '["Food & Drinks","Groceries","Transport","Fuel","Parking & Toll","Shopping","Bills & Utilities","Health","Entertainment","Travel","Others"]');
