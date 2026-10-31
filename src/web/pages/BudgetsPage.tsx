import { useEffect, useState, type CSSProperties } from 'react';
import { api, ApiRequestError } from '../api';
import { Dropdown } from '../components/Dropdown';
import { Icon } from '../components/Icon';
import { SkeletonRows } from '../components/Skeleton';
import { useCategories } from '../data';
import { monthLabel } from '../format';
import { usePrefs } from '../prefs';
import type { MessageKey } from '../i18n';
import { addMonths } from '../../shared/recurring';
import { budgetStatus, type BudgetMonth, type BudgetStatus } from '../../shared/budget';
import type { Category } from '../../shared/types';

// Budgets: a monthly limit for the whole month, and one per category. They repeat every month until changed,
// and each month keeps the budget it had. The page shows one month (this month by default, or a past one),
// a chart of spending against the budget over the last months, and the history month by month.

const HISTORY_MONTHS = 6;

const STATUS_KEYS: Record<Exclude<BudgetStatus, 'none'>, MessageKey> = {
  ok: 'budgets.status.ok',
  near: 'budgets.status.near',
  over: 'budgets.status.over',
};

const STATUS_BADGES: Record<Exclude<BudgetStatus, 'none'>, string> = {
  ok: 'badge-success',
  near: 'badge-warning',
  over: 'badge-danger',
};

/** Digits only: the amount is whole money, with no separators typed in. */
const digits = (text: string) => text.replace(/\D/g, '');

function shortMoney(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`;
  if (amount >= 1_000) return `${Math.round(amount / 1_000)}K`;
  return String(amount);
}

function shortMonth(month: string, lang: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-US', { month: 'short' });
}

/** The status as a badge: on track, near the limit, or over it. Nothing without a budget. */
function StatusBadge({ status }: { status: BudgetStatus }) {
  const { t } = usePrefs();
  if (status === 'none') return null;
  return <span className={`badge ${STATUS_BADGES[status]}`}>{t(STATUS_KEYS[status])}</span>;
}

interface RowProps {
  scope: string;
  label: string;
  color: string;
  icon: string;
  amount: number | null;
  spent: number;
  editable: boolean;
  busy: boolean;
  onSave: (scope: string, amount: number) => Promise<boolean>;
}

/**
 * One compact tile: the icon, the name and its warning, a thin bar of how much is used, and spent against the
 * budget. The amount field only opens with the edit button, so a tile stays one line high.
 */
function BudgetRow({ scope, label, color, icon, amount, spent, editable, busy, onSave }: RowProps) {
  const { t, money } = usePrefs();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const status = budgetStatus(spent, amount);
  const ratio = amount ? Math.min(1, spent / amount) : 0;
  const fill = status === 'over' ? 'var(--danger)' : status === 'near' ? 'var(--warning)' : color;

  function startEdit() {
    setDraft(amount !== null ? String(amount) : '');
    setEditing(true);
  }

  async function submit(value: number) {
    if (await onSave(scope, value)) setEditing(false);
  }

  return (
    <div className={`budget-item is-${status}`} style={{ '--cat-color': color } as CSSProperties}>
      <span className="budget-item-icon" aria-hidden="true">
        {icon || <Icon name="wallet" size={18} />}
      </span>
      <div className="budget-item-main">
        <div className="budget-item-top">
          <span className="budget-item-name truncate" title={label}>
            {label}
          </span>
          <StatusBadge status={status} />
        </div>
        {amount !== null && (
          <div className="bar-track budget-item-track" role="img" aria-label={t('budgets.used', { percent: Math.round((spent / amount) * 100) })}>
            <span className="bar-fill" style={{ width: `${ratio * 100}%`, background: fill }} />
          </div>
        )}
        <div className="budget-item-meta">
          <span className="budget-item-amount">
            <strong>{money(spent)}</strong>
            {amount !== null && <span className="text-muted"> / {money(amount)}</span>}
          </span>
          {amount !== null ? (
            <span className={`budget-item-left ${status === 'over' ? 'text-danger' : status === 'near' ? 'text-warning' : 'text-muted'}`}>
              {status === 'over' ? `+${money(spent - amount)}` : t('budgets.left', { amount: money(amount - spent) })}
            </span>
          ) : (
            <span className="budget-item-left text-muted">{t('budgets.noBudget')}</span>
          )}
        </div>
      </div>
      {editable && !editing && (
        <button type="button" className="icon-btn icon-btn-sm icon-btn-plain icon-btn-soft" onClick={startEdit} aria-label={`${t('budgets.amount')}: ${label}`} title={t('budgets.amount')}>
          <Icon name={amount !== null ? 'edit' : 'plus'} size={15} />
        </button>
      )}
      {editing && (
        <form
          className="budget-item-edit"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(Number(draft) || 0);
          }}
        >
          <input
            className="input input-sm"
            inputMode="numeric"
            placeholder={t('budgets.none')}
            aria-label={`${t('budgets.amount')}: ${label}`}
            value={draft}
            autoFocus
            onChange={(event) => setDraft(digits(event.target.value))}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {t('budgets.save')}
          </button>
          <button type="button" className="icon-btn icon-btn-sm icon-btn-plain" onClick={() => setEditing(false)} aria-label={t('common.cancel')} title={t('common.cancel')}>
            <Icon name="x" size={15} />
          </button>
          {amount !== null && (
            <button
              type="button"
              className="icon-btn icon-btn-sm icon-btn-plain icon-btn-soft text-danger"
              disabled={busy}
              onClick={() => void submit(0)}
              aria-label={t('budgets.remove')}
              title={t('budgets.remove')}
            >
              <Icon name="trash" size={15} />
            </button>
          )}
        </form>
      )}
    </div>
  );
}

/** Spending and budget of one scope in a month: '' is the total, else a category id. */
function lineOf(month: BudgetMonth, scope: string) {
  if (scope === '') return { amount: month.total, spent: month.spent };
  const line = month.categories.find((row) => row.categoryId === scope);
  return { amount: line?.amount ?? null, spent: line?.spent ?? 0 };
}

/** Bars of spending per month for one scope, the budget of each month as a line, and what changed since last month. */
function TrendCard({ months, categories }: { months: BudgetMonth[]; categories: Category[] }) {
  const { t, lang, money, categoryName } = usePrefs();
  const [scope, setScope] = useState('');
  const used = new Set(months.flatMap((month) => month.categories.filter((row) => row.amount !== null || row.spent > 0).map((row) => row.categoryId)));
  const options = [
    { value: '', label: t('budgets.total') },
    ...categories.filter((category) => used.has(category.id)).map((category) => ({ value: category.id, label: `${category.icon} ${categoryName(category.name)}` })),
  ];
  const lines = months.map((month) => ({ month: month.month, ...lineOf(month, scope) }));
  const max = Math.max(1, ...lines.map((line) => Math.max(line.spent, line.amount ?? 0)));
  const last = lines[lines.length - 1];
  const previous = lines[lines.length - 2];

  let spentChange = '';
  if (previous && previous.spent > 0) {
    const percent = Math.round(((last.spent - previous.spent) / previous.spent) * 100);
    spentChange = percent > 0 ? t('budgets.spentUp', { percent }) : percent < 0 ? t('budgets.spentDown', { percent: -percent }) : t('budgets.spentSame');
  }
  let budgetChange = '';
  if (previous && previous.amount !== null && last.amount !== null && previous.amount !== last.amount) {
    budgetChange = t(last.amount > previous.amount ? 'budgets.budgetUp' : 'budgets.budgetDown', { from: money(previous.amount), to: money(last.amount) });
  }

  return (
    <section className="card rep-card" aria-labelledby="budget-trend">
      <div className="budget-trend-head">
        <div>
          <h3 id="budget-trend" className="rep-card-title">
            {t('budgets.trend')}
          </h3>
          <p className="hint m-0">{t('budgets.trendHint')}</p>
        </div>
        <Dropdown value={scope} options={options} onChange={setScope} ariaLabel={t('budgets.trendScope')} className="budget-trend-scope" />
      </div>

      <div className="rep-bars budget-bars" role="img" aria-label={t('budgets.trend')}>
        {lines.map((line, index) => {
          const status = budgetStatus(line.spent, line.amount);
          return (
            <div
              key={line.month}
              className={`rep-bar budget-bar is-${status}`}
              title={`${monthLabel(line.month, lang)}: ${money(line.spent)}${line.amount !== null ? ` / ${money(line.amount)}` : ''}`}
            >
              <span className="rep-bar-value">
                {status === 'over' && <Icon name="alert" size={11} />}
                {line.spent > 0 ? shortMoney(line.spent) : ''}
              </span>
              <span className="budget-bar-area">
                {/* The Reports colours, one per month; the budget line and the value above say near or over. */}
                <span
                  className="rep-bar-fill budget-bar-fill"
                  style={{ height: `${Math.max(line.spent > 0 ? 3 : 0, (line.spent / max) * 100)}%`, '--bar-index': index % 6 } as CSSProperties}
                />
                {line.amount !== null && <span className="budget-bar-limit" style={{ bottom: `${(line.amount / max) * 100}%` }} />}
              </span>
              <span className="rep-bar-label">{shortMonth(line.month, lang)}</span>
            </div>
          );
        })}
      </div>

      <div className="budget-legend">
        <span>
          <i className="budget-legend-bar" aria-hidden="true" />
          {t('budgets.legendSpent')}
        </span>
        <span>
          <i className="budget-legend-line" aria-hidden="true" />
          {t('budgets.legendBudget')}
        </span>
        <span className="text-warning">
          <i className="budget-legend-dot is-near" aria-hidden="true" />
          {t('budgets.status.near')}
        </span>
        <span className="text-danger">
          <i className="budget-legend-dot is-over" aria-hidden="true" />
          {t('budgets.status.over')}
        </span>
      </div>
      {(spentChange || budgetChange) && (
        <p className="text-sm text-muted m-0">
          {[spentChange, budgetChange].filter(Boolean).join(' · ')}
        </p>
      )}
    </section>
  );
}

/** This month against last month for every category with a budget: spending, the change, and the budget. */
function ChangesCard({ months, categories }: { months: BudgetMonth[]; categories: Category[] }) {
  const { t, money, categoryName } = usePrefs();
  const last = months[months.length - 1];
  const previous = months[months.length - 2];
  const rows = categories
    .map((category) => ({ category, now: lineOf(last, category.id), before: lineOf(previous, category.id) }))
    .filter((row) => row.now.amount !== null || row.before.amount !== null);
  if (rows.length === 0) return null;

  return (
    <section className="card rep-card" aria-labelledby="budget-changes">
      <div>
        <h3 id="budget-changes" className="rep-card-title">
          {t('budgets.changes')}
        </h3>
        <p className="hint m-0">{t('budgets.changesHint')}</p>
      </div>
      <div className="budget-changes">
        <div className="budget-changes-row budget-changes-head">
          <span>{t('budgets.colCategory')}</span>
          <span>{t('budgets.colLast')}</span>
          <span>{t('budgets.colThis')}</span>
          <span>{t('budgets.colBudget')}</span>
        </div>
        {rows.map(({ category, now, before }) => {
          const change = before.spent > 0 ? Math.round(((now.spent - before.spent) / before.spent) * 100) : null;
          return (
            <div key={category.id} className="budget-changes-row">
              <span className="cat-name">
                <span className="cat-badge" style={{ '--cat-color': category.color } as CSSProperties} aria-hidden="true">
                  {category.icon}
                </span>
                <span className="truncate">{categoryName(category.name)}</span>
              </span>
              <span className="amount">{money(before.spent)}</span>
              <span className="amount">
                {money(now.spent)}
                {change !== null && change !== 0 && (
                  <span className={`budget-change ${change > 0 ? 'is-up' : 'is-down'}`}>
                    {change > 0 ? '▲' : '▼'} {Math.abs(change)}%
                  </span>
                )}
              </span>
              <span className="budget-changes-budget">
                {now.amount !== null ? money(now.amount) : t('budgets.noBudget')}
                <StatusBadge status={budgetStatus(now.spent, now.amount)} />
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Every month of the history, newest first: spending against the total budget, and how many categories went over. */
function HistoryCard({ months, selected, onOpen }: { months: BudgetMonth[]; selected: string; onOpen: (month: string) => void }) {
  const { t, lang, money } = usePrefs();
  return (
    <section className="card rep-card" aria-labelledby="budget-history">
      <div>
        <h3 id="budget-history" className="rep-card-title">
          {t('budgets.history')}
        </h3>
        <p className="hint m-0">{t('budgets.historyHint')}</p>
      </div>
      <div className="budget-history">
        {[...months].reverse().map((month) => {
          const over = month.categories.filter((row) => budgetStatus(row.spent, row.amount) === 'over').length;
          const near = month.categories.filter((row) => budgetStatus(row.spent, row.amount) === 'near').length;
          const status = budgetStatus(month.spent, month.total);
          return (
            <button
              key={month.month}
              type="button"
              className="list-row budget-history-row"
              aria-current={month.month === selected ? 'true' : undefined}
              onClick={() => onOpen(month.month)}
            >
              <span className="source-main">
                <span className="source-name">{monthLabel(month.month, lang)}</span>
                <span className="source-meta">
                  {money(month.spent)}
                  {month.total !== null && ` / ${money(month.total)}`}
                  {over > 0 && ` · ${t('budgets.overCount', { count: over })}`}
                  {near > 0 && ` · ${t('budgets.nearCount', { count: near })}`}
                </span>
              </span>
              <StatusBadge status={status} />
              <Icon name="chevron-right" size={16} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function BudgetsPage() {
  const { t, categoryName, lang } = usePrefs();
  const { categories } = useCategories();
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<(BudgetMonth & { current: string }) | null>(null);
  const [history, setHistory] = useState<BudgetMonth[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function load() {
    api
      .get<BudgetMonth & { current: string }>(month ? `/budgets?month=${month}` : '/budgets')
      .then(setData)
      .catch(() => setError(t('budgets.error')));
  }

  function loadHistory() {
    api
      .get<{ months: BudgetMonth[] }>(`/budgets/history?months=${HISTORY_MONTHS}`)
      .then((result) => setHistory(result.months))
      .catch(() => setHistory([]));
  }

  useEffect(load, [month]);
  useEffect(loadHistory, []);

  /** Saves one budget. True when it was saved, so the tile can close its field. */
  async function save(scope: string, amount: number) {
    setError('');
    setBusy(true);
    try {
      await api.put('/budgets', { categoryId: scope, amount });
      load();
      loadHistory();
      return true;
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('budgets.error'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function open(next: string) {
    setMonth(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (data === null) {
    return error ? (
      <p className="text-danger" role="alert">
        {error}
      </p>
    ) : (
      <SkeletonRows count={6} />
    );
  }

  const isCurrent = data.month === data.current;
  const byCategory = new Map(data.categories.map((row) => [row.categoryId, row]));
  const rowProps = { busy, editable: isCurrent, onSave: save };
  // Over and near first, so the warnings are at the top; then the rest in the categories' own order.
  const order: Record<BudgetStatus, number> = { over: 0, near: 1, ok: 2, none: 3 };
  const sorted = [...(categories ?? [])].sort((a, b) => {
    const rowA = byCategory.get(a.id);
    const rowB = byCategory.get(b.id);
    return order[budgetStatus(rowA?.spent ?? 0, rowA?.amount ?? null)] - order[budgetStatus(rowB?.spent ?? 0, rowB?.amount ?? null)];
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h2>{t('budgets.title')}</h2>
          <p className="hint">{t('budgets.subtitle', { month: monthLabel(data.month, lang) })}</p>
        </div>
        <div className="budget-month-nav">
          <button type="button" className="icon-btn icon-btn-sm" onClick={() => setMonth(addMonths(data.month, -1))} aria-label={t('budgets.prev')} title={t('budgets.prev')}>
            <Icon name="chevron-left" size={16} />
          </button>
          <span className="budget-month-label">{monthLabel(data.month, lang)}</span>
          <button type="button" className="icon-btn icon-btn-sm" onClick={() => setMonth(addMonths(data.month, 1))} disabled={isCurrent} aria-label={t('budgets.next')} title={t('budgets.next')}>
            <Icon name="chevron-right" size={16} />
          </button>
        </div>
      </div>

      {!isCurrent && (
        <div className="alert budget-past" role="status">
          <div className="alert-content">
            <p>{t('budgets.pastHint')}</p>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => setMonth(null)}>
            {t('budgets.backToNow')}
          </button>
        </div>
      )}

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      <section className="card rep-card">
        <div>
          <h3 className="rep-card-title">{t('budgets.total')}</h3>
          <p className="hint m-0">{t('budgets.totalHint')}</p>
        </div>
        <BudgetRow {...rowProps} key={`total-${data.month}`} scope="total" label={t('budgets.total')} color="var(--accent)" icon="" amount={data.total} spent={data.spent} />
      </section>

      <section className="card rep-card">
        <div>
          <h3 className="rep-card-title">{t('budgets.categories')}</h3>
          <p className="hint m-0">{t('budgets.categoriesHint')}</p>
        </div>
        <div className="budget-list">
          {sorted.map((category) => {
            const row = byCategory.get(category.id);
            return (
              <BudgetRow
                {...rowProps}
                key={`${category.id}-${data.month}`}
                scope={category.id}
                label={categoryName(category.name)}
                color={category.color}
                icon={category.icon}
                amount={row?.amount ?? null}
                spent={row?.spent ?? 0}
              />
            );
          })}
        </div>
      </section>

      {history === null ? (
        <SkeletonRows count={4} />
      ) : (
        history.length > 1 && (
          <>
            <TrendCard months={history} categories={categories ?? []} />
            <div className="rep-grid budget-report-grid">
              <HistoryCard months={history} selected={data.month} onOpen={open} />
              <ChangesCard months={history} categories={categories ?? []} />
            </div>
          </>
        )
      )}
    </>
  );
}
