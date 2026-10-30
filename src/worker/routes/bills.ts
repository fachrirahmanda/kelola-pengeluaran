import { billPeriodOf, closesOn, dueOn } from '../../shared/billing';
import { isBilledKind, type OpenBill, type PaidBill, type SourceKind } from '../../shared/types';
import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';

const CHUNK = 50;
const PAID_LIST_LIMIT = 100;

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

interface SourceRow {
  id: string;
  name: string;
  kind: SourceKind;
  closing_day: number | null;
  payment_day: number | null;
}

/** GET /api/bills: open bills (unpaid, by period and source) and the paid bill history. */
export async function listBills({ env, userId }: RouteContext) {
  const { results: sources } = await env.DB.prepare(
    'SELECT id, name, kind, closing_day, payment_day FROM payment_sources WHERE user_id = ? AND kind IN (?, ?)',
  )
    .bind(userId, 'credit_card', 'paylater')
    .all<SourceRow>();

  const { results: unpaid } = await env.DB.prepare(
    "SELECT source_id, occurred_on, amount FROM transactions WHERE user_id = ? AND status = 'unpaid' AND source_id IS NOT NULL",
  )
    .bind(userId)
    .all<{ source_id: string; occurred_on: string; amount: number }>();

  const open: OpenBill[] = [];
  for (const source of sources) {
    if (!isBilledKind(source.kind) || source.closing_day === null || source.payment_day === null) continue;
    const byPeriod = new Map<string, { total: number; count: number }>();
    for (const row of unpaid) {
      if (row.source_id !== source.id) continue;
      const period = billPeriodOf(row.occurred_on, source.closing_day);
      const bill = byPeriod.get(period) ?? { total: 0, count: 0 };
      bill.total += row.amount;
      bill.count += 1;
      byPeriod.set(period, bill);
    }
    for (const [period, bill] of byPeriod) {
      open.push({
        sourceId: source.id,
        sourceName: source.name,
        kind: source.kind,
        period,
        closesOn: closesOn(period, source.closing_day),
        dueOn: dueOn(period, source.closing_day, source.payment_day),
        total: bill.total,
        count: bill.count,
      });
    }
  }
  open.sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  const { results: paidRows } = await env.DB.prepare(
    `SELECT b.id, b.source_id, s.name AS source_name, b.period, b.total, b.transaction_count, b.paid_on
     FROM card_bills b JOIN payment_sources s ON s.id = b.source_id
     WHERE b.user_id = ? ORDER BY b.paid_on DESC, b.period DESC LIMIT ${PAID_LIST_LIMIT}`,
  )
    .bind(userId)
    .all<{ id: string; source_id: string; source_name: string; period: string; total: number; transaction_count: number; paid_on: string }>();

  const paid: PaidBill[] = paidRows.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    period: row.period,
    total: row.total,
    count: row.transaction_count,
    paidOn: row.paid_on,
  }));

  return json({ open, paid });
}

/**
 * POST /api/bills/pay { sourceId, period, paidOn }: marks the open bill as paid. Its unpaid
 * transactions count as spending on the payment date, and the bill is kept as paid history.
 */
export async function payBill({ request, env, userId }: RouteContext) {
  const body = await readJson(request);
  if (typeof body.sourceId !== 'string') throw new HttpError(400, 'Pilih kartu kredit atau paylater');
  if (typeof body.period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.period)) throw new HttpError(400, 'Periode tagihan tidak valid');
  if (!isDate(body.paidOn)) throw new HttpError(400, 'Tanggal pelunasan tidak valid');
  const period = body.period;
  const paidOn = body.paidOn;

  const source = await env.DB.prepare('SELECT id, kind, closing_day FROM payment_sources WHERE id = ? AND user_id = ?')
    .bind(body.sourceId, userId)
    .first<{ id: string; kind: SourceKind; closing_day: number | null }>();
  if (!source || !isBilledKind(source.kind) || source.closing_day === null) throw new HttpError(400, 'Pilih kartu kredit atau paylater');

  const { results: unpaid } = await env.DB.prepare(
    "SELECT id, occurred_on, amount FROM transactions WHERE user_id = ? AND source_id = ? AND status = 'unpaid'",
  )
    .bind(userId, source.id)
    .all<{ id: string; occurred_on: string; amount: number }>();
  const inBill = unpaid.filter((row) => billPeriodOf(row.occurred_on, source.closing_day!) === period);
  if (inBill.length === 0) throw new HttpError(400, 'Tidak ada tagihan yang belum lunas untuk periode ini');

  const total = inBill.reduce((sum, row) => sum + row.amount, 0);
  const billId = crypto.randomUUID();

  const statements = [
    env.DB.prepare('INSERT INTO card_bills (id, user_id, source_id, period, total, transaction_count, paid_on) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
      billId,
      userId,
      source.id,
      period,
      total,
      inBill.length,
      paidOn,
    ),
  ];
  for (let i = 0; i < inBill.length; i += CHUNK) {
    const ids = inBill.slice(i, i + CHUNK).map((row) => row.id);
    statements.push(
      env.DB.prepare(
        `UPDATE transactions SET status = 'posted', posted_on = ?, updated_at = datetime('now')
         WHERE user_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
      ).bind(paidOn, userId, ...ids),
    );
  }

  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new HttpError(409, 'Tagihan ini sudah dilunasi');
    throw error;
  }

  const sourceRow = await env.DB.prepare('SELECT name FROM payment_sources WHERE id = ?').bind(source.id).first<{ name: string }>();
  const bill: PaidBill = {
    id: billId,
    sourceId: source.id,
    sourceName: sourceRow?.name ?? '',
    period,
    total,
    count: inBill.length,
    paidOn,
  };
  return json({ bill }, 201);
}
