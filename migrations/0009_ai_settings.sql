-- Ask AI: one NVIDIA key and model for the whole app, set from Settings by the admin. The key is
-- stored encrypted and never sent back to the browser.
CREATE TABLE ai_settings (
  id TEXT PRIMARY KEY CHECK (id = 'app'),
  key_encrypted TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  model TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT ''
);

-- One row per question: for the daily limit per person, and the counts the admin sees.
CREATE TABLE ai_questions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX ai_questions_day ON ai_questions (day, user_id);
