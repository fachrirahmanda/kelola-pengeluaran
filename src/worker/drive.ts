import type { Env } from './env';
import { HttpError } from './http';
import { decryptSecret, encryptSecret } from './crypto';

// Google Drive as the file store for receipt attachments. One Google account for the whole app: the
// admin (ADMIN_EMAIL) connects it once, and every user's attachments go into its folder. The scope
// drive.file means the app only sees files it created. The refresh token is kept in drive_connections,
// encrypted with a key derived from SESSION_SECRET.

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'Neraca attachments';
/** drive_connections holds one row: the app's connection. */
const CONNECTION = 'app';

/** The access token is cached for its short life. */
let cached: { token: string; expires: number } | null = null;


/** Whether Drive is connected, and what it holds: how many receipt files and how many bytes. */
export async function driveStatus(env: Env) {
  const row = await env.DB.prepare('SELECT email, folder_id, connected_at FROM drive_connections WHERE id = ?').bind(CONNECTION).first<{ email: string; folder_id: string | null; connected_at: string }>();
  const usage = await env.DB.prepare('SELECT COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes FROM attachments').first<{ files: number; bytes: number }>();
  return {
    connected: !!row,
    email: row?.email ?? null,
    folderId: row?.folder_id ?? null,
    connectedAt: row?.connected_at ?? null,
    files: usage?.files ?? 0,
    bytes: usage?.bytes ?? 0,
  };
}

export async function disconnectDrive(env: Env) {
  const row = await env.DB.prepare('SELECT refresh_token FROM drive_connections WHERE id = ?').bind(CONNECTION).first<{ refresh_token: string }>();
  if (row) {
    // Revoke at Google too, so the token is useless even if it leaked.
    const token = await decryptSecret(env, row.refresh_token, DRIVE_INFO).catch(() => null);
    if (token) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
  }
  await env.DB.prepare('DELETE FROM drive_connections WHERE id = ?').bind(CONNECTION).run();
  cached = null;
}

const DRIVE_INFO = 'drive-refresh-token';

// ---------- connect (the code from the callback) ----------

/** Exchanges the code for tokens and stores the app's refresh token. */
export async function connectDrive(env: Env, code: string, verifier: string, redirectUri: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
  });
  if (!res.ok) throw new HttpError(502, 'Google Drive tidak bisa dihubungkan. Coba lagi.');
  const tokensBody = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope: string };
  if (!tokensBody.refresh_token) throw new HttpError(400, 'Google tidak memberi izin jangka panjang. Coba hubungkan lagi.');
  if (!tokensBody.scope.split(' ').includes(DRIVE_SCOPE)) throw new HttpError(400, 'Izin Google Drive belum diberikan.');

  const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tokensBody.access_token}` } });
  const profile = profileRes.ok ? ((await profileRes.json()) as { email?: string }) : {};

  await env.DB.prepare(
    `INSERT INTO drive_connections (id, refresh_token, email, folder_id) VALUES (?, ?, ?, NULL)
     ON CONFLICT (id) DO UPDATE SET refresh_token = excluded.refresh_token, email = excluded.email, folder_id = NULL, connected_at = datetime('now')`,
  )
    .bind(CONNECTION, await encryptSecret(env, tokensBody.refresh_token, DRIVE_INFO), profile.email ?? '')
    .run();
  cached = { token: tokensBody.access_token, expires: Date.now() + tokensBody.expires_in * 1000 };
  await ensureFolder(env);
}

// ---------- access ----------

async function accessToken(env: Env) {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;

  const row = await env.DB.prepare('SELECT refresh_token FROM drive_connections WHERE id = ?').bind(CONNECTION).first<{ refresh_token: string }>();
  if (!row) throw new HttpError(503, 'Lampiran butuh Google Drive. Admin bisa menghubungkannya di Pengaturan.');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: await decryptSecret(env, row.refresh_token, DRIVE_INFO),
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    console.error('drive token refresh failed', res.status, await res.text());
    throw new HttpError(503, 'Akses Google Drive sudah habis atau dicabut. Admin perlu menghubungkan lagi di Pengaturan.');
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

async function drive(env: Env, url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${await accessToken(env)}` } });
}

/** The folder attachments go in; made again if it was deleted in Drive. */
async function ensureFolder(env: Env, force = false) {
  const row = await env.DB.prepare('SELECT folder_id FROM drive_connections WHERE id = ?').bind(CONNECTION).first<{ folder_id: string | null }>();
  if (row?.folder_id && !force) return row.folder_id;
  const res = await drive(env, `${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', description: 'Receipt attachments from Neraca. Deleting files here breaks those attachments.' }),
  });
  if (!res.ok) throw new HttpError(502, `Folder di Google Drive tidak bisa dibuat (${res.status})`);
  const { id } = (await res.json()) as { id: string };
  await env.DB.prepare('UPDATE drive_connections SET folder_id = ? WHERE id = ?').bind(id, CONNECTION).run();
  return id;
}

// ---------- files ----------

/** Uploads one file in a single request (attachments are capped well below Drive's 5 MB limit for this). */
export async function uploadFile(env: Env, name: string, type: string, data: ArrayBuffer): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const folder = await ensureFolder(env, attempt > 0);
    const boundary = `neraca-${crypto.randomUUID()}`;
    const meta = JSON.stringify({ name, parents: [folder], mimeType: type });
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`,
      data,
      `\r\n--${boundary}--`,
    ]);
    const res = await drive(env, `${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body,
    });
    if (res.ok) return ((await res.json()) as { id: string }).id;
    // The folder was removed in Drive: make a new one and try once more.
    if (res.status === 404 && attempt === 0) continue;
    console.error('drive upload failed', res.status, await res.text());
    throw new HttpError(502, `Upload ke Google Drive gagal (${res.status})`);
  }
  throw new HttpError(502, 'Upload ke Google Drive gagal');
}

/** The file's bytes as a response, or null if it is gone from Drive. */
export async function downloadFile(env: Env, fileId: string) {
  const res = await drive(env, `${API}/files/${encodeURIComponent(fileId)}?alt=media`);
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, `File tidak bisa dimuat dari Google Drive (${res.status})`);
  return res;
}

export async function deleteFiles(env: Env, fileIds: string[]) {
  for (const id of fileIds) await drive(env, `${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
}
