import { addMonths } from '../../shared/recurring';
import type { RouteContext } from '../context';
import { HttpError, json, readJson } from '../http';
import { aiConfig, chat } from '../nvidia';

// Ask AI: answers questions about the data owner's spending, from a summary this Worker builds. The
// model never writes SQL and only sees the signed-in person's data set (userId), so it cannot reach
// anyone else's transactions. Amounts count the way reports do (posted_on).

const MAX_QUESTION = 1000;
/** Questions one person can ask per day (the day in Jakarta time). */
const DAILY_LIMIT = 50;
const MONTHS = 6;
const RECENT_TRANSACTIONS = 300;

const SYSTEM_PROMPT = [
  'You answer questions about one person’s personal expenses in Neraca, a spending tracker.',
  'Use only the summary you are given. If the summary does not contain the answer, say so instead of guessing.',
  'Amounts are plain numbers in the person’s own currency. Reply in the language of the question (Indonesian or English), briefly.',
  'Do not invent transactions, categories or dates.',
].join(' ');

/** Today's date in Jakarta (WIB), as YYYY-MM-DD. */
export function todayInWib() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** The text the model reads: months, categories, this period's transactions, sources and unpaid card spending. */
async function summaryOf(env: RouteContext['env'], userId: string) {
  const today = todayInWib();
  const thisMonth = today.slice(0, 7);
  const firstMonth = addMonths(thisMonth, -(MONTHS - 1));
  const start = `${firstMonth}-01`;

  const [categories, monthly, recent, sources, unpaid] = await Promise.all([
    env.DB.prepare('SELECT id, name FROM categories WHERE user_id = ?').bind(userId).all<{ id: string; name: string }>(),
    env.DB.prepare(
      `SELECT substr(posted_on, 1, 7) AS month, category_id, SUM(amount) AS total, COUNT(*) AS count
       FROM transactions WHERE user_id = ? AND status = 'posted' AND posted_on >= ? GROUP BY month, category_id`,
    )
      .bind(userId, start)
      .all<{ month: string; category_id: string; total: number; count: number }>(),
    env.DB.prepare(
      `SELECT t.occurred_on, t.posted_on, t.status, t.amount, t.method, t.note, t.category_id, s.name AS source_name
       FROM transactions t LEFT JOIN payment_sources s ON s.id = t.source_id
       WHERE t.user_id = ? AND t.occurred_on >= ?
       ORDER BY t.occurred_on DESC LIMIT ?`,
    )
      .bind(userId, start, RECENT_TRANSACTIONS)
      .all<{ occurred_on: string; posted_on: string | null; status: string; amount: number; method: string; note: string; category_id: string; source_name: string | null }>(),
    env.DB.prepare('SELECT name, kind, closing_day, payment_day FROM payment_sources WHERE user_id = ? ORDER BY name').bind(userId).all<{ name: string; kind: string; closing_day: number | null; payment_day: number | null }>(),
    env.DB.prepare(
      `SELECT s.name AS source_name, SUM(t.amount) AS total, COUNT(*) AS count
       FROM transactions t JOIN payment_sources s ON s.id = t.source_id
       WHERE t.user_id = ? AND t.status = 'unpaid' GROUP BY s.name`,
    )
      .bind(userId)
      .all<{ source_name: string; total: number; count: number }>(),
  ]);

  const names = new Map(categories.results.map((row) => [row.id, row.name]));
  const categoryName = (id: string) => names.get(id) ?? 'Lainnya';
  const lines: string[] = [`Today: ${today} (Jakarta time).`, ''];

  lines.push(`Spending per month, last ${MONTHS} months (counted on the day it was posted):`);
  for (let i = 0; i < MONTHS; i++) {
    const month = addMonths(firstMonth, i);
    const rows = monthly.results.filter((row) => row.month === month);
    const total = rows.reduce((sum, row) => sum + row.total, 0);
    const count = rows.reduce((sum, row) => sum + row.count, 0);
    lines.push(`- ${month}: total ${total}, ${count} transactions`);
  }
  lines.push('');

  lines.push(`Spending per category, last ${MONTHS} months:`);
  const byCategory = new Map<string, { total: number; count: number }>();
  for (const row of monthly.results) {
    const entry = byCategory.get(row.category_id) ?? { total: 0, count: 0 };
    entry.total += row.total;
    entry.count += row.count;
    byCategory.set(row.category_id, entry);
  }
  for (const [id, entry] of [...byCategory.entries()].sort((a, b) => b[1].total - a[1].total)) {
    lines.push(`- ${categoryName(id)}: total ${entry.total}, ${entry.count} transactions`);
  }
  lines.push('');

  lines.push(`Transactions from ${start} (date | status | amount | category | method | source | note):`);
  for (const row of recent.results) {
    lines.push(`- ${row.occurred_on} | ${row.status} | ${row.amount} | ${categoryName(row.category_id)} | ${row.method} | ${row.source_name ?? '-'} | ${row.note || '-'}`);
  }
  if (recent.results.length === 0) lines.push('- none');
  lines.push('');

  lines.push('Payment sources:');
  for (const row of sources.results) {
    const billing = row.kind === 'savings' ? '' : `, closes on day ${row.closing_day}, pays on day ${row.payment_day}`;
    lines.push(`- ${row.name} (${row.kind}${billing})`);
  }
  if (sources.results.length === 0) lines.push('- none');
  lines.push('');

  lines.push('Card and paylater purchases not yet settled:');
  for (const row of unpaid.results) lines.push(`- ${row.source_name}: total ${row.total}, ${row.count} transactions`);
  if (unpaid.results.length === 0) lines.push('- none');

  return lines.join('\n');
}

/** POST /api/ask { question }: an answer from the NVIDIA model, from the summary of the data set it belongs to. */
export async function askAi({ request, env, userId, actorId }: RouteContext) {
  const config = await aiConfig(env);
  if (!config) throw new HttpError(400, 'Ask AI belum diatur. Admin bisa mengaturnya di Pengaturan.');
  const body = await readJson(request);
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) throw new HttpError(400, 'Tulis pertanyaan dulu');
  if (question.length > MAX_QUESTION) throw new HttpError(400, `Pertanyaan maksimal ${MAX_QUESTION} karakter`);

  const day = todayInWib();
  const asked = await env.DB.prepare('SELECT COUNT(*) AS total FROM ai_questions WHERE user_id = ? AND day = ?').bind(actorId, day).first<{ total: number }>();
  if ((asked?.total ?? 0) >= DAILY_LIMIT) throw new HttpError(429, `Batas ${DAILY_LIMIT} pertanyaan per hari sudah tercapai. Coba lagi besok.`);

  const summary = await summaryOf(env, userId);
  const answer = await chat(config, [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `${summary}

Question: ${question}` },
  ], 1024);
  await env.DB.prepare('INSERT INTO ai_questions (id, user_id, day) VALUES (?, ?, ?)').bind(crypto.randomUUID(), actorId, day).run();
  return json({ answer });
}
