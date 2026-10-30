import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { DatePicker } from '../components/DatePicker';
import { Dropdown } from '../components/Dropdown';
import { SkeletonRows } from '../components/Skeleton';
import { useCategories, useSources } from '../data';
import { todayInWib } from '../format';
import { usePrefs } from '../prefs';

// Loans (pinjaman): money received is a loan, not spending. Each repayment is recorded as an expense on
// the day it is paid, and the remaining balance goes down.

interface LoanPayment {
  id: string;
  amount: number;
  paidOn: string;
  transactionId: string;
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

  // New loan form
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState(todayInWib());
  const [saving, setSaving] = useState(false);

  function load() {
    api
      .get<{ loans: Loan[] }>('/loans')
      .then((data) => setLoans(data.loans))
      .catch(() => setError(t('loans.error')));
  }

  useEffect(load, []);

  async function addLoan(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post('/loans', { name: name.trim(), principal: toAmount(amount), receivedOn });
      setName('');
      setAmount('');
      setReceivedOn(todayInWib());
      load();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('loans.error'));
    } finally {
      setSaving(false);
    }
  }

  if (loans === null) {
    return error ? (
      <p className="text-danger" role="alert">
        {error}
      </p>
    ) : (
      <SkeletonRows count={4} />
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>{t('loans.title')}</h2>
          <p className="hint">{t('loans.subtitle')}</p>
        </div>
      </div>

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      <section className="card storage-card">
        <h3 className="m-0">{t('loans.newTitle')}</h3>
        <form className="stack" onSubmit={(event) => void addLoan(event)}>
          <label className="stack">
            <span className="text-sm">{t('loans.name')}</span>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} required />
          </label>
          <label className="stack">
            <span className="text-sm">{t('loans.amount')}</span>
            <input className="input" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))} required />
          </label>
          <div className="stack">
            <span className="text-sm">{t('loans.received')}</span>
            <DatePicker value={receivedOn} onChange={(value) => setReceivedOn(value ?? todayInWib())} ariaLabel={t('loans.received')} />
          </div>
          <div className="cluster">
            <button type="submit" className="btn btn-primary" disabled={saving || !name.trim() || !toAmount(amount)} aria-busy={saving}>
              {t('loans.add')}
            </button>
          </div>
        </form>
      </section>

      {loans.length === 0 ? (
        <p className="hint">{t('loans.empty')}</p>
      ) : (
        loans.map((loan) => <LoanCard key={loan.id} loan={loan} onChanged={load} />)
      )}

    </>
  );
}

/** One loan: its balance, a repayment form, the repayments so far, and removing the loan. */
function LoanCard({ loan, onChanged }: { loan: Loan; onChanged: () => void }) {
  const { t, money, date, categoryName } = usePrefs();
  const { categories } = useCategories();
  const { sources } = useSources();
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
      await api.post(`/loans/${loan.id}/payments`, { amount: toAmount(amount), paidOn, categoryId, method, sourceId: sourceId || null });
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
  const sourceOptions = [{ value: '', label: t('loans.sourceNone') }, ...(sources ?? []).map((source) => ({ value: source.id, label: source.name }))];

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
          <div className="stack">
            <span className="text-sm">{t('loans.paySource')}</span>
            <Dropdown value={sourceId} options={sourceOptions} onChange={setSourceId} ariaLabel={t('loans.paySource')} />
          </div>
          {error && <p className="text-danger">{error}</p>}
          <div className="cluster">
            <button type="submit" className="btn btn-primary" disabled={busy || !toAmount(amount) || !categoryId} aria-busy={busy}>
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
              <span className="source-meta">{date(payment.paidOn)}</span>
              <span className="amount">{money(payment.amount)}</span>
            </div>
          ))
        )}
      </div>
      {error && !open && <p className="text-danger">{error}</p>}
    </section>
  );
}
