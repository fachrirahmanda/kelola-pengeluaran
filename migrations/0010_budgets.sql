-- Monthly budgets, the same each month: one per category, and one total (category_id NULL).
CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX budgets_per_category ON budgets (user_id, category_id) WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX budgets_total ON budgets (user_id) WHERE category_id IS NULL;
