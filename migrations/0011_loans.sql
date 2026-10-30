-- Loans (pinjaman): money received is a loan, not spending. Each repayment is a normal expense
-- transaction, linked here, so its amount is what counts against the remaining balance.
CREATE TABLE loans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  principal INTEGER NOT NULL CHECK (principal > 0),
  received_on TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE loan_payments (
  id TEXT PRIMARY KEY,
  loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  paid_on TEXT NOT NULL
);

CREATE INDEX loan_payments_loan ON loan_payments (loan_id);
