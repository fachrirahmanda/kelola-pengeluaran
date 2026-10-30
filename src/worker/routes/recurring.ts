import type { Env } from '../env';
import { addMonths, dueDateOf, dueMonthOf, monthOf, nextInstallment } from '../../shared/recurring';
import { RECURRING_METHODS, type RecurringItem, type RecurringMethod, type RecurringPayment } from '../../shared/types';
import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';

const NAME_MAX = 60;
const MAX_AMOUNT = 1_000_000_000_000;
const MAX_MONTHS = 600;
const PAYMENT_LIST_LIMIT = 50;

interface ItemRow {
  id: string;
  name: string;
  amount: number;
  category_id: string;
  start_date: string;
  total_months: number | null;
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Today in WIB as YYYY-MM-DD. */
function todayWib(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function categoryOwned(db: D1Database, userId: string, categoryId: unknown): Promise<string> {
  if (typeof categoryId !== 'string') throw new HttpError(400, 'Pilih kategori');
  const row = await db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').bind(categoryId, userId).first();
  if (!row) throw new HttpError(400, 'Kategori tidak ditemukan');
  return categoryId;
}

/** Checks name, amount, category and (for a new item) the start date and number of months. */
function parseItem(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > NAME_MAX) throw new HttpError(400, `Nama wajib diisi (maks. ${NAME_MAX} karakter)`);
  const amount = body.amount;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    throw new HttpError(400, 'Nominal harus bilangan bulat lebih dari 0');
  }
  return { name, amount };
}

function toItem(row: ItemRow, paidCount: number, lastPaidOn: string | null, today: string): RecurringItem {
  const next = nextInstallment(paidCount, row.total_months);
  const nextDueMonth = next === null ? null : dueMonthOf(row.start_date, next);
  return {
    id: row.id,
    name: row.name,
    amount: row.amount,
    categoryId: row.category_id,
    startDate: row.start_date,
    totalMonths: row.total_months,
    paidCount,
    remaining: row.total_months === null ? null : row.total_months - paidCount,
    nextInstallment: next,
    nextDueMonth,
    nextDueDate: next === null ? null : dueDateOf(row.start_date, next),
    overdue: nextDueMonth !== null && nextDueMonth < monthOf(today),
    lastPaidOn,
  };
}

/** GET /api/recurring: all items, the ones due next month or earlier, and recent payments. */
export async function listRecurring({ env, userId }: RouteContext) {
  const { results: rows } = await env.DB.prepare('SELECT id, name, amount, category_id, start_date, total_months FROM recurring_items WHERE user_id = ? ORDER BY created_at, name')
    .bind(userId)
    .all<ItemRow>();
  const { results: counts } = await env.DB.prepare('SELECT item_id, COUNT(*) AS paid, MAX(paid_on) AS last_paid_on FROM recurring_payments WHERE user_id = ? GROUP BY item_id')
    .bind(userId)
    .all<{ item_id: string; paid: number; last_paid_on: string | null }>();
  const paidBy = new Map(counts.map((row) => [row.item_id, row.paid]));
  const lastPaidBy = new Map(counts.map((row) => [row.item_id, row.last_paid_on]));

  const today = todayWib();
  const nextMonth = addMonths(monthOf(today), 1);
  const items = rows.map((row) => toItem(row, paidBy.get(row.id) ?? 0, lastPaidBy.get(row.id) ?? null, today));
  const upcoming = items
    .filter((item) => item.nextDueMonth !== null && item.nextDueMonth <= nextMonth)
    .sort((a, b) => (a.nextDueDate ?? '').localeCompare(b.nextDueDate ?? ''));

  const { results: paymentRows } = await env.DB.prepare(
    `SELECT p.id, p.item_id, i.name, p.installment, p.due_month, p.amount, p.paid_on
     FROM recurring_payments p JOIN recurring_items i ON i.id = p.item_id
     WHERE p.user_id = ? ORDER BY p.paid_on DESC, p.created_at DESC LIMIT ${PAYMENT_LIST_LIMIT}`,
  )
    .bind(userId)
    .all<{ id: string; item_id: string; name: string; installment: number; due_month: string; amount: number; paid_on: string }>();
  const payments: RecurringPayment[] = paymentRows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    name: row.name,
    installment: row.installment,
    dueMonth: row.due_month,
    amount: row.amount,
    paidOn: row.paid_on,
  }));

  return json({ items, upcoming, payments, nextMonth });
}

/** POST /api/recurring { name, amount, categoryId, startDate, totalMonths | null } */

/** A month as YYYY-MM: "paid through" and the catch-up use it. */
const isMonth = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/**
 * Records every installment due up to `throughMonth` that is not recorded yet: one posted transaction and one
 * installment payment each, both dated on the due day. Installments already recorded are left alone.
 * Returns how many installments were added.
 */
async function recordThrough(env: Env, userId: string, item: ItemRow, throughMonth: string, method: RecurringMethod): Promise<number> {
  const paid = await env.DB.prepare('SELECT COUNT(*) AS paid FROM recurring_payments WHERE item_id = ?').bind(item.id).first<{ paid: number }>();
  const statements: D1PreparedStatement[] = [];
  let installment = nextInstallment(paid?.paid ?? 0, item.total_months);
  while (installment !== null && dueMonthOf(item.start_date, installment) <= throughMonth) {
    const dueDate = dueDateOf(item.start_date, installment);
    const transactionId = crypto.randomUUID();
    statements.push(
      env.DB.prepare(
        `INSERT INTO transactions (id, user_id, occurred_on, amount, category_id, note, method, source_id, status, posted_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'posted', ?)`,
      ).bind(transactionId, userId, dueDate, item.amount, item.category_id, `${item.name} (${installment})`, method, dueDate),
      env.DB.prepare(
        'INSERT INTO recurring_payments (id, user_id, item_id, installment, due_month, amount, paid_on, transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), userId, item.id, installment, dueMonthOf(item.start_date, installment), item.amount, dueDate, transactionId),
    );
    installment = nextInstallment(installment, item.total_months);
  }
  // Each installment is two statements. D1 takes a limited number per batch, so they go in chunks of 40.
  for (let index = 0; index < statements.length; index += 40) {
    await env.DB.batch(statements.slice(index, index + 40));
  }
  return statements.length / 2;
}

export async function createRecurring({ request, env, userId }: RouteContext) {
  const body = await readJson(request);
  const { name, amount } = parseItem(body);
  const categoryId = await categoryOwned(env.DB, userId, body.categoryId);
  if (!isDate(body.startDate)) throw new HttpError(400, 'Tanggal mulai tidak valid');
  const totalMonths = body.totalMonths ?? null;
  if (totalMonths !== null && (typeof totalMonths !== 'number' || !Number.isInteger(totalMonths) || totalMonths < 1 || totalMonths > MAX_MONTHS)) {
    throw new HttpError(400, `Jumlah bulan harus 1-${MAX_MONTHS}, atau kosong untuk tanpa batas`);
  }

  // Optional: the last month that was paid (the latest payment). Every installment due up to it is recorded.
  const paidThrough = body.paidThrough;
  if (paidThrough !== undefined && paidThrough !== null && paidThrough !== '' && !isMonth(paidThrough)) throw new HttpError(400, 'Bulan pembayaran tidak valid');
  if (isMonth(paidThrough) && paidThrough > todayWib().slice(0, 7)) throw new HttpError(400, 'Bulan pembayaran tidak boleh di masa depan');

  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO recurring_items (id, user_id, name, amount, category_id, start_date, total_months) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, userId, name, amount, categoryId, body.startDate, totalMonths)
    .run();
  const row: ItemRow = { id, name, amount, category_id: categoryId, start_date: body.startDate, total_months: totalMonths };
  if (isMonth(paidThrough)) await recordThrough(env, userId, row, paidThrough, 'transfer');
  const paid = await env.DB.prepare('SELECT COUNT(*) AS paid, MAX(paid_on) AS last_paid_on FROM recurring_payments WHERE item_id = ?').bind(id).first<{ paid: number; last_paid_on: string | null }>();
  return json({ item: toItem(row, paid?.paid ?? 0, paid?.last_paid_on ?? null, todayWib()) }, 201);
}

/** POST /api/recurring/:id/catch-up { throughMonth, method }: records the installments due up to that month. */
export async function catchUpRecurring({ request, env, userId, params }: RouteContext) {
  const item = await env.DB.prepare('SELECT id, name, amount, category_id, start_date, total_months FROM recurring_items WHERE id = ? AND user_id = ?')
    .bind(params.id, userId)
    .first<ItemRow>();
  if (!item) throw new HttpError(404, 'Cicilan tidak ditemukan');
  const body = await readJson(request);
  if (!isMonth(body.throughMonth)) throw new HttpError(400, 'Pilih bulan pembayaran terakhir');
  if (body.throughMonth > todayWib().slice(0, 7)) throw new HttpError(400, 'Bulan pembayaran tidak boleh di masa depan');
  if (!RECURRING_METHODS.includes(body.method as RecurringMethod)) throw new HttpError(400, 'Metode bayar tidak valid');
  const added = await recordThrough(env, userId, item, body.throughMonth, body.method as RecurringMethod);
  return json({ added });
}

/** PATCH /api/recurring/:id. The start date and number of months stay fixed. */
export async function updateRecurring({ request, env, userId, params }: RouteContext) {
  const current = await env.DB.prepare('SELECT id, name, amount, category_id, start_date, total_months FROM recurring_items WHERE id = ? AND user_id = ?')
    .bind(params.id, userId)
    .first<ItemRow>();
  if (!current) throw new HttpError(404, 'Cicilan tidak ditemukan');

  const body = await readJson(request);
  const { name, amount } = parseItem({ name: body.name ?? current.name, amount: body.amount ?? current.amount });
  const categoryId = body.categoryId === undefined ? current.category_id : await categoryOwned(env.DB, userId, body.categoryId);
  await env.DB.prepare('UPDATE recurring_items SET name = ?, amount = ?, category_id = ? WHERE id = ? AND user_id = ?')
    .bind(name, amount, categoryId, current.id, userId)
    .run();

  const paid = await env.DB.prepare('SELECT COUNT(*) AS paid, MAX(paid_on) AS last_paid_on FROM recurring_payments WHERE item_id = ?').bind(current.id).first<{ paid: number; last_paid_on: string | null }>();
  return json({ item: toItem({ ...current, name, amount, category_id: categoryId }, paid?.paid ?? 0, paid?.last_paid_on ?? null, todayWib()) });
}

/** DELETE /api/recurring/:id. Refused once an installment has been paid. */
export async function deleteRecurring({ env, userId, params }: RouteContext) {
  const paid = await env.DB.prepare('SELECT COUNT(*) AS paid FROM recurring_payments WHERE item_id = ? AND user_id = ?')
    .bind(params.id, userId)
    .first<{ paid: number }>();
  if (paid && paid.paid > 0) throw new HttpError(409, 'Cicilan sudah punya pembayaran dan tidak bisa dihapus.');

  const result = await env.DB.prepare('DELETE FROM recurring_items WHERE id = ? AND user_id = ?').bind(params.id, userId).run();
  if (result.meta.changes === 0) throw new HttpError(404, 'Cicilan tidak ditemukan');
  return json({ ok: true });
}

/**
 * POST /api/recurring/:id/pay { paidOn, method }: pays the next installment. It becomes a posted
 * transaction on the payment date, in the item's category.
 */
export async function payRecurring({ request, env, userId, params }: RouteContext) {
  const item = await env.DB.prepare('SELECT id, name, amount, category_id, start_date, total_months FROM recurring_items WHERE id = ? AND user_id = ?')
    .bind(params.id, userId)
    .first<ItemRow>();
  if (!item) throw new HttpError(404, 'Cicilan tidak ditemukan');

  const body = await readJson(request);
  if (!isDate(body.paidOn)) throw new HttpError(400, 'Tanggal pelunasan tidak valid');
  if (!RECURRING_METHODS.includes(body.method as RecurringMethod)) throw new HttpError(400, 'Metode bayar tidak valid');
  const method = body.method as RecurringMethod;

  const paid = await env.DB.prepare('SELECT COUNT(*) AS paid FROM recurring_payments WHERE item_id = ?').bind(item.id).first<{ paid: number }>();
  const installment = nextInstallment(paid?.paid ?? 0, item.total_months);
  if (installment === null) throw new HttpError(400, 'Semua cicilan sudah lunas');

  const transactionId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  const dueMonth = dueMonthOf(item.start_date, installment);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO transactions (id, user_id, occurred_on, amount, category_id, note, method, source_id, status, posted_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'posted', ?)`,
      ).bind(transactionId, userId, body.paidOn, item.amount, item.category_id, `${item.name} (${installment})`, method, body.paidOn),
      env.DB.prepare(
        'INSERT INTO recurring_payments (id, user_id, item_id, installment, due_month, amount, paid_on, transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(paymentId, userId, item.id, installment, dueMonth, item.amount, body.paidOn, transactionId),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new HttpError(409, 'Cicilan ini sudah dibayar. Muat ulang halaman.');
    throw error;
  }

  const payment: RecurringPayment = {
    id: paymentId,
    itemId: item.id,
    name: item.name,
    installment,
    dueMonth,
    amount: item.amount,
    paidOn: body.paidOn,
  };
  return json({ payment }, 201);
}
