-- Initial schema. Money is stored as whole rupiah (INTEGER). Dates are YYYY-MM-DD text in WIB.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  icon TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name)
);

CREATE TABLE credit_cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  closing_day INTEGER NOT NULL CHECK (closing_day BETWEEN 1 AND 28),
  payment_day INTEGER NOT NULL CHECK (payment_day BETWEEN 1 AND 28),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurred_on TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  category_id TEXT NOT NULL REFERENCES categories(id),
  note TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL CHECK (method IN ('cash', 'debit', 'transfer', 'credit')),
  card_id TEXT REFERENCES credit_cards(id),
  -- 'unpaid' = on a credit card bill that is not settled yet (not in spending totals).
  -- 'posted' = counted as spending on posted_on.
  status TEXT NOT NULL CHECK (status IN ('posted', 'unpaid')),
  posted_on TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((method = 'credit') = (card_id IS NOT NULL)),
  CHECK (method = 'credit' OR status = 'posted'),
  CHECK ((status = 'posted') = (posted_on IS NOT NULL))
);

CREATE INDEX transactions_user_date ON transactions (user_id, occurred_on);
CREATE INDEX transactions_user_category ON transactions (user_id, category_id);
