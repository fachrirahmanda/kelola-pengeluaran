import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, ApiRequestError } from '../api';
import { formatDate } from '../format';
import { Icon } from './Icon';
import { SkeletonSettingsCard } from './Skeleton';
import { usePrefs } from '../prefs';
import type { MessageKey } from '../i18n';

// Settings: the Google Drive that receipt attachments are stored in. Laid out like Silpasala's Storage
// page: the account, how much it holds, and the rules. The admin connects and disconnects it.

interface DriveStatus {
  canManage: boolean;
  connected: boolean;
  email: string | null;
  folderId: string | null;
  connectedAt: string | null;
  files: number;
  bytes: number;
}

const RESULTS: Record<string, MessageKey> = {
  connected: 'drive.done',
  state: 'drive.failed',
  failed: 'drive.failed',
  forbidden: 'drive.ownerOnly',
};

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export function DriveSection() {
  const { t, lang } = usePrefs();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState('');
  const result = params.get('drive');

  function load() {
    api
      .get<DriveStatus>('/drive')
      .then((data) => {
        setFailed(false);
        setStatus(data);
      })
      .catch(() => setFailed(true));
  }

  useEffect(load, []);

  // The connect flow comes back here with ?drive=…; show the result once, then drop it from the URL.
  useEffect(() => {
    if (!result) return;
    if (result === 'connected') load();
    const next = new URLSearchParams(params);
    next.delete('drive');
    setParams(next, { replace: true });
    // Only on arrival: the params are read once.
  }, []);

  async function disconnect() {
    if (!confirm(t('drive.confirmDisconnect'))) return;
    setError('');
    try {
      await api.delete('/drive');
      load();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('drive.failed'));
    }
  }

  if (status === null) return failed ? null : <SkeletonSettingsCard lines={3} />;

  return (
    <section className="card storage-card">
      <div className="storage-head">
        <span className="storage-logo" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 87.3 78">
            <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
            <path d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5A9 9 0 0 0 0 53h27.5z" fill="#00ac47" />
            <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z" fill="#ea4335" />
            <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
            <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
            <path d="M73.4 26.5 60.7 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
          </svg>
        </span>
        <div className="grow">
          <h2 className="m-0">{t('drive.title')}</h2>
          {status.connected ? (
            <p className="text-muted m-0">
              {t('drive.connectedAs', { email: status.email || '-' })}
              {status.connectedAt && <> · {t('drive.since', { date: formatDate(status.connectedAt.slice(0, 10), lang) })}</>}
            </p>
          ) : (
            <p className="text-muted m-0">{t('drive.notConnectedHint')}</p>
          )}
        </div>
        <span className={`badge ${status.connected ? 'badge-success badge-dot' : 'badge-warning'}`}>
          {status.connected ? t('drive.statusConnected') : t('drive.statusNot')}
        </span>
      </div>

      {status.connected && (
        <div className="storage-stats">
          <div>
            <strong>{status.files}</strong>
            <span>{t('drive.receipts')}</span>
          </div>
          <div>
            <strong>{size(status.bytes)}</strong>
            <span>{t('drive.used')}</span>
          </div>
          {status.folderId && (
            <a className="btn btn-sm" href={`https://drive.google.com/drive/folders/${status.folderId}`} target="_blank" rel="noreferrer">
              <Icon name="folder" size={14} />
              {t('drive.openFolder')}
            </a>
          )}
        </div>
      )}

      <ul className="storage-notes">
        <li>{t('drive.note1')}</li>
        <li>{t('drive.note2')}</li>
        <li>{t('drive.note3')}</li>
        <li>{t('drive.note4')}</li>
      </ul>

      {error && <p className="text-danger">{error}</p>}
      {result && RESULTS[result] && <p className="text-sm text-muted">{t(RESULTS[result])}</p>}

      {status.canManage && (
        <div className="cluster">
          <a className="btn btn-primary" href="/api/drive/connect">
            <Icon name="link" size={14} />
            {status.connected ? t('drive.reconnect') : t('drive.connect')}
          </a>
          {status.connected && (
            <button type="button" className="btn btn-danger-soft" onClick={() => void disconnect()}>
              {t('drive.disconnect')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
