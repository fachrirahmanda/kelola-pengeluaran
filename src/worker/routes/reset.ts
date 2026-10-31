import { DEFAULT_CATEGORIES } from '../../shared/types';
import { deleteFiles } from '../drive';
import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';

// Reset data (Profile): empties the data set so the owner can start again. Everything recorded goes: transactions,
// sources of funds, installments, card bills, loans, incomes, salaries, budgets, attachments (also in Drive),
// notifications and the Ask AI history. The account, the workspace and its members stay. Categories stay too
// unless the owner asks for them to go back to the defaults.

/** The word the owner types to confirm. */
export const RESET_WORD = 'RESET';

/** Tables emptied, children before parents, all keyed by the data set's user_id. */
const TABLES = ['incomes', 'salaries', 'recurring_payments', 'loan_payments', 'attachments', 'card_bills', 'transactions', 'recurring_items', 'loans', 'budget_changes', 'budgets', 'payment_sources', 'notifications'];

/** POST /api/profile/reset { confirm: "RESET", keepCategories } */
export async function resetData({ request, env, userId, role }: RouteContext) {
  if (role !== 'owner') throw new HttpError(403, 'Hanya pemilik data yang bisa mereset data');
  const body = await readJson(request);
  if (body.confirm !== RESET_WORD) throw new HttpError(400, `Ketik ${RESET_WORD} untuk mengonfirmasi`);
  const keepCategories = body.keepCategories !== false;

  const files = await env.DB.prepare('SELECT drive_file_id FROM attachments WHERE user_id = ?').bind(userId).all<{ drive_file_id: string }>();

  // One batch, so the reset happens completely or not at all.
  const statements = TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId));
  statements.push(env.DB.prepare('DELETE FROM ai_questions WHERE user_id IN (SELECT user_id FROM workspace_members WHERE owner_id = ?)').bind(userId));
  if (!keepCategories) {
    statements.push(env.DB.prepare('DELETE FROM categories WHERE user_id = ?').bind(userId));
    for (const category of DEFAULT_CATEGORIES) {
      statements.push(
        env.DB.prepare('INSERT INTO categories (id, user_id, name, color, icon) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), userId, category.name, category.color, category.icon),
      );
    }
  }
  await env.DB.batch(statements);

  // Drive files last: the records are gone either way, and a file Drive cannot remove only stays in Drive.
  if (files.results.length) await deleteFiles(env, files.results.map((row) => row.drive_file_id));
  return json({ ok: true });
}
