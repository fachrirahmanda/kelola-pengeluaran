-- Budget history: every change to a budget, with the month it takes effect. The budget of a month is the
-- latest change at or before it (amount 0 = no budget from then on), so a past month keeps the budget it
-- had even after the budget changes. category_id NULL is the total budget.
CREATE TABLE budget_changes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX budget_changes_scope_month ON budget_changes (user_id, IFNULL(category_id, ''), month);

-- The budgets set before this had no history: they count for every month before now.
INSERT INTO budget_changes (id, user_id, category_id, month, amount)
  SELECT id, user_id, category_id, '2000-01', amount FROM budgets;
