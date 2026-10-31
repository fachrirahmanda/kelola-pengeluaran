-- A counter per data set that goes up on every change (any successful write through the API). Open pages poll
-- it, and reload their data when it moved because of a change made somewhere else (another device or member).
CREATE TABLE data_versions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 0
);
