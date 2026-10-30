import type { Env } from './env';
import type { NotificationKind } from '../shared/types';
import { todayInWib } from './routes/ask';
import { openBillsOf } from './routes/bills';

// Storing notifications (see migrations/0016). A notification belongs to one person and is written when
// something happens: an invitation, a change someone else made in shared data, or a card bill that is due
// soon. Writing never fails the action that caused it; the error is logged instead.

/** Card and paylater bills are reminded this many days before they are due (and after, until paid). */
const BILL_WARNING_DAYS = 3;

/** The owner of a data set and everyone who can see it: the owner's members, the owner included. */
export async function peopleOf(env: Env, userId: string): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT user_id FROM workspace_members WHERE owner_id = ?').bind(userId).all<{ user_id: string }>();
  return [...new Set([userId, ...results.map((row) => row.user_id)])];
}

/** A person's name, or their email when they have no name. */
export async function nameOf(env: Env, userId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT name, email FROM users WHERE id = ?').bind(userId).first<{ name: string; email: string }>();
  return row?.name || row?.email || '';
}

/**
 * Stores one notification for each person. A dedupe key that a person already has is skipped, so the
 * same event (such as one bill's reminder) is stored once.
 */
export async function notify(env: Env, userIds: string[], kind: NotificationKind, data: Record<string, string | number>, dedupeKey: string | null = null) {
  if (userIds.length === 0) return;
  try {
    const createdAt = Date.now();
    await env.DB.batch(
      userIds.map((userId) =>
        env.DB.prepare('INSERT OR IGNORE INTO notifications (id, user_id, kind, data, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
          crypto.randomUUID(),
          userId,
          kind,
          JSON.stringify(data),
          dedupeKey,
          createdAt,
        ),
      ),
    );
  } catch (error) {
    console.error('notify failed', kind, error);
  }
}

/** A change to a transaction in shared data: everyone who sees the data except the person who made it. */
export async function notifyDataChange(env: Env, userId: string, actorId: string, kind: NotificationKind, amount: number) {
  const people = (await peopleOf(env, userId)).filter((id) => id !== actorId);
  if (people.length === 0) return;
  await notify(env, people, kind, { actor: await nameOf(env, actorId), amount });
}

/** Reminders for open card and paylater bills that are due within a few days, or already overdue. */
export async function syncBills(env: Env, userId: string) {
  const limit = new Date(Date.parse(`${todayInWib()}T00:00:00Z`) + BILL_WARNING_DAYS * 86_400_000).toISOString().slice(0, 10);
  const due = (await openBillsOf(env, userId)).filter((bill) => bill.dueOn <= limit);
  if (due.length === 0) return;
  const people = await peopleOf(env, userId);
  for (const bill of due) {
    await notify(env, people, 'bill_due', { source: bill.sourceName, amount: bill.total, dueOn: bill.dueOn }, `bill:${bill.sourceId}:${bill.period}`);
  }
}
