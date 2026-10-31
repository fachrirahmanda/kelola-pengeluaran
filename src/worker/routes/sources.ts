import { SOURCE_KINDS, isBilledKind, type PaymentSource, type SourceKind } from '../../shared/types';
import { bankKinds } from '../../shared/banks';
import type { Env } from '../env';
import { banksOf } from './banks';
import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';
import { syncSalaries } from './salaries';
import { photoOf } from './workspace';
import type { SourceHolder } from '../../shared/types';

const NAME_MAX = 40;

interface SourceRow {
  id: string;
  name: string;
  kind: SourceKind;
  closing_day: number | null;
  billing_day?: number | null;
  payment_day: number | null;
  bank: string | null;
  holder_id?: string | null;
  opening_balance?: number;
  credit_limit?: number | null;
  income?: number;
  spent?: number;
  owed?: number;
}

function toSource(row: SourceRow): PaymentSource {
  const source: PaymentSource = {
    id: row.id,
    name: row.name,
    kind: row.kind,
    billingDay: row.billing_day ?? null,
    closingDay: row.closing_day,
    paymentDay: row.payment_day,
    bank: row.bank,
    holderId: row.holder_id ?? null,
  };
  if (row.kind === 'savings') {
    source.openingBalance = row.opening_balance ?? 0;
    source.balance = (row.opening_balance ?? 0) + (row.income ?? 0) - (row.spent ?? 0);
  } else {
    source.creditLimit = row.credit_limit ?? null;
    source.owed = row.owed ?? 0;
  }
  return source;
}

function isBillingDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 3 && value <= 28;
}

function isDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 28;
}

/**
 * Checks a source. Savings has no billing days. Credit cards and paylater need both, because
 * their transactions are billed on those days. `current` fills in fields that were not sent (PATCH).
 */
async function parseSource(
  env: Env,
  userId: string,
  body: Record<string, unknown>,
  holders: SourceHolder[],
  current?: Pick<PaymentSource, 'name' | 'kind' | 'billingDay' | 'closingDay' | 'paymentDay' | 'openingBalance' | 'creditLimit' | 'bank' | 'holderId'>,
) {
  const name = body.name ?? current?.name;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > NAME_MAX) {
    throw new HttpError(400, `Nama sumber dana wajib diisi (maks. ${NAME_MAX} karakter)`);
  }

  const kind = body.kind ?? current?.kind;
  if (typeof kind !== 'string' || !SOURCE_KINDS.includes(kind as SourceKind)) throw new HttpError(400, 'Jenis sumber dana tidak valid');

  const billingDay = body.billingDay !== undefined ? body.billingDay : current?.billingDay ?? null;
  const paymentDay = body.paymentDay !== undefined ? body.paymentDay : current?.paymentDay ?? null;

  const openingBalance = body.openingBalance !== undefined ? body.openingBalance : current?.openingBalance ?? 0;
  const creditLimit = body.creditLimit !== undefined ? body.creditLimit : current?.creditLimit ?? null;
  const bankInput = body.bank !== undefined ? body.bank : current?.bank ?? null;
  const bank = typeof bankInput === 'string' && bankInput ? bankInput : null;
  // A bank holds only some kinds of source. Checked when the bank or the kind is new, so a source can still be renamed.
  if (bank && (bank !== current?.bank || kind !== current?.kind)) {
    await banksOf(env, userId);
    const row = await env.DB.prepare('SELECT savings, credit_card, paylater FROM banks WHERE id = ? AND user_id = ?').bind(bank, userId).first<{ savings: number; credit_card: number; paylater: number }>();
    if (!row) throw new HttpError(400, 'Bank tidak ditemukan');
    const allowed = bankKinds({ savings: row.savings === 1, creditCard: row.credit_card === 1, paylater: row.paylater === 1 });
    if (!allowed.includes(kind as SourceKind)) throw new HttpError(400, 'Bank ini tidak punya jenis sumber dana itu');
  }
  const holderInput = body.holderId !== undefined ? body.holderId : current?.holderId ?? null;
  if (holderInput !== null && holderInput !== '' && (typeof holderInput !== 'string' || !holders.some((holder) => holder.userId === holderInput))) {
    throw new HttpError(400, 'Pemilik sumber dana harus anggota data ini');
  }
  const holderId = typeof holderInput === 'string' && holderInput ? holderInput : null;
  if (kind === 'savings') {
    if (typeof openingBalance !== 'number' || !Number.isInteger(openingBalance) || openingBalance < 0) throw new HttpError(400, 'Saldo awal tidak valid');
    return { name: name.trim(), kind: 'savings' as const, billingDay: null, closingDay: null, paymentDay: null, openingBalance, creditLimit: null, bank, holderId };
  }
  if (!isBilledKind(kind as SourceKind)) throw new HttpError(400, 'Jenis sumber dana tidak valid');
  // The bill closes two days before the statement date, so the closing day is the billing day less two.
  if (!isBillingDay(billingDay)) throw new HttpError(400, 'Tanggal billing harus 3-28');
  if (!isDay(paymentDay)) throw new HttpError(400, 'Tanggal pelunasan harus 1-28');
  if (creditLimit !== null && (typeof creditLimit !== 'number' || !Number.isInteger(creditLimit) || creditLimit <= 0)) throw new HttpError(400, 'Limit harus bilangan bulat lebih dari 0');
  return { name: name.trim(), kind: kind as SourceKind, billingDay, closingDay: billingDay - 2, paymentDay, openingBalance: 0, creditLimit, bank, holderId };
}

/** What a savings account holds now: opening balance + income - spent from it - card bills paid from it. */
export async function balanceOf(db: D1Database, sourceId: string) {
  const row = await db
    .prepare(
      `SELECT s.opening_balance
         + (SELECT COALESCE(SUM(i.amount), 0) FROM incomes i WHERE i.source_id = s.id)
         + (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t WHERE t.to_source_id = s.id AND t.status = 'posted')
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

/** The people a source can belong to: the owner of the data set and its members. */
export async function holdersOf(db: D1Database, userId: string): Promise<SourceHolder[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.avatar_url, u.avatar_v FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE m.owner_id = ? ORDER BY m.role DESC, u.name, u.email`,
    )
    .bind(userId)
    .all<{ id: string; name: string; email: string; avatar_url: string | null; avatar_v: number | null }>();
  return results.map((row) => ({ userId: row.id, name: row.name, email: row.email, avatarUrl: photoOf(row.id, row.avatar_url, row.avatar_v) }));
}

/** GET /api/sources: the sources, and the people they can belong to. */
export async function listSources({ env, userId }: RouteContext) {
  // Salaries whose payday has come are recorded first, so the balances include them.
  await syncSalaries(env, userId);
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.name, s.kind, s.closing_day, s.billing_day, s.payment_day, s.bank, s.holder_id, s.opening_balance, s.credit_limit,
       (SELECT COALESCE(SUM(i.amount), 0) FROM incomes i WHERE i.source_id = s.id)
         + (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t WHERE t.to_source_id = s.id AND t.status = 'posted') AS income,
       (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t WHERE t.source_id = s.id AND t.status = 'posted' AND t.method <> 'credit')
         + (SELECT COALESCE(SUM(b.total), 0) FROM card_bills b WHERE b.paid_from_id = s.id) AS spent,
       (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t WHERE t.source_id = s.id AND t.status = 'unpaid') AS owed
     FROM payment_sources s WHERE s.user_id = ? ORDER BY s.rowid`,
  )
    .bind(userId)
    .all<SourceRow>();
  const holders = await holdersOf(env.DB, userId);
  // Someone who has left the data set no longer holds a source: it shows as shared.
  const sources = results.map(toSource).map((source) => (holders.some((holder) => holder.userId === source.holderId) ? source : { ...source, holderId: null }));
  return json({ sources, holders });
}

/** POST /api/sources */
export async function createSource({ request, env, userId }: RouteContext) {
  const input = await parseSource(env, userId, await readJson(request), await holdersOf(env.DB, userId));
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO payment_sources (id, user_id, name, kind, closing_day, billing_day, payment_day, opening_balance, credit_limit, bank, holder_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, userId, input.name, input.kind, input.closingDay, input.billingDay, input.paymentDay, input.openingBalance, input.creditLimit, input.bank, input.holderId)
    .run();
  return json({ source: { id, ...input } }, 201);
}

/** PATCH /api/sources/:id. The kind cannot change: existing transactions depend on it. */
export async function updateSource({ request, env, userId, params }: RouteContext) {
  const current = await env.DB.prepare('SELECT id, name, kind, closing_day, billing_day, payment_day, bank, holder_id, opening_balance, credit_limit FROM payment_sources WHERE id = ? AND user_id = ?')
    .bind(params.id, userId)
    .first<SourceRow>();
  if (!current) throw new HttpError(404, 'Sumber dana tidak ditemukan');

  const body = await readJson(request);
  if (body.kind !== undefined && body.kind !== current.kind) throw new HttpError(400, 'Jenis sumber dana tidak bisa diubah');
  const holders = await holdersOf(env.DB, userId);
  const existing = toSource(current);
  // A holder who has left the data set is dropped rather than refused.
  if (!holders.some((holder) => holder.userId === existing.holderId)) existing.holderId = null;
  const input = await parseSource(env, userId, body, holders, existing);
  await env.DB.prepare('UPDATE payment_sources SET name = ?, closing_day = ?, billing_day = ?, payment_day = ?, opening_balance = ?, credit_limit = ?, bank = ?, holder_id = ? WHERE id = ? AND user_id = ?')
    .bind(input.name, input.closingDay, input.billingDay, input.paymentDay, input.openingBalance, input.creditLimit, input.bank, input.holderId, current.id, userId)
    .run();
  return json({ source: { id: current.id, ...input } });
}

/** DELETE /api/sources/:id. Refused while transactions still use the source. */
export async function deleteSource({ env, userId, params }: RouteContext) {
  const usage = await env.DB.prepare('SELECT COUNT(*) AS total FROM transactions WHERE (source_id = ? OR to_source_id = ?) AND user_id = ?')
    .bind(params.id, params.id, userId)
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
