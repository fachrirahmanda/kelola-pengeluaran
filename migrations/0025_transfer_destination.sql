-- The savings account a transfer goes to. sourceId is where the money comes from. NULL for every other method.
ALTER TABLE transactions ADD COLUMN to_source_id TEXT REFERENCES payment_sources(id);
