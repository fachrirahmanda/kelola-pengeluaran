import type { Env } from './env';
import { base64urlToBytes, base64urlToText, bytesToBase64url } from './base64url';

export const SESSION_COOKIE = 'neraca_session';
const SESSION_SECONDS = 60 * 60 * 24 * 30;

interface SessionPayload {
  /** Internal user ID. */
  sub: string;
  /** Unix time in seconds. */
  exp: number;
}

function sessionKey(env: Env, usages: ('sign' | 'verify')[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

/** Creates a signed token: `<payload>.<signature>`, both base64url. */
export async function signSession(env: Env, userId: string): Promise<string> {
  const payload: SessionPayload = { sub: userId, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS };
  const encoded = bytesToBase64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await sessionKey(env, ['sign']), new TextEncoder().encode(encoded));
  return `${encoded}.${bytesToBase64url(new Uint8Array(signature))}`;
}

/** Returns the user ID when the token is genuine and not expired. */
export async function verifySession(env: Env, token: string): Promise<string | null> {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  try {
    const valid = await crypto.subtle.verify('HMAC', await sessionKey(env, ['verify']), base64urlToBytes(signature), new TextEncoder().encode(encoded));
    if (!valid) return null;

    const payload = JSON.parse(base64urlToText(encoded)) as SessionPayload;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload.sub;
  } catch {
    // Malformed token (bad base64 or JSON): treat it as signed out.
    return null;
  }
}

export function readSessionToken(request: Request): string | null {
  const cookies = request.headers.get('cookie') ?? '';
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
