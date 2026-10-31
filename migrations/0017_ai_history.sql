-- Ask AI history: each question keeps its text and answer, so the person can read them again.
-- Clearing the history empties both but keeps the row, which still counts toward the daily limit.
-- Rows from before this migration have no text and are not shown.
ALTER TABLE ai_questions ADD COLUMN question TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_questions ADD COLUMN answer TEXT NOT NULL DEFAULT '';

CREATE INDEX ai_questions_user_created ON ai_questions (user_id, created_at);
