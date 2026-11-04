import { useEffect, useMemo, useRef, useState, type CSSProperties, type TouchEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { Link, useSearchParams } from 'react-router';
import { Dialog } from '../components/Dialog';
import { usePhone } from '../components/SidePanel';
import { Dropdown } from '../components/Dropdown';
import { SkeletonRows } from '../components/Skeleton';
import { TransactionForm } from '../components/TransactionForm';
import { useCategories, usePeriodStart, useSources } from '../data';
import { monthLabel, todayInWib } from '../format';
import { addMonths } from '../../shared/recurring';
import { periodOf, periodRange } from '../../shared/period';
import type { MessageKey } from '../i18n';
import { usePrefs } from '../prefs';
import { type Income, type Method, type Transaction } from '../../shared/types';
import { Icon } from '../components/Icon';
import { TransactionCalendar } from '../components/TransactionCalendar';
import { AttachmentsSection } from '../components/AttachmentsSection';
import { Pager, pageOf, usePage } from '../components/Pager';

// Matches the server's LIST_LIMIT in routes/transactions.ts.
const LIST_LIMIT = 500;
/** Transactions per page in the list. */
const TX_PAGE_SIZE = 20;

/** A line of the list: a transaction, or an income (a one-off, or a salary's payday). */
type Row = { key: string; occurredOn: string; kind: 'transaction'; transaction: Transaction } | { key: string; occurredOn: string; kind: 'income'; income: Income };

interface Filters {
  category: string;
  method: string;
  source: string;
  q: string;
}

const EMPTY_FILTERS: Filters = { category: '', method: '', source: '', q: '' };

/** The months from one period (YYYY-MM) to another. */
const monthsBetween = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5)) - Number(from.slice(5)));

// Debit and credit cards are both Cards in the app.
const METHOD_KEYS: Record<Method, MessageKey> = {
  debit: 'method.cards',
  transfer: 'method.transfer',
  credit: 'method.cards',
};

export function TransaksiPage() {
  const { t, lang, money, date, categoryName } = usePrefs();
  const { categories } = useCategories();
  const { sources, holders } = useSources();
  // Opened from a funds card (?source=…), the list starts filtered to that funds account.
  const [searchParams] = useSearchParams();
  const sourceParam = searchParams.get('source') ?? '';
  const [filters, setFilters] = useState<Filters>(() => ({ ...EMPTY_FILTERS, source: sourceParam }));
  useEffect(() => {
    setFilters((current) => ({ ...current, source: sourceParam }));
  }, [sourceParam]);
  // The list shows one monthly period (its start day is set in Settings). Offset 0 is the current period. A day picked on the calendar narrows the list to that day.
  const startDay = usePeriodStart();
  const phone = usePhone();
  const currentPeriod = periodOf(todayInWib(), startDay);
  const [offset, setOffset] = useState(0);
  const [day, setDay] = useState('');
  const period = addMonths(currentPeriod, offset);
  const { from, to } = day ? { from: day, to: day } : periodRange(period, startDay);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [incomes, setIncomes] = useState<Income[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  // Transactions and incomes, newest first. Incomes have no category or method, so those filters leave them out,
  // and the search only keeps the ones whose note matches.
  const rows = useMemo<Row[]>(() => {
    const search = filters.q.trim().toLowerCase();
    const incomeRows: Row[] =
      filters.category || filters.method
        ? []
        : (incomes ?? [])
            .filter((income) => !search || income.note.toLowerCase().includes(search))
            .map((income): Row => ({ key: `income-${income.id}`, occurredOn: income.occurredOn, kind: 'income', income }));
    const transactionRows = (transactions ?? []).map((transaction): Row => ({ key: transaction.id, occurredOn: transaction.occurredOn, kind: 'transaction', transaction }));
    return [...transactionRows, ...incomeRows].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  }, [transactions, incomes, filters.q, filters.category, filters.method]);
  const paging = usePage(rows.length, TX_PAGE_SIZE, `${from}|${to}|${filters.q}|${filters.category}|${filters.method}|${filters.source}`);

  // Fetch after the user stops typing for a moment.
  useEffect(() => {
    let ignore = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, value);
      }
      params.set('from', from);
      params.set('to', to);
      // Incomes have no category or method, so the category and method filters leave them out.
      const incomeRange = `from=${from}&to=${to}${filters.source ? `&source=${filters.source}` : ''}`;
      Promise.all([
        api.get<{ transactions: Transaction[] }>(`/transactions?${params}`),
        filters.category || filters.method ? Promise.resolve({ incomes: [] as Income[] }) : api.get<{ incomes: Income[] }>(`/incomes?${incomeRange}`),
      ])
        .then(([data, received]) => {
          if (ignore) return;
          setTransactions(data.transactions);
          setIncomes(received.incomes);
          setLoadError('');
        })
        .catch((error: unknown) => {
          if (ignore) return;
          setLoadError(error instanceof ApiRequestError ? error.message : t('tx.loadError'));
        });
    }, 200);

    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [filters, from, to, reloadKey]);

  const categoryById = useMemo(() => new Map((categories ?? []).map((category) => [category.id, category])), [categories]);
  const sourceById = useMemo(() => new Map((sources ?? []).map((source) => [source.id, source])), [sources]);

  // Only posted transactions count as spending. Unpaid credit card items are not in the total.
  // Transfers are listed but are not spending, so the total leaves them out.
  const total = (transactions ?? []).filter((item) => item.status === 'posted' && item.method !== 'transfer').reduce((sum, item) => sum + item.amount, 0);

  function updateFilter(key: keyof Filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function resetAll() {
    setFilters(EMPTY_FILTERS);
    setOffset(0);
    setDay('');
  }

  // A swipe to the left goes to the next period, a swipe to the right to the one before. Only a clearly sideways move counts.
  function onSwipeStart(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    swipe.current = { x: touch.clientX, y: touch.clientY };
  }

  function onSwipeEnd(event: TouchEvent<HTMLDivElement>) {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    setDay('');
    setOffset((value) => (dx < 0 ? value + 1 : value - 1));
  }

  function refresh() {
    setReloadKey((key) => key + 1);
  }

  function closeEdit() {
    setEditing(null);
  }

  async function handleDelete(transaction: Transaction) {
    if (!window.confirm(t('tx.confirmDelete'))) return;
    setActionError('');
    try {
      await api.delete(`/transactions/${transaction.id}`);
      window.DS?.toast(t('tx.deleted'));
      refresh();
    } catch (error) {
      setActionError(error instanceof ApiRequestError ? error.message : t('tx.deleteError'));
    }
  }

  async function handleDeleteIncome(income: Income) {
    if (!window.confirm(t('income.confirmDelete', { amount: money(income.amount) }))) return;
    setActionError('');
    try {
      await api.delete(`/incomes/${income.id}`);
      window.DS?.toast(t('income.deleted'));
      refresh();
    } catch (error) {
      setActionError(error instanceof ApiRequestError ? error.message : t('tx.deleteError'));
    }
  }

  // The category and method filters: shown in the grid on desktop, and in a side panel on phones. The period is set above the list.
  const filterFields = (
    <>
      <label className="field">
        <span className="field-label">{t('tx.category')}</span>
        <Dropdown
          value={filters.category}
          options={[
            { value: '', label: t('tx.allCategories') },
            ...(categories ?? []).map((category) => ({ value: category.id, label: `${category.icon} ${categoryName(category.name)}` })),
          ]}
          onChange={(next) => updateFilter('category', next)}
          ariaLabel={t('tx.category')}
        />
      </label>
      <label className="field">
        <span className="field-label">{t('tx.method')}</span>
        <Dropdown
          value={filters.method}
          options={[
            { value: '', label: t('tx.allMethods') },
            { value: 'cards', label: t('method.cards') },
            { value: 'transfer', label: t('method.transfer') },
          ]}
          onChange={(next) => updateFilter('method', next)}
          ariaLabel={t('tx.method')}
        />
      </label>
      <label className="field">
        <span className="field-label">{t('tx.source')}</span>
        <Dropdown
          value={filters.source}
          options={[{ value: '', label: t('tx.allSources') }, ...(sources ?? []).map((source) => ({ value: source.id, label: source.name }))]}
          onChange={(next) => updateFilter('source', next)}
          ariaLabel={t('tx.source')}
        />
      </label>
    </>
  );
  const activeFilterCount = [filters.category, filters.method, filters.source].filter(Boolean).length;

  return (
    <>
      <div className="page-header">
        <div>
          <h2>{t('tx.title')}</h2>
          <p className="hint">{t('tx.subtitle')}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={resetAll}>
          {t('common.reset')}
        </button>
      </div>

      {/* Computers: the calendar and filters sit on the left, and the list on the right. Phones stack them. */}
      <div className="tx-layout">
      <div className="tx-side">
      {phone && (
        <div className="row-actions" style={{ marginBottom: 'var(--space-4)' }}>
          <button type="button" className="btn btn-sm" aria-expanded={showCalendar} onClick={() => setShowCalendar((open) => !open)}>
            {showCalendar ? t('tx.hideCalendar') : t('tx.showCalendar')}
          </button>
        </div>
      )}
      {(!phone || showCalendar) && (
        <div>
          <TransactionCalendar
            onPickDay={(day) => {
              setFilters(EMPTY_FILTERS);
              setDay(day);
              setOffset(monthsBetween(currentPeriod, periodOf(day, startDay)));
              setShowCalendar(false);
            }}
          />
        </div>
      )}

      {/* Desktop: every filter in one card, under the calendar. */}
      <div className="card tx-filter-desktop" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="card-body filter-grid">
          {filterFields}
          <label className="field">
            <span className="field-label">{t('tx.search')}</span>
            <input type="search" className="input" value={filters.q} placeholder={t('tx.searchPlaceholder')} onChange={(event) => updateFilter('q', event.target.value)} />
          </label>
        </div>
      </div>
      </div>

      <div className="tx-main">
      {/* The list shows one period: move with the arrows, or swipe the list on a phone. */}
      <div className="period-nav">
        <button type="button" className="icon-btn icon-btn-plain" onClick={() => setOffset((value) => value - 1)} aria-label={t('tx.prevPeriod')} title={t('tx.prevPeriod')}>
          <Icon name="chevron-right" size={18} className="period-nav-prev" />
        </button>
        <div className="period-nav-label">
          <strong>{monthLabel(period, lang)}</strong>
          <span className="hint">{day ? date(day) : `${date(from)} – ${date(to)}`}</span>
        </div>
        <button type="button" className="icon-btn icon-btn-plain" onClick={() => setOffset((value) => value + 1)} aria-label={t('tx.nextPeriod')} title={t('tx.nextPeriod')}>
          <Icon name="chevron-right" size={18} />
        </button>
      </div>
      {(offset !== 0 || day) && (
        <div className="row-actions" style={{ marginBottom: 'var(--space-3)' }}>
          <button type="button" className="btn btn-sm" onClick={() => { setOffset(0); setDay(''); }}>
            {t('tx.thisPeriod')}
          </button>
        </div>
      )}

      {/* Phones: the search, and a Filters button with a count; the rest opens in a side panel. */}
      <div className="tx-filter-mobile">
        <input type="search" className="input grow" value={filters.q} placeholder={t('tx.searchPlaceholder')} aria-label={t('tx.search')} onChange={(event) => updateFilter('q', event.target.value)} />
        <button type="button" className="tx-filter-btn" onClick={() => setFilterOpen(true)} aria-haspopup="dialog" aria-label={t('tx.filters')} title={t('tx.filters')}>
          <Icon name="filter" size={16} />
          {activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}
        </button>
      </div>
      <Dialog
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title={t('tx.filters')}
        className="filter-sheet"
        footer={
          <>
            <button type="button" className="btn" onClick={resetAll} disabled={activeFilterCount === 0 && !filters.q && offset === 0 && !day}>
              {t('common.reset')}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setFilterOpen(false)}>
              {t('tx.showResults')}
            </button>
          </>
        }
      >
        <div className="filter-sheet-body">{filterFields}</div>
      </Dialog>

      {loadError && (
        <p className="text-danger" role="alert">
          {loadError}
        </p>
      )}
      {actionError && (
        <p className="text-danger" role="alert">
          {actionError}
        </p>
      )}

      {transactions === null || incomes === null ? (
        <div className="card">
          <SkeletonRows count={6} />
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="empty">
            <p className="empty-title">{t('tx.emptyTitle')}</p>
            <p>{t('tx.emptyText')}</p>
          </div>
        </div>
      ) : (
        <>
          <p className="hint" style={{ marginBottom: 'var(--space-3)' }}>
            {t('tx.summary', { count: rows.length, total: money(total) })}
            {transactions.length >= LIST_LIMIT && ` · ${t('tx.limitNote', { limit: LIST_LIMIT })}`}
          </p>

          <div className="tx-list" onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd}>
            {pageOf(rows, paging.page, TX_PAGE_SIZE).map((row) => {
              if (row.kind === 'income') {
                const { income } = row;
                return (
                  <article key={row.key} className="tx-item recent-tile" style={{ '--cat-color': 'var(--success)' } as CSSProperties}>
                    <span className="cat-badge" style={{ '--cat-color': 'var(--success)' } as CSSProperties}>
                      <Icon name="wallet" size={16} />
                    </span>
                    <div className="tx-item-main">
                      <div className="tx-item-top">
                        <strong className="tx-item-title">{income.note || t('income.untitled')}</strong>
                        <span className="tx-item-amount text-success">+{money(income.amount)}</span>
                      </div>
                      <span className="tx-item-meta">
                        {date(income.occurredOn)} · {income.sourceName}
                      </span>
                      <div className="tx-item-foot">
                        <span className="tx-item-chips">
                          <span className="badge badge-success">{income.fromSalary ? t('income.salaryBadge') : t('add.income')}</span>
                        </span>
                        <span className="tx-item-actions">
                          {!income.fromSalary && (
                            <button type="button" className="icon-btn icon-btn-sm icon-btn-plain icon-btn-soft text-danger" onClick={() => void handleDeleteIncome(income)} aria-label={t('tx.delete')} title={t('tx.delete')}>
                              <Icon name="trash" size={15} />
                            </button>
                          )}
                        </span>
                      </div>
                    </div>
                  </article>
                );
              }
              const transaction = row.transaction;
              const category = categoryById.get(transaction.categoryId);
              const source = transaction.sourceId ? sourceById.get(transaction.sourceId) : undefined;
              const methodText = source ? `${t(METHOD_KEYS[transaction.method])} · ${source.name}` : t(METHOD_KEYS[transaction.method]);
              // A transfer shows where the money went, in place of the category.
              const destination = transaction.toSourceId ? sourceById.get(transaction.toSourceId) : undefined;
              const transferText = destination ? t('tx.transferTo', { name: destination.name }) : methodText;
              const categoryText = category ? categoryName(category.name) : '—';
              return (
                <article key={transaction.id} className="tx-item recent-tile" style={{ '--cat-color': category?.color ?? '#6c757d' } as CSSProperties}>
                  <span className="cat-badge" style={{ '--cat-color': category?.color } as CSSProperties}>
                    {transaction.method === 'transfer' ? <Icon name="transfer" size={16} /> : category?.icon}
                  </span>
                  <div className="tx-item-main">
                    <div className="tx-item-top">
                      <Link to={`/transactions/${transaction.id}`} className="tx-item-title tx-item-link">
                        {transaction.note || categoryText}
                      </Link>
                      <span className="tx-item-amount">{money(transaction.amount)}</span>
                    </div>
                    <span className="tx-item-meta">
                      {date(transaction.occurredOn)}
                      {transaction.occurredTime && ` ${transaction.occurredTime}`}
                      {' · '}
                      {transaction.method === 'transfer' ? transferText : transaction.note ? categoryText : methodText}
                    </span>
                    <div className="tx-item-foot">
                      <span className="tx-item-chips">
                        {transaction.note && <span className="text-muted">{methodText}</span>}
                        {transaction.status === 'posted' ? (
                          <span className="badge badge-success">{t('tx.status.posted')}</span>
                        ) : (
                          <span className="badge badge-warning">{t('tx.status.unpaid')}</span>
                        )}
                      </span>
                      <span className="tx-item-actions">
                        <button type="button" className="icon-btn icon-btn-sm icon-btn-plain icon-btn-soft" onClick={() => setEditing(transaction)} aria-label={t('tx.edit')} title={t('tx.edit')}>
                          <Icon name="edit" size={15} />
                        </button>
                        <button type="button" className="icon-btn icon-btn-sm icon-btn-plain icon-btn-soft text-danger" onClick={() => void handleDelete(transaction)} aria-label={t('tx.delete')} title={t('tx.delete')}>
                          <Icon name="trash" size={15} />
                        </button>
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <Pager page={paging.page} pages={paging.pages} count={rows.length} onPage={paging.setPage} />
        </>
      )}

      </div>
      </div>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={t('tx.editTitle')}>
        {editing && categories && sources && (
          <TransactionForm
            key={editing.id}
            categories={categories}
            sources={sources}
            holders={holders}
            initial={editing}
            submitLabel={t('form.saveChanges')}
            onCancel={closeEdit}
            onSaved={() => {
              closeEdit();
              window.DS?.toast(t('tx.updated'), { variant: 'success' });
              refresh();
            }}
          />
        )}
        {editing && (
          <div className="stack">
            <AttachmentsSection transactionId={editing.id} />
          </div>
        )}
      </Dialog>
    </>
  );
}
