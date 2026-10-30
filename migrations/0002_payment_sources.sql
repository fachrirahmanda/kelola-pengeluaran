-- Sources of funds: savings, credit cards and paylater. Replaces credit_cards.
-- Existing cards become credit_card sources. Transactions point to a source via source_id.

CREATE TABLE payment_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('savings', 'credit_card', 'paylater')),
  -- Billing days: only for credit cards and paylater. Both or neither.
  closing_day INTEGER CHECK (closing_day IS NULL OR closing_day BETWEEN 1 AND 28),
  payment_day INTEGER CHECK (payment_day IS NULL OR payment_day BETWEEN 1 AND 28),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((kind = 'savings') = (closing_day IS NULL)),
  CHECK ((closing_day IS NULL) = (payment_day IS NULL))
);

INSERT INTO payment_sources (id, user_id, name, kind, closing_day, payment_day, created_at)
  SELECT id, user_id, name, 'credit_card', closing_day, payment_day, created_at FROM credit_cards;

CREATE TABLE transactions_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurred_on TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  category_id TEXT NOT NULL REFERENCES categories(id),
  note TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL CHECK (method IN ('cash', 'debit', 'transfer', 'credit')),
  -- Where the money came from. Required for credit (a card or paylater), optional otherwise (e.g. savings).
  source_id TEXT REFERENCES payment_sources(id),
  -- 'unpaid' = on a credit bill that is not settled yet (not in spending totals).
  -- 'posted' = counted as spending on posted_on.
  status TEXT NOT NULL CHECK (status IN ('posted', 'unpaid')),
  posted_on TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (method <> 'credit' OR source_id IS NOT NULL),
  CHECK (method = 'credit' OR status = 'posted'),
  CHECK ((status = 'posted') = (posted_on IS NOT NULL))
);

INSERT INTO transactions_new (id, user_id, occurred_on, amount, category_id, note, method, source_id, status, posted_on, created_at, updated_at)
  SELECT id, user_id, occurred_on, amount, category_id, note, method, card_id, status, posted_on, created_at, updated_at FROM transactions;

DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

CREATE INDEX transactions_user_date ON transactions (user_id, occurred_on);
CREATE INDEX transactions_user_category ON transactions (user_id, category_id);

DROP TABLE credit_cards;
