import type { Env } from '../env';
import { periodOf, periodRange, MAX_PERIOD_START, MIN_PERIOD_START } from '../../shared/period';
import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';

// The monthly period of a data set (see shared/period). Budgets, reports, the dashboard and Ask AI count
// spending in periods; the day is stored on the owner's account, so members and the owner share it.

/** The day the data set's monthly period starts. */
export async function periodStartOf(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT period_start_day FROM users WHERE id = ?').bind(userId).first<{ period_start_day: number }>();
  return row?.period_start_day ?? MIN_PERIOD_START;
}

/**
 * Spending (posted, not a transfer) per period and category, for the periods from `first` to `last` (YYYY-MM).
 * Rows are grouped by the period each day belongs to, so a changed start day is applied to every month.
 */
export async function periodSpendingOf(env: Env, userId: string, startDay: number, first: string, last: string) {
  const { results } = await env.DB.prepare(
    `SELECT posted_on, category_id, SUM(amount) AS total, COUNT(*) AS count FROM transactions
     WHERE user_id = ? AND status = 'posted' AND method <> 'transfer' AND posted_on >= ? AND posted_on <= ?
     GROUP BY posted_on, category_id`,
  )
    .bind(userId, periodRange(first, startDay).from, periodRange(last, startDay).to)
    .all<{ posted_on: string; category_id: string; total: number; count: number }>();

  const grouped = new Map<string, { month: string; category_id: string; total: number; count: number }>();
  for (const row of results) {
    const month = periodOf(row.posted_on, startDay);
    const key = `${month}|${row.category_id}`;
    const entry = grouped.get(key) ?? { month, category_id: row.category_id, total: 0, count: 0 };
    entry.total += row.total;
    entry.count += row.count;
    grouped.set(key, entry);
  }
  return [...grouped.values()];
}

/** PUT /api/workspace/period-start { day }: the day the monthly period starts (1 to 28). Owners and members can change it. */
export async function setPeriodStart({ request, env, userId }: RouteContext) {
  const body = await readJson(request);
  const day = body.day;
  if (typeof day !== 'number' || !Number.isInteger(day) || day < MIN_PERIOD_START || day > MAX_PERIOD_START) {
    throw new HttpError(400, `Tanggal mulai periode harus 1-${MAX_PERIOD_START}`);
  }
  await env.DB.prepare('UPDATE users SET period_start_day = ? WHERE id = ?').bind(day, userId).run();
  return json({ ok: true, day });
}
