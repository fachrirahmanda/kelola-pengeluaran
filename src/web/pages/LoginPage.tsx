import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api, ApiRequestError } from '../api';
import { useAuth } from '../auth';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { usePrefs } from '../prefs';
import type { MessageKey } from '../i18n';
import type { User } from '../../shared/types';

// Rows for the preview in the brand panel: category color, and bar widths (%, or px for the amount). No real data.
const PREVIEW_ROWS = [
  { color: '#e76f51', title: 62, sub: 34, amount: 52 },
  { color: '#457b9d', title: 48, sub: 28, amount: 64 },
  { color: '#2a9d8f', title: 70, sub: 40, amount: 44 },
  { color: '#e9c46a', title: 54, sub: 30, amount: 58 },
];

const HIGHLIGHTS: { title: MessageKey; text: MessageKey }[] = [
  { title: 'login.hl1.title', text: 'login.hl1.text' },
  { title: 'login.hl2.title', text: 'login.hl2.text' },
  { title: 'login.hl3.title', text: 'login.hl3.text' },
];

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function LoginPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const { t } = usePrefs();
  const [error, setError] = useState('');
  // Dev login: only the Worker decides, and only on localhost with DEV_LOGIN=true in .dev.vars.
  const [devLogin, setDevLogin] = useState(false);
  const [devEmail, setDevEmail] = useState('');

  useEffect(() => {
    api
      .get<{ devLogin: boolean }>('/auth/config')
      .then((data) => setDevLogin(data.devLogin))
      .catch(() => setDevLogin(false));
  }, []);

  // Sign-in comes back here with ?error= when Google or the check failed.
  useEffect(() => {
    const failure = new URLSearchParams(window.location.search).get('error');
    if (failure) setError(failure === 'not_invited' ? 'login.notInvited' : 'login.failed');
  }, []);

  if (user) return <Navigate to="/dashboard" replace />;

  // Errors from the Worker are already in Indonesian. Only our own messages are translated.
  const errorText = error.startsWith('login.') ? t(error as MessageKey) : error;

  return (
    <div className="login">
      <aside className="login-hero">
        <div className="login-brand">
          <img src="/favicon.svg" alt="" width="36" height="36" />
          <span>Neraca</span>
        </div>

        <div className="login-pitch">
          <h2>{t('login.heroTitle')}</h2>
          <p>{t('login.heroText')}</p>
        </div>

        <div className="login-preview" aria-hidden="true">
          <div className="login-preview-total">
            <span>{t('login.previewTotal')}</span>
            <span className="bar" />
          </div>
          {PREVIEW_ROWS.map((row, i) => (
            <div key={i} className="login-preview-row" style={{ ['--i' as string]: i, ['--cat' as string]: row.color }}>
              <span className="login-preview-badge" />
              <span className="login-preview-lines">
                <span className="bar" style={{ width: `${row.title}%` }} />
                <span className="bar short" style={{ width: `${row.sub}%` }} />
              </span>
              <span className="login-preview-amount" style={{ width: `${row.amount}px` }} />
            </div>
          ))}
        </div>

        <ul className="login-highlights">
          {HIGHLIGHTS.map((item) => (
            <li key={item.title}>
              <span className="login-highlight-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
              </span>
              <span>
                <strong>{t(item.title)}</strong>
                <span>{t(item.text)}</span>
              </span>
            </li>
          ))}
        </ul>
      </aside>

      <main className="login-main">
        <div className="login-theme">
          <ThemeSwitch />
        </div>

        <div className="ds-login-card">
          <img src="/favicon.svg" alt="" width="44" height="44" className="login-card-logo" />
          <div className="ds-login-card-head">
            <h1>{t('login.title')}</h1>
            <p>{t('login.subtitle')}</p>
          </div>

          {errorText && (
            <div className="alert alert-danger" role="alert">
              <div className="alert-content">
                <p>{errorText}</p>
              </div>
            </div>
          )}

          <a href="/api/auth/google" className="btn btn-primary login-google">
            <span className="login-google-mark" aria-hidden="true">
              <GoogleMark />
            </span>
            {t('login.button')}
          </a>

          {devLogin && (
            <form
              className="dev-login"
              onSubmit={(event) => {
                event.preventDefault();
                setError('');
                api
                  .post<{ user: User }>('/auth/dev-login', { email: devEmail })
                  .then((data) => {
                    setUser(data.user);
                    navigate('/dashboard', { replace: true });
                  })
                  .catch((requestError: unknown) => setError(requestError instanceof ApiRequestError ? requestError.message : 'login.failed'));
              }}
            >
              <p className="hint">Dev login (localhost only)</p>
              <input type="email" className="input" value={devEmail} onChange={(event) => setDevEmail(event.target.value)} placeholder="you@example.com" required />
              <button type="submit" className="btn">
                Sign in with this email
              </button>
            </form>
          )}

          <p className="ds-login-note">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v.01M11 12h1v4h1" /></svg>
            <span>{t('login.note')}</span>
          </p>
        </div>
      </main>
    </div>
  );
}
