import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { formatDate } from '../format';
import { usePrefs } from '../prefs';
import { Dropdown } from './Dropdown';
import { Icon } from './Icon';
import { SkeletonSettingsCard } from './Skeleton';

// Settings → Ask AI: the NVIDIA key and model behind Ask AI. Laid out like Silpasala's Ask AI page.
// Only the admin sees this; the key is checked, stored encrypted, and never shown again.

interface AiStatus {
  canManage: boolean;
  configured: boolean;
  source: 'settings' | 'secret' | 'none';
  keyHint: string | null;
  model: string;
  defaultModel: string;
  models: string[];
  updatedAt: string | null;
  updatedBy: string | null;
  questionsToday: number;
  peopleToday: number;
}

interface TestResult {
  ok: boolean;
  ms: number;
  model: string;
  message: string;
}

export function AiSection() {
  const { t, lang } = usePrefs();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [key, setKey] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [test, setTest] = useState<TestResult | null>(null);

  function load() {
    api
      .get<AiStatus>('/ai/settings')
      .then((data) => {
        setFailed(false);
        setStatus(data);
      })
      .catch(() => setFailed(true));
  }

  useEffect(load, []);

  async function run(action: () => Promise<AiStatus>, done: string) {
    setError('');
    setBusy(true);
    try {
      setStatus(await action());
      setTest(null);
      window.DS?.toast(done, { variant: 'success' });
      return true;
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('ai.error'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveKey(event: FormEvent) {
    event.preventDefault();
    if (await run(() => api.put<AiStatus>('/ai/settings', { apiKey: key.trim() }), t('ai.keySaved'))) {
      setKey('');
      setEditing(false);
    }
  }

  async function saveModel(model: string) {
    await run(() => api.put<AiStatus>('/ai/settings', { model }), t('ai.modelSaved', { model }));
  }

  async function runTest() {
    setError('');
    setBusy(true);
    try {
      setTest(await api.post<TestResult>('/ai/test'));
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('ai.error'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(t('ai.removeConfirm'))) return;
    await run(() => api.delete<AiStatus>('/ai/settings'), t('ai.keyRemoved'));
  }

  if (status === null) return failed ? null : <SkeletonSettingsCard lines={3} />;
  if (!status.canManage) return null;

  const showForm = !status.configured || editing || status.source === 'secret';
  const models = [...new Set([status.model, ...status.models])];

  return (
    <>
      <section className="card storage-card">
        <div className="storage-head">
          <span className="storage-logo" aria-hidden="true">
            <Icon name="sparkle" size={24} />
          </span>
          <div className="grow">
            <h2 className="m-0">NVIDIA</h2>
            {status.configured ? (
              <p className="text-muted m-0">
                {status.source === 'secret' ? (
                  t('ai.secretUsed')
                ) : (
                  <>
                    {t('ai.key')} <strong className="text-accent">{status.keyHint}</strong>
                  </>
                )}
                {status.updatedAt && status.source === 'settings' && (
                  <> · {t('ai.savedBy', { date: formatDate(status.updatedAt.slice(0, 10), lang), email: status.updatedBy || '-' })}</>
                )}
              </p>
            ) : (
              <p className="text-muted m-0">{t('ai.notSet')}</p>
            )}
          </div>
          <span className={`badge ${status.configured ? 'badge-success badge-dot' : 'badge-warning'}`}>{status.configured ? t('ai.on') : t('ai.off')}</span>
        </div>

        {status.configured && (
          <>
            <div className="storage-stats">
              <div>
                <strong>{status.questionsToday}</strong>
                <span>{t('ai.questionsToday')}</span>
              </div>
              <div>
                <strong>{status.peopleToday}</strong>
                <span>{t('ai.peopleToday')}</span>
              </div>
            </div>

            <div className="stack">
              <span className="text-sm">{t('ai.model')}</span>
              <Dropdown
                value={status.model}
                options={models.map((model) => ({ value: model, label: model }))}
                onChange={(value) => value !== status.model && void saveModel(value)}
                ariaLabel={t('ai.model')}
              />
              <p className="hint">{t('ai.modelHint')}</p>
            </div>

            <div className="cluster">
              <button type="button" className="btn" onClick={() => void runTest()} aria-busy={busy} disabled={busy}>
                <Icon name="sparkle" size={14} />
                {t('ai.test')}
              </button>
              {status.source === 'settings' && !editing && (
                <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}>
                  {t('ai.replaceKey')}
                </button>
              )}
              {status.source === 'settings' && (
                <button type="button" className="btn btn-danger-soft" onClick={() => void remove()} disabled={busy}>
                  {t('ai.removeKey')}
                </button>
              )}
              {test && (
                <span className={test.ok ? 'text-success' : 'text-danger'}>
                  {test.ok ? t('ai.testOk', { model: test.model, seconds: (test.ms / 1000).toFixed(1) }) : test.message}
                </span>
              )}
            </div>
          </>
        )}

        {error && <p className="text-danger">{error}</p>}

        {showForm && (
          <form className="stack" onSubmit={(event) => void saveKey(event)}>
            <label className="stack">
              <span className="text-sm">{status.configured ? t('ai.newKey') : t('ai.keyLabel')}</span>
              <input
                type="password"
                className="input"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="nvapi-…"
                autoComplete="off"
                spellCheck={false}
                required
              />
              <span className="hint">{t('ai.keyHint')}</span>
            </label>
            <div className="cluster">
              <button type="submit" className="btn btn-primary" disabled={busy || !key.trim()} aria-busy={busy}>
                {t('ai.saveKey')}
              </button>
              {editing && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setEditing(false);
                    setKey('');
                  }}
                >
                  {t('ai.cancel')}
                </button>
              )}
            </div>
          </form>
        )}
      </section>

      <section className="card storage-card">
        <h3 className="m-0">{t('ai.stepsTitle')}</h3>
        <ol className="ai-steps">
          <li>{t('ai.step1')}</li>
          <li>{t('ai.step2')}</li>
          <li>{t('ai.step3')}</li>
          <li>{t('ai.step4')}</li>
        </ol>
        <a className="btn btn-sm" href="https://build.nvidia.com" target="_blank" rel="noreferrer">
          <Icon name="link" size={14} />
          {t('ai.openNvidia')}
        </a>
        <ul className="storage-notes">
          <li>{t('ai.note1')}</li>
          <li>{t('ai.note2')}</li>
          <li>{t('ai.note3')}</li>
        </ul>
      </section>
    </>
  );
}
