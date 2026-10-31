import { deleteFiles } from '../drive';
import { METHODS, isBilledKind, type Method, type SourceKind, type Transaction, type TransactionInput, type TransactionStatus } from '../../shared/types';
import { billPeriodOf } from '../../shared/billing';
import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';
import { notifyDataChange, recordActivity } from '../notify';
import { balanceOf } from './sources';

// Upper bound for one transaction (Rp 1 triliun). Guards against typos and unsafe integers.
const MAX_AMOUNT = 1_000_000_000_000;
const NOTE_MAX = 200;
const LIST_LIMIT = 500;
const LOCKED_MESSAGE = 'Transaksi ini sudah masuk tagihan yang lunas. Hanya catatan dan kategori yang bisa diubah.';
const INSTALLMENT_LOCKED_MESSAGE = 'Ini pembayaran cicilan. Nominal, tanggal, dan metode tidak bisa diubah.';
const INSTALLMENT_DELETE_MESSAGE = 'Ini pembayaran cicilan dan tidak bisa dihapus.';

interface TransactionRow {
  id: string;
  occurred_on: string;
  amount: number;
  category_id: string;
  note: string;
  method: Method;
  source_id: string | null;
  to_source_id: string | null;
  status: TransactionStatus;
  posted_on: string | null;
  occurred_time: string | null;
}

const SELECT_COLUMNS = 'id, occurred_on, occurred_time, amount, category_id, note, method, source_id, to_source_id, status, posted_on';

function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    occurredOn: row.occurred_on,
    amount: row.amount,
    categoryId: row.category_id,
    note: row.note,
    method: row.method,
    sourceId: row.source_id,
    toSourceId: row.to_source_id,
    status: row.status,
    postedOn: row.posted_on,
    occurredTime: row.occurred_time,
  };
}

/** True for a real calendar date in YYYY-MM-DD form. */
function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * The hidden category transfers are filed under, made the first time one is needed. A visible category the owner
 * already named "Transfer" is used as it is.
 */
export async function transferCategoryOf(db: D1Database, userId: string): Promise<string> {
  const hidden = await db.prepare("SELECT id FROM categories WHERE user_id = ? AND system = 1 AND name = 'Transfer'").bind(userId).first<{ id: string }>();
  if (hidden) return hidden.id;
  await db
    .prepare("INSERT OR IGNORE INTO categories (id, user_id, name, color, icon, system) VALUES (?, ?, 'Transfer', '#64748b', '⇄', 1)")
    .bind(crypto.randomUUID(), userId)
    .run();
  const row = await db.prepare("SELECT id FROM categories WHERE user_id = ? AND name = 'Transfer'").bind(userId).first<{ id: string }>();
  if (!row) throw new HttpError(500, 'Kategori transfer tidak bisa dibuat');
  return row.id;
}

/**
 * Checks a transaction body and the category and source it refers to.
 * Cash, debit and transfer are posted on the transaction date. Credit card and paylater
 * transactions are posted when their bill is paid (see postingOf).
 */
async function parseTransaction(db: D1Database, userId: string, body: Record<string, unknown>): Promise<TransactionInput> {
  if (typeof body.occurredOn !== 'string' || !isDate(body.occurredOn)) throw new HttpError(400, 'Tanggal tidak valid');

  const amount = body.amount;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    throw new HttpError(400, 'Nominal harus bilangan bulat lebih dari 0');
  }

  if (!METHODS.includes(body.method as Method)) throw new HttpError(400, 'Metode bayar tidak valid');
  const method = body.method as Method;

  const note = body.note ?? '';
  if (typeof note !== 'string' || note.trim().length > NOTE_MAX) throw new HttpError(400, `Catatan maksimal ${NOTE_MAX} karakter`);

  // A transfer moves money between savings accounts, so it has no category: it is filed under the hidden Transfer one.
  let categoryId: string;
  if (method === 'transfer') {
    categoryId = await transferCategoryOf(db, userId);
  } else {
    if (typeof body.categoryId !== 'string') throw new HttpError(400, 'Pilih kategori');
    const category = await db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').bind(body.categoryId, userId).first();
    if (!category) throw new HttpError(400, 'Kategori tidak ditemukan');
    categoryId = body.categoryId;
  }

  // A credit card or paylater source needs the credit method, and the credit method needs one of them.
  // Other methods may name a savings source, or none.
  let sourceId: string | null = null;
  if (body.sourceId !== undefined && body.sourceId !== null) {
    if (typeof body.sourceId !== 'string') throw new HttpError(400, 'Pilih sumber dana');
    const source = await db.prepare('SELECT kind FROM payment_sources WHERE id = ? AND user_id = ?').bind(body.sourceId, userId).first<{ kind: SourceKind }>();
    if (!source) throw new HttpError(400, 'Sumber dana tidak ditemukan');
    if (method === 'credit' && !isBilledKind(source.kind)) throw new HttpError(400, 'Pilih kartu kredit atau paylater');
    if (method !== 'credit' && isBilledKind(source.kind)) throw new HttpError(400, 'Kartu kredit dan paylater hanya untuk metode Kartu kredit');
    sourceId = body.sourceId;
  } else if (method === 'credit') {
    throw new HttpError(400, 'Pilih kartu kredit atau paylater');
  }

  // A transfer moves money from one savings account to another: both are needed, and they must differ.
  let toSourceId: string | null = null;
  if (method === 'transfer') {
    if (!sourceId) throw new HttpError(400, 'Pilih rekening asal transfer');
    if (typeof body.toSourceId !== 'string' || !body.toSourceId) throw new HttpError(400, 'Pilih rekening tujuan transfer');
    if (body.toSourceId === sourceId) throw new HttpError(400, 'Rekening asal dan tujuan harus berbeda');
    const target = await db.prepare("SELECT id FROM payment_sources WHERE id = ? AND user_id = ? AND kind = 'savings'").bind(body.toSourceId, userId).first();
    if (!target) throw new HttpError(400, 'Transfer hanya bisa ke rekening tabungan');
    toSourceId = body.toSourceId;
  }

  const occurredTime = typeof body.occurredTime === 'string' && /^([01]d|2[0-3]):[0-5]d$/.test(body.occurredTime) ? body.occurredTime : null;
  return { occurredOn: body.occurredOn, occurredTime, amount, categoryId, note: note.trim(), method, sourceId, toSourceId };
}

/** GET /api/transactions?from=&to=&category=&method=&q= */
export async function listTransactions({ request, env, userId }: RouteContext) {
  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const category = url.searchParams.get('category');
  const method = url.searchParams.get('method');
  const query = url.searchParams.get('q')?.trim();

  if (from && !isDate(from)) throw new HttpError(400, 'Tanggal awal tidak valid');
  if (to && !isDate(to)) throw new HttpError(400, 'Tanggal akhir tidak valid');
  // "cards" is debit and credit together: both are shown as Cards in the app.
  if (method && method !== 'cards' && !METHODS.includes(method as Method)) throw new HttpError(400, 'Metode bayar tidak valid');

  const clauses = ['user_id = ?'];
  const binds: (string | number)[] = [userId];
  if (from) {
    clauses.push('occurred_on >= ?');
    binds.push(from);
  }
  if (to) {
    clauses.push('occurred_on <= ?');
    binds.push(to);
  }
  if (category) {
    clauses.push('category_id = ?');
    binds.push(category);
  }
  if (method === 'cards') {
    clauses.push("method IN ('debit', 'credit')");
  } else if (method) {
    clauses.push('method = ?');
    binds.push(method);
  }
  if (query) {
    clauses.push('instr(lower(note), lower(?)) > 0');
    binds.push(query);
  }

  const sql = `SELECT ${SELECT_COLUMNS} FROM transactions WHERE ${clauses.join(' AND ')} ORDER BY occurred_on DESC, created_at DESC LIMIT ${LIST_LIMIT}`;
  const { results } = await env.DB.prepare(sql)
    .bind(...binds)
    .all<TransactionRow>();
  return json({ transactions: results.map(toTransaction) });
}

/**
 * Status and posting date for a transaction. Cash, debit and transfer count on their date.
 * A credit card or paylater transaction counts on the payment date of its bill once that bill is
 * paid; until then it is unpaid. A transaction dated into an already paid bill counts at once.
 */
async function postingOf(db: D1Database, userId: string, input: TransactionInput): Promise<Pick<Transaction, 'status' | 'postedOn'>> {
  if (input.method !== 'credit') return { status: 'posted', postedOn: input.occurredOn };
  if (!input.sourceId) throw new HttpError(400, 'Pilih kartu kredit atau paylater');

  const source = await db.prepare('SELECT closing_day FROM payment_sources WHERE id = ? AND user_id = ?').bind(input.sourceId, userId).first<{ closing_day: number }>();
  if (!source) throw new HttpError(400, 'Sumber dana tidak ditemukan');
  const period = billPeriodOf(input.occurredOn, source.closing_day);
  const paid = await db
    .prepare('SELECT paid_on FROM card_bills WHERE source_id = ? AND period = ? AND user_id = ?')
    .bind(input.sourceId, period, userId)
    .first<{ paid_on: string }>();
  return paid ? { status: 'posted', postedOn: paid.paid_on } : { status: 'unpaid', postedOn: null };
}

/**
 * Spending from a savings account (any method but credit) must not take it below zero. `alreadyCounted` is what
 * this transaction already takes from the same account, when it is being edited.
 */
async function ensureFunds(db: D1Database, input: TransactionInput, alreadyCounted = 0) {
  if (input.method === 'credit' || !input.sourceId) return;
  const balance = (await balanceOf(db, input.sourceId)) + alreadyCounted;
  if (balance < input.amount) {
    const source = await db.prepare('SELECT name FROM payment_sources WHERE id = ?').bind(input.sourceId).first<{ name: string }>();
    const rupiah = (value: number) => `Rp${Math.max(0, value).toLocaleString('id-ID')}`;
    throw new HttpError(400, `Saldo ${source?.name ?? 'rekening'} tidak cukup: tersisa ${rupiah(balance)}, perlu ${rupiah(input.amount)}.`);
  }
}

/** POST /api/transactions */
export async function createTransaction({ request, env, userId, actorId }: RouteContext) {
  const input = await parseTransaction(env.DB, userId, await readJson(request));
  await ensureFunds(env.DB, input);
  const posting = await postingOf(env.DB, userId, input);
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO transactions (id, user_id, occurred_on, occurred_time, amount, category_id, note, method, source_id, to_source_id, status, posted_on)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, input.occurredOn, input.occurredTime, input.amount, input.categoryId, input.note, input.method, input.sourceId, input.toSourceId, posting.status, posting.postedOn)
    .run();
  await notifyDataChange(env, userId, actorId, 'data_created', input.amount);
  await recordActivity(env, userId, actorId, 'tx_created', { amount: input.amount, note: input.note });
  return json({ transaction: { id, ...input, ...posting } }, 201);
}

/**
 * PUT /api/transactions/:id. A credit transaction whose bill is paid is locked: only its note and
 * category can change, so the paid bill keeps matching its transactions.
 */
export async function updateTransaction({ request, env, userId, actorId, params }: RouteContext) {
  const existing = await env.DB.prepare('SELECT occurred_on, amount, method, source_id, status, posted_on FROM transactions WHERE id = ? AND user_id = ?')
    .bind(params.id, userId)
    .first<{ occurred_on: string; amount: number; method: Method; source_id: string | null; status: TransactionStatus; posted_on: string | null }>();
  if (!existing) throw new HttpError(404, 'Transaksi tidak ditemukan');

  const input = await parseTransaction(env.DB, userId, await readJson(request));
  const isInstallment = await env.DB.prepare('SELECT 1 FROM recurring_payments WHERE transaction_id = ?').bind(params.id).first();
  if (isInstallment && (input.amount !== existing.amount || input.occurredOn !== existing.occurred_on || input.method !== existing.method)) {
    throw new HttpError(409, INSTALLMENT_LOCKED_MESSAGE);
  }
  await ensureFunds(env.DB, input, existing.method !== 'credit' && existing.source_id === input.sourceId ? existing.amount : 0);
  let posting: Pick<Transaction, 'status' | 'postedOn'>;
  if (existing.method === 'credit' && existing.status === 'posted') {
    const changed = input.amount !== existing.amount || input.occurredOn !== existing.occurred_on || input.sourceId !== existing.source_id || input.method !== 'credit';
    if (changed) throw new HttpError(409, LOCKED_MESSAGE);
    posting = { status: existing.status, postedOn: existing.posted_on };
  } else {
    posting = await postingOf(env.DB, userId, input);
  }

  await env.DB.prepare(
    `UPDATE transactions
     SET occurred_on = ?, occurred_time = ?, amount = ?, category_id = ?, note = ?, method = ?, source_id = ?, to_source_id = ?, status = ?, posted_on = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(input.occurredOn, input.occurredTime, input.amount, input.categoryId, input.note, input.method, input.sourceId, input.toSourceId, posting.status, posting.postedOn, params.id, userId)
    .run();

  await notifyDataChange(env, userId, actorId, 'data_updated', input.amount);
  await recordActivity(env, userId, actorId, 'tx_updated', { amount: input.amount, note: input.note });
  return json({ transaction: { id: params.id, ...input, ...posting } });
}

/** DELETE /api/transactions/:id. A credit transaction in a paid bill cannot be deleted. */
export async function deleteTransaction({ env, userId, actorId, params }: RouteContext) {
  const existing = await env.DB.prepare('SELECT method, status, amount, note FROM transactions WHERE id = ? AND user_id = ?')
    .bind(params.id, userId)
    .first<{ method: Method; status: TransactionStatus; amount: number; note: string }>();
  if (!existing) throw new HttpError(404, 'Transaksi tidak ditemukan');
  if (existing.method === 'credit' && existing.status === 'posted') {
    throw new HttpError(409, 'Transaksi ini sudah masuk tagihan yang lunas dan tidak bisa dihapus.');
  }
  const isInstallment = await env.DB.prepare('SELECT 1 FROM recurring_payments WHERE transaction_id = ?').bind(params.id).first();
  if (isInstallment) throw new HttpError(409, INSTALLMENT_DELETE_MESSAGE);

  // Receipt files go with the transaction: their rows cascade, the files in Drive are removed here.
  const files = await env.DB.prepare('SELECT drive_file_id FROM attachments WHERE transaction_id = ?').bind(params.id).all<{ drive_file_id: string }>();
  await env.DB.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').bind(params.id, userId).run();
  if (files.results.length) await deleteFiles(env, files.results.map((row) => row.drive_file_id));
  await notifyDataChange(env, userId, actorId, 'data_deleted', existing.amount);
  await recordActivity(env, userId, actorId, 'tx_deleted', { amount: existing.amount, note: existing.note });
  return json({ ok: true });
}
