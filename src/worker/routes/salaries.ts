import { dueMonths, firstUpcomingMonth, payDateOf } from '../../shared/salary';
import { addMonths } from '../../shared/recurring';
import type { Salary } from '../../shared/types';
import type { Env } from '../env';
import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';

// Recurring income (gaji): a fixed amount into a savings account every month. Each month whose pay date has
// come is recorded once as an income (see syncSalaries), so the account's balance goes up on payday.

const NAME_MAX = 40;
const MAX_AMOUNT = 1_000_000_000_000;

interface SalaryRow {
  id: string;
  source_id: string;
  source_name: string;
  name: string;
  amount: number;
  pay_day: number;
  start_month: string;
}

/** Today in WIB as YYYY-MM-DD. */
function todayWib(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function salaryRows(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.source_id, p.name AS source_name, s.name, s.amount, s.pay_day, s.start_month
     FROM salaries s JOIN payment_sources p ON p.id = s.source_id WHERE s.user_id = ? ORDER BY s.created_at`,
  )
    .bind(userId)
    .all<SalaryRow>();
  return results;
}

/**
 * Records every salary month whose pay date has come and is not recorded yet, as an income on its pay date.
 * Runs before balances are read, so payday shows without anyone doing anything. A month is recorded once
 * (unique salary_id + salary_month), even when two requests run at the same time.
 */
export async function syncSalaries(env: Env, userId: string) {
  const rows = await salaryRows(env, userId);
  if (rows.length === 0) return;
  const today = todayWib();
  const { results: recorded } = await env.DB.prepare('SELECT salary_id, salary_month FROM incomes WHERE user_id = ? AND salary_id IS NOT NULL')
    .bind(userId)
    .all<{ salary_id: string; salary_month: string }>();
  const done = new Set(recorded.map((row) => `${row.salary_id}/${row.salary_month}`));

  const statements: D1PreparedStatement[] = [];
  for (const row of rows) {
    for (const month of dueMonths(row.start_month, row.pay_day, today)) {
      if (done.has(`${row.id}/${month}`)) continue;
      statements.push(
        env.DB.prepare(
          'INSERT OR IGNORE INTO incomes (id, user_id, source_id, occurred_on, amount, note, salary_id, salary_month) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(crypto.randomUUID(), userId, row.source_id, payDateOf(month, row.pay_day), row.amount, row.name, row.id, month),
      );
    }
  }
  for (let index = 0; index < statements.length; index += 50) await env.DB.batch(statements.slice(index, index + 50));
}

function toSalary(row: SalaryRow, today: string): Salary {
  let month = row.start_month > today.slice(0, 7) ? row.start_month : firstUpcomingMonth(today, row.pay_day);
  // The next pay date can be in an earlier month's turn (pay day 1 on a weekend), so step to the first one still ahead.
  while (payDateOf(month, row.pay_day) < today) month = addMonths(month, 1);
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    name: row.name,
    amount: row.amount,
    payDay: row.pay_day,
    startMonth: row.start_month,
    nextPayDate: payDateOf(month, row.pay_day),
  };
}

function parseSalary(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > NAME_MAX) throw new HttpError(400, `Nama wajib diisi (maks. ${NAME_MAX} karakter)`);
  const amount = body.amount;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) throw new HttpError(400, 'Nominal harus bilangan bulat lebih dari 0');
  const payDay = body.payDay;
  if (typeof payDay !== 'number' || !Number.isInteger(payDay) || payDay < 1 || payDay > 31) throw new HttpError(400, 'Tanggal gajian harus 1-31');
  return { name, amount, payDay };
}

async function savingsOf(env: Env, userId: string, sourceId: unknown) {
  if (typeof sourceId !== 'string') throw new HttpError(400, 'Pilih rekening tujuan');
  const row = await env.DB.prepare("SELECT id FROM payment_sources WHERE id = ? AND user_id = ? AND kind = 'savings'").bind(sourceId, userId).first();
  if (!row) throw new HttpError(400, 'Gaji hanya bisa masuk ke rekening tabungan');
  return sourceId;
}

/** GET /api/salaries */
export async function listSalaries({ env, userId }: RouteContext) {
  await syncSalaries(env, userId);
  const today = todayWib();
  return json({ salaries: (await salaryRows(env, userId)).map((row) => toSalary(row, today)) });
}

/**
 * POST /api/salaries { sourceId, name, amount, payDay }: recorded from the next pay date on. A pay date that
 * has already passed this month is left out, because the balance usually has it already.
 */
export async function createSalary({ request, env, userId }: RouteContext) {
  const body = await readJson(request);
  const input = parseSalary(body);
  const sourceId = await savingsOf(env, userId, body.sourceId);
  const startMonth = firstUpcomingMonth(todayWib(), input.payDay);
  await env.DB.prepare('INSERT INTO salaries (id, user_id, source_id, name, amount, pay_day, start_month) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, sourceId, input.name, input.amount, input.payDay, startMonth)
    .run();
  return listSalaries({ request, env, userId } as RouteContext);
}

/** PATCH /api/salaries/:id { sourceId, name, amount, payDay }: applies to the months not recorded yet. */
export async function updateSalary({ request, env, userId, params }: RouteContext) {
  const body = await readJson(request);
  const input = parseSalary(body);
  const sourceId = await savingsOf(env, userId, body.sourceId);
  const result = await env.DB.prepare('UPDATE salaries SET source_id = ?, name = ?, amount = ?, pay_day = ? WHERE id = ? AND user_id = ?')
    .bind(sourceId, input.name, input.amount, input.payDay, params.id, userId)
    .run();
  if (result.meta.changes === 0) throw new HttpError(404, 'Gaji tidak ditemukan');
  return listSalaries({ request, env, userId } as RouteContext);
}

/** DELETE /api/salaries/:id: stops it. Incomes it already recorded stay. */
export async function deleteSalary({ env, userId, params }: RouteContext) {
  await env.DB.batch([
    env.DB.prepare('UPDATE incomes SET salary_id = NULL WHERE salary_id = ? AND user_id = ?').bind(params.id, userId),
    env.DB.prepare('DELETE FROM salaries WHERE id = ? AND user_id = ?').bind(params.id, userId),
  ]);
  return json({ ok: true });
}
