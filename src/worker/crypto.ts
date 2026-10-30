import type { Env } from './env';

// Secrets kept in the database (the Drive token, the NVIDIA key) are encrypted with AES-GCM. The key is
// derived from SESSION_SECRET, and `info` keeps each kind of secret apart. Rotating SESSION_SECRET means
// those secrets must be entered again.

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64url = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));

async function key(env: Env, info: string) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('neraca'), info: new TextEncoder().encode(info) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptSecret(env: Env, text: string, info: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env, info), new TextEncoder().encode(text)));
  const out = new Uint8Array(iv.length + data.length);
  out.set(iv);
  out.set(data, iv.length);
  return base64url(out);
}

export async function decryptSecret(env: Env, value: string, info: string) {
  const bytes = fromBase64url(value);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await key(env, info), bytes.slice(12));
  return new TextDecoder().decode(plain);
}
