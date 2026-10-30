-- Notifications for one person: invitations, changes made by others in shared data, and upcoming card bills.
-- kind says what happened; data holds the values the app shows it with (names, amounts, dates).
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  -- Same key for the same event, so a reminder for one bill is only stored once per person.
  dedupe_key TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);

CREATE INDEX notifications_user_created ON notifications (user_id, created_at);
CREATE INDEX notifications_user_unread ON notifications (user_id, read_at);
CREATE UNIQUE INDEX notifications_dedupe ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
