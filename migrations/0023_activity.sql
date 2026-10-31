-- What happened in a data set, by whom: the owner's and the members' own actions (transactions, bills paid,
-- income, members joining or leaving). The bell's Activity tab lists them for everyone in the data set.
CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  -- The data set: its owner's user id.
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX activity_owner_created ON activity (owner_id, created_at);
