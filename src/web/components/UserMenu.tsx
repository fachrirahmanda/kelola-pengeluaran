import { Icon } from './Icon';
import { usePrefs } from '../prefs';

// The signed-in person's menu from Silpasala's sidebar: the account button with name and role, and a
// Basis dropdown above it with the name and email, then Profile and Sign out.

export function UserMenu({
  name,
  email,
  initials,
  avatarUrl,
  onProfile,
  onSignOut,
}: {
  name: string;
  email: string;
  initials: string;
  avatarUrl?: string | null;
  onProfile: () => void;
  onSignOut: () => void;
}) {
  const { t } = usePrefs();

  return (
    <div className="dropdown dropdown-up ds-sidebar-user">
      <button type="button" className="ds-user-btn" data-ds-toggle="dropdown" aria-expanded="false" aria-haspopup="menu" aria-label={t('nav.account')} title={email}>
        <span className="avatar avatar-sm" aria-hidden="true">
          {avatarUrl ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" /> : initials}
        </span>
        <span className="ds-user-btn-text ds-sidebar-text">
          <strong className="truncate">{name || email}</strong>
          <span className="truncate">{t('nav.owner')}</span>
        </span>
        <span className="ds-sidebar-text" aria-hidden="true">
          <Icon name="chevron-up" size={12} />
        </span>
      </button>
      <div className="menu" role="menu">
        <div className="ds-menu-user">
          <strong>{name || email}</strong>
          <span className="text-sm text-muted">{email}</span>
        </div>
        <div className="menu-divider" role="separator" />
        <button type="button" className="menu-item" role="menuitem" onClick={onProfile}>
          <Icon name="user" size={16} />
          {t('nav.profile')}
        </button>
        <button type="button" className="menu-item" role="menuitem" onClick={onSignOut}>
          <Icon name="logout" size={16} />
          {t('nav.signOut')}
        </button>
      </div>
    </div>
  );
}
