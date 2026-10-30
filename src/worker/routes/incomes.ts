import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';

// Income (gaji, transfer masuk) goes into a savings source, and adds to its balance. It is not spending.

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** POST /api/sources/:id/income { amount, occurredOn, note? } */
export async function addIncome({ request, env, userId, params }: RouteContext) {
  const source = await env.DB.prepare("SELECT id FROM payment_sources WHERE id = ? AND user_id = ? AND kind = 'savings'").bind(params.id, userId).first();
  if (!source) throw new HttpError(404, 'Dompet tidak ditemukan');
  const body = await readJson(request);
  const amount = typeof body.amount === 'number' ? Math.round(body.amount) : 0;
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Jumlah pemasukan harus lebih dari 0');
  if (!isDate(body.occurredOn)) throw new HttpError(400, 'Tanggal tidak valid');
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 80) : '';

  await env.DB.prepare('INSERT INTO incomes (id, user_id, source_id, occurred_on, amount, note) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, params.id, body.occurredOn, amount, note)
    .run();
  return json({ ok: true }, 201);
}
