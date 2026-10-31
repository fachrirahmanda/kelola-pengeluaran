import { decryptSecret } from './crypto';
import type { Env } from './env';
import { HttpError } from './http';

// NVIDIA's hosted models (build.nvidia.com) through their OpenAI-compatible API. The admin sets the key
// and model in Settings; the NVIDIA_API_KEY and NVIDIA_MODEL secrets are the fallback.

export const API_BASE = 'https://integrate.api.nvidia.com/v1';
export const DEFAULT_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';
/**
 * Models offered in Settings. The model in use is always listed too, even if it is not here. NVIDIA's
 * model list still names retired models, which answer 404 "Function … Not found for account", so this
 * list keeps to recent ones.
 */
export const MODELS = [
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'openai/gpt-oss-20b',
  'deepseek-ai/deepseek-v4.1-flash',
  'z-ai/glm-5.3-flash',
  'minimaxai/minimax-m3.1-flash',
  'nvidia/nemotron-3-super-120b-a12b',
  'moonshotai/kimi-k2.6',
];
/**
 * The longest one answer may take: NVIDIA's free endpoints can queue a request, and a reasoning model can
 * think for a minute or more. The answer is asked for whole, not streamed. Reading a stream of thousands of
 * small chunks costs more CPU time than the Worker's free plan allows, and the Worker is then stopped
 * part-way through the answer.
 */
const TIMEOUT_MS = 150_000;

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

/** NVIDIA's own reason from an error body ({ detail } or { error: { message } }), kept short. */
function nvidiaDetail(body: string) {
  try {
    const data = JSON.parse(body) as { detail?: string; title?: string; error?: { message?: string } | string };
    const detail = data.detail ?? (typeof data.error === 'string' ? data.error : data.error?.message) ?? data.title;
    if (detail) return detail.slice(0, 300);
  } catch {}
  return body.slice(0, 300) || 'tanpa keterangan';
}

/**
 * One chat request. Returns the text of the first answer. Failures are logged with NVIDIA's status
 * and message, and the caller gets a short Indonesian message. No max_tokens is sent, so the model
 * can think and answer as long as it needs; the time limit above is the only limit.
 */
export async function chat(config: AiConfig, messages: { role: 'system' | 'user' | 'assistant'; content: string }[]) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const tooSlow = (err: unknown) => {
    console.error('nvidia request did not finish', config.model, err);
    if (signal.aborted) return new HttpError(504, `Model ${config.model} terlalu lama menjawab (lebih dari ${TIMEOUT_MS / 1000} detik). Coba model lain.`);
    return new HttpError(502, 'Ask AI tidak bisa menghubungi NVIDIA. Coba lagi.');
  };
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ model: config.model, messages, temperature: 0.2 }),
      signal,
    });
  } catch (err) {
    throw tooSlow(err);
  }
  if (!res.ok) {
    const body = await res.text();
    console.error('nvidia request failed', config.model, res.status, body);
    if (res.status === 404) throw new HttpError(502, `NVIDIA 404 untuk ${config.model}: ${nvidiaDetail(body)}`);
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'NVIDIA menolak key ini. Periksa lagi key-nya.');
    if (res.status === 429) throw new HttpError(502, 'Batas pemakaian NVIDIA tercapai. Coba lagi nanti.');
    throw new HttpError(502, `Ask AI sedang tidak bisa menjawab (NVIDIA ${res.status}). Coba lagi.`);
  }
  let data: { choices?: { message?: { content?: string | null }; finish_reason?: string }[] };
  try {
    data = await res.json();
  } catch (err) {
    throw tooSlow(err);
  }
  const choice = data.choices?.[0];
  const answer = choice?.message?.content?.trim();
  if (!answer) {
    console.error('nvidia gave no answer', config.model, choice?.finish_reason);
    // A reasoning model can spend the whole budget thinking and stop before it writes the answer.
    if (choice?.finish_reason === 'length') throw new HttpError(502, `Model ${config.model} kehabisan token sebelum menjawab. Coba model lain.`);
    throw new HttpError(502, 'Ask AI tidak memberi jawaban. Coba pertanyaan lain.');
  }
  return answer;
}
