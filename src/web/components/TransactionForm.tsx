import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiRequestError } from '../api';
import { budgetStatus, type BudgetLine, type BudgetMonth } from '../../shared/budget';
import { todayInWib } from '../format';
import { usePrefs } from '../prefs';
import { METHODS, isBilledKind, type Category, type Method, type PaymentSource, type SourceHolder, type Transaction, type TransactionInput } from '../../shared/types';
import { DatePicker } from './DatePicker';
import { Icon } from './Icon';

interface TransactionFormProps {
  categories: Category[];
  sources: PaymentSource[];
  /** People sources can belong to; a source's owner shows next to its name when there is more than one. */
  holders?: SourceHolder[];
  /** Set when editing. Without it the form creates a new transaction. */
  initial?: Transaction;
  submitLabel: string;
  onSaved: (transaction: Transaction) => void;
  onCancel?: () => void;
}

const METHOD_ICONS: Record<Method, string> = {
  cash: 'banknote',
  debit: 'card',
  transfer: 'transfer',
  credit: 'receipt',
};

const METHOD_KEYS = {
  cash: 'method.cash',
  debit: 'method.debit',
  transfer: 'method.transfer',
  credit: 'method.credit',
} as const;

export function TransactionForm({ categories, sources, holders = [], initial, submitLabel, onSaved, onCancel }: TransactionFormProps) {
  const { t, money, categoryName } = usePrefs();
  const [occurredOn, setOccurredOn] = useState(initial?.occurredOn ?? todayInWib());
  const [occurredTime, setOccurredTime] = useState(initial?.occurredTime ?? '');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [method, setMethod] = useState<Method>(initial?.method ?? 'cash');
  const [sourceId, setSourceId] = useState(initial?.sourceId ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // This month's budgets, to warn on a category that is near or over its budget.
  const [budgets, setBudgets] = useState<Map<string, BudgetLine>>(new Map());

  useEffect(() => {
    api
      .get<BudgetMonth>('/budgets')
      .then((data) => setBudgets(new Map(data.categories.filter((row) => row.amount !== null).map((row) => [row.categoryId, row]))))
      .catch(() => undefined);
  }, []);

  // Credit needs a credit card or paylater. Other methods may use savings, or no source at all.
  // "BCA · Rina": whose account it is, when the data is shared by more than one person.
  const sourceLabel = (source: PaymentSource) => {
    const holder = holders.length > 1 ? holders.find((person) => person.userId === source.holderId) : undefined;
    return holder ? `${source.name} · ${(holder.name || holder.email).split(/[\s@]/)[0]}` : source.name;
  };
  const billedSources = sources.filter((source) => isBilledKind(source.kind));
  const savingsSources = sources.filter((source) => source.kind === 'savings');
  const selectedCategoryId = categoryId || categories[0]?.id || '';
  const selectedBilled = billedSources.find((source) => source.id === sourceId) ?? billedSources[0];
  const selectedSavings = savingsSources.find((source) => source.id === sourceId);
  const amountNumber = Number(amount);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!amount) {
      setError(t('form.amountRequired'));
      return;
    }

    const body: TransactionInput = {
      occurredOn,
      occurredTime: occurredTime || null,
      amount: amountNumber,
      categoryId: selectedCategoryId,
      note,
      method,
      sourceId: method === 'credit' ? (selectedBilled?.id ?? null) : (selectedSavings?.id ?? null),
    };

    setSaving(true);
    try {
      const data = initial
        ? await api.put<{ transaction: Transaction }>(`/transactions/${initial.id}`, body)
        : await api.post<{ transaction: Transaction }>('/transactions', body);
      onSaved(data.transaction);
      if (!initial && data.transaction.status === 'posted' && data.transaction.postedOn?.slice(0, 7) === todayInWib().slice(0, 7)) {
        // Count the new expense against its category's budget, so the warning stays right for the next entry.
        setBudgets((current) => {
          const line = current.get(data.transaction.categoryId);
          if (!line) return current;
          return new Map(current).set(line.categoryId, { ...line, spent: line.spent + data.transaction.amount });
        });
      }
      if (!initial) {
        // Keep date, method, category and source for the next entry; clear the rest.
        setAmount('');
        setNote('');
      }
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('form.failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="tx-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
      <label className="tx-amount">
        <span className="tx-amount-label">{t('form.amount')}</span>
        <span className="tx-amount-field">
          <span className="tx-amount-prefix">{currencyPrefix(money)}</span>
          <input
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/\D/g, '').slice(0, 13))}
            placeholder="0"
            autoComplete="off"
            aria-describedby="tx-amount-hint"
          />
        </span>
        <span id="tx-amount-hint" className="tx-amount-hint">
          {amount ? money(amountNumber) : t('form.amountHint')}
        </span>
      </label>

      <div className="tx-field">
        <span className="tx-field-label">{t('form.method')}</span>
        <div className="chip-row" role="radiogroup" aria-label={t('form.method')}>
          {METHODS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={method === option}
              className="pill"
              onClick={() => setMethod(option)}
            >
              <span aria-hidden="true">
                <Icon name={METHOD_ICONS[option]} size={20} />
              </span>
              {t(METHOD_KEYS[option])}
            </button>
          ))}
        </div>
      </div>

      {method === 'credit' ? (
        <div className="tx-field">
          <span className="tx-field-label">{t('form.billedSource')}</span>
          {billedSources.length === 0 ? (
            <p className="tx-hint">{t('form.noBilledSources')}</p>
          ) : (
            <div className="chip-row" role="radiogroup" aria-label={t('form.billedSource')}>
              {billedSources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedBilled?.id === source.id}
                  className="pill"
                  onClick={() => setSourceId(source.id)}
                >
                  {sourceLabel(source)}
                </button>
              ))}
            </div>
          )}
          <p className="tx-hint">{t('form.cardNote')}</p>
        </div>
      ) : (
        savingsSources.length > 0 && (
          <div className="tx-field">
            <span className="tx-field-label">{t('form.savingsSource')}</span>
            <div className="chip-row" role="radiogroup" aria-label={t('form.savingsSource')}>
              <button type="button" role="radio" aria-checked={!selectedSavings} className="pill" onClick={() => setSourceId('')}>
                {t('form.sourceNone')}
              </button>
              {savingsSources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedSavings?.id === source.id}
                  className="pill"
                  onClick={() => setSourceId(source.id)}
                >
                  {sourceLabel(source)}
                </button>
              ))}
            </div>
          </div>
        )
      )}

      <div className="tx-field">
        <span className="tx-field-label">{t('form.category')}</span>
        {categories.length === 0 && (
          <p className="tx-hint">
            <Link to="/settings?tab=categories">{t('form.noCategories')}</Link>
          </p>
        )}
        <div className="category-grid" role="radiogroup" aria-label={t('form.category')}>
          {categories.map((category) => {
            const line = budgets.get(category.id);
            const status = line ? budgetStatus(line.spent, line.amount) : 'none';
            return (
              <button
                key={category.id}
                type="button"
                role="radio"
                aria-checked={selectedCategoryId === category.id}
                className="category-option"
                style={{ '--cat-color': category.color } as CSSProperties}
                onClick={() => setCategoryId(category.id)}
              >
                <span className="cat-badge" aria-hidden="true">
                  {category.icon}
                </span>
                <span className="category-option-name">{categoryName(category.name)}</span>
                {(status === 'near' || status === 'over') && (
                  <span className={`badge ${status === 'over' ? 'badge-danger' : 'badge-warning'} category-option-budget`}>
                    {t(status === 'over' ? 'budgets.status.over' : 'budgets.status.near')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <BudgetHint line={budgets.get(selectedCategoryId)} name={categoryName(categories.find((category) => category.id === selectedCategoryId)?.name ?? '')} adding={initial ? 0 : amountNumber} />
      </div>

      <div className="tx-grid">
        <label className="tx-field">
          <span className="tx-field-label">{t('form.date')}</span>
          <DatePicker value={occurredOn} onChange={(v) => setOccurredOn(v ?? todayInWib())} ariaLabel={t('form.date')} />
        </label>
        <label className="tx-field">
          <span className="tx-field-label">{t('form.time')}</span>
          <input type="time" className="input" value={occurredTime} onChange={(event) => setOccurredTime(event.target.value)} />
        </label>
        <label className="tx-field">
          <span className="tx-field-label">{t('form.note')}</span>
          <input
            type="text"
            className="input"
            value={note}
            maxLength={200}
            placeholder={t('form.notePlaceholder')}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        )}
        <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>
          {saving ? t('form.saving') : submitLabel}
        </button>
      </div>
    </form>
  );
}

/**
 * Under the categories: the chosen category's budget this month. Over budget is red, near it amber, and an
 * amount that would take it over is said before it is saved. Nothing when the category has no budget.
 */
function BudgetHint({ line, name, adding }: { line: BudgetLine | undefined; name: string; adding: number }) {
  const { t, money } = usePrefs();
  if (!line || line.amount === null) return null;
  const status = budgetStatus(line.spent, line.amount);
  if (status === 'over') {
    return <p className="tx-hint text-danger">{t('form.budgetOver', { name, over: money(line.spent - line.amount) })}</p>;
  }
  if (adding > 0 && line.spent + adding > line.amount) {
    return <p className="tx-hint text-danger">{t('form.budgetWillOver', { name })}</p>;
  }
  return (
    <p className={`tx-hint${status === 'near' ? ' text-warning' : ''}`}>
      {t('form.budgetLeft', { name, left: money(line.amount - line.spent), amount: money(line.amount) })}
    </p>
  );
}

/** The currency code shown before the amount field, e.g. "IDR" or "$". Taken from the formatted sample. */
function currencyPrefix(money: (amount: number) => string): string {
  // Format 0 and drop the digits, so the prefix follows the chosen currency and language.
  return money(0).replace(/[\d.,\s ]/g, '');
}
