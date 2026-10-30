import { DRIVE_SCOPE, connectDrive, deleteFiles, disconnectDrive, downloadFile, driveStatus, uploadFile } from '../drive';
import { isAdmin } from '../admin';
import type { RouteContext } from '../context';
import { HttpError, json } from '../http';
import { base64url, cookieValue, randomString, redirect } from './auth';

// Google Drive for receipt attachments. One connection for the whole app, made by the admin
// (ADMIN_EMAIL) with their Google account. Connecting uses the same code flow as sign-in (state and
// PKCE in a short cookie), with the Drive permission added.

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DRIVE_COOKIE = 'neraca_drive';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_PER_TRANSACTION = 5;

const redirectUri = (request: Request) => `${new URL(request.url).origin}/api/drive/callback`;
const driveCookie = (value: string, maxAge: number) => `${DRIVE_COOKIE}=${value}; Path=/api/drive; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

/** GET /api/drive: whether Drive is connected, and whether this person can manage it. */
export async function getDrive({ env, actorId }: RouteContext) {
  // Storage belongs to the admin: everyone else learns nothing about the connection.
  if (!(await isAdmin(env, actorId))) return json({ canManage: false });
  return json({ ...(await driveStatus(env)), canManage: true });
}

/** GET /api/drive/connect: the admin goes to Google to allow the app to store files in their Drive. */
export async function startDrive({ request, env, actorId }: RouteContext) {
  if (!(await isAdmin(env, actorId))) throw new HttpError(403, 'Hanya admin yang bisa menghubungkan Google Drive');
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new HttpError(400, 'Login Google belum diatur');
  const state = randomString(16);
  const verifier = randomString(32);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));

  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(request),
    response_type: 'code',
    // Offline access + consent, so Google returns a refresh token the Worker keeps.
    scope: `openid email ${DRIVE_SCOPE}`,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent select_account',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return redirect(url.toString(), [driveCookie(`${state}.${verifier}`, 600)]);
}

/** GET /api/drive/callback: Google sends the admin back here with a code. */
export async function driveCallback({ request, env, actorId }: RouteContext) {
  const clear = driveCookie('', 0);
  const fail = (reason: string) => redirect(`/settings?tab=storage&drive=${reason}`, [clear]);
  if (!(await isAdmin(env, actorId))) return fail('forbidden');

  const [state, verifier] = (cookieValue(request, DRIVE_COOKIE) ?? '').split('.');
  const params = new URL(request.url).searchParams;
  const code = params.get('code');
  if (!code || !state || params.get('state') !== state) return fail('state');

  try {
    await connectDrive(env, code, verifier, redirectUri(request));
  } catch (err) {
    console.error('drive connect failed', err);
    return fail('failed');
  }
  return redirect('/settings?tab=storage&drive=connected', [clear]);
}

/** DELETE /api/drive: disconnects Drive (revoked at Google too). Files already uploaded stay in Drive. */
export async function removeDrive({ env, actorId }: RouteContext) {
  if (!(await isAdmin(env, actorId))) throw new HttpError(403, 'Hanya admin yang bisa memutus Google Drive');
  await disconnectDrive(env);
  return json({ ok: true });
}

/** GET /api/transactions/:id/attachments */
export async function listAttachments({ env, userId, params }: RouteContext) {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.name, a.mime_type, a.size FROM attachments a
     JOIN transactions t ON t.id = a.transaction_id
     WHERE a.transaction_id = ? AND t.user_id = ? ORDER BY a.created_at`,
  )
    .bind(params.id, userId)
    .all<{ id: string; name: string; mime_type: string; size: number }>();
  return json({ attachments: results.map((row) => ({ id: row.id, name: row.name, mimeType: row.mime_type, size: row.size })) });
}

/** POST /api/transactions/:id/attachments: a receipt (image or PDF) stored in the app's Drive. */
export async function addAttachment({ request, env, userId, params }: RouteContext) {
  const transaction = await env.DB.prepare('SELECT id FROM transactions WHERE id = ? AND user_id = ?').bind(params.id, userId).first();
  if (!transaction) throw new HttpError(404, 'Transaksi tidak ditemukan');

  const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM attachments WHERE transaction_id = ?').bind(params.id).first<{ total: number }>();
  if ((count?.total ?? 0) >= MAX_PER_TRANSACTION) throw new HttpError(400, `Maksimal ${MAX_PER_TRANSACTION} lampiran per transaksi`);

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Pilih file dulu');
  if (!ALLOWED_TYPES.includes(file.type)) throw new HttpError(400, 'Format file harus JPG, PNG, WebP, atau PDF');
  if (file.size > MAX_BYTES) throw new HttpError(400, 'Ukuran file maksimal 4 MB');

  const name = file.name || 'lampiran';
  const driveFileId = await uploadFile(env, name, file.type, await file.arrayBuffer());
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO attachments (id, user_id, transaction_id, drive_file_id, name, mime_type, size) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, userId, params.id, driveFileId, name, file.type, file.size)
    .run();
  return json({ attachment: { id, name, mimeType: file.type, size: file.size } }, 201);
}

/** GET /api/attachments/:id: the file, from Drive. */
export async function getAttachment({ env, userId, params }: RouteContext) {
  const row = await env.DB.prepare('SELECT drive_file_id, mime_type FROM attachments WHERE id = ? AND user_id = ?')
    .bind(params.id, userId)
    .first<{ drive_file_id: string; mime_type: string }>();
  if (!row) throw new HttpError(404, 'Lampiran tidak ditemukan');
  const file = await downloadFile(env, row.drive_file_id);
  if (!file) throw new HttpError(404, 'File sudah tidak ada di Google Drive');
  return new Response(file.body, { headers: { 'content-type': row.mime_type, 'cache-control': 'private, max-age=3600' } });
}

/** DELETE /api/attachments/:id: removes the attachment and its file in Drive. */
export async function deleteAttachment({ env, userId, params }: RouteContext) {
  const row = await env.DB.prepare('SELECT drive_file_id FROM attachments WHERE id = ? AND user_id = ?').bind(params.id, userId).first<{ drive_file_id: string }>();
  if (!row) throw new HttpError(404, 'Lampiran tidak ditemukan');
  await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(params.id).run();
  await deleteFiles(env, [row.drive_file_id]);
  return json({ ok: true });
}
