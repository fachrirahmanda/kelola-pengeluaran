import { useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { Dropdown } from '../components/Dropdown';
import { Icon } from '../components/Icon';
import { Pager, pageOf, usePage } from '../components/Pager';
import { MonthPicker } from '../components/MonthPicker';
import { SkeletonRows } from '../components/Skeleton';
import { useCategories, useRecurring } from '../data';
import { monthLabel, todayInWib } from '../format';
import { usePrefs } from '../prefs';
import { RECURRING_METHODS, type RecurringItem, type RecurringMethod, type RecurringPayment } from '../../shared/types';
import type { MessageKey } from '../i18n';
import { DatePicker } from '../components/DatePicker';
import { DebitSourceField } from '../components/DebitSourceField';

const METHOD_KEYS: Record<RecurringMethod, MessageKey> = {
  debit: 'rec.method.debit',
  transfer: 'rec.method.transfer',
};

/** Payment history: how many payments one page shows. */
const HISTORY_PAGE_SIZE = 10;

/** The installments (cicilan), shown on the Loans page: each plan with its next payment, and the payment history. Adding one is in the Add panel. */
export function InstallmentsSection() {
  const { t, categoryName } = usePrefs();
  const { categories } = useCategories();
  const { data, reload } = useRecurring();
  const [error, setError] = useState('');
  const history = usePage(data?.payments.length ?? 0, HISTORY_PAGE_SIZE);

  const categoryOptions = (categories ?? []).map((category) => ({ value: category.id, label: `${category.icon} ${categoryName(category.name)}` }));

  // The installments whose next payment is due or overdue, as the server reports them. Only these can be marked as paid here.
  const dueIds = new Set((data?.upcoming ?? []).map((item) => item.id));

  // Only the latest payment of each installment can be cancelled, so the installments stay in order.
  const latestIds = new Set((data?.items ?? []).flatMap((item) => (data?.payments ?? []).filter((payment) => payment.itemId === item.id && payment.installment === item.paidCount).map((payment) => payment.id)));

  async function cancelPayment(payment: RecurringPayment) {
    if (!window.confirm(t('rec.cancelConfirm', { n: payment.installment, name: payment.name }))) return;
    setError('');
    try {
      await api.delete(`/recurring/payments/${payment.id}`);
      window.DS?.toast(t('rec.cancelled'), { variant: 'success' });
      await reload();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    }
  }

  return (
    <>
      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      <section className="settings-section" aria-labelledby="rec-installments">
        <h3 id="rec-installments" className="section-heading">
          {t('rec.installments')}
        </h3>
        <p className="hint">{t('rec.installmentsHint')}</p>

        {data === null ? (
          <div className="card">
            <SkeletonRows count={2} />
          </div>
        ) : data.items.length === 0 ? (
          <div className="card">
            <div className="empty">
              <p>{t('rec.activeNone')}</p>
            </div>
          </div>
        ) : (
          <div className="bill-grid bill-slider">
            {sortedInstallments(data.items, dueIds).map((item) => (
              <InstallmentCard
                key={item.id}
                item={item}
                due={dueIds.has(item.id)}
                categoryOptions={categoryOptions}
                onChanged={() => void reload()}
                onError={setError}
              />
            ))}
          </div>
        )}
      </section>

      <section className="settings-section" aria-labelledby="rec-history">
        <h3 id="rec-history" className="section-heading">
          {t('rec.history')}
        </h3>
        <div className="card">
          {data === null ? (
            <SkeletonRows count={2} />
          ) : data.payments.length === 0 ? (
            <div className="empty">
              <p>{t('rec.historyNone')}</p>
            </div>
          ) : (
            pageOf(data.payments, history.page, HISTORY_PAGE_SIZE).map((payment: RecurringPayment) => (
              <PaymentRow
                key={payment.id}
                payment={payment}
                latest={latestIds.has(payment.id)}
                onCancel={() => void cancelPayment(payment)}
                onChanged={() => void reload()}
                onError={setError}
              />
            ))
          )}
          {data && <Pager page={history.page} pages={history.pages} count={data.payments.length} onPage={history.setPage} />}
        </div>
      </section>

    </>
  );
}

/** Overdue first, then due next month, then the rest, and finished ones last. Each group by its next due date. */
function sortedInstallments(items: RecurringItem[], dueIds: Set<string>): RecurringItem[] {
  const rank = (item: RecurringItem) => {
    if (item.nextDueMonth === null) return 3;
    if (item.overdue) return 0;
    return dueIds.has(item.id) ? 1 : 2;
  };
  return [...items].sort((a, b) => rank(a) - rank(b) || (a.nextDueDate ?? '').localeCompare(b.nextDueDate ?? ''));
}

/** One installment: its status, the next payment (marked as paid when it is due), and the actions. */
function InstallmentCard({
  item,
  due,
  categoryOptions,
  onChanged,
  onError,
}: {
  item: RecurringItem;
  due: boolean;
  categoryOptions: { value: string; label: string }[];
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const { t, lang, money, date } = usePrefs();
  const [editing, setEditing] = useState(false);
  const [catching, setCatching] = useState(false);
  const [through, setThrough] = useState('');
  const [fillBusy, setFillBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState<RecurringMethod>('debit');
  const [sourceId, setSourceId] = useState('');
  const [paidOn, setPaidOn] = useState(todayInWib());
  const [paySaving, setPaySaving] = useState(false);
  const [name, setName] = useState(item.name);
  const [amount, setAmount] = useState(String(item.amount));
  const [categoryId, setCategoryId] = useState(item.categoryId);
  const [firstMonth, setFirstMonth] = useState(item.startDate.slice(0, 7));

  const progress =
    item.totalMonths !== null
      ? t('rec.progress', { paid: item.paidCount, total: item.totalMonths, left: item.remaining ?? 0 })
      : t('rec.progressNoEnd', { paid: item.paidCount });
  const done = item.nextDueMonth === null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError('');
    try {
      // The first month is sent only when it changed, since moving it moves every recorded installment.
      const moved = firstMonth !== item.startDate.slice(0, 7) ? { firstMonth } : {};
      await api.patch(`/recurring/${item.id}`, { name: name.trim(), amount: Number(amount), categoryId, ...moved });
      setEditing(false);
      window.DS?.toast(t('rec.updated'), { variant: 'success' });
      onChanged();
    } catch (requestError) {
      onError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    }
  }

  async function remove() {
    if (!window.confirm(t('rec.confirmDelete', { name: item.name }))) return;
    onError('');
    try {
      await api.delete(`/recurring/${item.id}`);
      onChanged();
    } catch (requestError) {
      onError(requestError instanceof ApiRequestError ? requestError.message : t('rec.deleteBlocked'));
    }
  }

  async function handlePay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError('');
    setPaySaving(true);
    try {
      await api.post(`/recurring/${item.id}/pay`, { paidOn, method, sourceId: method === 'debit' ? sourceId : null });
      setPaying(false);
      window.DS?.toast(t('rec.paidToast'), { variant: 'success' });
      onChanged();
    } catch (requestError) {
      onError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    } finally {
      setPaySaving(false);
    }
  }

  async function fillThrough() {
    onError('');
    setFillBusy(true);
    try {
      await api.post(`/recurring/${item.id}/catch-up`, { throughMonth: through, method: 'transfer' });
      setCatching(false);
      setThrough('');
      onChanged();
    } catch (requestError) {
      onError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    } finally {
      setFillBusy(false);
    }
  }

  if (editing) {
    return (
      <form className="card-body settings-row-edit stack-lg" onSubmit={(event) => void save(event)} noValidate>
        <div className="tx-grid">
          <label className="tx-field">
            <span className="tx-field-label">{t('rec.name')}</span>
            <input type="text" className="input" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label className="tx-field">
            <span className="tx-field-label">{t('rec.amount')}</span>
            <input
              type="text"
              inputMode="numeric"
              className="input"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/\D/g, '').slice(0, 13))}
              required
            />
          </label>
          <div className="tx-field">
            <span className="tx-field-label">{t('rec.category')}</span>
            <Dropdown value={categoryId} options={categoryOptions} onChange={setCategoryId} ariaLabel={t('rec.category')} />
          </div>
          <div className="tx-field">
            <span className="tx-field-label">{t('rec.firstMonth')}</span>
            <MonthPicker value={firstMonth || null} onChange={(value) => setFirstMonth(value ?? firstMonth)} ariaLabel={t('rec.firstMonth')} />
            <span className="tx-hint">{t('rec.firstMonthHint')}</span>
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => setEditing(false)}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary">
            {t('form.save')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <article className="bill-card installment-card">
      <header className="bill-card-head">
        <div>
          <h4 className="bill-card-title">{item.name}</h4>
          <p className="source-meta">{progress}</p>
        </div>
        {item.overdue && <span className="badge badge-danger">{t('rec.overdue')}</span>}
        {!item.overdue && due && <span className="badge badge-warning">{t('rec.dueSoon')}</span>}
        {done && <span className="badge badge-success">{t('rec.paidDone')}</span>}
      </header>

      <p className="bill-total">{money(item.amount)}</p>
      <p className="source-meta">
        {item.nextDueMonth && monthLabel(item.nextDueMonth, lang)}
        {item.nextDueDate && ` · ${t('rec.dueOn', { date: date(item.nextDueDate) })}`}
        {item.lastPaidOn && ` · ${t('rec.lastPaid', { date: date(item.lastPaidOn), ago: agoText(item.lastPaidOn, t) })}`}
      </p>

      {due &&
        (paying ? (
          <form className="bill-pay-form" onSubmit={(event) => void handlePay(event)}>
            <div className="tx-field">
              <span className="tx-field-label">{t('rec.method')}</span>
              <div className="chip-row" role="radiogroup" aria-label={t('rec.method')}>
                {RECURRING_METHODS.map((option) => (
                  <button key={option} type="button" role="radio" aria-checked={method === option} className="pill" onClick={() => setMethod(option)}>
                    {t(METHOD_KEYS[option])}
                  </button>
                ))}
              </div>
            </div>
            {method === 'debit' && <DebitSourceField value={sourceId} onChange={setSourceId} />}
            <label className="tx-field">
              <span className="tx-field-label">{t('rec.paidOn')}</span>
              <DatePicker value={paidOn} onChange={(v) => setPaidOn(v ?? todayInWib())} ariaLabel={t('rec.paidOn')} />
            </label>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setPaying(false)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={paySaving || (method === 'debit' && !sourceId)}>
                {paySaving ? t('form.saving') : t('rec.confirm')}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn btn-primary bill-pay-button" onClick={() => setPaying(true)}>
            {t('rec.markPaid')}
          </button>
        ))}

      <div className="row-actions installment-actions">
        <button type="button" className="icon-btn icon-btn-sm icon-btn-plain" onClick={() => setCatching((open) => !open)} aria-expanded={catching} aria-label={t('rec.fillThrough')} title={t('rec.fillThrough')}>
          <Icon name="calendar" size={15} />
        </button>
        <button type="button" className="icon-btn icon-btn-sm icon-btn-plain icon-btn-soft" onClick={() => setEditing(true)} aria-label={t('rec.edit')} title={t('rec.edit')}>
          <Icon name="edit" size={15} />
        </button>
        <button type="button" className="icon-btn icon-btn-sm icon-btn-plain icon-btn-soft text-danger" onClick={() => void remove()} aria-label={t('rec.delete')} title={t('rec.delete')}>
          <Icon name="trash" size={15} />
        </button>
      </div>
      {catching && (
        <form className="rec-fill" onSubmit={(event) => {
          event.preventDefault();
          void fillThrough();
        }}>
          <label className="tx-field">
            <span className="tx-field-label">{t('rec.paidThrough')}</span>
            <MonthPicker value={through || null} onChange={(value) => setThrough(value ?? '')} max={todayInWib().slice(0, 7)} ariaLabel={t('rec.paidThrough')} />
            <span className="tx-hint">{t('rec.fillHint')}</span>
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={fillBusy || !through} aria-busy={fillBusy}>
              {t('rec.fillSave')}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

/** How long ago a date was, in words: "this month", "5 months ago", "3 years 6 months ago". */
function agoText(iso: string, t: (key: 'rec.agoThisMonth' | 'rec.agoMonths' | 'rec.agoYears' | 'rec.agoYearsMonths', vars?: Record<string, number>) => string): string {
  const [py, pm] = iso.slice(0, 7).split('-').map(Number);
  const [ty, tm] = todayInWib().slice(0, 7).split('-').map(Number);
  const months = ty * 12 + tm - (py * 12 + pm);
  if (months <= 0) return t('rec.agoThisMonth');
  if (months < 12) return t('rec.agoMonths', { n: months });
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? t('rec.agoYears', { years }) : t('rec.agoYearsMonths', { years, months: rest });
}

/** One payment in the history. The latest of a plan can be cancelled. Any payment can be changed: its date, or the account it came from. */
function PaymentRow({ payment, latest, onCancel, onChanged, onError }: { payment: RecurringPayment; latest: boolean; onCancel: () => void; onChanged: () => void; onError: (message: string) => void }) {
  const { t, lang, money, date } = usePrefs();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paidOn, setPaidOn] = useState(payment.paidOn);
  const [method, setMethod] = useState<RecurringMethod>(payment.method);
  const [sourceId, setSourceId] = useState(payment.sourceId ?? '');

  function startEditing() {
    setPaidOn(payment.paidOn);
    setMethod(payment.method);
    setSourceId(payment.sourceId ?? '');
    onError('');
    setEditing(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    onError('');
    try {
      await api.patch(`/recurring/payments/${payment.id}`, { paidOn, method, sourceId: method === 'debit' ? sourceId : null });
      setEditing(false);
      window.DS?.toast(t('rec.paymentUpdated'), { variant: 'success' });
      onChanged();
    } catch (requestError) {
      onError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form className="list-row rec-history-row" onSubmit={(event) => void save(event)}>
        <div className="source-main">
          <span className="source-name">{payment.name}</span>
          <span className="source-meta">{t('rec.installmentNoEnd', { n: payment.installment })}</span>
          <div className="stack">
            <div className="tx-field">
              <span className="tx-field-label">{t('rec.paidOn')}</span>
              <DatePicker value={paidOn} onChange={(value) => setPaidOn(value ?? paidOn)} ariaLabel={t('rec.paidOn')} />
            </div>
            <div className="tx-field">
              <span className="tx-field-label">{t('rec.method')}</span>
              <div className="chip-row" role="radiogroup" aria-label={t('rec.method')}>
                {RECURRING_METHODS.map((option) => (
                  <button key={option} type="button" role="radio" aria-checked={method === option} className="pill" onClick={() => setMethod(option)}>
                    {t(METHOD_KEYS[option])}
                  </button>
                ))}
              </div>
            </div>
            {method === 'debit' && <DebitSourceField value={sourceId} onChange={setSourceId} />}
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving || (method === 'debit' && !sourceId)}>
              {saving ? t('form.saving') : t('form.save')}
            </button>
          </div>
        </div>
      </form>
    );
  }

  return (
    <div className="list-row rec-history-row">
      <div className="source-main">
        <span className="cluster">
          <span className="source-name">{payment.name}</span>
          {latest && (
            <button type="button" className="btn btn-danger-soft rec-cancel" onClick={onCancel}>
              {t('rec.cancelPayment')}
            </button>
          )}
          <button type="button" className="icon-btn icon-btn-sm icon-btn-plain icon-btn-soft" onClick={startEditing} aria-label={t('rec.editPayment')} title={t('rec.editPayment')}>
            <Icon name="edit" size={15} />
          </button>
        </span>
        <span className="source-meta">{t('rec.installmentNoEnd', { n: payment.installment })}</span>
        <span className="source-meta">
          {t('rec.paidLine', { date: date(payment.paidOn), month: monthLabel(payment.dueMonth, lang) })}
          {payment.sourceName && ` · ${t('pay.fromLine', { name: payment.sourceName })}`}
        </span>
      </div>
      <span className="amount">{money(payment.amount)}</span>
    </div>
  );
}
