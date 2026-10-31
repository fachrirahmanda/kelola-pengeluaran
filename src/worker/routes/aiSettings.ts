import { isAdmin } from '../admin';
import { encryptSecret } from '../crypto';
import type { Env } from '../env';
import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';
import { AI_INFO, DEFAULT_MODEL, MODELS, aiConfig, chat, keyAccepted } from '../nvidia';
import { getUser } from '../users';
import { todayInWib } from './ask';

// Ask AI settings, managed by the admin in Settings: the NVIDIA key (stored encrypted, never sent back)
// and the model. Everyone else gets { canManage: false } and nothing else.

const MAX_MODEL_LENGTH = 100;

/** What the Settings page shows: the key's last characters, the model, and today's use. */
async function view(env: Env) {
  const row = await env.DB.prepare('SELECT key_hint, model, updated_at, updated_by FROM ai_settings WHERE id = ?')
    .bind('app')
    .first<{ key_hint: string; model: string; updated_at: string; updated_by: string }>();
  const counts = await env.DB.prepare('SELECT COUNT(*) AS questions, COUNT(DISTINCT user_id) AS people FROM ai_questions WHERE day = ?')
    .bind(todayInWib())
    .first<{ questions: number; people: number }>();
  const source = row ? 'settings' : env.NVIDIA_API_KEY ? 'secret' : 'none';
  return {
    canManage: true,
    configured: source !== 'none',
    source,
    keyHint: row?.key_hint ?? null,
    model: row?.model ?? env.NVIDIA_MODEL ?? DEFAULT_MODEL,
    defaultModel: DEFAULT_MODEL,
    models: MODELS,
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
    questionsToday: counts?.questions ?? 0,
    peopleToday: counts?.people ?? 0,
  };
}

/** GET /api/ai/settings */
export async function getAi({ env, actorId }: RouteContext) {
  if (!(await isAdmin(env, actorId))) return json({ canManage: false });
  return json(await view(env));
}

/** PUT /api/ai/settings { apiKey?, model? }: a new key is checked with NVIDIA before it is saved. */
export async function saveAi({ request, env, actorId }: RouteContext) {
  if (!(await isAdmin(env, actorId))) throw new HttpError(403, 'Hanya admin yang bisa mengatur Ask AI');
  const body = await readJson(request);
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  if (model && (model.length > MAX_MODEL_LENGTH || !/^[\w./-]+$/.test(model))) throw new HttpError(400, 'Nama model tidak valid');

  const current = await env.DB.prepare('SELECT model FROM ai_settings WHERE id = ?').bind('app').first<{ model: string }>();
  if (apiKey) {
    if (!(await keyAccepted(apiKey))) throw new HttpError(400, 'NVIDIA menolak key ini. Periksa lagi key-nya.');
    const user = await getUser(env.DB, actorId);
    await env.DB.prepare(
      `INSERT INTO ai_settings (id, key_encrypted, key_hint, model, updated_at, updated_by) VALUES ('app', ?, ?, ?, datetime('now'), ?)
       ON CONFLICT (id) DO UPDATE SET key_encrypted = excluded.key_encrypted, key_hint = excluded.key_hint, model = excluded.model,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
      .bind(await encryptSecret(env, apiKey, AI_INFO), `…${apiKey.slice(-4)}`, model || current?.model || DEFAULT_MODEL, user?.email ?? '')
      .run();
  } else if (model) {
    if (!current) throw new HttpError(400, 'Simpan key dulu sebelum memilih model');
    await env.DB.prepare("UPDATE ai_settings SET model = ?, updated_at = datetime('now') WHERE id = ?").bind(model, 'app').run();
  } else {
    throw new HttpError(400, 'Tidak ada yang diubah');
  }
  return json(await view(env));
}

/** DELETE /api/ai/settings: removes the saved key. Ask AI then uses the secret if one is set, or turns off. */
export async function removeAi({ env, actorId }: RouteContext) {
  if (!(await isAdmin(env, actorId))) throw new HttpError(403, 'Hanya admin yang bisa mengatur Ask AI');
  await env.DB.prepare('DELETE FROM ai_settings WHERE id = ?').bind('app').run();
  return json(await view(env));
}

/** POST /api/ai/test: one short question to the model in use, and how long it took. */
export async function testAi({ env, actorId }: RouteContext) {
  if (!(await isAdmin(env, actorId))) throw new HttpError(403, 'Hanya admin yang bisa mengatur Ask AI');
  const config = await aiConfig(env);
  if (!config) throw new HttpError(400, 'Ask AI belum diatur');
  const started = Date.now();
  try {
    await chat(config, [{ role: 'user', content: 'Reply with the single word: ok' }]);
    return json({ ok: true, ms: Date.now() - started, model: config.model, message: '' });
  } catch (err) {
    return json({ ok: false, ms: Date.now() - started, model: config.model, message: err instanceof HttpError ? err.message : 'Tes gagal.' });
  }
}
