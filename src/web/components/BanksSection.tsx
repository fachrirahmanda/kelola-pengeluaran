import { useState, type CSSProperties, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { useBankList } from '../banks';
import { useWorkspace } from '../data';
import type { MessageKey } from '../i18n';
import { usePrefs } from '../prefs';
import { bankKinds, textOn, type Bank } from '../../shared/banks';
import type { SourceKind } from '../../shared/types';
import { BankBadge } from './BankBadge';
import { Icon } from './Icon';
import { SidePanel } from './SidePanel';

// The Banks settings: the banks and e-wallets the data set's sources belong to. Each one holds some kinds of
// source (savings, credit card, paylater). Only the owner adds, changes or removes them.

const KIND_KEYS: Record<SourceKind, MessageKey> = {
  savings: 'source.savings',
  credit_card: 'source.credit_card',
  paylater: 'source.paylater',
};

export function BanksSection() {
  const { t } = usePrefs();
  const { banks, reload } = useBankList();
  const { state } = useWorkspace();
  const owner = state?.workspace.role === 'owner';
  // null: closed. {}: adding. { bank }: editing that bank.
  const [panel, setPanel] = useState<{ bank?: Bank } | null>(null);
  const [error, setError] = useState('');

  async function remove(bank: Bank) {
    if (!window.confirm(t('banks.confirmDelete', { name: bank.name }))) return;
    setError('');
    try {
      await api.delete(`/banks/${bank.id}`);
      window.DS?.toast(t('banks.deleted'));
      await reload();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    }
  }

  return (
    <section className="settings-section" aria-labelledby="banks-title">
      <div className="section-head">
        <div>
          <h3 id="banks-title" className="section-heading">
            {t('banks.title')}
          </h3>
          <p className="hint">{t('banks.hint')}</p>
        </div>
        {owner && (
          <button type="button" className="btn btn-sm" onClick={() => setPanel({})}>
            <Icon name="plus" size={15} />
            {t('banks.add')}
          </button>
        )}
      </div>

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="card">
        {banks.map((bank) => (
          <div key={bank.id} className="list-row">
            <BankBadge bankId={bank.id} size={32} />
            <div className="source-main grow">
              <span className="source-name">{bank.name}</span>
              <span className="source-meta">{bankKinds(bank).map((kind) => t(KIND_KEYS[kind])).join(' · ')}</span>
            </div>
            {owner && (
              <div className="row-actions">
                <button type="button" className="icon-btn icon-btn-sm icon-btn-plain icon-btn-soft" onClick={() => setPanel({ bank })} aria-label={t('cat.edit')} title={t('cat.edit')}>
                  <Icon name="edit" size={15} />
                </button>
                <button type="button" className="icon-btn icon-btn-sm icon-btn-plain icon-btn-soft text-danger" onClick={() => void remove(bank)} aria-label={t('cat.delete')} title={t('cat.delete')}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <SidePanel open={panel !== null} onClose={() => setPanel(null)} title={panel?.bank ? t('banks.edit') : t('banks.add')}>
        {panel && (
          <BankEditor
            key={panel.bank?.id ?? 'new'}
            initial={panel.bank}
            onSaved={async () => {
              setPanel(null);
              await reload();
            }}
            onCancel={() => setPanel(null)}
          />
        )}
      </SidePanel>
    </section>
  );
}

function BankEditor({ initial, onSaved, onCancel }: { initial?: Bank; onSaved: () => Promise<void>; onCancel: () => void }) {
  const { t } = usePrefs();
  const [name, setName] = useState(initial?.name ?? '');
  const [short, setShort] = useState(initial?.short ?? '');
  const [color, setColor] = useState(initial?.color ?? '#0060AF');
  const [kinds, setKinds] = useState({ savings: initial?.savings ?? true, creditCard: initial?.creditCard ?? false, paylater: initial?.paylater ?? false });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const anyKind = kinds.savings || kinds.creditCard || kinds.paylater;
  const valid = name.trim() && short.trim() && anyKind;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaving(true);
    const body = { name: name.trim(), short: short.trim(), color, ...kinds };
    try {
      if (initial) await api.patch(`/banks/${initial.id}`, body);
      else await api.post('/banks', body);
      window.DS?.toast(t('banks.saved'), { variant: 'success' });
      await onSaved();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    } finally {
      setSaving(false);
    }
  }

  const kindToggle = (key: 'savings' | 'creditCard' | 'paylater', label: MessageKey) => (
    <button type="button" role="checkbox" aria-checked={kinds[key]} className="pill" onClick={() => setKinds((current) => ({ ...current, [key]: !current[key] }))}>
      {t(label)}
    </button>
  );

  return (
    <form className="tx-form" onSubmit={(event) => void submit(event)} noValidate>
      <label className="tx-field">
        <span className="tx-field-label">{t('banks.name')}</span>
        <input className="input" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label className="tx-field">
        <span className="tx-field-label">{t('banks.short')}</span>
        <input className="input" value={short} maxLength={4} onChange={(event) => setShort(event.target.value)} required />
      </label>
      <label className="tx-field">
        <span className="tx-field-label">{t('banks.color')}</span>
        <span className="bank-color-row">
          <input type="color" className="bank-color-swatch" value={color} aria-label={t('banks.color')} onChange={(event) => setColor(event.target.value)} />
          <span className="text-sm text-muted">{color.toUpperCase()}</span>
        </span>
      </label>
      <div className="tx-field">
        <span className="tx-field-label">{t('banks.kinds')}</span>
        <div className="chip-row" role="group" aria-label={t('banks.kinds')}>
          {kindToggle('savings', KIND_KEYS.savings)}
          {kindToggle('creditCard', KIND_KEYS.credit_card)}
          {kindToggle('paylater', KIND_KEYS.paylater)}
        </div>
      </div>
      <div className="tx-field">
        <span className="tx-field-label">{t('banks.preview')}</span>
        <span className="bank-badge" style={{ '--bank-color': color, '--bank-text': textOn(color), width: 40, height: 40 } as CSSProperties} aria-hidden="true">
          {short.trim() || '•'}
        </span>
      </div>
      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary btn-lg" disabled={saving || !valid}>
          {saving ? t('form.saving') : t('banks.save')}
        </button>
      </div>
    </form>
  );
}
