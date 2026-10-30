-- Balances: a savings source (wallet) has an opening balance, and income (gaji, transfer masuk) adds to it.
-- A credit card or paylater has a limit; what is still unpaid counts against it.
ALTER TABLE payment_sources ADD COLUMN opening_balance INTEGER NOT NULL DEFAULT 0 CHECK (opening_balance >= 0);
ALTER TABLE payment_sources ADD COLUMN credit_limit INTEGER CHECK (credit_limit IS NULL OR credit_limit > 0);

CREATE TABLE incomes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES payment_sources(id) ON DELETE CASCADE,
  occurred_on TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX incomes_source ON incomes (source_id);
