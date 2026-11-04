-- The day a monthly period starts, chosen for the data set (its owner's account). 1 is the calendar month.
ALTER TABLE users ADD COLUMN period_start_day INTEGER NOT NULL DEFAULT 1 CHECK (period_start_day BETWEEN 1 AND 28);
