import { useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { todayInWib } from '../format';
import { usePrefs } from '../prefs';
import type { PaymentSource } from '../../shared/types';
import { BankBadge } from './BankBadge';
import { DatePicker } from './DatePicker';
import { Dropdown } from './Dropdown';

// One-off income: money that comes in once (a bonus, a refund, a transfer from someone). It is added from the Add
// panel (New transaction) and listed with the transactions. It adds to a savings account's balance once. A salary's
// monthly incomes are listed too, marked, but are changed through the salary.

/** A one-off income: the account it goes into, how much, when, and a note. */
export function IncomeForm({ savings, initialSourceId, onDone, onCancel }: { savings: PaymentSource[]; initialSourceId: string; onDone: () => void; onCancel?: () => void }) {
  const { t, money } = usePrefs();
  const [sourceId, setSourceId] = useState(initialSourceId);
  const [amount, setAmount] = useState('');
  const [occurredOn, setOccurredOn] = useState(todayInWib());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post(`/sources/${sourceId}/income`, { amount: Number(amount) || 0, occurredOn, note });
      window.DS?.toast(t('income.saved'), { variant: 'success' });
      onDone();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('income.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack-lg" onSubmit={(event) => void submit(event)} noValidate>
      <div className="tx-grid">
        <div className="tx-field">
          <span className="tx-field-label">{t('income.account')}</span>
          <Dropdown
            value={sourceId}
            options={savings.map((source) => ({ value: source.id, label: `${source.name} · ${money(source.balance ?? 0)}`, icon: <BankBadge bankId={source.bank} size={20} /> }))}
            onChange={setSourceId}
            ariaLabel={t('income.account')}
          />
        </div>
        <label className="tx-field">
          <span className="tx-field-label">{t('income.amount')}</span>
          <input className="input" inputMode="numeric" value={amount} autoFocus onChange={(event) => setAmount(event.target.value.replace(/\D/g, '').slice(0, 13))} required />
          {amount && <span className="tx-hint">{money(Number(amount))}</span>}
        </label>
        <div className="tx-field">
          <span className="tx-field-label">{t('income.date')}</span>
          <DatePicker value={occurredOn} onChange={(value) => setOccurredOn(value ?? todayInWib())} ariaLabel={t('income.date')} />
        </div>
        <label className="tx-field">
          <span className="tx-field-label">{t('income.note')}</span>
          <input className="input" value={note} maxLength={80} onChange={(event) => setNote(event.target.value)} />
        </label>
      </div>
      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={saving || !Number(amount) || !sourceId}>
          {saving ? t('form.saving') : t('income.save')}
        </button>
      </div>
    </form>
  );
}
