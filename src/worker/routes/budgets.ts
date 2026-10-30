import { addMonths } from '../../shared/recurring';
import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';
import { todayInWib } from './ask';

// Budgets: a monthly amount per category, and a total. They repeat every month. The spending they are
// compared with is what is counted (posted) in the current month, the same as reports.

/** GET /api/budgets: the total and per-category budgets, with what has been spent this month. */
export async function listBudgets({ env, userId }: RouteContext) {
  const month = todayInWib().slice(0, 7);
  const start = `${month}-01`;
  const end = `${addMonths(month, 1)}-01`;
  const budgets = await env.DB.prepare('SELECT category_id, amount FROM budgets WHERE user_id = ?')
    .bind(userId)
    .all<{ category_id: string | null; amount: number }>();
  const spent = await env.DB.prepare(
    `SELECT category_id, SUM(amount) AS total FROM transactions
     WHERE user_id = ? AND status = 'posted' AND posted_on >= ? AND posted_on < ? GROUP BY category_id`,
  )
    .bind(userId, start, end)
    .all<{ category_id: string; total: number }>();

  const spentBy = new Map(spent.results.map((row) => [row.category_id, row.total]));
  const budgetBy = new Map(budgets.results.filter((row) => row.category_id !== null).map((row) => [row.category_id as string, row.amount]));
  return json({
    month,
    total: budgets.results.find((row) => row.category_id === null)?.amount ?? null,
    spent: [...spentBy.values()].reduce((sum, value) => sum + value, 0),
    // Every category with a budget or with spending this month, so the page can show both.
    categories: [...new Set([...budgetBy.keys(), ...spentBy.keys()])].map((categoryId) => ({
      categoryId,
      amount: budgetBy.get(categoryId) ?? null,
      spent: spentBy.get(categoryId) ?? 0,
    })),
  });
}

/** PUT /api/budgets { categoryId: "total" | <category id>, amount }: amount 0 or empty removes the budget. */
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

  const remove = categoryId
    ? env.DB.prepare('DELETE FROM budgets WHERE user_id = ? AND category_id = ?').bind(userId, categoryId)
    : env.DB.prepare('DELETE FROM budgets WHERE user_id = ? AND category_id IS NULL').bind(userId);
  if (amount === 0) {
    await remove.run();
  } else {
    await env.DB.batch([
      remove,
      env.DB.prepare('INSERT INTO budgets (id, user_id, category_id, amount) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), userId, categoryId, amount),
    ]);
  }
  return json({ ok: true });
}
