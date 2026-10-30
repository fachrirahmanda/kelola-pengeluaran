import { useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { useWorkspace } from '../data';
import { usePrefs } from '../prefs';
import { formatDate } from '../format';
import { Icon } from './Icon';
import { SkeletonSettingsCard } from './Skeleton';

// Settings → Workspace: whose data this is, who shares it, the invitations waiting on each side. People
// show with their photo; actions are icon buttons with their names kept as tooltips.

/** A person's photo, or their initials on a soft circle when there is no photo. */
function PersonAvatar({ name, email, avatarUrl, size = 40 }: { name: string; email: string; avatarUrl?: string | null; size?: number }) {
  const source = name.trim() || email.split('@')[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
  return (
    <span className="ws-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {avatarUrl ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" /> : initials}
    </span>
  );
}

/** Settings section: the shared data set, its members, invitations sent, and invitations received. */
export function WorkspaceSection() {
  const { t, lang } = usePrefs();
  const { state, reload, failed } = useWorkspace();
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  if (state === null) {
    return failed ? null : <SkeletonSettingsCard lines={3} />;
  }
  const { workspace, invitations } = state;
  const isOwner = workspace.role === 'owner';
  const ownerName = workspace.ownerName || workspace.ownerEmail;

  // Joining or leaving a data set changes everything on screen, so the app reloads after it.
  async function run(action: () => Promise<unknown>, done: string, reloadApp = false) {
    setError('');
    try {
      await action();
      window.DS?.toast(done, { variant: 'success' });
      if (reloadApp) {
        window.location.reload();
        return;
      }
      await reload();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    const address = email.trim();
    await run(() => api.post('/workspace/invites', { email: address }), t('ws.inviteSent', { email: address }));
    setEmail('');
    setSending(false);
  }

  return (
    <section className="settings-section ws" aria-labelledby="settings-workspace">
      <div className="settings-section-head">
        <h3 id="settings-workspace">{t('ws.title')}</h3>
        <p className="hint">{t('ws.subtitle')}</p>
      </div>

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      {invitations.length > 0 && (
        <div className="card ws-card">
          <div className="ws-card-head">
            <h4 className="m-0">{t('ws.incoming')}</h4>
            <p className="hint m-0">{t('ws.incomingHint')}</p>
          </div>
          {invitations.map((invitation) => {
            const from = invitation.ownerName || invitation.ownerEmail;
            return (
              <div key={invitation.id} className="ws-row">
                <PersonAvatar name={from} email={invitation.ownerEmail} />
                <div className="grow ws-row-text">
                  <strong className="truncate">{from}</strong>
                  <span className="text-sm text-muted">{t('ws.invitedOn', { date: formatDate(invitation.createdAt.slice(0, 10), lang) })}</span>
                </div>
                <button
                  type="button"
                  className="icon-btn icon-btn-plain"
                  aria-label={t('ws.decline')}
                  title={t('ws.decline')}
                  onClick={() => void run(() => api.post(`/workspace/invites/${invitation.id}/decline`), t('ws.decline'))}
                >
                  <Icon name="x" size={16} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-plain ws-accept"
                  aria-label={t('ws.accept')}
                  title={t('ws.accept')}
                  onClick={() =>
                    void run(() => api.post(`/workspace/invites/${invitation.id}/accept`), t('ws.joined', { owner: from }), true)
                  }
                >
                  <Icon name="check" size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="card ws-card ws-hero">
        <PersonAvatar name={workspace.ownerName} email={workspace.ownerEmail} avatarUrl={workspace.ownerAvatarUrl} size={52} />
        <div className="grow ws-row-text">
          <strong className="truncate">{isOwner ? t('ws.yourData') : ownerName}</strong>
          <span className="text-sm text-muted truncate">{isOwner ? workspace.ownerEmail : t('ws.memberOf', { owner: ownerName })}</span>
        </div>
        <span className={`badge ${isOwner ? 'badge-success' : ''}`}>{isOwner ? t('ws.owner') : t('ws.member')}</span>
        {!isOwner && (
          <button
            type="button"
            className="icon-btn icon-btn-plain"
            aria-label={t('ws.leave')}
            title={t('ws.leave')}
            onClick={() => {
              if (!window.confirm(t('ws.confirmLeave', { owner: ownerName }))) return;
              void run(() => api.post('/workspace/leave'), t('ws.leave'), true);
            }}
          >
            <Icon name="logout" size={16} />
          </button>
        )}
      </div>

      {isOwner && (
        <div className="card ws-card">
          <div className="ws-card-head">
            <h4 className="m-0">{t('ws.members')}</h4>
            <p className="hint m-0">{t('ws.ownData')}</p>
          </div>
          <div className="ws-members">
            {workspace.members.map((member) => (
              <div key={member.userId} className="ws-person">
                <PersonAvatar name={member.name} email={member.email} avatarUrl={member.avatarUrl} />
                <div className="grow ws-row-text">
                  <strong className="truncate">{member.name || member.email}</strong>
                  <span className="text-sm text-muted truncate">{member.email}</span>
                </div>
                {member.role === 'owner' ? (
                  <span className="badge badge-success">{t('ws.owner')}</span>
                ) : (
                  <button
                    type="button"
                    className="icon-btn icon-btn-plain text-danger"
                    aria-label={t('ws.remove')}
                    title={t('ws.remove')}
                    onClick={() => {
                      if (!window.confirm(t('ws.confirmRemove', { name: member.name || member.email }))) return;
                      void run(() => api.delete(`/workspace/members/${member.userId}`), t('ws.remove'));
                    }}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {workspace.members.length <= 1 && <p className="hint m-0">{t('ws.onlyYou')}</p>}
        </div>
      )}

      {isOwner && (
        <div className="card ws-card">
          <div className="ws-card-head">
            <h4 className="m-0">{t('ws.invite')}</h4>
          </div>
          <form className="ws-invite" onSubmit={(event) => void invite(event)} noValidate>
            <input
              type="email"
              className="input grow"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              aria-label={t('ws.invite')}
              required
            />
            <button type="submit" className="ws-send" disabled={sending || !email.trim()} aria-label={t('ws.inviteButton')} title={t('ws.inviteButton')}>
              <Icon name="send" size={16} />
            </button>
          </form>

          {workspace.invites.length > 0 && (
            <div className="ws-chips">
              <span className="text-sm text-muted">{t('ws.pending')}</span>
              {workspace.invites.map((invite) => (
                <span key={invite.id} className="ws-chip" title={t('ws.invitedOn', { date: formatDate(invite.createdAt.slice(0, 10), lang) })}>
                  <Icon name="mail" size={14} />
                  <span className="truncate">{invite.email}</span>
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm icon-btn-plain"
                    aria-label={t('ws.revoke')}
                    title={t('ws.revoke')}
                    onClick={() => void run(() => api.delete(`/workspace/invites/${invite.id}`), t('ws.revoke'))}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
