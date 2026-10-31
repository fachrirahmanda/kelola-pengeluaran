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
 * Answers are streamed. A request is given up when NVIDIA sends nothing for IDLE_MS (it stopped, or is
 * still queued), or when the whole answer takes longer than TOTAL_MS. A reasoning model keeps sending its
 * thinking while it works, so a long answer to a hard question still finishes.
 */
const IDLE_MS = 30_000;
const TOTAL_MS = 150_000;

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

/** What one streamed chunk or a whole (non-streamed) answer may hold. */
interface Choice {
  delta?: { content?: string | null };
  message?: { content?: string | null };
  finish_reason?: string | null;
}

/**
 * One chat request. Returns the text of the first answer. Failures are logged with NVIDIA's status
 * and message, and the caller gets a short Indonesian message. No max_tokens is sent, so the model
 * can think and answer as long as it needs; the time limits above are the only limit.
 */
export async function chat(config: AiConfig, messages: { role: 'system' | 'user' | 'assistant'; content: string }[]) {
  const controller = new AbortController();
  // Why the request was stopped, if it was. An object, so the timers' writes are seen below.
  const stopped: { reason: 'idle' | 'total' | null } = { reason: null };
  // Cancelled along with the request, so a read that is waiting on the stream ends too.
  let reader: ReadableStreamDefaultReader<string> | undefined;
  const stop = (reason: 'idle' | 'total') => {
    stopped.reason = reason;
    controller.abort();
    reader?.cancel().catch(() => {});
  };
  const total = setTimeout(() => stop('total'), TOTAL_MS);
  let idle = setTimeout(() => stop('idle'), IDLE_MS);
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => stop('idle'), IDLE_MS);
  };
  const failure = (err: unknown) => {
    console.error('nvidia request did not finish', config.model, stopped.reason, err);
    if (stopped.reason === 'idle') return new HttpError(504, `Model ${config.model} berhenti merespons (${IDLE_MS / 1000} detik tanpa jawaban). Coba lagi atau pilih model lain.`);
    if (stopped.reason === 'total') return new HttpError(504, `Model ${config.model} terlalu lama menjawab (lebih dari ${TOTAL_MS / 1000} detik). Coba model lain.`);
    return new HttpError(502, 'Ask AI tidak bisa menghubungi NVIDIA. Coba lagi.');
  };

  try {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.key}` },
        body: JSON.stringify({ model: config.model, messages, temperature: 0.2, stream: true }),
        signal: controller.signal,
      });
    } catch (err) {
      throw failure(err);
    }
    if (!res.ok) {
      const body = await res.text();
      console.error('nvidia request failed', config.model, res.status, body);
      if (res.status === 404) throw new HttpError(502, `NVIDIA 404 untuk ${config.model}: ${nvidiaDetail(body)}`);
      if (res.status === 401 || res.status === 403) throw new HttpError(502, 'NVIDIA menolak key ini. Periksa lagi key-nya.');
      if (res.status === 429) throw new HttpError(502, 'Batas pemakaian NVIDIA tercapai. Coba lagi nanti.');
      throw new HttpError(502, `Ask AI sedang tidak bisa menjawab (NVIDIA ${res.status}). Coba lagi.`);
    }
    touch();

    let answer = '';
    let finish: string | null | undefined;
    try {
      if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
        // The model answered in one piece instead of streaming.
        const choice = ((await res.json()) as { choices?: Choice[] }).choices?.[0];
        answer = choice?.message?.content ?? '';
        finish = choice?.finish_reason;
      } else {
        reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          touch();
          buffer += value;
          let newline: number;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const choice = (JSON.parse(payload) as { choices?: Choice[] }).choices?.[0];
              if (choice?.delta?.content) answer += choice.delta.content;
              if (choice?.finish_reason) finish = choice.finish_reason;
            } catch {
              // Not JSON (a keep-alive or a comment): skipped.
            }
          }
        }
      }
    } catch (err) {
      throw failure(err);
    }
    // A cancelled stream ends like a finished one: a time limit, not a short answer.
    if (stopped.reason) throw failure('stream cancelled');

    answer = answer.trim();
    if (!answer) {
      console.error('nvidia gave no answer', config.model, finish);
      // A reasoning model can spend the whole budget thinking and stop before it writes the answer.
      if (finish === 'length') throw new HttpError(502, `Model ${config.model} kehabisan token sebelum menjawab. Coba model lain.`);
      throw new HttpError(502, 'Ask AI tidak memberi jawaban. Coba pertanyaan lain.');
    }
    return answer;
  } finally {
    clearTimeout(total);
    clearTimeout(idle);
  }
}
