-- A data set's banks and e-wallets. Its first list is the built-in one (see shared/banks.ts), written the first time it
-- is needed. Each bank says which kinds of source it can hold; a source keeps its bank by id.
CREATE TABLE banks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  short TEXT NOT NULL,
  color TEXT NOT NULL,
  text_color TEXT NOT NULL,
  logo TEXT,
  savings INTEGER NOT NULL DEFAULT 1 CHECK (savings IN (0, 1)),
  credit_card INTEGER NOT NULL DEFAULT 0 CHECK (credit_card IN (0, 1)),
  paylater INTEGER NOT NULL DEFAULT 0 CHECK (paylater IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, id)
);
