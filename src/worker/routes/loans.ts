import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';

// Loans (pinjaman). Money received is recorded as a loan, not as spending. A repayment becomes an
// expense transaction on the day it is paid, and the remaining balance is the principal minus the
// repayments that are still on record.

const PAYMENT_METHODS = ['cash', 'debit', 'transfer'];
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** GET /api/loans */
export async function listLoans({ env, userId }: RouteContext) {
  const loans = await env.DB.prepare('SELECT id, name, principal, received_on FROM loans WHERE user_id = ? ORDER BY received_on DESC, created_at DESC')
    .bind(userId)
    .all<{ id: string; name: string; principal: number; received_on: string }>();
  const payments = await env.DB.prepare(
    `SELECT p.id, p.loan_id, p.paid_on, p.transaction_id, t.amount FROM loan_payments p
     JOIN transactions t ON t.id = p.transaction_id WHERE p.user_id = ? ORDER BY p.paid_on DESC`,
  )
    .bind(userId)
    .all<{ id: string; loan_id: string; paid_on: string; transaction_id: string; amount: number }>();

  return json({
    loans: loans.results.map((loan) => {
      const mine = payments.results.filter((payment) => payment.loan_id === loan.id);
      const paid = mine.reduce((sum, payment) => sum + payment.amount, 0);
      return {
        id: loan.id,
        name: loan.name,
        principal: loan.principal,
        receivedOn: loan.received_on,
        paid,
        remaining: loan.principal - paid,
        payments: mine.map((payment) => ({ id: payment.id, amount: payment.amount, paidOn: payment.paid_on, transactionId: payment.transaction_id })),
      };
    }),
  });
}

/** POST /api/loans { name, principal, receivedOn } */
export async function addLoan({ request, env, userId }: RouteContext) {
  const body = await readJson(request);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const principal = typeof body.principal === 'number' ? Math.round(body.principal) : 0;
  if (!name || name.length > 60) throw new HttpError(400, 'Nama pinjaman 1–60 karakter');
  if (!Number.isFinite(principal) || principal <= 0) throw new HttpError(400, 'Jumlah pinjaman harus lebih dari 0');
  if (!isDate(body.receivedOn)) throw new HttpError(400, 'Tanggal tidak valid');

  await env.DB.prepare('INSERT INTO loans (id, user_id, name, principal, received_on) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, name, principal, body.receivedOn)
    .run();
  return json({ ok: true }, 201);
}

/** DELETE /api/loans/:id: removes the loan and the expense transactions of its repayments. */
export async function removeLoan({ env, userId, params }: RouteContext) {
  const loan = await env.DB.prepare('SELECT id FROM loans WHERE id = ? AND user_id = ?').bind(params.id, userId).first();
  if (!loan) throw new HttpError(404, 'Pinjaman tidak ditemukan');
  const payments = await env.DB.prepare('SELECT transaction_id FROM loan_payments WHERE loan_id = ?').bind(params.id).all<{ transaction_id: string }>();
  await env.DB.batch([
    ...payments.results.map((row) => env.DB.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').bind(row.transaction_id, userId)),
    env.DB.prepare('DELETE FROM loans WHERE id = ? AND user_id = ?').bind(params.id, userId),
  ]);
  return json({ ok: true });
}

/** POST /api/loans/:id/payments { amount, paidOn, categoryId, method, sourceId? }: a repayment, counted as spending. */
export async function payLoan({ request, env, userId, params }: RouteContext) {
  const loan = await env.DB.prepare('SELECT name, principal FROM loans WHERE id = ? AND user_id = ?').bind(params.id, userId).first<{ name: string; principal: number }>();
  if (!loan) throw new HttpError(404, 'Pinjaman tidak ditemukan');
  const paidRow = await env.DB.prepare(
    'SELECT COALESCE(SUM(t.amount), 0) AS paid FROM loan_payments p JOIN transactions t ON t.id = p.transaction_id WHERE p.loan_id = ?',
  )
    .bind(params.id)
    .first<{ paid: number }>();
  const remaining = loan.principal - (paidRow?.paid ?? 0);

  const body = await readJson(request);
  const amount = typeof body.amount === 'number' ? Math.round(body.amount) : 0;
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Jumlah bayar harus lebih dari 0');
  if (amount > remaining) throw new HttpError(400, 'Jumlah bayar melebihi sisa pinjaman');
  if (!isDate(body.paidOn)) throw new HttpError(400, 'Tanggal tidak valid');
  if (typeof body.categoryId !== 'string') throw new HttpError(400, 'Pilih kategori');
  if (typeof body.method !== 'string' || !PAYMENT_METHODS.includes(body.method)) throw new HttpError(400, 'Cara bayar tidak valid');

  const category = await env.DB.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').bind(body.categoryId, userId).first();
  if (!category) throw new HttpError(404, 'Kategori tidak ditemukan');
  const sourceId = typeof body.sourceId === 'string' && body.sourceId ? body.sourceId : null;
  if (sourceId) {
    const source = await env.DB.prepare('SELECT id FROM payment_sources WHERE id = ? AND user_id = ?').bind(sourceId, userId).first();
    if (!source) throw new HttpError(404, 'Sumber pembayaran tidak ditemukan');
  }

  const transactionId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO transactions (id, user_id, occurred_on, amount, category_id, note, method, source_id, status, posted_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?)`,
    ).bind(transactionId, userId, body.paidOn, amount, body.categoryId, `Bayar pinjaman: ${loan.name}`, body.method, sourceId, body.paidOn),
    env.DB.prepare('INSERT INTO loan_payments (id, loan_id, user_id, transaction_id, paid_on) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), params.id, userId, transactionId, body.paidOn),
  ]);
  return json({ ok: true }, 201);
}
