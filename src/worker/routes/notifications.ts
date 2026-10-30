import type { AppNotification, NotificationFeed, NotificationKind } from '../../shared/types';
import type { RouteContext } from '../context';
import { json } from '../http';
import { syncBills } from '../notify';

// Notifications for the signed-in person (see notify.ts). The app asks for the newest ones, then for the
// ones after the time it last checked, which pop up as toasts. Mounted under /api/notifications.

const LATEST = 30;
const POPUPS = 10;

interface Row {
  id: string;
  kind: NotificationKind;
  data: string;
  created_at: number;
  read_at: number | null;
}

const toItem = (row: Row): AppNotification => ({
  id: row.id,
  kind: row.kind,
  data: JSON.parse(row.data),
  createdAt: row.created_at,
  read: row.read_at !== null,
});

/**
 * GET /api/notifications: the newest ones (newest first). With ?after=<time>, only those stored after
 * that time, oldest first, for popups.
 */
export async function listNotifications({ request, env, actorId }: RouteContext) {
  const after = Number(new URL(request.url).searchParams.get('after')) || 0;
  const select = 'SELECT id, kind, data, created_at, read_at FROM notifications WHERE user_id = ?';
  const { results } = after
    ? await env.DB.prepare(`${select} AND created_at > ? ORDER BY created_at ASC LIMIT ${POPUPS}`).bind(actorId, after).all<Row>()
    : await env.DB.prepare(`${select} ORDER BY created_at DESC LIMIT ${LATEST}`).bind(actorId).all<Row>();
  const unread = await env.DB.prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND read_at IS NULL')
    .bind(actorId)
    .first<{ total: number }>();
  const feed: NotificationFeed = { items: results.map(toItem), unread: unread?.total ?? 0, now: Date.now() };
  return json(feed);
}

/** POST /api/notifications/read: everything so far counts as read (the panel was opened). */
export async function markNotificationsRead({ env, actorId }: RouteContext) {
  await env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').bind(Date.now(), actorId).run();
  return json({ ok: true });
}

/** POST /api/notifications/sync: adds the reminders for bills that are due soon, for the data set in use. */
export async function syncNotifications({ env, userId }: RouteContext) {
  await syncBills(env, userId);
  return json({ ok: true });
}
