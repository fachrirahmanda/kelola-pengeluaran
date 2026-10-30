import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface MemberRow {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  avatar_v: number | null;
  role: 'owner' | 'member';
}

/** A person's photo: their own upload if they have one, else their Google picture (see users.ts). */
const photoOf = (id: string, avatarUrl: string | null, avatarV: number | null) => (avatarV ? `/api/avatar/${id}?v=${avatarV}` : avatarUrl);

/** The signed-in person's email, lower-cased. */
async function actorEmail(env: RouteContext['env'], actorId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(actorId).first<{ email: string }>();
  if (!row) throw new HttpError(401, 'Belum masuk');
  return row.email.toLowerCase();
}

function requireOwner(role: RouteContext['role']) {
  if (role !== 'owner') throw new HttpError(403, 'Hanya pemilik data yang bisa melakukan ini');
}

/** GET /api/workspace: whose data this is, who is in it, and invitations for the signed-in person. */
export async function getWorkspace({ env, actorId, userId, role }: RouteContext) {
  const owner = await env.DB.prepare('SELECT id, name, email, avatar_url, avatar_v FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; name: string; email: string; avatar_url: string | null; avatar_v: number | null }>();
  const members =
    role === 'owner'
      ? (
          await env.DB.prepare(
            `SELECT u.id, u.email, u.name, u.avatar_url, u.avatar_v, m.role FROM workspace_members m JOIN users u ON u.id = m.user_id
             WHERE m.owner_id = ? ORDER BY m.role, u.email`,
          )
            .bind(userId)
            .all<MemberRow>()
        ).results
      : [];
  const invites =
    role === 'owner'
      ? (
          await env.DB.prepare('SELECT id, email, created_at FROM workspace_invites WHERE owner_id = ? ORDER BY created_at')
            .bind(userId)
            .all<{ id: string; email: string; created_at: string }>()
        ).results.map((row) => ({ id: row.id, email: row.email, createdAt: row.created_at }))
      : [];

  const email = await actorEmail(env, actorId);
  const { results: incoming } = await env.DB.prepare(
    `SELECT i.id, i.created_at, u.name AS owner_name, u.email AS owner_email
     FROM workspace_invites i JOIN users u ON u.id = i.owner_id
     WHERE i.email = ? ORDER BY i.created_at`,
  )
    .bind(email)
    .all<{ id: string; created_at: string; owner_name: string; owner_email: string }>();

  return json({
    workspace: {
      ownerId: owner?.id ?? userId,
      ownerName: owner?.name ?? '',
      ownerEmail: owner?.email ?? '',
      ownerAvatarUrl: owner ? photoOf(owner.id, owner.avatar_url, owner.avatar_v) : null,
      role,
      members: members.map((row) => ({ userId: row.id, email: row.email, name: row.name, avatarUrl: photoOf(row.id, row.avatar_url, row.avatar_v), role: row.role })),
      invites,
    },
    invitations: incoming.map((row) => ({ id: row.id, ownerName: row.owner_name, ownerEmail: row.owner_email, createdAt: row.created_at })),
  });
}

/** POST /api/workspace/invites { email }: invite someone to this data. */
export async function invite({ request, env, actorId, userId, role }: RouteContext) {
  requireOwner(role);
  const body = await readJson(request);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL.test(email)) throw new HttpError(400, 'Email tidak valid');
  if (email === (await actorEmail(env, actorId))) throw new HttpError(400, 'Anda sudah pemilik data ini');

  const already = await env.DB.prepare(
    `SELECT 1 FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.owner_id = ? AND u.email = ?`,
  )
    .bind(userId, email)
    .first();
  if (already) throw new HttpError(409, 'Email ini sudah menjadi anggota');

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare('INSERT INTO workspace_invites (id, owner_id, email) VALUES (?, ?, ?)').bind(id, userId, email).run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new HttpError(409, 'Undangan untuk email ini sudah dikirim');
    throw error;
  }
  return json({ invite: { id, email, createdAt: new Date().toISOString() } }, 201);
}

/** DELETE /api/workspace/invites/:id: cancel an invitation. */
export async function revokeInvite({ env, userId, role, params }: RouteContext) {
  requireOwner(role);
  const result = await env.DB.prepare('DELETE FROM workspace_invites WHERE id = ? AND owner_id = ?').bind(params.id, userId).run();
  if (result.meta.changes === 0) throw new HttpError(404, 'Undangan tidak ditemukan');
  return json({ ok: true });
}

/**
 * POST /api/workspace/invites/:id/accept: join the inviting owner's data. Refused while the
 * person has members of their own, because they would be left without an owner.
 */
export async function acceptInvite({ env, actorId, params }: RouteContext) {
  const email = await actorEmail(env, actorId);
  const invite = await env.DB.prepare('SELECT id, owner_id FROM workspace_invites WHERE id = ? AND email = ?')
    .bind(params.id, email)
    .first<{ id: string; owner_id: string }>();
  if (!invite) throw new HttpError(404, 'Undangan tidak ditemukan');
  if (invite.owner_id === actorId) throw new HttpError(400, 'Ini data Anda sendiri');

  const ownMembers = await env.DB.prepare('SELECT COUNT(*) AS total FROM workspace_members WHERE owner_id = ? AND user_id <> ?')
    .bind(actorId, actorId)
    .first<{ total: number }>();
  if (ownMembers && ownMembers.total > 0) {
    throw new HttpError(409, 'Keluarkan dulu anggota dari data Anda sebelum bergabung ke data lain.');
  }

  await env.DB.batch([
    env.DB.prepare("UPDATE workspace_members SET owner_id = ?, role = 'member' WHERE user_id = ?").bind(invite.owner_id, actorId),
    env.DB.prepare('DELETE FROM workspace_invites WHERE id = ?').bind(invite.id),
  ]);
  return json({ ok: true });
}

/** POST /api/workspace/invites/:id/decline */
export async function declineInvite({ env, actorId, params }: RouteContext) {
  const email = await actorEmail(env, actorId);
  const result = await env.DB.prepare('DELETE FROM workspace_invites WHERE id = ? AND email = ?').bind(params.id, email).run();
  if (result.meta.changes === 0) throw new HttpError(404, 'Undangan tidak ditemukan');
  return json({ ok: true });
}

/**
 * DELETE /api/workspace/members/:userId: remove a member. They go back to an empty data set of
 * their own; their old data stays with the owner.
 */
export async function removeMember({ env, userId, role, params }: RouteContext) {
  requireOwner(role);
  if (params.userId === userId) throw new HttpError(400, 'Pemilik tidak bisa mengeluarkan diri sendiri');
  const result = await env.DB.prepare("UPDATE workspace_members SET owner_id = user_id, role = 'owner' WHERE user_id = ? AND owner_id = ? AND role = 'member'")
    .bind(params.userId, userId)
    .run();
  if (result.meta.changes === 0) throw new HttpError(404, 'Anggota tidak ditemukan');
  return json({ ok: true });
}

/** POST /api/workspace/leave: a member leaves the data and gets their own back. */
export async function leaveWorkspace({ env, actorId, role }: RouteContext) {
  if (role !== 'member') throw new HttpError(400, 'Pemilik data tidak bisa keluar dari datanya sendiri');
  await env.DB.prepare("UPDATE workspace_members SET owner_id = user_id, role = 'owner' WHERE user_id = ? AND role = 'member'").bind(actorId).run();
  return json({ ok: true });
}
