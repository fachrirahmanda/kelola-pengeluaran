-- The savings account (debit) a credit card or paylater bill was paid from. Its total then comes off that
-- account's balance. NULL for bills paid before this, or paid without saying from where.
ALTER TABLE card_bills ADD COLUMN paid_from_id TEXT REFERENCES payment_sources(id);
