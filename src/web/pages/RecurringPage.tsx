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
import { SidePanel, usePhone } from '../components/SidePanel';

const METHOD_KEYS: Record<RecurringMethod, MessageKey> = {
  cash: 'rec.method.cash',
  debit: 'rec.method.debit',
  transfer: 'rec.method.transfer',
};

/** Payment history: how many payments one page shows. */
const HISTORY_PAGE_SIZE = 10;

export function RecurringPage() {
  const { t, lang, money, date, categoryName } = usePrefs();
  const { categories } = useCategories();
  const { data, reload } = useRecurring();
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  // On desktop the add panel is always shown beside the list, so the button only exists on phones.
  const phone = usePhone();
  const history = usePage(data?.payments.length ?? 0, HISTORY_PAGE_SIZE);

  const categoryOptions = (categories ?? []).map((category) => ({ value: category.id, label: `${category.icon} ${categoryName(category.name)}` }));

  // The installments whose next payment is due or overdue, as the server reports them. Only these can be marked as paid here.
  const dueIds = new Set((data?.upcoming ?? []).map((item) => item.id));

  return (
    <>
      <div className="page-header">
        <div>
          <h2>{t('rec.title')}</h2>
          <p className="hint">{t('rec.subtitle')}</p>
        </div>
        {phone && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} />
            {t('rec.create')}
          </button>
        )}
      </div>

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
              <div key={payment.id} className="list-row rec-history-row">
                <div className="source-main">
                  <span className="source-name">{payment.name}</span>
                  <span className="source-meta">{t('rec.installmentNoEnd', { n: payment.installment })}</span>
                  <span className="source-meta">{t('rec.paidLine', { date: date(payment.paidOn), month: monthLabel(payment.dueMonth, lang) })}</span>
                </div>
                <span className="amount">{money(payment.amount)}</span>
              </div>
            ))
          )}
          {data && <Pager page={history.page} pages={history.pages} count={data.payments.length} onPage={history.setPage} />}
        </div>
      </section>

      <SidePanel open={adding} onClose={() => setAdding(false)} title={t('rec.addTitle')}>
        <AddRecurringForm
          categoryOptions={categoryOptions}
          defaultCategoryId={categories?.[0]?.id ?? ''}
          onCreated={(name) => {
            window.DS?.toast(t('rec.created', { name }), { variant: 'success' });
            setAdding(false);
            void reload();
          }}
          onError={setError}
        />
      </SidePanel>
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

function AddRecurringForm({
  categoryOptions,
  defaultCategoryId,
  onCreated,
  onError,
}: {
  categoryOptions: { value: string; label: string }[];
  defaultCategoryId: string;
  onCreated: (name: string) => void;
  onError: (message: string) => void;
}) {
  const { t } = usePrefs();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [startDate, setStartDate] = useState(todayInWib());
  const [fixed, setFixed] = useState(true);
  const [months, setMonths] = useState('12');
  // The last month already paid: every installment due up to it is recorded, so nothing has to be entered one by one.
  const [paidThrough, setPaidThrough] = useState('');
  const [saving, setSaving] = useState(false);
  const selectedCategory = categoryId || defaultCategoryId;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError('');
    setSaving(true);
    try {
      await api.post('/recurring', {
        name: name.trim(),
        amount: Number(amount),
        categoryId: selectedCategory,
        startDate,
        totalMonths: fixed ? Number(months) : null,
        paidThrough: paidThrough || null,
      });
      setPaidThrough('');
      onCreated(name.trim());
      setName('');
      setAmount('');
    } catch (requestError) {
      onError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack-lg" onSubmit={(event) => void handleSubmit(event)} noValidate>
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
          <Dropdown value={selectedCategory} options={categoryOptions} onChange={setCategoryId} ariaLabel={t('rec.category')} />
        </div>
        <label className="tx-field">
          <span className="tx-field-label">{t('rec.startDate')}</span>
          <DatePicker value={startDate} onChange={(v) => setStartDate(v ?? todayInWib())} ariaLabel={t('rec.startDate')} />
        </label>
      </div>

      <div className="tx-field">
        <span className="tx-field-label">{t('rec.duration')}</span>
        <div className="chip-row" role="radiogroup" aria-label={t('rec.duration')}>
          <button type="button" role="radio" aria-checked={fixed} className="pill" onClick={() => setFixed(true)}>
            {t('rec.fixed')}
          </button>
          <button type="button" role="radio" aria-checked={!fixed} className="pill" onClick={() => setFixed(false)}>
            {t('rec.noEnd')}
          </button>
        </div>
        {fixed && (
          <label className="tx-field">
            <span className="tx-field-label">{t('rec.months')}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={600}
              className="input"
              value={months}
              onChange={(event) => setMonths(event.target.value)}
              required
            />
          </label>
        )}
      </div>

      <label className="tx-field">
        <span className="tx-field-label">{t('rec.paidThrough')}</span>
        <MonthPicker value={paidThrough || null} onChange={(value) => setPaidThrough(value ?? '')} max={todayInWib().slice(0, 7)} ariaLabel={t('rec.paidThrough')} />
        <span className="tx-hint">{t('rec.paidThroughHint')}</span>
      </label>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving || !amount || !name.trim()}>
          {saving ? t('form.saving') : t('rec.create')}
        </button>
      </div>
    </form>
  );
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
  const [paidOn, setPaidOn] = useState(todayInWib());
  const [paySaving, setPaySaving] = useState(false);
  const [name, setName] = useState(item.name);
  const [amount, setAmount] = useState(String(item.amount));
  const [categoryId, setCategoryId] = useState(item.categoryId);

  const progress =
    item.totalMonths !== null
      ? t('rec.progress', { paid: item.paidCount, total: item.totalMonths, left: item.remaining ?? 0 })
      : t('rec.progressNoEnd', { paid: item.paidCount });
  const done = item.nextDueMonth === null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError('');
    try {
      await api.patch(`/recurring/${item.id}`, { name: name.trim(), amount: Number(amount), categoryId });
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
      await api.post(`/recurring/${item.id}/pay`, { paidOn, method });
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
            <label className="tx-field">
              <span className="tx-field-label">{t('rec.paidOn')}</span>
              <DatePicker value={paidOn} onChange={(v) => setPaidOn(v ?? todayInWib())} ariaLabel={t('rec.paidOn')} />
            </label>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setPaying(false)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={paySaving}>
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
        <button type="button" className="icon-btn icon-btn-sm icon-btn-plain" onClick={() => setEditing(true)} aria-label={t('rec.edit')} title={t('rec.edit')}>
          <Icon name="edit" size={15} />
        </button>
        <button type="button" className="icon-btn icon-btn-sm icon-btn-plain text-danger" onClick={() => void remove()} aria-label={t('rec.delete')} title={t('rec.delete')}>
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
