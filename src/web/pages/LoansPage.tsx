import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { DatePicker } from '../components/DatePicker';
import { Dropdown } from '../components/Dropdown';
import { SkeletonRows } from '../components/Skeleton';
import { DebitSourceField } from '../components/DebitSourceField';
import { Icon } from '../components/Icon';
import { SidePanel, usePhone } from '../components/SidePanel';
import { useCategories } from '../data';
import { todayInWib } from '../format';
import { usePrefs } from '../prefs';

// Loans (pinjaman): money received is a loan, not spending. Each repayment is recorded as an expense on
// the day it is paid, and the remaining balance goes down.

interface LoanPayment {
  id: string;
  amount: number;
  paidOn: string;
  transactionId: string;
  /** The savings account it was debited from, if any. */
  sourceName: string | null;
}

interface Loan {
  id: string;
  name: string;
  principal: number;
  receivedOn: string;
  paid: number;
  remaining: number;
  payments: LoanPayment[];
}

const toAmount = (text: string) => Number(text.replace(/\D/g, '')) || 0;
const METHOD_KEYS = ['cash', 'debit', 'transfer'] as const;

export function LoansPage() {
  const { t } = usePrefs();
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  // On desktop the add panel is always shown beside the list, so the button only exists on phones.
  const phone = usePhone();

  function load() {
    api
      .get<{ loans: Loan[] }>('/loans')
      .then((data) => setLoans(data.loans))
      .catch(() => setError(t('loans.error')));
  }

  useEffect(load, []);

  return (
    <>
      <div className="page-header">
        <div>
          <h2>{t('loans.title')}</h2>
          <p className="hint">{t('loans.subtitle')}</p>
        </div>
        {phone && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} />
            {t('loans.add')}
          </button>
        )}
      </div>

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      <section className="settings-section" aria-labelledby="loans-list">
        <h3 id="loans-list" className="section-heading">
          {t('loans.list')}
        </h3>
        <p className="hint">{t('loans.listHint')}</p>

        {loans === null ? (
          <div className="card">
            <SkeletonRows count={2} />
          </div>
        ) : loans.length === 0 ? (
          <div className="card">
            <div className="empty">
              <p>{t('loans.empty')}</p>
            </div>
          </div>
        ) : (
          <div className="stack">
            {loans.map((loan) => (
              <LoanCard key={loan.id} loan={loan} onChanged={load} />
            ))}
          </div>
        )}
      </section>

      <SidePanel open={adding} onClose={() => setAdding(false)} title={t('loans.newTitle')}>
        <AddLoanForm
          onAdded={() => {
            setAdding(false);
            load();
          }}
          onError={setError}
        />
      </SidePanel>
    </>
  );
}

/** A new loan: its name, how much was received, and when. */
function AddLoanForm({ onAdded, onError }: { onAdded: () => void; onError: (message: string) => void }) {
  const { t, money } = usePrefs();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState(todayInWib());
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    onError('');
    setSaving(true);
    try {
      await api.post('/loans', { name: name.trim(), principal: toAmount(amount), receivedOn });
      window.DS?.toast(t('loans.added', { name: name.trim() }), { variant: 'success' });
      setName('');
      setAmount('');
      setReceivedOn(todayInWib());
      onAdded();
    } catch (requestError) {
      onError(requestError instanceof ApiRequestError ? requestError.message : t('loans.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack-lg" onSubmit={(event) => void submit(event)} noValidate>
      <label className="tx-field">
        <span className="tx-field-label">{t('loans.name')}</span>
        <input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} required />
      </label>
      <label className="tx-field">
        <span className="tx-field-label">{t('loans.amount')}</span>
        <input className="input" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))} required />
        {toAmount(amount) > 0 && <span className="tx-hint">{money(toAmount(amount))}</span>}
      </label>
      <div className="tx-field">
        <span className="tx-field-label">{t('loans.received')}</span>
        <DatePicker value={receivedOn} onChange={(value) => setReceivedOn(value ?? todayInWib())} ariaLabel={t('loans.received')} />
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving || !name.trim() || !toAmount(amount)} aria-busy={saving}>
          {saving ? t('form.saving') : t('loans.add')}
        </button>
      </div>
    </form>
  );
}

/** One loan: its balance, a repayment form, the repayments so far, and removing the loan. */
function LoanCard({ loan, onChanged }: { loan: Loan; onChanged: () => void }) {
  const { t, money, date, categoryName } = usePrefs();
  const { categories } = useCategories();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(todayInWib());
  const [categoryId, setCategoryId] = useState('');
  const [method, setMethod] = useState<(typeof METHOD_KEYS)[number]>('debit');
  const [sourceId, setSourceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ratio = loan.principal > 0 ? Math.min(1, loan.paid / loan.principal) : 0;

  async function pay(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post(`/loans/${loan.id}/payments`, { amount: toAmount(amount), paidOn, categoryId, method, sourceId: method === 'debit' ? sourceId : null });
      setAmount('');
      setOpen(false);
      onChanged();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('loans.error'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(t('loans.deleteConfirm'))) return;
    try {
      await api.delete(`/loans/${loan.id}`);
      onChanged();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('loans.error'));
    }
  }

  const categoryOptions = (categories ?? []).map((category) => ({ value: category.id, label: categoryName(category.name) }));

  return (
    <section className="card storage-card">
      <div className="storage-head">
        <div className="grow">
          <h2 className="m-0">{loan.name}</h2>
          <p className="text-muted m-0">
            {t('loans.receivedOn', { date: date(loan.receivedOn) })} · {t('loans.principal')} {money(loan.principal)}
          </p>
        </div>
        <span className={`badge ${loan.remaining === 0 ? 'badge-success badge-dot' : 'badge-warning'}`}>
          {loan.remaining === 0 ? t('loans.paidOff') : money(loan.remaining)}
        </span>
      </div>

      <div className="bar-track" role="img" aria-label={`${Math.round(ratio * 100)}%`}>
        <span className="bar-fill" style={{ width: `${ratio * 100}%`, background: 'var(--accent)' }} />
      </div>
      <div className="storage-stats">
        <div>
          <strong>{money(loan.paid)}</strong>
          <span>{t('loans.paid')}</span>
        </div>
        <div>
          <strong>{money(loan.remaining)}</strong>
          <span>{t('loans.remaining')}</span>
        </div>
      </div>

      {loan.remaining > 0 && (
        <div className="cluster">
          <button type="button" className="btn" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            {t('loans.pay')}
          </button>
          <button type="button" className="btn btn-danger-soft" onClick={() => void remove()}>
            {t('loans.delete')}
          </button>
        </div>
      )}

      {open && (
        <form className="stack" onSubmit={(event) => void pay(event)}>
          <label className="stack">
            <span className="text-sm">{t('loans.payAmount')}</span>
            <input className="input" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))} required />
          </label>
          <div className="stack">
            <span className="text-sm">{t('loans.payDate')}</span>
            <DatePicker value={paidOn} onChange={(value) => setPaidOn(value ?? todayInWib())} ariaLabel={t('loans.payDate')} />
          </div>
          <div className="stack">
            <span className="text-sm">{t('loans.payCategory')}</span>
            <Dropdown value={categoryId} options={categoryOptions} onChange={setCategoryId} ariaLabel={t('loans.payCategory')} />
          </div>
          <div className="stack">
            <span className="text-sm">{t('loans.payMethod')}</span>
            <Dropdown value={method} options={METHOD_KEYS.map((key) => ({ value: key, label: t(`method.${key}`) }))} onChange={(value) => setMethod(value as (typeof METHOD_KEYS)[number])} ariaLabel={t('loans.payMethod')} />
          </div>
          {method === 'debit' && <DebitSourceField value={sourceId} onChange={setSourceId} />}
          {error && <p className="text-danger">{error}</p>}
          <div className="cluster">
            <button type="submit" className="btn btn-primary" disabled={busy || !toAmount(amount) || !categoryId || (method === 'debit' && !sourceId)} aria-busy={busy}>
              {t('loans.paySave')}
            </button>
          </div>
        </form>
      )}

      <div className="stack">
        <span className="text-sm">{t('loans.payments')}</span>
        {loan.payments.length === 0 ? (
          <p className="text-sm text-muted">{t('loans.noPayments')}</p>
        ) : (
          loan.payments.map((payment) => (
            <div key={payment.id} className="list-row">
              <span className="source-meta">
                {date(payment.paidOn)}
                {payment.sourceName && ` · ${t('pay.fromLine', { name: payment.sourceName })}`}
              </span>
              <span className="amount">{money(payment.amount)}</span>
            </div>
          ))
        )}
      </div>
      {error && !open && <p className="text-danger">{error}</p>}
    </section>
  );
}
