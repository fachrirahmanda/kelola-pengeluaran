-- When a person last had Neraca open (UTC, "YYYY-MM-DD HH:MM:SS"). Open pages check in every few seconds
-- (GET /api/sync), so someone seen in the last minute is shown as active.
ALTER TABLE users ADD COLUMN last_seen_at TEXT;
