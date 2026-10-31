import { addMonths } from '../../shared/recurring';
import type { RouteContext } from '../context';
import { HttpError, json } from '../http';

// Reports count spending on the day it was counted (posted_on), the same as the rest of the app.
// For a credit bill that is the payment date, not the purchase date.
const MAX_MONTHS = 36;

function isMonth(value: string | null): value is string {
  return value !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** The month range from ?from=YYYY-MM&to=YYYY-MM (both inclusive). */
function rangeOf(url: URL): { from: string; to: string; months: number } {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!isMonth(from) || !isMonth(to)) throw new HttpError(400, 'Pilih bulan awal dan akhir');
  const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5)) - Number(from.slice(5))) + 1;
  if (months < 1) throw new HttpError(400, 'Bulan akhir harus sama atau setelah bulan awal');
  if (months > MAX_MONTHS) throw new HttpError(400, `Rentang maksimal ${MAX_MONTHS} bulan`);
  return { from, to, months };
}

/** First and last day of the range, as YYYY-MM-DD bounds on posted_on. */
function bounds(range: { from: string; to: string }) {
  const lastDay = new Date(Date.UTC(Number(range.to.slice(0, 4)), Number(range.to.slice(5)), 0)).getUTCDate();
  return { start: `${range.from}-01`, end: `${range.to}-${String(lastDay).padStart(2, '0')}` };
}

/** GET /api/reports?from=YYYY-MM&to=YYYY-MM: spending per month and per category. */
export async function monthlyReport({ request, env, userId }: RouteContext) {
  const range = rangeOf(new URL(request.url));
  const { start, end } = bounds(range);
  const { results } = await env.DB.prepare(
    `SELECT substr(posted_on, 1, 7) AS month, category_id, SUM(amount) AS total, COUNT(*) AS count
     FROM transactions
     WHERE user_id = ? AND status = 'posted' AND method <> 'transfer' AND posted_on >= ? AND posted_on <= ?
     GROUP BY month, category_id`,
  )
    .bind(userId, start, end)
    .all<{ month: string; category_id: string; total: number; count: number }>();

  const months = Array.from({ length: range.months }, (_, i) => {
    const month = addMonths(range.from, i);
    return { month, total: 0, count: 0, byCategory: [] as { categoryId: string; total: number; count: number }[] };
  });
  const byMonth = new Map(months.map((entry) => [entry.month, entry]));
  const byCategory = new Map<string, { total: number; count: number }>();

  for (const row of results) {
    const entry = byMonth.get(row.month);
    if (!entry) continue;
    entry.total += row.total;
    entry.count += row.count;
    entry.byCategory.push({ categoryId: row.category_id, total: row.total, count: row.count });
    const category = byCategory.get(row.category_id) ?? { total: 0, count: 0 };
    category.total += row.total;
    category.count += row.count;
    byCategory.set(row.category_id, category);
  }
  for (const entry of months) entry.byCategory.sort((a, b) => b.total - a.total);

  const categories = [...byCategory.entries()]
    .map(([categoryId, value]) => ({ categoryId, ...value }))
    .sort((a, b) => b.total - a.total);
  const total = months.reduce((sum, entry) => sum + entry.total, 0);
  const count = months.reduce((sum, entry) => sum + entry.count, 0);

  return json({ from: range.from, to: range.to, total, count, months, categories });
}

/** CSV cell: quoted when needed, and guarded against spreadsheet formulas. */
function cell(value: string | number | null): string {
  let text = value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** GET /api/reports/export.csv?from=YYYY-MM&to=YYYY-MM: every counted transaction in the range. */
export async function exportCsv({ request, env, userId }: RouteContext) {
  const range = rangeOf(new URL(request.url));
  const { start, end } = bounds(range);
  const { results } = await env.DB.prepare(
    `SELECT t.posted_on, t.occurred_on, t.amount, c.name AS category, t.note, t.method, s.name AS source
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     LEFT JOIN payment_sources s ON s.id = t.source_id
     WHERE t.user_id = ? AND t.status = 'posted' AND t.posted_on >= ? AND t.posted_on <= ?
     ORDER BY t.posted_on, t.created_at`,
  )
    .bind(userId, start, end)
    .all<{ posted_on: string; occurred_on: string; amount: number; category: string; note: string; method: string; source: string | null }>();

  const header = ['Counted on', 'Transaction date', 'Category', 'Note', 'Method', 'Source', 'Amount'];
  const lines = [header.map(cell).join(',')];
  for (const row of results) {
    lines.push([row.posted_on, row.occurred_on, row.category, row.note, row.method, row.source, row.amount].map(cell).join(','));
  }
  // A BOM so Excel opens the file as UTF-8.
  const body = `﻿${lines.join('\r\n')}\r\n`;
  const filename = `neraca-${range.from}_${range.to}.csv`;

  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
