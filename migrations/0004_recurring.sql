-- Installments and recurring payments (monthly). Each paid installment is also a transaction.

CREATE TABLE recurring_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  category_id TEXT NOT NULL REFERENCES categories(id),
  start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  -- NULL = no end date.
  total_months INTEGER CHECK (total_months IS NULL OR total_months > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE recurring_payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES recurring_items(id) ON DELETE CASCADE,
  installment INTEGER NOT NULL CHECK (installment > 0),
  due_month TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  paid_on TEXT NOT NULL,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (item_id, installment),
  UNIQUE (transaction_id)
);

CREATE INDEX recurring_items_user ON recurring_items (user_id);
CREATE INDEX recurring_payments_user ON recurring_payments (user_id, paid_on);
