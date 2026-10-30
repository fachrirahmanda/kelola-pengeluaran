import { decryptSecret } from './crypto';
import type { Env } from './env';
import { HttpError } from './http';

// NVIDIA's hosted models (build.nvidia.com) through their OpenAI-compatible API. The admin sets the key
// and model in Settings; the NVIDIA_API_KEY and NVIDIA_MODEL secrets are the fallback.

export const API_BASE = 'https://integrate.api.nvidia.com/v1';
export const DEFAULT_MODEL = 'meta/llama-3.1-70b-instruct';
/** Models offered in Settings. The model in use is always listed too, even if it is not here. */
export const MODELS = [
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.2-90b-vision-instruct',
  'meta/llama-3.2-11b-vision-instruct',
  'meta/llama-3.1-8b-instruct',
];

export const AI_INFO = 'nvidia-api-key';

export interface AiConfig {
  key: string;
  model: string;
  source: 'settings' | 'secret';
}

/** The key and model in use: the ones saved in Settings, else the secrets. Null when Ask AI is off. */
export async function aiConfig(env: Env): Promise<AiConfig | null> {
  const row = await env.DB.prepare('SELECT key_encrypted, model FROM ai_settings WHERE id = ?').bind('app').first<{ key_encrypted: string; model: string }>();
  if (row) return { key: await decryptSecret(env, row.key_encrypted, AI_INFO), model: row.model, source: 'settings' };
  if (env.NVIDIA_API_KEY) return { key: env.NVIDIA_API_KEY, model: env.NVIDIA_MODEL || DEFAULT_MODEL, source: 'secret' };
  return null;
}

/** Whether a key is accepted by NVIDIA. Listing models costs nothing and needs no model choice. */
export async function keyAccepted(key: string) {
  const res = await fetch(`${API_BASE}/models`, { headers: { authorization: `Bearer ${key}` } });
  return res.ok;
}

/**
 * One chat request. Returns the text of the first answer. Failures are logged with NVIDIA's status
 * and message, and the caller gets a short Indonesian message.
 */
export async function chat(config: AiConfig, messages: { role: 'system' | 'user'; content: string }[], maxTokens: number) {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.key}` },
    body: JSON.stringify({ model: config.model, messages, temperature: 0.2, max_tokens: maxTokens }),
  });
  if (!res.ok) {
    console.error('nvidia request failed', res.status, await res.text());
    throw new HttpError(502, 'Ask AI sedang tidak bisa menjawab. Coba lagi.');
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new HttpError(502, 'Ask AI tidak memberi jawaban. Coba pertanyaan lain.');
  return answer;
}
