-- Whose a source of funds is: one person in the data set (the owner or a member), or nobody for a shared one.
ALTER TABLE payment_sources ADD COLUMN holder_id TEXT REFERENCES users(id) ON DELETE SET NULL;
