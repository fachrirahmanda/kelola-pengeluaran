import { addMonths } from '../../shared/recurring';
import type { BudgetMonth } from '../../shared/budget';
import type { Env } from '../env';
import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';
import { todayInWib } from './ask';

// Budgets: a monthly amount per category, and a total. A budget repeats every month until it changes; each
// change is kept with the month it starts (budget_changes), so past months keep the budget they had. The
// spending they are compared with is what is counted (posted) in the month, the same as reports.

const MAX_HISTORY_MONTHS = 24;
const isMonth = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/** The budget changes of a data set, oldest first. */
async function changesOf(env: Env, userId: string) {
  const { results } = await env.DB.prepare('SELECT category_id, month, amount FROM budget_changes WHERE user_id = ? ORDER BY month')
    .bind(userId)
    .all<{ category_id: string | null; month: string; amount: number }>();
  return results;
}

/** Spending per month and category, for the months from `first` to `last`. */
async function spendingOf(env: Env, userId: string, first: string, last: string) {
  const { results } = await env.DB.prepare(
    `SELECT substr(posted_on, 1, 7) AS month, category_id, SUM(amount) AS total FROM transactions
     WHERE user_id = ? AND status = 'posted' AND method <> 'transfer' AND posted_on >= ? AND posted_on < ? GROUP BY month, category_id`,
  )
    .bind(userId, `${first}-01`, `${addMonths(last, 1)}-01`)
    .all<{ month: string; category_id: string; total: number }>();
  return results;
}

/** The budgets in force in a month: the latest change at or before it, per scope ('' is the total). */
function budgetsAt(changes: { category_id: string | null; month: string; amount: number }[], month: string) {
  const amounts = new Map<string, number>();
  for (const change of changes) {
    if (change.month > month) break;
    amounts.set(change.category_id ?? '', change.amount);
  }
  for (const [scope, amount] of amounts) if (amount <= 0) amounts.delete(scope);
  return amounts;
}

function monthOf(month: string, changes: Awaited<ReturnType<typeof changesOf>>, spending: Awaited<ReturnType<typeof spendingOf>>): BudgetMonth {
  const budgets = budgetsAt(changes, month);
  const spentBy = new Map(spending.filter((row) => row.month === month).map((row) => [row.category_id, row.total]));
  const categoryIds = new Set([...[...budgets.keys()].filter((scope) => scope !== ''), ...spentBy.keys()]);
  return {
    month,
    total: budgets.get('') ?? null,
    spent: [...spentBy.values()].reduce((sum, value) => sum + value, 0),
    // Every category with a budget or with spending in the month, so the page can show both.
    categories: [...categoryIds].map((categoryId) => ({ categoryId, amount: budgets.get(categoryId) ?? null, spent: spentBy.get(categoryId) ?? 0 })),
  };
}

/** GET /api/budgets?month=YYYY-MM: the budgets of a month (this month by default) and what was spent in it. */
export async function listBudgets({ request, env, userId }: RouteContext) {
  const current = todayInWib().slice(0, 7);
  const asked = new URL(request.url).searchParams.get('month');
  const month = isMonth(asked) && asked <= current ? asked : current;
  const [changes, spending] = await Promise.all([changesOf(env, userId), spendingOf(env, userId, month, month)]);
  return json({ ...monthOf(month, changes, spending), current });
}

/** GET /api/budgets/history?months=6: the last months, oldest first, each with its budgets and spending. */
export async function budgetHistory({ request, env, userId }: RouteContext) {
  const current = todayInWib().slice(0, 7);
  const count = Math.min(MAX_HISTORY_MONTHS, Math.max(2, Number(new URL(request.url).searchParams.get('months')) || 6));
  const first = addMonths(current, -(count - 1));
  const [changes, spending] = await Promise.all([changesOf(env, userId), spendingOf(env, userId, first, current)]);
  const months = Array.from({ length: count }, (_, index) => monthOf(addMonths(first, index), changes, spending));
  return json({ months });
}

/**
 * PUT /api/budgets { categoryId: "total" | <category id>, amount }: amount 0 or empty removes the budget. The
 * change starts this month; earlier months keep the budget they had.
 */
export async function saveBudget({ request, env, userId }: RouteContext) {
  const body = await readJson(request);
  const scope = typeof body.categoryId === 'string' ? body.categoryId : '';
  const amount = typeof body.amount === 'number' ? Math.round(body.amount) : 0;
  if (!scope) throw new HttpError(400, 'Pilih kategori atau total');
  if (!Number.isFinite(amount) || amount < 0) throw new HttpError(400, 'Budget tidak valid');

  const categoryId = scope === 'total' ? null : scope;
  if (categoryId) {
    const category = await env.DB.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').bind(categoryId, userId).first();
    if (!category) throw new HttpError(404, 'Kategori tidak ditemukan');
  }

  const month = todayInWib().slice(0, 7);
  const remove = categoryId
    ? env.DB.prepare('DELETE FROM budgets WHERE user_id = ? AND category_id = ?').bind(userId, categoryId)
    : env.DB.prepare('DELETE FROM budgets WHERE user_id = ? AND category_id IS NULL').bind(userId);
  const statements = [
    remove,
    env.DB.prepare("DELETE FROM budget_changes WHERE user_id = ? AND IFNULL(category_id, '') = ? AND month = ?").bind(userId, categoryId ?? '', month),
    env.DB.prepare('INSERT INTO budget_changes (id, user_id, category_id, month, amount) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), userId, categoryId, month, amount),
  ];
  if (amount > 0) {
    statements.push(env.DB.prepare('INSERT INTO budgets (id, user_id, category_id, amount) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), userId, categoryId, amount));
  }
  await env.DB.batch(statements);
  return json({ ok: true });
}
