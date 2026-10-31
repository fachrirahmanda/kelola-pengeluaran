import { SOURCE_KINDS, isBilledKind, type PaymentSource, type SourceKind } from '../../shared/types';
import { bankById } from '../../shared/banks';
import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';
import { syncSalaries } from './salaries';

const NAME_MAX = 40;

interface SourceRow {
  id: string;
  name: string;
  kind: SourceKind;
  closing_day: number | null;
  payment_day: number | null;
  bank: string | null;
  opening_balance?: number;
  credit_limit?: number | null;
  income?: number;
  spent?: number;
  owed?: number;
}

function toSource(row: SourceRow): PaymentSource {
  const source: PaymentSource = { id: row.id, name: row.name, kind: row.kind, closingDay: row.closing_day, paymentDay: row.payment_day, bank: row.bank };
  if (row.kind === 'savings') {
    source.openingBalance = row.opening_balance ?? 0;
    source.balance = (row.opening_balance ?? 0) + (row.income ?? 0) - (row.spent ?? 0);
  } else {
    source.creditLimit = row.credit_limit ?? null;
    source.owed = row.owed ?? 0;
  }
  return source;
}

function isDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 28;
}

/**
 * Checks a source. Savings has no billing days. Credit cards and paylater need both, because
 * their transactions are billed on those days. `current` fills in fields that were not sent (PATCH).
 */
function parseSource(body: Record<string, unknown>, current?: Pick<PaymentSource, 'name' | 'kind' | 'closingDay' | 'paymentDay' | 'openingBalance' | 'creditLimit' | 'bank'>) {
  const name = body.name ?? current?.name;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > NAME_MAX) {
    throw new HttpError(400, `Nama sumber dana wajib diisi (maks. ${NAME_MAX} karakter)`);
  }

  const kind = body.kind ?? current?.kind;
  if (typeof kind !== 'string' || !SOURCE_KINDS.includes(kind as SourceKind)) throw new HttpError(400, 'Jenis sumber dana tidak valid');

  const closingDay = body.closingDay !== undefined ? body.closingDay : current?.closingDay ?? null;
  const paymentDay = body.paymentDay !== undefined ? body.paymentDay : current?.paymentDay ?? null;

  const openingBalance = body.openingBalance !== undefined ? body.openingBalance : current?.openingBalance ?? 0;
  const creditLimit = body.creditLimit !== undefined ? body.creditLimit : current?.creditLimit ?? null;
  const bankInput = body.bank !== undefined ? body.bank : current?.bank ?? null;
  const bank = typeof bankInput === 'string' && bankById(bankInput) ? bankInput : null;
  if (kind === 'savings') {
    if (typeof openingBalance !== 'number' || !Number.isInteger(openingBalance) || openingBalance < 0) throw new HttpError(400, 'Saldo awal tidak valid');
    return { name: name.trim(), kind: 'savings' as const, closingDay: null, paymentDay: null, openingBalance, creditLimit: null, bank };
  }
  if (!isBilledKind(kind as SourceKind)) throw new HttpError(400, 'Jenis sumber dana tidak valid');
  if (!isDay(closingDay)) throw new HttpError(400, 'Tanggal tutup tagihan harus 1-28');
  if (!isDay(paymentDay)) throw new HttpError(400, 'Tanggal pelunasan harus 1-28');
  if (creditLimit !== null && (typeof creditLimit !== 'number' || !Number.isInteger(creditLimit) || creditLimit <= 0)) throw new HttpError(400, 'Limit harus bilangan bulat lebih dari 0');
  return { name: name.trim(), kind: kind as SourceKind, closingDay, paymentDay, openingBalance: 0, creditLimit, bank };
}

/** What a savings account holds now: opening balance + income - spent from it - card bills paid from it. */
export async function balanceOf(db: D1Database, sourceId: string) {
  const row = await db
    .prepare(
      `SELECT s.opening_balance
         + (SELECT COALESCE(SUM(i.amount), 0) FROM incomes i WHERE i.source_id = s.id)
         - (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t WHERE t.source_id = s.id AND t.status = 'posted' AND t.method <> 'credit')
         - (SELECT COALESCE(SUM(b.total), 0) FROM card_bills b WHERE b.paid_from_id = s.id) AS balance
       FROM payment_sources s WHERE s.id = ?`,
    )
    .bind(sourceId)
    .first<{ balance: number }>();
  return row?.balance ?? 0;
}

/**
 * The savings account a debit payment comes from (installment, card bill, loan repayment). Only savings
 * can pay by debit: a credit card or paylater cannot pay another bill. With an amount, the account must hold
 * at least that much; a payment never takes it below zero. Returns its id and name.
 */
export async function debitSourceOf(db: D1Database, userId: string, sourceId: unknown, amount?: number) {
  if (typeof sourceId !== 'string' || !sourceId) throw new HttpError(400, 'Pilih rekening untuk bayar debit');
  const source = await db.prepare('SELECT id, name, kind FROM payment_sources WHERE id = ? AND user_id = ?').bind(sourceId, userId).first<{ id: string; name: string; kind: SourceKind }>();
  if (!source) throw new HttpError(404, 'Rekening tidak ditemukan');
  if (source.kind !== 'savings') throw new HttpError(400, 'Bayar debit hanya bisa dari rekening tabungan');
  if (amount !== undefined) {
    const balance = await balanceOf(db, source.id);
    if (balance < amount) {
      const rupiah = (value: number) => `Rp${Math.max(0, value).toLocaleString('id-ID')}`;
      throw new HttpError(400, `Saldo ${source.name} tidak cukup: tersisa ${rupiah(balance)}, perlu ${rupiah(amount)}.`);
    }
  }
  return { id: source.id, name: source.name };
}

/** GET /api/sources */
export async function listSources({ env, userId }: RouteContext) {
  // Salaries whose payday has come are recorded first, so the balances include them.
  await syncSalaries(env, userId);
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.name, s.kind, s.closing_day, s.payment_day, s.bank, s.opening_balance, s.credit_limit,
       (SELECT COALESCE(SUM(i.amount), 0) FROM incomes i WHERE i.source_id = s.id) AS income,
       (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t WHERE t.source_id = s.id AND t.status = 'posted' AND t.method <> 'credit')
         + (SELECT COALESCE(SUM(b.total), 0) FROM card_bills b WHERE b.paid_from_id = s.id) AS spent,
       (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t WHERE t.source_id = s.id AND t.status = 'unpaid') AS owed
     FROM payment_sources s WHERE s.user_id = ? ORDER BY s.rowid`,
  )
    .bind(userId)
    .all<SourceRow>();
  return json({ sources: results.map(toSource) });
}

/** POST /api/sources */
export async function createSource({ request, env, userId }: RouteContext) {
  const input = parseSource(await readJson(request));
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO payment_sources (id, user_id, name, kind, closing_day, payment_day, opening_balance, credit_limit, bank) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, userId, input.name, input.kind, input.closingDay, input.paymentDay, input.openingBalance, input.creditLimit, input.bank)
    .run();
  return json({ source: { id, ...input } }, 201);
}

/** PATCH /api/sources/:id. The kind cannot change: existing transactions depend on it. */
export async function updateSource({ request, env, userId, params }: RouteContext) {
  const current = await env.DB.prepare('SELECT id, name, kind, closing_day, payment_day, bank, opening_balance, credit_limit FROM payment_sources WHERE id = ? AND user_id = ?')
    .bind(params.id, userId)
    .first<SourceRow>();
  if (!current) throw new HttpError(404, 'Sumber dana tidak ditemukan');

  const body = await readJson(request);
  if (body.kind !== undefined && body.kind !== current.kind) throw new HttpError(400, 'Jenis sumber dana tidak bisa diubah');
  const input = parseSource(body, toSource(current));
  await env.DB.prepare('UPDATE payment_sources SET name = ?, closing_day = ?, payment_day = ?, opening_balance = ?, credit_limit = ?, bank = ? WHERE id = ? AND user_id = ?')
    .bind(input.name, input.closingDay, input.paymentDay, input.openingBalance, input.creditLimit, input.bank, current.id, userId)
    .run();
  return json({ source: { id: current.id, ...input } });
}

/** DELETE /api/sources/:id. Refused while transactions still use the source. */
export async function deleteSource({ env, userId, params }: RouteContext) {
  const usage = await env.DB.prepare('SELECT COUNT(*) AS total FROM transactions WHERE source_id = ? AND user_id = ?')
    .bind(params.id, userId)
    .first<{ total: number }>();
  if (usage && usage.total > 0) {
    throw new HttpError(409, `Sumber dana dipakai ${usage.total} transaksi. Hapus atau ubah transaksinya dulu.`);
  }
  const bills = await env.DB.prepare('SELECT COUNT(*) AS total FROM card_bills WHERE (source_id = ? OR paid_from_id = ?) AND user_id = ?')
    .bind(params.id, params.id, userId)
    .first<{ total: number }>();
  if (bills && bills.total > 0) throw new HttpError(409, `Sumber dana dipakai ${bills.total} tagihan yang sudah lunas, jadi tidak bisa dihapus.`);

  const result = await env.DB.prepare('DELETE FROM payment_sources WHERE id = ? AND user_id = ?').bind(params.id, userId).run();
  if (result.meta.changes === 0) throw new HttpError(404, 'Sumber dana tidak ditemukan');
  return json({ ok: true });
}
