import type { Env } from './env';
import type { ActivityKind, NotificationKind } from '../shared/types';
import { todayInWib } from './routes/ask';
import { openBillsOf } from './routes/bills';

// Storing notifications (see migrations/0016). A notification belongs to one person and is written when
// something happens: an invitation, a change someone else made in shared data, or a card bill that is due
// soon. Writing never fails the action that caused it; the error is logged instead.

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

/**
 * Records something a person did in a data set (see migrations/0023), for the bell's Activity tab. Like
 * notify, it never fails the action; the error is logged instead.
 */
export async function recordActivity(env: Env, ownerId: string, actorId: string, kind: ActivityKind, data: Record<string, string | number>) {
  try {
    await env.DB.prepare('INSERT INTO activity (id, owner_id, actor_id, kind, data, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), ownerId, actorId, kind, JSON.stringify(data), Date.now())
      .run();
  } catch (error) {
    console.error('activity failed', kind, error);
  }
}

/** A change to a transaction in shared data: everyone who sees the data except the person who made it. */
export async function notifyDataChange(env: Env, userId: string, actorId: string, kind: NotificationKind, amount: number) {
  const people = (await peopleOf(env, userId)).filter((id) => id !== actorId);
  if (people.length === 0) return;
  await notify(env, people, kind, { actor: await nameOf(env, actorId), amount });
}

/** Reminders go out this many days before a bill is due. */
const DUE_REMINDER_DAYS = [2, 1];

/** Whole days from one YYYY-MM-DD to another. */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Card and paylater bills: a notice when a bill's billing date (the statement date) has come, and reminders 2 and 1 days
 * before it is due. Each is stored once, and a bill that is paid stops getting them. A notice opens that card's bills.
 */
export async function syncBills(env: Env, userId: string) {
  const today = todayInWib();
  const open = await openBillsOf(env, userId);
  if (open.length === 0) return;
  const people = await peopleOf(env, userId);
  for (const bill of open) {
    const data = { source: bill.sourceName, sourceId: bill.sourceId, amount: bill.total, billingOn: bill.billingOn, dueOn: bill.dueOn };
    if (bill.billingOn <= today) await notify(env, people, 'bill_due', data, `bill:${bill.sourceId}:${bill.period}`);
    const daysLeft = daysBetween(today, bill.dueOn);
    if (DUE_REMINDER_DAYS.includes(daysLeft)) {
      await notify(env, people, 'bill_reminder', { ...data, days: daysLeft }, `due:${bill.sourceId}:${bill.dueOn}:${daysLeft}`);
    }
  }
}
