import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';
import { getUser } from '../users';

// The signed-in person's own profile: their name, their photo, and when they joined and last signed in.
// These belong to the person, not to the data set they are working in.

const NAME_MAX = 60;
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const AVATAR_MAX_BYTES = 300 * 1024;

/** GET /api/profile */
export async function getProfile({ env, actorId }: RouteContext) {
  const user = await getUser(env.DB, actorId);
  const row = await env.DB.prepare('SELECT created_at, last_login_at FROM users WHERE id = ?').bind(actorId).first<{ created_at: string; last_login_at: string | null }>();
  if (!user || !row) throw new HttpError(401, 'Belum masuk');
  return json({ user, createdAt: row.created_at, lastLoginAt: row.last_login_at });
}

/** PUT /api/profile { name }: the name the person chose. Google's name no longer replaces it at sign-in. */
export async function saveName({ request, env, actorId }: RouteContext) {
  const body = await readJson(request);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > NAME_MAX) throw new HttpError(400, `Nama 1–${NAME_MAX} karakter`);
  await env.DB.prepare('UPDATE users SET name = ?, name_edited = 1 WHERE id = ?').bind(name, actorId).run();
  return json({ user: await getUser(env.DB, actorId) });
}

/** PUT /api/profile/avatar: a square photo, already cropped in the browser. */
export async function saveAvatar({ request, env, actorId }: RouteContext) {
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Pilih gambar dulu');
  if (!AVATAR_TYPES.includes(file.type)) throw new HttpError(400, 'Format gambar harus JPG, PNG, atau WebP');
  if (file.size > AVATAR_MAX_BYTES) throw new HttpError(400, 'Ukuran gambar maksimal 300 KB');

  await env.DB.prepare('UPDATE users SET avatar_data = ?, avatar_type = ?, avatar_v = ? WHERE id = ?')
    .bind(await file.arrayBuffer(), file.type, Date.now(), actorId)
    .run();
  return json({ user: await getUser(env.DB, actorId) });
}

/** DELETE /api/profile/avatar: back to the Google picture. */
export async function removeAvatar({ env, actorId }: RouteContext) {
  await env.DB.prepare('UPDATE users SET avatar_data = NULL, avatar_type = NULL, avatar_v = NULL WHERE id = ?').bind(actorId).run();
  return json({ user: await getUser(env.DB, actorId) });
}

/** GET /api/avatar/:id: a person's own photo. Only signed-in people can load it. */
export async function getAvatar({ env, params }: RouteContext) {
  const row = await env.DB.prepare('SELECT avatar_data, avatar_type FROM users WHERE id = ?').bind(params.id).first<{ avatar_data: ArrayBuffer | null; avatar_type: string | null }>();
  if (!row || !row.avatar_data || !row.avatar_type) throw new HttpError(404, 'Foto tidak ditemukan');
  return new Response(row.avatar_data, { headers: { 'content-type': row.avatar_type, 'cache-control': 'private, max-age=86400' } });
}
