import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { api } from '../api';
import { NOTIFICATIONS_CHANGED } from '../ask';
import { formatDate, localeOf } from '../format';
import { usePrefs } from '../prefs';
import type { ActivityItem, AppNotification, NotificationFeed } from '../../shared/types';
import { Icon } from './Icon';

// Notifications: the list behind the bell, and a toast for each new one. The server keeps them (see
// worker/notify.ts); the app asks for new ones every minute, and checks for bills due soon every 10 minutes.
// Each one opens the page it is about, from the toast or from the list.

const POLL_MS = 60_000;
const SYNC_MS = 10 * 60_000;
const POPUPS_AT_ONCE = 3;
const LATEST = 30;

type Prefs = Pick<ReturnType<typeof usePrefs>, 't' | 'money' | 'lang'>;

/** A person's initials, from their name or else their email. */
export function initialsOf(name: string, email: string): string {
  const source = name.trim() || email.split('@')[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** When something happened, as a short date and time in the person's own time zone. */
function whenOf(time: number, lang: Prefs['lang']) {
  return new Intl.DateTimeFormat(localeOf(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(time);
}

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
    case 'bill_reminder':
      return t('notif.billReminder', { source: String(d.source), amount: money(Number(d.amount)), date: formatDate(String(d.dueOn), lang), days: Number(d.days) });
    case 'ask_answered':
      return t('notif.askAnswered', { question: String(d.question) });
    case 'ask_failed':
      return t('notif.askFailed', { question: String(d.question) });
  }
}

/** The page a notification is about. */
export function linkOf(item: AppNotification): string {
  switch (item.kind) {
    case 'invite_received':
    case 'invite_accepted':
    case 'invite_declined':
    case 'member_left':
      return '/settings?tab=workspace';
    case 'member_removed':
      return '/dashboard';
    case 'data_created':
    case 'data_updated':
    case 'data_deleted':
      return '/transactions';
    case 'bill_due':
    case 'bill_reminder':
      // Opens that card's bills, so the person can see what the bill holds and choose its payment month.
      return item.data.sourceId ? `/bills?source=${encodeURIComponent(String(item.data.sourceId))}` : '/bills';
    case 'ask_answered':
      // Opens at the answer itself; older notifications without its id open at the latest one.
      return `/ask?answer=${item.data.id ? encodeURIComponent(String(item.data.id)) : 'last'}`;
    case 'ask_failed':
      // The question is back in the box at the bottom, ready to send again.
      return '/ask?answer=last';
  }
}

/** The notifications for the signed-in person, kept up to date. Mount it once, in the app shell. */
export function useNotifications() {
  const prefs = usePrefs();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  // The newest time seen. Popups are the notifications stored after it.
  const since = useRef<number | null>(null);
  // The latest language and currency, page and navigate, so the polling below does not restart when they change.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

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
        const link = linkOf(item);
        // Already on the page it is about (an answer on the Ask AI page): no toast.
        if (link.split('?')[0] === pathRef.current) continue;
        window.DS?.toast(notificationText(item, prefsRef.current), {
          variant: 'info',
          action: { label: prefsRef.current.t('notif.open'), onClick: () => navigateRef.current(link) },
        });
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
    // Something here made a notification on the server (an Ask AI answer): look for it now.
    const changed = () => void load();
    window.addEventListener(NOTIFICATIONS_CHANGED, changed);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(check);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener(NOTIFICATIONS_CHANGED, changed);
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

/** The list inside the notifications panel. Unread ones are highlighted; each opens the page it is about. */
export function NotificationList({ items, onOpen }: { items: AppNotification[]; onOpen: (item: AppNotification) => void }) {
  const prefs = usePrefs();
  const onKey = (item: AppNotification) => (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpen(item);
  };
  return (
    <div className="ds-notif-list">
      {items.map((item) => (
        <div
          key={item.id}
          className={`ds-notif-item notif-link${item.read ? '' : ' is-new'}`}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(item)}
          onKeyDown={onKey(item)}
        >
          <span className="avatar avatar-sm" aria-hidden="true">
            <Icon name="bell" size={14} />
          </span>
          <div className="ds-notif-body">
            <span className="ds-notif-text">{notificationText(item, prefs)}</span>
            <span className="ds-notif-meta">{whenOf(item.createdAt, prefs.lang)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The sentence for one action in the data set: "You …" for the signed-in person, else the member's name. */
function activityText(item: ActivityItem, { t, money }: Prefs): string {
  const d = item.data;
  const who = item.mine ? t('activity.you') : item.actor.name;
  const what = d.note ? `“${d.note}”` : t('activity.aTransaction');
  const amount = money(Number(d.amount));
  switch (item.kind) {
    case 'tx_created':
      return t('activity.txCreated', { who, what, amount });
    case 'tx_updated':
      return t('activity.txUpdated', { who, what, amount });
    case 'tx_deleted':
      return t('activity.txDeleted', { who, what, amount });
    case 'bill_paid':
      return t('activity.billPaid', { who, source: String(d.source), amount });
    case 'income_added':
      return t('activity.incomeAdded', { who, source: String(d.source), amount });
    case 'invite_sent':
      return t('activity.inviteSent', { who, email: String(d.email) });
    case 'member_joined':
      return t('activity.memberJoined', { who });
    case 'member_left':
      return t('activity.memberLeft', { who });
    case 'member_removed':
      return t('activity.memberRemoved', { who, name: String(d.name) });
  }
}

/** The page an action is about. */
export function activityLink(item: ActivityItem): string {
  switch (item.kind) {
    case 'tx_created':
    case 'tx_updated':
    case 'tx_deleted':
      return '/transactions';
    case 'bill_paid':
      return '/bills';
    case 'income_added':
      return '/sources';
    case 'invite_sent':
    case 'member_joined':
    case 'member_left':
    case 'member_removed':
      return '/settings?tab=workspace';
  }
}

/**
 * The Activity tab: what the signed-in person and the members did in the data set, newest first. Loaded
 * each time the tab shows, so it is current.
 */
export function ActivityList({ onOpen }: { onOpen: (item: ActivityItem) => void }) {
  const prefs = usePrefs();
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .get<{ items: ActivityItem[] }>('/activity')
      .then((data) => setItems(data.items))
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="text-sm text-muted">{prefs.t('common.error.network')}</p>;
  if (items === null) return <p className="text-sm text-muted">{prefs.t('common.loading')}</p>;
  if (items.length === 0) return <p className="text-sm text-muted">{prefs.t('activity.empty')}</p>;
  const onKey = (item: ActivityItem) => (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpen(item);
  };
  return (
    <div className="ds-notif-list">
      {items.map((item) => (
        <div key={item.id} className="ds-notif-item notif-link" role="button" tabIndex={0} onClick={() => onOpen(item)} onKeyDown={onKey(item)}>
          <span className="avatar avatar-sm activity-avatar" aria-hidden="true">
            {item.actor.avatarUrl ? <img src={item.actor.avatarUrl} alt="" referrerPolicy="no-referrer" /> : initialsOf(item.actor.name, item.actor.name)}
          </span>
          <div className="ds-notif-body">
            <span className="ds-notif-text">{activityText(item, prefs)}</span>
            <span className="ds-notif-meta">{whenOf(item.createdAt, prefs.lang)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
