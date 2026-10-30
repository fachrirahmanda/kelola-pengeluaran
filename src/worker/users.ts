import { DEFAULT_CATEGORIES, type User } from '../shared/types';

/** The account details Google gives back at sign-in. */
export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  avatar_v: number | null;
  name_edited: number;
}

const SELECT_USER = 'SELECT id, email, name, avatar_url, avatar_v, name_edited FROM users';

/** The photo to show: the person's own upload if they made one, else their Google picture. */
const avatarUrlOf = (row: Pick<UserRow, 'id' | 'avatar_url' | 'avatar_v'>) => (row.avatar_v ? `/api/avatar/${row.id}?v=${row.avatar_v}` : row.avatar_url);

const toUser = (row: UserRow): User => ({ id: row.id, email: row.email, name: row.name, avatarUrl: avatarUrlOf(row) });

export async function getUser(db: D1Database, id: string): Promise<User | null> {
  const row = await db.prepare(`${SELECT_USER} WHERE id = ?`).bind(id).first<UserRow>();
  return row ? toUser(row) : null;
}

/** Finds the user for this Google account, or creates it with the default categories. Records the sign-in. */
export async function upsertUser(db: D1Database, profile: GoogleProfile): Promise<User> {
  const picture = profile.picture || null;
  const existing = await db.prepare(`${SELECT_USER} WHERE google_sub = ?`).bind(profile.sub).first<UserRow>();

  if (existing) {
    // A name the person typed stays. Google's name only fills in until they change it.
    const name = existing.name_edited ? existing.name : profile.name;
    if (existing.email !== profile.email || existing.name !== name || existing.avatar_url !== picture) {
      await db.prepare('UPDATE users SET email = ?, name = ?, avatar_url = ? WHERE id = ?').bind(profile.email, name, picture, existing.id).run();
    }
    await db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(existing.id).run();
    return toUser({ ...existing, email: profile.email, name, avatar_url: picture });
  }

  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare("INSERT INTO users (id, google_sub, email, name, avatar_url, last_login_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
      .bind(id, profile.sub, profile.email, profile.name, picture),
    // Every new account owns its own data set.
    db.prepare("INSERT INTO workspace_members (user_id, owner_id, role) VALUES (?, ?, 'owner')").bind(id, id),
    ...DEFAULT_CATEGORIES.map((category) =>
      db.prepare('INSERT INTO categories (id, user_id, name, color, icon) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), id, category.name, category.color, category.icon),
    ),
  ]);
  return { id, email: profile.email, name: profile.name, avatarUrl: picture };
}
