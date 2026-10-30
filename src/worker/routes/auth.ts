import type { Env } from '../env';
import { HttpError, json, readJson } from '../http';
import type { RouteContext } from '../context';
import { isAdmin } from '../admin';
import { clearSessionCookie, sessionCookie, signSession } from '../session';
import { getUser, upsertUser } from '../users';

// Dev login: sign in without Google, for local development only. It needs DEV_LOGIN=true in
// .dev.vars and a request to localhost. In production DEV_LOGIN is not set, so the route is a 404.
const isLocal = (url: string) => ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
const devLoginEnabled = (request: Request, env: Env) => env.DEV_LOGIN === 'true' && isLocal(request.url);

/** GET /api/auth/config: what the login page can offer. */
export async function authConfig({ request, env }: RouteContext) {
  return json({ devLogin: devLoginEnabled(request, env) });
}

/** POST /api/auth/dev-login { email }: signs in as that email, creating the account if needed. */
export async function devLogin({ request, env }: RouteContext) {
  if (!devLoginEnabled(request, env)) throw new HttpError(404, 'Tidak ditemukan');
  const body = await readJson(request);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Email tidak valid');

  const user = await upsertUser(env.DB, { sub: `dev:${email}`, email, name: email.split('@')[0] });
  const token = await signSession(env, user.id);
  return json({ user }, 200, { 'Set-Cookie': sessionCookie(token) });
}

// Google sign-in: the browser goes to Google in this tab and comes back to the callback. The state
// and PKCE verifier wait in a short-lived cookie, so the callback can check them.
const OAUTH_COOKIE = 'neraca_oauth';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

const redirectUri = (request: Request) => `${new URL(request.url).origin}/api/auth/google/callback`;

export function base64url(bytes: Uint8Array) {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomString(length: number) {
  return base64url(crypto.getRandomValues(new Uint8Array(length)));
}

export function cookieValue(request: Request, name: string) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

const oauthCookie = (value: string, maxAge: number) => `${OAUTH_COOKIE}=${value}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({ location });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

/** GET /api/auth/google: sends the browser to Google's sign-in page. */
export async function startGoogle({ request, env }: RouteContext) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new HttpError(400, 'Login Google belum diatur');
  const state = randomString(16);
  const verifier = randomString(32);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));

  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(request),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return redirect(url.toString(), [oauthCookie(`${state}.${verifier}`, 600)]);
}

/** GET /api/auth/google/callback: Google sends the browser back here with a code. */
export async function googleCallback({ request, env }: RouteContext) {
  const clear = oauthCookie('', 0);
  const fail = (error: string) => redirect(`/login?error=${error}`, [clear]);
  const [state, verifier] = (cookieValue(request, OAUTH_COOKIE) ?? '').split('.');
  const params = new URL(request.url).searchParams;
  const code = params.get('code');
  if (!code || !state || params.get('state') !== state) return fail('state');

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(request),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) return fail('google');
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const profileRes = await fetch(GOOGLE_USERINFO_URL, { headers: { authorization: `Bearer ${access_token}` } });
  if (!profileRes.ok) return fail('google');
  const profile = (await profileRes.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
  if (!profile.sub || !profile.email || profile.email_verified !== true) return fail('unverified');

  // Invite only: an account that already exists, or an email with a pending invitation from a data owner.
  const known =
    (await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?').bind(profile.sub).first()) ??
    (await env.DB.prepare('SELECT id FROM workspace_invites WHERE email = ?').bind(profile.email).first());
  if (!known) return fail('not_invited');

  const user = await upsertUser(env.DB, { sub: profile.sub, email: profile.email, name: profile.name ?? '', picture: profile.picture });
  const token = await signSession(env, user.id);
  return redirect('/dashboard', [clear, sessionCookie(token)]);
}

/** GET /api/auth/me */
export async function currentUser({ env, actorId }: RouteContext) {
  const user = await getUser(env.DB, actorId);
  if (!user) throw new HttpError(401, 'Belum masuk');
  return json({ user: { ...user, isAdmin: await isAdmin(env, actorId) } });
}

/** POST /api/auth/logout */
export function logout() {
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}
