-- Recurring income (gaji): a fixed amount into a savings account on a day of every month. When that day is a
-- Saturday or Sunday it is paid on the Friday before. Each month is recorded once as an income, from
-- start_month on, as soon as its pay date has come.
CREATE TABLE salaries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES payment_sources(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  pay_day INTEGER NOT NULL CHECK (pay_day BETWEEN 1 AND 31),
  start_month TEXT NOT NULL CHECK (start_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX salaries_user ON salaries (user_id);

-- The income a salary recorded, and for which month, so a month is never recorded twice. Removing the salary
-- keeps the incomes it already recorded.
ALTER TABLE incomes ADD COLUMN salary_id TEXT REFERENCES salaries(id) ON DELETE SET NULL;
ALTER TABLE incomes ADD COLUMN salary_month TEXT;
CREATE UNIQUE INDEX incomes_salary_month ON incomes (salary_id, salary_month) WHERE salary_id IS NOT NULL;
