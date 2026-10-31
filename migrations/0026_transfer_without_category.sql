-- A system category is hidden from the lists. Transfers are filed under it, since every transaction has a category,
-- and transfers are left out of spending totals.
ALTER TABLE categories ADD COLUMN system INTEGER NOT NULL DEFAULT 0 CHECK (system IN (0, 1));
