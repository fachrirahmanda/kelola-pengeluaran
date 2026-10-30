import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api, ApiRequestError } from '../api';
import { Dialog } from '../components/Dialog';
import { Dropdown } from '../components/Dropdown';
import { SkeletonRows } from '../components/Skeleton';
import { TransactionForm } from '../components/TransactionForm';
import { useCategories, useSources } from '../data';
import type { MessageKey } from '../i18n';
import { usePrefs } from '../prefs';
import { METHODS, type Method, type Transaction } from '../../shared/types';
import { DatePicker } from '../components/DatePicker';
import { Icon } from '../components/Icon';
import { TransactionCalendar } from '../components/TransactionCalendar';
import { AttachmentsSection } from '../components/AttachmentsSection';
import { Pager, pageOf, usePage } from '../components/Pager';

// Matches the server's LIST_LIMIT in routes/transactions.ts.
const LIST_LIMIT = 500;
/** Transactions per page in the list. */
const TX_PAGE_SIZE = 20;

interface Filters {
  from: string;
  to: string;
  category: string;
  method: string;
  q: string;
}

const EMPTY_FILTERS: Filters = { from: '', to: '', category: '', method: '', q: '' };

const METHOD_KEYS: Record<Method, MessageKey> = {
  cash: 'method.cash',
  debit: 'method.debit',
  transfer: 'method.transfer',
  credit: 'method.credit',
};

export function TransaksiPage() {
  const { t, money, date, categoryName } = usePrefs();
  const { categories } = useCategories();
  const { sources } = useSources();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const paging = usePage(transactions?.length ?? 0, TX_PAGE_SIZE, [filters.q, filters.from, filters.to, filters.category, filters.method]);

  // Fetch after the user stops typing for a moment.
  useEffect(() => {
    let ignore = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, value);
      }
      api
        .get<{ transactions: Transaction[] }>(`/transactions?${params}`)
        .then((data) => {
          if (ignore) return;
          setTransactions(data.transactions);
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
  }, [filters, reloadKey]);

  const categoryById = useMemo(() => new Map((categories ?? []).map((category) => [category.id, category])), [categories]);
  const sourceById = useMemo(() => new Map((sources ?? []).map((source) => [source.id, source])), [sources]);

  // Only posted transactions count as spending. Unpaid credit card items are not in the total.
  const total = (transactions ?? []).filter((item) => item.status === 'posted').reduce((sum, item) => sum + item.amount, 0);

  function updateFilter(key: keyof Filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
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

  // The date and category/method filters: shown in the grid on desktop, and in a side panel on phones.
  const filterFields = (
    <>
      <label className="field">
        <span className="field-label">{t('tx.from')}</span>
        <DatePicker value={filters.from || null} onChange={(v) => updateFilter('from', v ?? '')} ariaLabel={t('tx.from')} />
      </label>
      <label className="field">
        <span className="field-label">{t('tx.to')}</span>
        <DatePicker value={filters.to || null} onChange={(v) => updateFilter('to', v ?? '')} ariaLabel={t('tx.to')} />
      </label>
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
          options={[{ value: '', label: t('tx.allMethods') }, ...METHODS.map((method) => ({ value: method, label: t(METHOD_KEYS[method]) }))]}
          onChange={(next) => updateFilter('method', next)}
          ariaLabel={t('tx.method')}
        />
      </label>
    </>
  );
  const activeFilterCount = [filters.from, filters.to, filters.category, filters.method].filter(Boolean).length;

  return (
    <>
      <div className="page-header">
        <div>
          <h2>{t('tx.title')}</h2>
          <p className="hint">{t('tx.subtitle')}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilters(EMPTY_FILTERS)}>
          {t('common.reset')}
        </button>
      </div>

      <div className="row-actions" style={{ marginBottom: 'var(--space-4)' }}>
        <button type="button" className="btn btn-sm" aria-expanded={showCalendar} onClick={() => setShowCalendar((open) => !open)}>
          {showCalendar ? t('tx.hideCalendar') : t('tx.showCalendar')}
        </button>
      </div>
      {showCalendar && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <TransactionCalendar
            onPickDay={(day) => {
              setFilters({ ...EMPTY_FILTERS, from: day, to: day });
              setShowCalendar(false);
            }}
          />
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
            <button type="button" className="btn" onClick={() => setFilters(EMPTY_FILTERS)} disabled={activeFilterCount === 0 && !filters.q}>
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

      {/* Desktop and tablets: every filter in one card. */}
      <div className="card tx-filter-desktop" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="card-body filter-grid">
          {filterFields}
          <label className="field">
            <span className="field-label">{t('tx.search')}</span>
            <input type="search" className="input" value={filters.q} placeholder={t('tx.searchPlaceholder')} onChange={(event) => updateFilter('q', event.target.value)} />
          </label>
        </div>
      </div>

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

      {transactions === null ? (
        <div className="card">
          <SkeletonRows count={6} />
        </div>
      ) : transactions.length === 0 ? (
        <div className="card">
          <div className="empty">
            <p className="empty-title">{t('tx.emptyTitle')}</p>
            <p>{t('tx.emptyText')}</p>
          </div>
        </div>
      ) : (
        <>
          <p className="hint" style={{ marginBottom: 'var(--space-3)' }}>
            {t('tx.summary', { count: transactions.length, total: money(total) })}
            {transactions.length >= LIST_LIMIT && ` · ${t('tx.limitNote', { limit: LIST_LIMIT })}`}
          </p>

          <div className="table-wrap tx-table-desktop">
            <table className="table tx-table">
              <thead>
                <tr>
                  <th>{t('tx.col.date')}</th>
                  <th>{t('tx.col.category')}</th>
                  <th>{t('tx.col.note')}</th>
                  <th>{t('tx.col.method')}</th>
                  <th className="text-right">{t('tx.col.amount')}</th>
                  <th>{t('tx.col.status')}</th>
                  <th>
                    <span className="visually-hidden">{t('tx.col.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageOf(transactions, paging.page, TX_PAGE_SIZE).map((transaction) => {
                  const category = categoryById.get(transaction.categoryId);
                  const source = transaction.sourceId ? sourceById.get(transaction.sourceId) : undefined;
                  const methodText =
                    source ? `${t(METHOD_KEYS[transaction.method])} · ${source.name}` : t(METHOD_KEYS[transaction.method]);
                  return (
                    <tr key={transaction.id}>
                      <td data-label={t('tx.col.date')} style={{ whiteSpace: 'nowrap' }}>
                        {date(transaction.occurredOn)}
                        {transaction.occurredTime && <span className="text-muted"> {transaction.occurredTime}</span>}
                      </td>
                      <td data-label={t('tx.col.category')}>
                        {category ? (
                          <span className="cat-name">
                            <span className="cat-badge" style={{ '--cat-color': category.color } as CSSProperties}>
                              {category.icon}
                            </span>
                            {categoryName(category.name)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td data-label={t('tx.col.note')}>{transaction.note || <span className="text-muted">—</span>}</td>
                      <td data-label={t('tx.col.method')}>{methodText}</td>
                      <td data-label={t('tx.col.amount')} className="text-right amount">
                        {money(transaction.amount)}
                      </td>
                      <td data-label={t('tx.col.status')}>
                        {transaction.status === 'posted' ? (
                          <span className="badge badge-success">{t('tx.status.posted')}</span>
                        ) : (
                          <span className="badge badge-warning">{t('tx.status.unpaid')}</span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(transaction)}>
                            {t('tx.edit')}
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => void handleDelete(transaction)}>
                            {t('tx.delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phones show the same rows as a list of cards: the table would need horizontal room they don't have. */}
          <div className="tx-list">
            {pageOf(transactions, paging.page, TX_PAGE_SIZE).map((transaction) => {
              const category = categoryById.get(transaction.categoryId);
              const source = transaction.sourceId ? sourceById.get(transaction.sourceId) : undefined;
              const methodText = source ? `${t(METHOD_KEYS[transaction.method])} · ${source.name}` : t(METHOD_KEYS[transaction.method]);
              const categoryText = category ? categoryName(category.name) : '—';
              return (
                <article key={transaction.id} className="tx-item recent-tile" style={{ '--cat-color': category?.color ?? '#6c757d' } as CSSProperties}>
                  <span className="cat-badge" style={{ '--cat-color': category?.color } as CSSProperties}>
                    {category?.icon}
                  </span>
                  <div className="tx-item-main">
                    <div className="tx-item-top">
                      <strong className="tx-item-title">{transaction.note || categoryText}</strong>
                      <span className="tx-item-amount">{money(transaction.amount)}</span>
                    </div>
                    <span className="tx-item-meta">
                      {date(transaction.occurredOn)}
                      {transaction.occurredTime && ` ${transaction.occurredTime}`}
                      {' · '}
                      {transaction.note ? categoryText : methodText}
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

          <Pager page={paging.page} pages={paging.pages} count={transactions.length} onPage={paging.setPage} />
        </>
      )}

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={t('tx.editTitle')}>
        {editing && categories && sources && (
          <TransactionForm
            key={editing.id}
            categories={categories}
            sources={sources}
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
