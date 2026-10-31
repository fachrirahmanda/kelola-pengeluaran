import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, ApiRequestError } from '../api';
import { Donut } from '../components/Donut';
import { Icon } from '../components/Icon';
import { AddPanel, type AddKind } from '../components/AddPanel';
import { usePhone } from '../components/SidePanel';
import { SkeletonDashboard, SkeletonRows } from '../components/Skeleton';
import { useBills, useCategories, useRecurring } from '../data';
import { monthLabel, monthRange, todayInWib } from '../format';
import { usePrefs } from '../prefs';
import { addMonths, monthOf } from '../../shared/recurring';
import type { OpenBill, RecurringItem, Transaction } from '../../shared/types';

const RECENT_COUNT = 5;

/** One line in "Due next month": a card bill, an installment, or a recurring payment. */
interface DueLine {
  key: string;
  kind: 'card' | 'installment' | 'recurring';
  name: string;
  amount: number;
  dueDate: string;
  overdue: boolean;
}

export function DashboardPage() {
  const { t, money, date, categoryName, lang } = usePrefs();
  const { categories } = useCategories();
  const { bills } = useBills();
  const { data: recurring } = useRecurring();
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [error, setError] = useState(false);
  const [budget, setBudget] = useState<{ total: number | null; spent: number } | null>(null);
  // The Add form lives on this page: the side panel on desktop, and a popup on phones. It has a tab for each
  // thing that can be added (see AddPanel). The bottom bar's Add opens it with ?add=1.
  const phone = usePhone();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(params.get('add') === '1');
  const [addKind, setAddKind] = useState<AddKind>('expense');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (params.get('add') === '1') setAdding(true);
  }, [params]);

  function closeAdd() {
    setAdding(false);
    if (params.get('add')) setParams({}, { replace: true });
  }

  function handleSaved() {
    closeAdd();
    setVersion((current) => current + 1);
  }

  // Only this month. Dates are WIB, the same as when they were recorded.
  const today = useMemo(() => todayInWib(), []);
  const range = useMemo(() => monthRange(today), [today]);
  const thisMonth = monthOf(today);
  const nextMonth = addMonths(thisMonth, 1);

  useEffect(() => {
    let ignore = false;
    api
      .get<{ transactions: Transaction[] }>(`/transactions?from=${range.from}&to=${range.to}`)
      .then((data) => {
        // A transfer only moves money between accounts, so it is not spending.
        if (!ignore) setTransactions(data.transactions.filter((item) => item.method !== 'transfer'));
      })
      .catch((requestError: unknown) => {
        if (!ignore) {
          setError(true);
          if (!(requestError instanceof ApiRequestError)) console.error(requestError);
        }
      });
    return () => {
      ignore = true;
    };
  }, [range, version]);

  useEffect(() => {
    api
      .get<{ total: number | null; spent: number }>('/budgets')
      .then(setBudget)
      .catch(() => setBudget(null));
  }, []);

  const stats = useMemo(() => {
    const list = transactions ?? [];
    const posted = list.filter((item) => item.status === 'posted');
    const unpaid = list.filter((item) => item.status === 'unpaid');
    const spent = posted.reduce((sum, item) => sum + item.amount, 0);

    // Spending per category, biggest first. Only counted (posted) transactions.
    const byCategory = new Map<string, number>();
    for (const item of posted) byCategory.set(item.categoryId, (byCategory.get(item.categoryId) ?? 0) + item.amount);
    const rows = [...byCategory.entries()]
      .map(([categoryId, amount]) => ({ categoryId, amount }))
      .sort((a, b) => b.amount - a.amount);

    return {
      spent,
      count: list.length,
      unpaid: unpaid.reduce((sum, item) => sum + item.amount, 0),
      rows,
      recent: list.slice(0, RECENT_COUNT),
    };
  }, [transactions]);

  // Due next month: card bills, installments and recurring payments whose next due month is
  // next month or earlier (so overdue ones stay on the list until they are paid).
  const dueNext = useMemo<DueLine[] | null>(() => {
    if (bills === null || recurring === null) return null;
    const cards: DueLine[] = bills.open
      .filter((bill: OpenBill) => monthOf(bill.dueOn) <= nextMonth)
      .map((bill) => ({
        key: `card-${bill.sourceId}-${bill.period}`,
        kind: 'card' as const,
        name: bill.sourceName,
        amount: bill.total,
        dueDate: bill.dueOn,
        overdue: monthOf(bill.dueOn) < thisMonth,
      }));
    const items: DueLine[] = recurring.upcoming.map((item: RecurringItem) => ({
      key: `item-${item.id}-${item.nextInstallment}`,
      kind: item.totalMonths !== null ? ('installment' as const) : ('recurring' as const),
      name: item.name,
      amount: item.amount,
      dueDate: item.nextDueDate ?? '',
      overdue: item.overdue,
    }));
    return [...cards, ...items].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [bills, recurring, nextMonth, thisMonth]);

  const dueTotal = dueNext?.reduce((sum, line) => sum + line.amount, 0) ?? 0;
  const kindLabel: Record<DueLine['kind'], string> = {
    card: t('dash.typeCard'),
    installment: t('dash.typeInstallment'),
    recurring: t('dash.typeRecurring'),
  };

  const categoryById = useMemo(() => new Map((categories ?? []).map((category) => [category.id, category])), [categories]);

  return (
    <>
      <div className="page-header">
        <div>
          <h2>{t('dash.title')}</h2>
          <p className="hint">{t('dash.subtitle')}</p>
        </div>
        {phone && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} />
            {t('catat.add')}
          </button>
        )}
      </div>

      {error && (
        <p className="text-danger" role="alert">
          {t('dash.error')}
        </p>
      )}

      {transactions === null && !error ? (
        <SkeletonDashboard />
      ) : (
        <>
          <section className="stat-grid" aria-label={t('dash.title')}>
            <article className="stat stat-primary">
              <span className="stat-label">{t('dash.spentMonth')}</span>
              <strong className="stat-value">{money(stats.spent)}</strong>
            </article>
            <article className="stat">
              <span className="stat-label">{t('dash.countMonth')}</span>
              <strong className="stat-value">{stats.count}</strong>
            </article>
            <article className="stat">
              <span className="stat-label">{t('dash.unpaid')}</span>
              <strong className="stat-value">{money(stats.unpaid)}</strong>
            </article>
            {budget?.total != null && (
              <article className="stat">
                <span className="stat-label">{t('dash.budgetLeft')}</span>
                <strong className="stat-value">{money(budget.total - budget.spent)}</strong>
              </article>
            )}
          </section>

          <div className="dash-grid">
            <section className="dash-panel" aria-labelledby="dash-due-next">
              <div className="dash-panel-head">
                <h3 id="dash-due-next" className="dash-panel-title">
                  {t('dash.dueNext', { month: monthLabel(nextMonth, lang) })}
                </h3>
                {dueNext && dueNext.length > 0 && <span className="stat-value dash-due-total">{money(dueTotal)}</span>}
              </div>
              {dueNext === null ? (
                <SkeletonRows count={3} />
              ) : dueNext.length === 0 ? (
                <p className="hint">{t('dash.dueNextNone')}</p>
              ) : (
                <ul className="recent-list">
                  {dueNext.map((line) => (
                    <li key={line.key} className="recent-row">
                      <span className="recent-main">
                        <span className="recent-title">{line.name}</span>
                        <span className="recent-meta">
                          {kindLabel[line.kind]} · {date(line.dueDate)}
                          {line.overdue && <span className="recent-unpaid"> · {t('rec.overdue')}</span>}
                        </span>
                      </span>
                      <span className="amount">{money(line.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/bills" className="btn btn-sm dash-panel-action">
                {t('dash.openBills')}
                <Icon name="chevron-right" size={14} />
              </Link>
            </section>

            <section className="dash-panel" aria-labelledby="dash-running">
              <div className="dash-panel-head">
                <h3 id="dash-running" className="dash-panel-title">
                  {t('dash.running')}
                </h3>
              </div>
              {bills === null ? (
                <SkeletonRows count={2} />
              ) : bills.open.length === 0 ? (
                <p className="hint">{t('dash.runningNone')}</p>
              ) : (
                <ul className="recent-list">
                  {bills.open.map((bill) => (
                    <li key={`${bill.sourceId}-${bill.period}`} className="recent-row">
                      <span className="recent-main">
                        <span className="recent-title">{bill.sourceName}</span>
                        <span className="recent-meta">
                          {monthLabel(bill.period, lang)} · {t('bills.count', { count: bill.count })} · {t('dash.dueOn', { date: date(bill.dueOn) })}
                        </span>
                      </span>
                      <span className="amount">{money(bill.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {stats.count === 0 ? (
            <div className="dash-empty">
              <p>{t('dash.empty')}</p>
              {phone && (
                <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                  {t('dash.emptyAction')}
                </button>
              )}
            </div>
          ) : (
            <div className="dash-grid">
              <section className="dash-panel" aria-labelledby="dash-by-category">
                <h3 id="dash-by-category" className="dash-panel-title">
                  {t('dash.byCategory')}
                </h3>
                <Donut
                  ariaLabel={t('dash.byCategory')}
                  centerLabel={t('dash.spentMonth')}
                  centerValue={money(stats.spent)}
                  segments={stats.rows.map((row) => ({ label: row.categoryId, value: row.amount, color: categoryById.get(row.categoryId)?.color ?? '#6c757d' }))}
                />
                <ul className="bar-list">
                  {stats.rows.map((row) => {
                    const category = categoryById.get(row.categoryId);
                    const share = stats.spent > 0 ? Math.round((row.amount / stats.spent) * 100) : 0;
                    return (
                      <li key={row.categoryId} className="bar-row">
                        <div className="bar-row-head">
                          <span className="cat-name">
                            <span className="cat-badge" style={{ '--cat-color': category?.color ?? '#6c757d' } as CSSProperties}>
                              {category?.icon ?? '📦'}
                            </span>
                            {category ? categoryName(category.name) : t('dash.uncategorized')}
                          </span>
                          <span className="amount">{money(row.amount)}</span>
                        </div>
                        <div className="bar-track" role="img" aria-label={`${share}% ${t('dash.share')}`}>
                          <span className="bar-fill" style={{ width: `${share}%`, background: category?.color ?? '#6c757d' }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="dash-panel" aria-labelledby="dash-recent">
                <div className="dash-panel-head">
                  <h3 id="dash-recent" className="dash-panel-title">
                    {t('dash.recent')}
                  </h3>
                  <Link to="/transactions" className="dash-link">
                    {t('dash.viewAll')}
                  </Link>
                </div>
                <ul className="recent-list">
                  {stats.recent.map((item) => {
                    const category = categoryById.get(item.categoryId);
                    return (
                      <li key={item.id} className="recent-row recent-tile" style={{ '--cat-color': category?.color ?? '#6c757d' } as CSSProperties}>
                        <span className="cat-badge" style={{ '--cat-color': category?.color ?? '#6c757d' } as CSSProperties} aria-hidden="true">
                          {category?.icon ?? '📦'}
                        </span>
                        <span className="recent-main">
                          <span className="recent-title">{item.note || (category ? categoryName(category.name) : '—')}</span>
                          <span className="recent-meta">
                            {date(item.occurredOn)}
                            {item.status === 'unpaid' && <span className="recent-unpaid"> · {t('tx.status.unpaid')}</span>}
                          </span>
                        </span>
                        <span className="amount">{money(item.amount)}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          )}
        </>
      )}

      <AddPanel open={adding} onClose={closeAdd} kind={addKind} onKindChange={setAddKind} onSaved={handleSaved} />
    </>
  );
}
