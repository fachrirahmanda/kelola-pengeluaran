import type { Income } from '../../shared/types';
import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';
import { syncSalaries } from './salaries';
import { balanceOf } from './sources';

// Income (gaji, transfer masuk, bonus) goes into a savings source, and adds to its balance. It is not spending.
// A one-off income is added here; a salary records its own every payday (see salaries.ts).

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const LIST_LIMIT = 50;
/** Incomes in a date range (the History calendar's month). */
const RANGE_LIMIT = 500;
const MAX_AMOUNT = 1_000_000_000_000;

/**
 * GET /api/incomes: the latest incomes into every savings account, newest first. With ?from=&to= (YYYY-MM-DD),
 * the incomes in that range instead.
 */
export async function listIncomes({ request, env, userId }: RouteContext) {
  await syncSalaries(env, userId);
  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if ((from && !isDate(from)) || (to && !isDate(to))) throw new HttpError(400, 'Tanggal tidak valid');
  const range = from && to;
  const { results } = await env.DB.prepare(
    `SELECT i.id, i.source_id, s.name AS source_name, s.bank, i.occurred_on, i.amount, i.note, i.salary_month
     FROM incomes i JOIN payment_sources s ON s.id = i.source_id
     WHERE i.user_id = ?${range ? ' AND i.occurred_on >= ? AND i.occurred_on <= ?' : ''}
     ORDER BY i.occurred_on DESC, i.created_at DESC LIMIT ${range ? RANGE_LIMIT : LIST_LIMIT}`,
  )
    .bind(...(range ? [userId, from, to] : [userId]))
    .all<{ id: string; source_id: string; source_name: string; bank: string | null; occurred_on: string; amount: number; note: string; salary_month: string | null }>();
  const incomes: Income[] = results.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    bank: row.bank,
    occurredOn: row.occurred_on,
    amount: row.amount,
    note: row.note,
    fromSalary: row.salary_month !== null,
  }));
  return json({ incomes });
}

/** POST /api/sources/:id/income { amount, occurredOn, note? }: a one-off income. */
export async function addIncome({ request, env, userId, params }: RouteContext) {
  const source = await env.DB.prepare("SELECT id FROM payment_sources WHERE id = ? AND user_id = ? AND kind = 'savings'").bind(params.id, userId).first();
  if (!source) throw new HttpError(404, 'Dompet tidak ditemukan');
  const body = await readJson(request);
  const amount = typeof body.amount === 'number' ? Math.round(body.amount) : 0;
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) throw new HttpError(400, 'Jumlah pemasukan harus lebih dari 0');
  if (!isDate(body.occurredOn)) throw new HttpError(400, 'Tanggal tidak valid');
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 80) : '';

  await env.DB.prepare('INSERT INTO incomes (id, user_id, source_id, occurred_on, amount, note) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, params.id, body.occurredOn, amount, note)
    .run();
  return json({ ok: true }, 201);
}

/**
 * DELETE /api/incomes/:id: removes a one-off income, e.g. one entered by mistake. A salary's income stays (the
 * salary would record it again); stop the salary instead. Refused when the account has already spent it.
 */
export async function deleteIncome({ env, userId, params }: RouteContext) {
  const income = await env.DB.prepare('SELECT id, source_id, amount, salary_month FROM incomes WHERE id = ? AND user_id = ?')
    .bind(params.id, userId)
    .first<{ id: string; source_id: string; amount: number; salary_month: string | null }>();
  if (!income) throw new HttpError(404, 'Pemasukan tidak ditemukan');
  if (income.salary_month !== null) throw new HttpError(409, 'Ini pemasukan dari gaji rutin dan tidak bisa dihapus. Ubah atau hentikan gajinya.');
  if ((await balanceOf(env.DB, income.source_id)) < income.amount) {
    throw new HttpError(409, 'Pemasukan ini sudah terpakai: menghapusnya membuat saldo rekening minus.');
  }
  await env.DB.prepare('DELETE FROM incomes WHERE id = ? AND user_id = ?').bind(income.id, userId).run();
  return json({ ok: true });
}
