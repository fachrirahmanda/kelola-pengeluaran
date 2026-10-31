import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAsk } from '../ask';
import { useAuth } from '../auth';
import { api } from '../api';
import { formatDate } from '../format';
import type { MessageKey } from '../i18n';
import { useBills, useWorkspace } from '../data';
import { usePrefs } from '../prefs';
import { ThemeSwitch } from './ThemeSwitch';
import { Icon } from './Icon';
import { UserMenu } from './UserMenu';
import { Dialog } from './Dialog';
import { ActivityList, NotificationList, activityLink, initialsOf, linkOf, useNotifications } from './Notifications';
import { SideSlotContext } from './SidePanel';
import { useLiveRefresh } from '../liveRefresh';

const ICON = {
  dashboard: <Icon name="home" size={18} />,
  add: <Icon name="plus" size={18} />,
  transactions: <Icon name="list" size={18} />,
  bills: <Icon name="note" size={18} />,
  recurring: <Icon name="sprint" size={18} />,
  reports: <Icon name="chart" size={18} />,
  settings: <Icon name="settings" size={18} />,
  ask: <Icon name="sparkle" size={18} />,
  budgets: <Icon name="target" size={18} />,
  loans: <Icon name="coins" size={18} />,
  categories: <Icon name="tag" size={18} />,
  wallets: <Icon name="wallet" size={18} />,
  creditCard: <Icon name="card" size={18} />,
  more: <Icon name="more" size={18} />,
};

interface Tab {
  to: string;
  label: MessageKey;
  icon: ReactNode;
  group: 'home' | 'history' | 'tools' | 'account';
  /** Shown in the phone bar. The rest sit behind "More". */
  primary: boolean;
  /** Listed in the desktop sidebar. False keeps it in the phone bar only. */
  sidebar?: boolean;
}

const BOTTOM_PATHS = ['/dashboard', '/reports', '/add', '/transactions'];

const TABS: Tab[] = [
  { to: '/dashboard', label: 'nav.dashboard', icon: ICON.dashboard, group: 'home', primary: true },
  { to: '/add', label: 'nav.add', icon: ICON.add, group: 'home', primary: true, sidebar: false },
  { to: '/transactions', label: 'nav.transactions', icon: ICON.transactions, group: 'history', primary: true },
  { to: '/sources', label: 'settings.sources', icon: ICON.wallets, group: 'tools', primary: false },
  { to: '/loans', label: 'nav.loans', icon: ICON.loans, group: 'tools', primary: false },
  { to: '/installments', label: 'nav.recurring', icon: ICON.recurring, group: 'tools', primary: false },
  { to: '/bills', label: 'nav.bills', icon: ICON.bills, group: 'tools', primary: false },
  { to: '/budgets', label: 'nav.budgets', icon: ICON.budgets, group: 'tools', primary: false },
  { to: '/reports', label: 'nav.reports', icon: ICON.reports, group: 'tools', primary: false },
  { to: '/ask', label: 'nav.ask', icon: ICON.ask, group: 'account', primary: false },
  { to: '/settings', label: 'nav.settings', icon: ICON.settings, group: 'account', primary: false },
];

const GROUP_LABELS: Record<Tab['group'], MessageKey> = {
  home: 'nav.groupHome',
  history: 'nav.groupHistory',
  tools: 'nav.groupTools',
  account: 'nav.groupAccount',
};

const GROUP_ORDER: Tab['group'][] = ['home', 'history', 'tools', 'account'];


const COLLAPSED_KEY = 'neraca.sidebar';

export function Layout() {
  const { user, signOut } = useAuth();
  const { t, lang } = usePrefs();
  const navigate = useNavigate();
  const { state, reload } = useWorkspace();
  const { bills } = useBills();
  const invitations = state?.invitations ?? [];
  const { items: notifications, unread, markRead } = useNotifications();
  const { busy: asking } = useAsk();
  const openBills = bills?.open.length ?? 0;
  const [more, setMore] = useState(false);
  const [account, setAccount] = useState(false);
  const [notices, setNotices] = useState(false);
  // The bell's panel: notifications for this person, or everyone's activity in the data set.
  const [noticeTab, setNoticeTab] = useState<'notifications' | 'activity'>('notifications');
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === 'collapsed';
    } catch {
      return false;
    }
  });
  const location = useLocation();

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? 'collapsed' : 'expanded');
      } catch {
        // Storage can be blocked; the sidebar then simply starts expanded next time.
      }
      return next;
    });
  }

  // Accepting or declining an invitation: accepting switches the data set, so the page reloads.
  async function respond(id: string, action: 'accept' | 'decline') {
    try {
      await api.post(`/workspace/invites/${id}/${action}`);
    } catch {
      return;
    }
    if (action === 'accept') window.location.reload();
    else await reload();
  }

  // The phone bar: Home, Reports, Add (in the middle), Transactions, and More for everything else.
  const primaryTabs = BOTTOM_PATHS.map((path) => TABS.find((tab) => tab.to === path)).filter((tab): tab is Tab => tab !== undefined);
  const moreTabs = TABS.filter((tab) => !BOTTOM_PATHS.includes(tab.to));

  const [sideSlot, setSideSlot] = useState<HTMLElement | null>(null);
  // Changes made elsewhere load the page's content again; a new deploy reloads the page (see liveRefresh.ts).
  const refreshKey = useLiveRefresh();
  return (
    <div className={`ds-app${collapsed ? ' is-collapsed' : ''}`}>
      <aside className="ds-sidebar" aria-label={t('nav.menu')}>
        <div className="ds-sidebar-head">
          <NavLink to="/dashboard" className="ds-sidebar-brand">
            <img src="/favicon.svg" alt="" width="32" height="32" />
            <span className="ds-sidebar-text">Neraca</span>
          </NavLink>
          <div className="sidebar-head-actions">
            {/* Notifications on desktop; on phones the bell is in the top bar. */}
            <button
              type="button"
              className="icon-btn icon-btn-sm icon-btn-plain notif-btn"
              onClick={() => {
                setNotices(true);
                markRead();
              }}
              aria-label={t('nav.notifications')}
              title={t('nav.notifications')}
            >
              <Icon name="bell" size={16} />
              {invitations.length + unread > 0 && <span className="notif-count">{invitations.length + unread}</span>}
            </button>
            <button type="button" className="icon-btn icon-btn-sm icon-btn-plain sidebar-collapse" onClick={toggleCollapsed} aria-label={collapsed ? t('nav.expand') : t('nav.collapse')} title={collapsed ? t('nav.expand') : t('nav.collapse')}>
              <Icon name={collapsed ? 'sidebar-open' : 'sidebar-close'} size={16} />
            </button>
          </div>
        </div>

        <nav className="ds-sidebar-scroll" aria-label={t('nav.menu')}>
          {GROUP_ORDER.map((group) => (
            <div key={group} className="sidebar-group">
              <p className="ds-sidebar-label">{t(GROUP_LABELS[group])}</p>
              <div className="ds-sidebar-nav">
                {TABS.filter((tab) => tab.group === group && tab.sidebar !== false).map((tab) => (
                  <NavLink key={tab.label} to={tab.to} className="ds-sidebar-link" title={t(tab.label)}>
                    {tab.icon}
                    <span className="ds-sidebar-text">{t(tab.label)}</span>
                    {tab.to === '/bills' && openBills > 0 && <span className="sidebar-count ds-sidebar-text">{openBills}</span>}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="ds-sidebar-foot">
          <ThemeSwitch />
          {user && (
            <UserMenu
              name={user.name}
              email={user.email}
              initials={initialsOf(user.name, user.email)}
              avatarUrl={user.avatarUrl}
              onProfile={() => navigate('/profile')}
              onSignOut={() => void signOut()}
            />
          )}
        </div>
      </aside>

      <header className="ds-mobile-bar">
        <NavLink to="/dashboard" className="ds-sidebar-brand">
          <img src="/favicon.svg" alt="" width="26" height="26" />
          <span>Neraca</span>
        </NavLink>
        <NavLink to="/ask" className="icon-btn icon-btn-plain ask-link" aria-label={asking ? t('ask.thinking') : t('nav.ask')} title={asking ? t('ask.thinking') : t('nav.ask')}>
          <Icon name="sparkle" size={18} />
          {asking && <span className="ask-busy-dot" aria-hidden="true" />}
        </NavLink>
        <button
          type="button"
          className="icon-btn icon-btn-plain notif-btn"
          onClick={() => {
            setNotices(true);
            markRead();
          }}
          aria-label={t('nav.notifications')}
          title={t('nav.notifications')}
        >
          <Icon name="bell" size={18} />
          {invitations.length + unread > 0 && <span className="notif-count">{invitations.length + unread}</span>}
        </button>
        {user && (
          <button type="button" className="ds-mobile-avatar" onClick={() => setAccount(true)} aria-label={t('nav.account')}>
            <span className="avatar avatar-sm" aria-hidden="true">
              {user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : initialsOf(user.name, user.email)}
            </span>
          </button>
        )}
      </header>

      <main className="app-main">
        <div className="container page">
        {invitations.length > 0 && (
          <div className="alert alert-info invite-banner" role="status">
            <div className="alert-content">
              <p>{t('ws.banner', { owner: invitations[0].ownerName || invitations[0].ownerEmail })}</p>
            </div>
            <NavLink to="/settings" className="dash-link">
              {t('ws.bannerLink')}
            </NavLink>
          </div>
        )}
        <SideSlotContext value={sideSlot}>
          <Outlet key={refreshKey} />
        </SideSlotContext>
        </div>
        <div className="app-side" ref={setSideSlot} />
      </main>

      <Dialog open={account} onClose={() => setAccount(false)} title={user?.name || user?.email || ''} className="ds-sheet">
        {user && <p className="text-sm text-muted">{user.email}</p>}
        <nav className="ds-more-list" aria-label={t('nav.account')}>
          <button type="button" className="ds-more-item" onClick={() => { setAccount(false); navigate('/profile'); }}>
            <span className="ds-more-icon"><Icon name="user" size={18} /></span>
            {t('nav.profile')}
            <Icon name="chevron-right" size={16} className="ds-more-chevron" />
          </button>
          <button type="button" className="ds-more-item" onClick={() => { setAccount(false); void signOut(); }}>
            <span className="ds-more-icon"><Icon name="logout" size={18} /></span>
            {t('nav.signOut')}
          </button>
        </nav>
      </Dialog>

      <Dialog open={notices} onClose={() => setNotices(false)} title={t('nav.notifications')} className="notif-drawer">
        <div className="tabs notif-tabs" role="tablist" aria-label={t('nav.notifications')}>
          <button type="button" role="tab" className="tab" aria-selected={noticeTab === 'notifications'} onClick={() => setNoticeTab('notifications')}>
            {t('notif.tabNotifications')}
          </button>
          <button type="button" role="tab" className="tab" aria-selected={noticeTab === 'activity'} onClick={() => setNoticeTab('activity')}>
            {t('notif.tabActivity')}
          </button>
        </div>
        {noticeTab === 'activity' ? (
          <ActivityList
            onOpen={(item) => {
              setNotices(false);
              navigate(activityLink(item));
            }}
          />
        ) : invitations.length === 0 && notifications.length === 0 ? (
          <p className="text-sm text-muted">{t('nav.noNotifications')}</p>
        ) : (
          <>
            {invitations.length > 0 && (
              <div className="ds-notif-list">
                {invitations.map((invitation) => (
                  <div key={invitation.id} className="ds-notif-item is-new">
                    <span className="avatar avatar-sm" aria-hidden="true">{initialsOf(invitation.ownerName, invitation.ownerEmail)}</span>
                    <div className="ds-notif-body">
                      <span className="ds-notif-text">{t('ws.banner', { owner: invitation.ownerName || invitation.ownerEmail })}</span>
                      <span className="ds-notif-meta">{t('ws.invitedOn', { date: formatDate(invitation.createdAt.slice(0, 10), lang) })}</span>
                      <div className="row-actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void respond(invitation.id, 'decline')}>{t('ws.decline')}</button>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => void respond(invitation.id, 'accept')}>{t('ws.accept')}</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {notifications.length > 0 && (
              <NotificationList
                items={notifications}
                onOpen={(item) => {
                  setNotices(false);
                  navigate(linkOf(item));
                }}
              />
            )}
          </>
        )}
      </Dialog>

      <Dialog open={more} onClose={() => setMore(false)} title={t('nav.more')} className="ds-sheet">
        <nav className="ds-more-list" aria-label={t('nav.more')}>
          {GROUP_ORDER.filter((group) => moreTabs.some((tab) => tab.group === group)).map((group) => (
            <div key={group} className="more-group">
              <p className="more-group-label">{t(GROUP_LABELS[group])}</p>
              {moreTabs
                .filter((tab) => tab.group === group)
                .map((tab) => (
                  <NavLink key={tab.label} to={tab.to} className="ds-more-item" onClick={() => setMore(false)}>
                    <span className="ds-more-icon">{tab.icon}</span>
                    {t(tab.label)}
                    <Icon name="chevron-right" size={16} className="ds-more-chevron" />
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
      </Dialog>

      <nav className="ds-bottom-nav" aria-label={t('nav.menu')}>
        {primaryTabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} className={`ds-bottom-nav-item${tab.to === '/add' ? ' is-add' : ''}`}>
            <span className={tab.to === '/add' ? 'bottom-add-circle' : undefined}>{tab.icon}</span>
            <span className={tab.to === '/add' ? 'visually-hidden' : undefined}>{t(tab.label)}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={`ds-bottom-nav-item${more || moreTabs.some((tab) => tab.to === location.pathname) ? ' active' : ''}`}
          aria-expanded={more}
          onClick={() => setMore((open) => !open)}
        >
          {ICON.more}
          <span>{t('nav.more')}</span>
        </button>
      </nav>
    </div>
  );
}
