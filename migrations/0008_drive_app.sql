-- Google Drive is one connection for the whole app (made by the admin), not one per data owner.
DROP TABLE drive_connections;

CREATE TABLE drive_connections (
  id TEXT PRIMARY KEY CHECK (id = 'app'),
  refresh_token TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  folder_id TEXT,
  connected_at TEXT NOT NULL DEFAULT (datetime('now'))
);
