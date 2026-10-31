import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { todayInWib } from '../format';
import { usePrefs } from '../prefs';
import type { Income, PaymentSource } from '../../shared/types';
import { BankBadge } from './BankBadge';
import { DatePicker } from './DatePicker';
import { Dropdown } from './Dropdown';
import { Icon } from './Icon';
import { SkeletonRows } from './Skeleton';

// One-off income on the Sources page: money that comes in once (a bonus, a refund, a transfer from someone).
// It adds to a savings account's balance once. A salary's monthly incomes show here too, marked, but are
// changed through the salary.

export function IncomeSection({
  sources,
  addFor,
  onAddFor,
  onChanged,
}: {
  sources: PaymentSource[] | null;
  /** The account the add form is open for, or null when it is closed. The wallet cards open it too. */
  addFor: string | null;
  onAddFor: (sourceId: string | null) => void;
  onChanged: () => void;
}) {
  const { t, money, date } = usePrefs();
  const [incomes, setIncomes] = useState<Income[] | null>(null);
  const [error, setError] = useState('');
  const formRef = useRef<HTMLDivElement>(null);
  const savings = (sources ?? []).filter((source) => source.kind === 'savings');

  function load() {
    api
      .get<{ incomes: Income[] }>('/incomes')
      .then((data) => setIncomes(data.incomes))
      .catch(() => setIncomes([]));
  }

  useEffect(load, []);

  // Opened from a wallet card further up: bring the form into view.
  useEffect(() => {
    if (addFor) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [addFor]);

  async function remove(income: Income) {
    if (!window.confirm(t('income.confirmDelete', { amount: money(income.amount) }))) return;
    setError('');
    try {
      await api.delete(`/incomes/${income.id}`);
      window.DS?.toast(t('income.deleted'));
      load();
      onChanged();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    }
  }

  return (
    <section className="settings-section" aria-labelledby="income-title">
      <div className="section-head">
        <div>
          <h3 id="income-title" className="section-heading">
            {t('income.listTitle')}
          </h3>
          <p className="hint">{t('income.listHint')}</p>
        </div>
        {addFor === null && savings.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => onAddFor(savings[0].id)}>
            <Icon name="plus" size={15} />
            {t('income.add')}
          </button>
        )}
      </div>

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="card">
        {addFor !== null && (
          <div className="card-body income-form" ref={formRef}>
            <IncomeForm
              key={addFor}
              savings={savings}
              initialSourceId={addFor}
              onDone={() => {
                onAddFor(null);
                load();
                onChanged();
              }}
              onCancel={() => onAddFor(null)}
            />
          </div>
        )}
        {incomes === null ? (
          <SkeletonRows count={2} />
        ) : incomes.length === 0 ? (
          addFor === null && (
            <div className="empty">
              <p>{savings.length > 0 ? t('income.empty') : t('pay.noSavings')}</p>
            </div>
          )
        ) : (
          incomes.map((income) => (
            <div key={income.id} className="list-row">
              <BankBadge bankId={income.bank} size={32} />
              <div className="source-main grow">
                <span className="source-name">
                  {income.note || t('income.untitled')}
                  {income.fromSalary && <span className="badge income-badge">{t('income.salaryBadge')}</span>}
                </span>
                <span className="source-meta">
                  {income.sourceName} · {date(income.occurredOn)}
                </span>
              </div>
              <span className="amount text-success">+{money(income.amount)}</span>
              {!income.fromSalary && (
                <button type="button" className="icon-btn icon-btn-sm icon-btn-plain icon-btn-soft text-danger" onClick={() => void remove(income)} aria-label={t('cat.delete')} title={t('cat.delete')}>
                  <Icon name="trash" size={15} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/** A one-off income: the account it goes into, how much, when, and a note. */
function IncomeForm({ savings, initialSourceId, onDone, onCancel }: { savings: PaymentSource[]; initialSourceId: string; onDone: () => void; onCancel: () => void }) {
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
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving || !Number(amount) || !sourceId}>
          {saving ? t('form.saving') : t('income.save')}
        </button>
      </div>
    </form>
  );
}
