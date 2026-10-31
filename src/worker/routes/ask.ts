import { addMonths, dueDateOf, nextInstallment } from '../../shared/recurring';
import type { RouteContext } from '../context';
import { fillCalculations } from '../calc';
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
/** Questions shown in the history on the Ask AI page. */
const HISTORY_LIMIT = 100;
/** Earlier exchanges sent with a new question: at most this many, from at most this long ago. */
const CONTEXT_EXCHANGES = 10;
const CONTEXT_MINUTES = 60;

const SYSTEM_PROMPT = [
  'You answer questions about one person’s personal expenses in Neraca, a spending tracker, about how to use Neraca, and about personal finance and calculations.',
  'For their own money, use only the summary you are given and facts the person states in the conversation. You may calculate from them (sums, differences, dates months ahead).',
  'If they do not contain the answer, say so instead of guessing.',
  'For installments, the Installments section is the source of truth: it has the number of months, the installments paid and the last due date.',
  'Amounts in the summary are plain numbers in the person’s own currency.',
  'Reply in the language of the question (Indonesian or English), briefly: one to three short sentences, or a short list of steps for how-to questions and calculations. Never a bare number.',
  'Write amounts with the currency and thousand separators, e.g. Rp17.415.000 in Indonesian or IDR 17,415,000 in English.',
  'Do not invent transactions, categories or dates.',
].join(' ');

/** How Neraca works, so the model can answer "how do I…" and explain how amounts are counted. */
const APP_GUIDE = [
  'About Neraca, for questions on how to use the app:',
  '- Home (Dashboard): this month’s spending and transactions, unpaid credit card spending, what is due next month, running card bills, spending by category and recent transactions.',
  '- Add expense (the + button): amount, date and time, category, note, payment method and source. The form stays open for the next entry. Receipts can be attached and are stored in Google Drive.',
  '- History: every transaction, with edit and delete. Reports: spending per month and per category, and a CSV export.',
  '- Bills: credit card and paylater bills; marking a bill as paid counts its purchases as spending.',
  '- Installments: monthly installments and recurring payments; each counts as spending on the day it is marked paid.',
  '- Loans: money borrowed is not spending; each repayment counts as spending on the day it is paid.',
  '- Budgeting: monthly spending limits. Sources of funds: savings accounts, credit cards and paylater, with balances; income into an account raises its balance, and salary is added on every payday by itself.',
  '- Settings: categories, workspace members (the owner invites people by email; members see and change the same data), storage and Ask AI. Profile: name, photo, language, currency and color style.',
  '- The bell shows notifications: invitations, changes others made in shared data, and card bills due within 3 days. Ask AI allows 50 questions per person per day.',
  '- Payment methods are cash, debit, transfer and credit. Cash, debit and transfer count as spending on the day they happen. Credit card and paylater purchases stay unpaid until their bill is paid and then count in the month the bill is paid. A card’s bill period ends on its closing day, and the bill is due on its payment day.',
].join('\n');

/** General personal-finance knowledge, with the formulas the model should use. */
const FINANCE_GUIDE = [
  'Personal finance: you may also answer general questions on budgeting, saving, loans and interest, even when they are not about the summary. Give general guidance, not professional financial advice, and state the assumptions you used (rate, months).',
  '- Share of a total: part / total * 100. Average per month: total / number of months. Savings rate: (income - spending) / income * 100.',
  '- Flat-rate loan (bunga flat, common in Indonesia): monthly payment = (principal + principal * yearly rate * years) / months.',
  '- Effective-rate (annuity) loan: monthly payment = P * r / (1 - (1 + r)^-n), where r = yearly rate / 12 and n = months.',
  '- Compound growth: P * (1 + r)^n. Saving A every month for n months at monthly rate r: A * ((1 + r)^n - 1) / r. Without interest, the monthly amount for a goal is goal / months.',
  '- Rules of thumb: 50/30/20 (needs, wants, savings), an emergency fund of 3 to 6 months of expenses, and paying a credit card bill in full by its due date to avoid interest.',
].join('\n');

/** The calculator (see calc.ts): the model writes calculations, the Worker works them out. */
const CALCULATOR = [
  'Calculator: never work out arithmetic yourself. Write every number you calculate as [[= expression]], with plain digits (no thousand separators, a dot for decimals), + - * / ^ ( ) and % for percent (10% means 0.1). The app replaces it with the result.',
  'Examples: "Sisa budget Rp[[= 3000000 - 1250000]]" and "an installment of IDR [[= 10000000 * 0.01 / (1 - (1 + 0.01)^-12)]] a month". Numbers copied from the summary need no brackets.',
].join(' ');

/** Words that mark an Indonesian question, for the separators the calculator's results use. */
const INDONESIAN = /\b(berapa|apa|apakah|yang|bulan|saya|aku|gimana|bagaimana|kapan|kenapa|mengapa|untuk|dari|ini|itu|tagihan|cicilan|pengeluaran|bunga|tabungan)\b/i;

/** id-ID (17.415.000) for an Indonesian question or answer, else en-US (17,415,000). */
const localeOf = (question: string, answer: string) => (/Rp\s?(\d|\[\[)/.test(answer) || INDONESIAN.test(question) ? 'id-ID' : 'en-US');
/** Currencies the app offers (src/web/format.ts). Anything else falls back to IDR. */
const CURRENCIES = ['IDR', 'USD', 'EUR', 'GBP', 'SGD', 'MYR', 'JPY'];

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

  const [categories, monthly, recent, sources, unpaid, installments, loans] = await Promise.all([
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
    env.DB.prepare(
      `SELECT i.name, i.amount, i.category_id, i.start_date, i.total_months,
         COUNT(p.id) AS paid_count, COALESCE(SUM(p.amount), 0) AS paid_total, MAX(p.paid_on) AS last_paid_on
       FROM recurring_items i LEFT JOIN recurring_payments p ON p.item_id = i.id
       WHERE i.user_id = ? GROUP BY i.id ORDER BY i.name`,
    )
      .bind(userId)
      .all<{ name: string; amount: number; category_id: string; start_date: string; total_months: number | null; paid_count: number; paid_total: number; last_paid_on: string | null }>(),
    env.DB.prepare(
      `SELECT l.name, l.principal, l.received_on, COALESCE(SUM(t.amount), 0) AS paid_total, COUNT(p.id) AS paid_count
       FROM loans l LEFT JOIN loan_payments p ON p.loan_id = l.id LEFT JOIN transactions t ON t.id = p.transaction_id
       WHERE l.user_id = ? GROUP BY l.id ORDER BY l.name`,
    )
      .bind(userId)
      .all<{ name: string; principal: number; received_on: string; paid_total: number; paid_count: number }>(),
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
  lines.push('');

  // Worked out here rather than left to the model: the next installment, what is left, and the last due date.
  lines.push('Installments and recurring payments (monthly, from the Installments page):');
  for (const row of installments.results) {
    // Counted the way the Installments page counts: installments paid = payments recorded.
    const paidThrough = row.paid_count;
    const next = nextInstallment(paidThrough, row.total_months);
    const parts = [
      `${row.amount} per month`,
      categoryName(row.category_id),
      `first installment due ${row.start_date}`,
      `${paidThrough} installments paid (total ${row.paid_total})${row.last_paid_on ? `, last paid on ${row.last_paid_on}` : ''}`,
    ];
    if (row.total_months === null) {
      parts.push('no end date');
    } else {
      const left = row.total_months - paidThrough;
      parts.push(`${row.total_months} installments in total`, `${left} left (${left * row.amount} still to pay)`, `last installment due ${dueDateOf(row.start_date, row.total_months)}`);
    }
    parts.push(next === null ? 'fully paid' : `next is installment ${next}, due ${dueDateOf(row.start_date, next)}`);
    lines.push(`- ${row.name}: ${parts.join(', ')}`);
  }
  if (installments.results.length === 0) lines.push('- none');
  lines.push('');

  lines.push('Loans received (money the person borrowed and pays back):');
  for (const row of loans.results) {
    lines.push(`- ${row.name}: borrowed ${row.principal} on ${row.received_on}, paid back ${row.paid_total} in ${row.paid_count} payments, ${Math.max(row.principal - row.paid_total, 0)} left`);
  }
  if (loans.results.length === 0) lines.push('- none');

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

  const currency = typeof body.currency === 'string' && CURRENCIES.includes(body.currency) ? body.currency : 'IDR';
  const summary = await summaryOf(env, userId);
  // The latest exchanges of this session, so a follow-up ("and last month?") has its context. The
  // summary goes only with the new question, so the model reads today's data once.
  const recent = await env.DB.prepare(
    `SELECT question, answer FROM ai_questions
     WHERE user_id = ? AND question != '' AND created_at >= datetime('now', ?) ORDER BY created_at DESC, rowid DESC LIMIT ?`,
  )
    .bind(actorId, `-${CONTEXT_MINUTES} minutes`, CONTEXT_EXCHANGES)
    .all<{ question: string; answer: string }>();
  const earlier = recent.results.reverse().flatMap((row) => [
    { role: 'user' as const, content: row.question },
    { role: 'assistant' as const, content: row.answer },
  ]);
  const raw = await chat(config, [
    { role: 'system', content: `${SYSTEM_PROMPT} The person’s currency is ${currency}.\n\n${APP_GUIDE}\n\n${FINANCE_GUIDE}\n\n${CALCULATOR}` },
    ...earlier,
    { role: 'user', content: `${summary}

Question: ${question}` },
  ]);
  // Stored with the results filled in, so the history and the next question's context show numbers.
  const answer = fillCalculations(raw, localeOf(question, raw));
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO ai_questions (id, user_id, day, question, answer) VALUES (?, ?, ?, ?, ?)')
    .bind(id, actorId, day, question, answer)
    .run();
  const row = await env.DB.prepare('SELECT created_at FROM ai_questions WHERE id = ?').bind(id).first<{ created_at: string }>();
  return json({ answer, id, createdAt: row?.created_at ?? '' });
}

/**
 * GET /api/ask/history: the latest questions this person asked, oldest first. History belongs to the
 * person who asked (actorId), not the shared data set, so workspace members do not see each other's.
 */
export async function askHistory({ env, actorId }: RouteContext) {
  const rows = await env.DB.prepare(
    `SELECT id, question, answer, created_at FROM ai_questions
     WHERE user_id = ? AND question != '' ORDER BY created_at DESC, rowid DESC LIMIT ?`,
  )
    .bind(actorId, HISTORY_LIMIT)
    .all<{ id: string; question: string; answer: string; created_at: string }>();
  const items = rows.results.reverse().map((row) => ({ id: row.id, question: row.question, answer: row.answer, createdAt: row.created_at }));
  return json({ items });
}

/** DELETE /api/ask/history: empties this person's questions and answers. The rows stay for the daily limit. */
export async function clearAskHistory({ env, actorId }: RouteContext) {
  await env.DB.prepare("UPDATE ai_questions SET question = '', answer = '' WHERE user_id = ? AND question != ''").bind(actorId).run();
  return json({ items: [] });
}
