-- One data set per user. Members of another person's data point at that owner.
-- Every data table keeps its user_id column; for a member it holds the owner's id.

CREATE TABLE workspace_members (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((role = 'owner') = (owner_id = user_id))
);

-- Everyone who exists today owns their own data.
INSERT INTO workspace_members (user_id, owner_id, role) SELECT id, id, 'owner' FROM users;

CREATE TABLE workspace_invites (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner_id, email)
);

CREATE INDEX workspace_invites_email ON workspace_invites (email);
