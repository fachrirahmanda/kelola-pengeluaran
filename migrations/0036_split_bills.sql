-- Split bill: a bill from a restaurant or shop, its people, its items, and who each item is shared with.
-- Money is whole rupiah. An item's amount is its whole line; people are listed in order (position).
CREATE TABLE split_bills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bill_date TEXT NOT NULL,
  tax INTEGER NOT NULL DEFAULT 0 CHECK (tax >= 0),
  service INTEGER NOT NULL DEFAULT 0 CHECK (service >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE split_people (
  id TEXT PRIMARY KEY,
  split_id TEXT NOT NULL REFERENCES split_bills(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE split_items (
  id TEXT PRIMARY KEY,
  split_id TEXT NOT NULL REFERENCES split_bills(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE split_item_people (
  item_id TEXT NOT NULL REFERENCES split_items(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES split_people(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, person_id)
);

CREATE INDEX split_bills_user ON split_bills (user_id, bill_date);
