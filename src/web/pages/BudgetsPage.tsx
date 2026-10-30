import { useEffect, useState, type CSSProperties } from 'react';
import { api, ApiRequestError } from '../api';
import { SkeletonRows } from '../components/Skeleton';
import { useCategories } from '../data';
import { monthLabel } from '../format';
import { usePrefs } from '../prefs';

// Budgets: a monthly limit for the whole month, and one per category. They repeat every month, and
// the page shows how much of each limit has been spent so far this month.

interface BudgetCategory {
  categoryId: string;
  amount: number | null;
  spent: number;
}

interface BudgetData {
  month: string;
  total: number | null;
  spent: number;
  categories: BudgetCategory[];
}

/** Digits only: the amount is whole money, with no separators typed in. */
const digits = (text: string) => text.replace(/\D/g, '');

interface RowProps {
  scope: string;
  label: string;
  color: string;
  icon: string;
  amount: number | null;
  spent: number;
  draft: string | undefined;
  busy: boolean;
  onDraft: (scope: string, value: string) => void;
  onSave: (scope: string, amount: number) => void;
}

/** One line: the scope (the total, or a category), its limit, and how much is spent against it. */
function BudgetRow({ scope, label, color, icon, amount, spent, draft, busy, onDraft, onSave }: RowProps) {
  const { t, money } = usePrefs();
  const ratio = amount ? Math.min(1, spent / amount) : 0;
  const over = amount !== null && spent > amount;
  return (
    <div className="budget-row">
      <div className="budget-row-head">
        <span className="cat-name">
          {icon && (
            <span className="cat-badge" style={{ '--cat-color': color } as CSSProperties} aria-hidden="true">
              {icon}
            </span>
          )}
          {label}
        </span>
        <span className="text-sm text-muted">
          {money(spent)}
          {amount !== null && (
            <>
              {' / '}
              {money(amount)}
              {' · '}
              <span className={over ? 'text-danger' : undefined}>{over ? t('budgets.over') : t('budgets.left', { amount: money(amount - spent) })}</span>
            </>
          )}
        </span>
      </div>
      {amount !== null && (
        <div className="bar-track" role="img" aria-label={`${Math.round(ratio * 100)}%`}>
          <span className="bar-fill" style={{ width: `${ratio * 100}%`, background: over ? 'var(--danger)' : color }} />
        </div>
      )}
      <div className="row-actions">
        <input
          className="input budget-input"
          inputMode="numeric"
          placeholder={t('budgets.none')}
          aria-label={`${t('budgets.amount')}: ${label}`}
          value={draft ?? (amount !== null ? String(amount) : '')}
          onChange={(event) => onDraft(scope, digits(event.target.value))}
        />
        {draft !== undefined && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onSave(scope, Number(draft) || 0)}>
            {t('budgets.save')}
          </button>
        )}
        {draft === undefined && amount !== null && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onSave(scope, 0)}>
            {t('budgets.remove')}
          </button>
        )}
      </div>
    </div>
  );
}

export function BudgetsPage() {
  const { t, categoryName, lang } = usePrefs();
  const { categories } = useCategories();
  const [data, setData] = useState<BudgetData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function load() {
    api
      .get<BudgetData>('/budgets')
      .then(setData)
      .catch(() => setError(t('budgets.error')));
  }

  useEffect(load, []);

  function changeDraft(scope: string, value: string) {
    setDrafts((current) => ({ ...current, [scope]: value }));
  }

  async function save(scope: string, amount: number) {
    setError('');
    setBusy(true);
    try {
      await api.put('/budgets', { categoryId: scope, amount });
      setDrafts((current) => {
        const next = { ...current };
        delete next[scope];
        return next;
      });
      load();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('budgets.error'));
    } finally {
      setBusy(false);
    }
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

  const byCategory = new Map(data.categories.map((row) => [row.categoryId, row]));
  const rowProps = { draft: undefined as string | undefined, busy, onDraft: changeDraft, onSave: (scope: string, amount: number) => void save(scope, amount) };

  return (
    <>
      <div className="page-header">
        <div>
          <h2>{t('budgets.title')}</h2>
          <p className="hint">{t('budgets.subtitle', { month: monthLabel(data.month, lang) })}</p>
        </div>
      </div>

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      <section className="card storage-card">
        <h3 className="m-0">{t('budgets.total')}</h3>
        <p className="hint m-0">{t('budgets.totalHint')}</p>
        <BudgetRow
          {...rowProps}
          draft={drafts.total}
          scope="total"
          label={t('budgets.total')}
          color="var(--accent)"
          icon=""
          amount={data.total}
          spent={data.spent}
        />
      </section>

      <section className="card storage-card">
        <h3 className="m-0">{t('budgets.categories')}</h3>
        <p className="hint m-0">{t('budgets.categoriesHint')}</p>
        {(categories ?? []).map((category) => {
          const row = byCategory.get(category.id);
          return (
            <BudgetRow
              {...rowProps}
              key={category.id}
              draft={drafts[category.id]}
              scope={category.id}
              label={categoryName(category.name)}
              color={category.color}
              icon={category.icon}
              amount={row?.amount ?? null}
              spent={row?.spent ?? 0}
            />
          );
        })}
      </section>
    </>
  );
}
