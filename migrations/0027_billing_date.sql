-- The billing date: the day the bank's statement comes out. The bill closes 2 days before it, so closing_day stays
-- as billing_day - 2. Cards that have a closing day get their billing date from it.
ALTER TABLE payment_sources ADD COLUMN billing_day INTEGER CHECK (billing_day IS NULL OR billing_day BETWEEN 3 AND 28);
UPDATE payment_sources SET billing_day = closing_day + 2 WHERE closing_day IS NOT NULL AND closing_day BETWEEN 1 AND 26;

-- A bill paid in a month other than its default one (the next month). Only the months that were changed are stored.
CREATE TABLE bill_plans (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES payment_sources(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  pay_month TEXT NOT NULL,
  PRIMARY KEY (source_id, period)
);
