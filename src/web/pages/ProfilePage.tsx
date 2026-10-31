import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiRequestError } from '../api';
import { useAuth } from '../auth';
import { Dialog } from '../components/Dialog';
import { Dropdown } from '../components/Dropdown';
import { CURRENCY_FLAGS, Flag, LANGUAGE_FLAGS } from '../components/Flag';
import { Icon } from '../components/Icon';
import { useWorkspace } from '../data';
import { CURRENCIES } from '../format';
import { LANGUAGES, type Lang } from '../i18n';
import { usePrefs } from '../prefs';
import type { User } from '../../shared/types';

// Profile: the person's account (name, photo, email, when they joined and last signed in), their own
// preferences (currency and language), and signing out. Shared data and app settings live in Settings.

const AVATAR_SIZE = 256;

function initialsOf(name: string, email: string): string {
  const source = name.trim() || email.split('@')[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** A square photo: the picture is cropped to the centre and shrunk, so it stays small to store. */
async function squarePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas');
  const scale = Math.max(AVATAR_SIZE / bitmap.width, AVATAR_SIZE / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.drawImage(bitmap, (AVATAR_SIZE - width) / 2, (AVATAR_SIZE - height) / 2, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('photo'))), 'image/webp', 0.85);
  });
}

const RESET_WORD = 'RESET';

/**
 * Reset data, for the owner of the data set: empties everything recorded so they can start again. It asks for
 * the word RESET first, and can put the categories back to the defaults or keep them.
 */
function ResetSection() {
  const { t } = usePrefs();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [keepCategories, setKeepCategories] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function close() {
    setOpen(false);
    setWord('');
    setError('');
  }

  async function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/profile/reset', { confirm: word.trim(), keepCategories });
      close();
      window.DS?.toast(t('reset.done'), { variant: 'success' });
      navigate('/dashboard');
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card storage-card reset-card">
      <div>
        <h3 className="m-0">{t('reset.title')}</h3>
        <p className="hint m-0">{t('reset.hint')}</p>
      </div>
      <div>
        <button type="button" className="btn btn-danger-soft" onClick={() => setOpen(true)}>
          <Icon name="trash" size={16} />
          {t('reset.button')}
        </button>
      </div>

      <Dialog open={open} onClose={close} title={t('reset.confirmTitle')} size="sm">
        <form className="stack-lg" onSubmit={(event) => void reset(event)} noValidate>
          <p className="m-0">{t('reset.confirmText')}</p>
          <ul className="reset-list">
            <li>{t('reset.listData')}</li>
            <li>{t('reset.listSources')}</li>
            <li>{t('reset.listOther')}</li>
          </ul>
          <p className="hint m-0">{t('reset.keeps')}</p>
          <label className="check">
            <input type="checkbox" checked={keepCategories} onChange={(event) => setKeepCategories(event.target.checked)} />
            {t('reset.keepCategories')}
          </label>
          <label className="tx-field">
            <span className="tx-field-label">{t('reset.typeWord', { word: RESET_WORD })}</span>
            <input className="input" value={word} onChange={(event) => setWord(event.target.value)} autoComplete="off" autoCapitalize="characters" placeholder={RESET_WORD} />
          </label>
          {error && (
            <p className="text-danger m-0" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="btn" onClick={close}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-danger" disabled={busy || word.trim() !== RESET_WORD} aria-busy={busy}>
              {busy ? t('reset.working') : t('reset.confirm')}
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

export function ProfilePage() {
  const { t, currency, setCurrency, lang, setLang, palette, setPalette, date } = usePrefs();
  const { user, setUser, signOut } = useAuth();
  const { state } = useWorkspace();
  const [details, setDetails] = useState<{ createdAt: string; lastLoginAt: string | null } | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const role = state?.workspace.role === 'owner' ? t('nav.owner') : t('ws.member');

  // Loaded once the page opens: the dates are not part of the signed-in user.
  useEffect(() => {
    api
      .get<{ createdAt: string; lastLoginAt: string | null }>('/profile')
      .then(setDetails)
      .catch(() => setDetails(null));
  }, []);

  async function refreshUser(next: User) {
    setUser(next);
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const data = await api.put<{ user: User }>('/profile', { name: (name ?? '').trim() });
      await refreshUser(data.user);
      setName(null);
      setMessage(t('profile.saved'));
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('profile.error'));
    } finally {
      setBusy(false);
    }
  }

  async function changePhoto(file: File) {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const blob = await squarePhoto(file);
      const form = new FormData();
      form.append('file', blob, 'photo.webp');
      const res = await fetch('/api/profile/avatar', { method: 'PUT', body: form, credentials: 'same-origin' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || t('profile.error'));
      }
      await refreshUser(((await res.json()) as { user: User }).user);
      setMessage(t('profile.saved'));
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : t('profile.error'));
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const data = await api.delete<{ user: User }>('/profile/avatar');
      await refreshUser(data.user);
      setMessage(t('profile.saved'));
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('profile.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>{t('profile.title')}</h2>
          <p className="hint">{t('profile.subtitle')}</p>
        </div>
      </div>

      {user && (
        <section className="card storage-card profile-card">
          <div className="profile-head">
            {/* The photo is the button: a pencil on it, and "Change photo" over it on hover, say it can be changed. */}
            <label className={`profile-avatar${busy ? ' is-busy' : ''}`} title={t('profile.changePhoto')}>
              <span className="avatar profile-avatar-img" aria-hidden="true">
                {user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : initialsOf(user.name, user.email)}
              </span>
              <span className="profile-avatar-overlay" aria-hidden="true">
                <Icon name="image" size={18} />
                {busy ? t('form.saving') : t('profile.changePhotoShort')}
              </span>
              <span className="profile-avatar-edit" aria-hidden="true">
                <Icon name="edit" size={13} />
              </span>
              <span className="visually-hidden">{t('profile.changePhoto')}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void changePhoto(file);
                }}
              />
            </label>
            <div className="grow profile-who">
              <h2 className="m-0 truncate">{user.name || user.email}</h2>
              <p className="text-muted m-0 truncate">{user.email}</p>
              {/* This page is open, so the account is active now; others see it in the workspace list too. */}
              <span className="presence is-active">
                <i aria-hidden="true" />
                {t('presence.active')}
              </span>
            </div>
            <span className="badge">{user.isAdmin ? t('profile.admin') : role}</span>
          </div>

          <p className="hint m-0 profile-photo-hint">
            {t('profile.photoHint')}
            {user.avatarUrl?.startsWith('/api/avatar/') && (
              <>
                {' · '}
                <button type="button" className="link-btn" onClick={() => void removePhoto()} disabled={busy}>
                  {t('profile.removePhoto')}
                </button>
              </>
            )}
          </p>

          <form className="tx-field" onSubmit={(event) => void saveName(event)}>
            <label className="tx-field-label" htmlFor="profile-name">
              {t('profile.name')}
            </label>
            <div className="profile-name-row">
              <input id="profile-name" className="input" value={name ?? user.name} maxLength={60} onChange={(event) => setName(event.target.value)} required />
              <button type="submit" className="btn btn-primary" disabled={busy || (name ?? user.name).trim() === user.name || !(name ?? user.name).trim()}>
                {t('profile.saveName')}
              </button>
            </div>
          </form>

          {state && (
            <p className="text-sm text-muted m-0">
              {t('profile.workspace', { owner: state.workspace.ownerName || state.workspace.ownerEmail })}
            </p>
          )}

          {error && (
            <p className="text-danger" role="alert">
              {error}
            </p>
          )}
          {message && <p className="text-sm text-muted m-0">{message}</p>}
        </section>
      )}

      {user && (
        <section className="card storage-card">
          <h3 className="m-0">{t('profile.account')}</h3>
          <div className="list-row">
            <span className="source-meta">{t('profile.email')}</span>
            <span>{user.email}</span>
          </div>
          <div className="list-row">
            <span className="source-meta">{t('profile.joined')}</span>
            <span>{details ? date(details.createdAt.slice(0, 10)) : '—'}</span>
          </div>
          <div className="list-row">
            <span className="source-meta">{t('profile.lastLogin')}</span>
            <span>{details?.lastLoginAt ? date(details.lastLoginAt.slice(0, 10)) : t('profile.never')}</span>
          </div>
        </section>
      )}

      <section className="settings-section" aria-labelledby="settings-preferences">
        <div className="settings-section-head">
          <h3 id="settings-preferences">{t('settings.preferences')}</h3>
          <p className="hint">{t('settings.currencyHint')}</p>
        </div>
        <div className="card">
          <div className="card-body settings-pref-row">
            <span className="tx-field-label">{t('settings.currency')}</span>
            <Dropdown
              value={currency}
              options={CURRENCIES.map((code) => ({ value: code, label: code, icon: <Flag code={CURRENCY_FLAGS[code]} /> }))}
              onChange={setCurrency}
              ariaLabel={t('settings.currency')}
            />
          </div>
        </div>
        <div className="card">
          <div className="card-body settings-pref-row">
            <span className="tx-field-label">{t('nav.language')}</span>
            <Dropdown
              value={lang}
              options={LANGUAGES.map((option) => ({ value: option.value, label: option.label, icon: <Flag code={LANGUAGE_FLAGS[option.value]} /> }))}
              onChange={(next) => setLang(next as Lang)}
              ariaLabel={t('nav.language')}
            />
          </div>
        </div>
        <div className="card">
          <div className="card-body settings-pref-row">
            <span className="tx-field-label">{t('palette.title')}</span>
            <div className="chip-row" role="radiogroup" aria-label={t('palette.title')}>
              <button type="button" role="radio" aria-checked={palette === 'mono'} className="pill" onClick={() => setPalette('mono')}>
                {t('palette.mono')}
              </button>
              <button type="button" role="radio" aria-checked={palette === 'pastel'} className="pill" onClick={() => setPalette('pastel')}>
                {t('palette.pastel')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {state?.workspace.role === 'owner' && <ResetSection />}

      {/* A plain button: signing out is not the page's main action, so it does not look like Save. */}
      <button type="button" className="btn btn-block" onClick={() => void signOut()}>
        <Icon name="logout" size={16} />
        {t('nav.signOut')}
      </button>
    </>
  );
}
