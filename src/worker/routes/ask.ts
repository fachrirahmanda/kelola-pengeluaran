import { addMonths, dueDateOf, nextInstallment } from '../../shared/recurring';
import type { RouteContext } from '../context';
import { fillCalculations } from '../calc';
import { HttpError, json, readJson } from '../http';
import { notify } from '../notify';
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
  '- Payment methods are debit and credit cards (Cards), plus transfers between savings accounts. Debit counts as spending on the day it happens. A transfer is not spending: it only moves money between accounts, so it is left out of spending totals. Credit card and paylater purchases stay unpaid until their bill is paid and then count in the month the bill is paid. A card’s bill period ends on its closing day, and the bill is due on its payment day.',
].join('\n');

/** General personal-finance knowledge, with the formulas the model should use. */
const FINANCE_GUIDE = [
  'Personal finance: you may also answer general questions on budgeting, saving, loans and interest, even when they are not about the summary. Give general guidance, not professional financial advice, and state the assumptions you used (rate, months).',
  '- Share of a total: part / total * 100. Average per month: total / number of months. Savings rate: (income - spending) / income * 100.',
  '- Flat-rate loan (bunga flat, common in Indonesia): monthly payment = (principal + principal * yearly rate * years) / months.',
  '- Effective-rate (annuity) loan: monthly payment = P * r / (1 - (1 + r)^-n), where r = yearly rate / 12 and n = months.',
  '- Compound growth: P * (1 + r)^n. Saving A every month for n months at monthly rate r: A * ((1 + r)^n - 1) / r. Without interest, the monthly amount for a goal is goal / months.',
  '- Rules of thumb: 50/30/20 (needs, wants, savings), an emergency fund of 3 to 6 months of expenses, and paying a credit card bill in full by its due date to avoid interest.',
  '- Indonesian amounts: rb or ribu is a thousand, jt or juta a million, M, miliar or milyar a billion (1.000.000.000), T or triliun a trillion. A comma is the decimal point: 2,7 M is Rp2.700.000.000 and 7,5 jt is Rp7.500.000.',
  '- A price ("harga", "seharga", "cash") is the whole price of the thing, not a monthly payment. For a house loan (KPR) or car loan without terms, say the down payment, tenor and rate you assume and give the monthly installment for them, then compare it with the person’s income.',
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

/** Between the answers to the questions in one message, in the saved answer. The page shows each as its own reply. */
export const PART_BREAK = '\u001e';
/** A message with more questions than this is answered whole, to keep the wait short. */
const MAX_PARTS = 4;

/**
 * The questions in one message, to answer one at a time: the text is split after each "?". Text without a "?"
 * stays with the question before it (or after it, at the start), and a piece of under three words joins the
 * one before it. A message with one question, or none, stays whole.
 */
export function partsOf(message: string): string[] {
  const pieces = (message.match(/[^?]*\?+|[^?]+$/g) ?? []).map((piece) => piece.trim()).filter(Boolean);
  const parts: string[] = [];
  for (const piece of pieces) {
    const short = piece.split(/\s+/).length < 3;
    if (parts.length && (!piece.endsWith('?') || short)) parts[parts.length - 1] += ` ${piece}`;
    else parts.push(piece);
  }
  return parts.length > 1 && parts.length <= MAX_PARTS ? parts : [message];
}

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
       FROM transactions WHERE user_id = ? AND status = 'posted' AND method <> 'transfer' AND posted_on >= ? GROUP BY month, category_id`,
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
    env.DB.prepare(
      `SELECT s.name, s.kind, s.closing_day, s.payment_day, COALESCE(NULLIF(u.name, ''), u.email) AS holder
       FROM payment_sources s
       LEFT JOIN workspace_members m ON m.user_id = s.holder_id AND m.owner_id = s.user_id
       LEFT JOIN users u ON u.id = m.user_id
       WHERE s.user_id = ? ORDER BY s.name`,
    )
      .bind(userId)
      .all<{ name: string; kind: string; closing_day: number | null; payment_day: number | null; holder: string | null }>(),
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
    lines.push(`- ${row.name} (${row.kind}${billing}, belongs to ${row.holder ?? 'everyone (shared)'})`);
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
    { role: 'assistant' as const, content: row.answer.replaceAll(PART_BREAK, '\n\n') },
  ]);
  // Several questions in one message are answered in turn, in one conversation: each answer is in view when
  // the next is asked, and the summary is sent once.
  const parts = partsOf(question);
  const conversation: Parameters<typeof chat>[1] = [
    { role: 'system', content: `${SYSTEM_PROMPT} The person’s currency is ${currency}.\n\n${APP_GUIDE}\n\n${FINANCE_GUIDE}\n\n${CALCULATOR}` },
    ...earlier,
  ];
  const promptFor = (index: number) => {
    if (parts.length === 1) return `${summary}\n\nQuestion: ${question}`;
    if (index === 0) {
      return `${summary}\n\nThe person’s message: ${question}\n\nIt has ${parts.length} questions, answered one at a time. Answer only question 1 now: ${parts[0]}`;
    }
    return `Now answer only question ${index + 1}: ${parts[index]}`;
  };

  // Each answer comes whole (see nvidia.ts), but it can take a minute or two. Meanwhile the page gets one JSON
  // object per line: "parts" with the number of questions (when more than one), "thinking" every 15 seconds so
  // the connection never sits idle, "part" as each question is answered, then "done" with the answer as saved,
  // or "error".
  const encoder = new TextEncoder();
  /** The question as the notification quotes it. */
  const shortQuestion = question.length > 80 ? `${question.slice(0, 79)}…` : question;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The page went away; the answer is still saved below.
        }
      };
      const heartbeat = setInterval(() => send({ type: 'thinking' }), 15_000);
      try {
        if (parts.length > 1) send({ type: 'parts', total: parts.length });
        const answers: string[] = [];
        for (let index = 0; index < parts.length; index++) {
          conversation.push({ role: 'user', content: promptFor(index) });
          try {
            const raw = await chat(config, conversation);
            // Kept with the results filled in, so the next question, the history and later context see numbers.
            const answer = fillCalculations(raw, localeOf(question, raw));
            conversation.push({ role: 'assistant', content: answer });
            answers.push(answer);
          } catch (error) {
            // The first question failing fails the message. A later one keeps the answers already given.
            if (index === 0) throw error;
            const reason = error instanceof HttpError ? error.message : 'Ask AI sedang tidak bisa menjawab.';
            answers.push(`Pertanyaan ini belum bisa dijawab. ${reason}`);
            break;
          }
          if (parts.length > 1) send({ type: 'part', index, total: parts.length, answer: answers[index] });
        }
        const answer = answers.join(PART_BREAK);
        const id = crypto.randomUUID();
        await env.DB.prepare('INSERT INTO ai_questions (id, user_id, day, question, answer) VALUES (?, ?, ?, ?, ?)')
          .bind(id, actorId, day, question, answer)
          .run();
        const row = await env.DB.prepare('SELECT created_at FROM ai_questions WHERE id = ?').bind(id).first<{ created_at: string }>();
        send({ type: 'done', answer, id, createdAt: row?.created_at ?? '' });
        // The person may be on another page by now: the bell tells them the answer is ready.
        // The answer's id, so the notification opens the Ask AI page at this answer.
        await notify(env, [actorId], 'ask_answered', { question: shortQuestion, id });
      } catch (error) {
        if (!(error instanceof HttpError)) console.error('ask failed', error);
        const message = error instanceof HttpError ? error.message : 'Ask AI sedang tidak bisa menjawab. Coba lagi.';
        send({ type: 'error', message });
        await notify(env, [actorId], 'ask_failed', { question: shortQuestion, message });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store, no-transform' } });
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
