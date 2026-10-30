-- Profile: a name typed by the person (kept over Google's name at sign-in), a photo of their own, and the
-- time they last signed in.
ALTER TABLE users ADD COLUMN name_edited INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN avatar_data BLOB;
ALTER TABLE users ADD COLUMN avatar_type TEXT;
ALTER TABLE users ADD COLUMN avatar_v INTEGER;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
