-- Google Drive, one connection per data owner: their refresh token, encrypted with SESSION_SECRET.
CREATE TABLE drive_connections (
  owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  folder_id TEXT,
  connected_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Receipt files on a transaction. The file itself lives in the owner's Drive.
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  drive_file_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX attachments_transaction ON attachments (transaction_id);
