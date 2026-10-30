-- Profile picture from the Google account (NULL when there is none, e.g. dev accounts).
ALTER TABLE users ADD COLUMN avatar_url TEXT;
