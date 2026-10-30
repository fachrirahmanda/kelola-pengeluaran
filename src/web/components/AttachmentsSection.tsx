import { useEffect, useState, type ChangeEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { usePrefs } from '../prefs';

// Receipts attached to one transaction. The files are stored in the data set owner's Google Drive.

interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export function AttachmentsSection({ transactionId }: { transactionId: string }) {
  const { t } = usePrefs();
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function load() {
    api
      .get<{ attachments: Attachment[] }>(`/transactions/${transactionId}/attachments`)
      .then((data) => setItems(data.attachments))
      .catch(() => setItems([]));
  }

  useEffect(load, [transactionId]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setBusy(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/attachments`, { method: 'POST', body: form, credentials: 'same-origin' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || t('attach.failed'));
      }
      load();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t('attach.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError('');
    try {
      await api.delete(`/attachments/${id}`);
      load();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('attach.failed'));
    }
  }

  return (
    <div className="stack">
      <div className="row-actions">
        <h4 className="section-heading">{t('attach.title')}</h4>
        <label className="btn btn-ghost btn-sm">
          {busy ? t('attach.uploading') : t('attach.add')}
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => void upload(event)} disabled={busy} hidden />
        </label>
      </div>
      {error && <p className="text-danger">{error}</p>}
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t('attach.none')}</p>
      ) : (
        <div className="stack">
          {items.map((item) => (
            <div key={item.id} className="row-actions">
              {item.mimeType.startsWith('image/') ? (
                <a href={`/api/attachments/${item.id}`} target="_blank" rel="noreferrer">
                  <img src={`/api/attachments/${item.id}`} alt={item.name} width={56} height={56} style={{ objectFit: 'cover', borderRadius: 8 }} />
                </a>
              ) : (
                <a href={`/api/attachments/${item.id}`} target="_blank" rel="noreferrer">
                  {item.name}
                </a>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove(item.id)}>
                {t('attach.remove')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
