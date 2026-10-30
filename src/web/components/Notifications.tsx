import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { formatDate } from '../format';
import { usePrefs } from '../prefs';
import type { AppNotification, NotificationFeed } from '../../shared/types';
import { Icon } from './Icon';

// Notifications: the list behind the bell, and a toast for each new one. The server keeps them (see
// worker/notify.ts); the app asks for new ones every minute, and checks for bills due soon every 10 minutes.

const POLL_MS = 60_000;
const SYNC_MS = 10 * 60_000;
const POPUPS_AT_ONCE = 3;
const LATEST = 30;

type Prefs = Pick<ReturnType<typeof usePrefs>, 't' | 'money' | 'lang'>;

/** The sentence for one notification, in the language the app is shown in. */
export function notificationText(item: AppNotification, { t, money, lang }: Prefs): string {
  const d = item.data;
  switch (item.kind) {
    case 'invite_received':
      return t('notif.inviteReceived', { owner: String(d.owner) });
    case 'invite_accepted':
      return t('notif.inviteAccepted', { name: String(d.name) });
    case 'invite_declined':
      return t('notif.inviteDeclined', { email: String(d.email) });
    case 'member_removed':
      return t('notif.memberRemoved', { owner: String(d.owner) });
    case 'member_left':
      return t('notif.memberLeft', { name: String(d.name) });
    case 'data_created':
      return t('notif.dataCreated', { actor: String(d.actor), amount: money(Number(d.amount)) });
    case 'data_updated':
      return t('notif.dataUpdated', { actor: String(d.actor), amount: money(Number(d.amount)) });
    case 'data_deleted':
      return t('notif.dataDeleted', { actor: String(d.actor), amount: money(Number(d.amount)) });
    case 'bill_due':
      return t('notif.billDue', { source: String(d.source), amount: money(Number(d.amount)), date: formatDate(String(d.dueOn), lang) });
  }
}

/** The notifications for the signed-in person, kept up to date. Mount it once, in the app shell. */
export function useNotifications() {
  const prefs = usePrefs();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  // The newest time seen. Popups are the notifications stored after it.
  const since = useRef<number | null>(null);
  // The latest language and currency, so the polling below does not restart when they change.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const load = useCallback(async () => {
    const first = since.current === null;
    try {
      const feed = await api.get<NotificationFeed>(first ? '/notifications' : `/notifications?after=${since.current}`);
      setUnread(feed.unread);
      if (first) {
        setItems(feed.items);
        since.current = feed.now;
        return;
      }
      if (feed.items.length === 0) return;
      since.current = Math.max(...feed.items.map((item) => item.createdAt));
      for (const item of feed.items.slice(-POPUPS_AT_ONCE)) {
        window.DS?.toast(notificationText(item, prefsRef.current), { variant: 'info' });
      }
      setItems((list) => {
        const known = new Set(list.map((item) => item.id));
        const fresh = [...feed.items].reverse().filter((item) => !known.has(item.id));
        return [...fresh, ...list].slice(0, LATEST);
      });
    } catch {
      // Offline or signed out: the next check tries again.
    }
  }, []);

  useEffect(() => {
    const sync = () => api.post('/notifications/sync').catch(() => {});
    void sync().finally(() => void load());
    const poll = window.setInterval(() => void load(), POLL_MS);
    const check = window.setInterval(() => void sync(), SYNC_MS);
    const wake = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(check);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [load]);

  /** The panel was opened: everything so far counts as read. */
  const markRead = useCallback(() => {
    setUnread(0);
    setItems((list) => list.map((item) => ({ ...item, read: true })));
    api.post('/notifications/read').catch(() => {});
  }, []);

  return { items, unread, markRead };
}

/** The list inside the notifications panel. Unread ones are highlighted. */
export function NotificationList({ items }: { items: AppNotification[] }) {
  const prefs = usePrefs();
  return (
    <div className="ds-notif-list">
      {items.map((item) => (
        <div key={item.id} className={`ds-notif-item${item.read ? '' : ' is-new'}`}>
          <span className="avatar avatar-sm" aria-hidden="true">
            <Icon name="bell" size={14} />
          </span>
          <div className="ds-notif-body">
            <span className="ds-notif-text">{notificationText(item, prefs)}</span>
            <span className="ds-notif-meta">{formatDate(new Date(item.createdAt + 7 * 3600 * 1000).toISOString().slice(0, 10), prefs.lang)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
