-- Credit card and paylater bills that have been paid. Open bills are not stored: they are the
-- unpaid transactions of a source, grouped by period (see src/shared/billing.ts).

CREATE TABLE card_bills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES payment_sources(id),
  period TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  total INTEGER NOT NULL CHECK (total > 0),
  transaction_count INTEGER NOT NULL CHECK (transaction_count > 0),
  paid_on TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source_id, period)
);

CREATE INDEX card_bills_user ON card_bills (user_id, paid_on);
