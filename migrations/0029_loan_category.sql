-- The category a loan belongs to. Its repayments default to it. NULL for loans added before this.
ALTER TABLE loans ADD COLUMN category_id TEXT REFERENCES categories(id);
