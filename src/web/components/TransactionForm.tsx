import { useState, type CSSProperties, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { todayInWib } from '../format';
import { usePrefs } from '../prefs';
import { METHODS, isBilledKind, type Category, type Method, type PaymentSource, type Transaction, type TransactionInput } from '../../shared/types';
import { DatePicker } from './DatePicker';
import { Icon } from './Icon';

interface TransactionFormProps {
  categories: Category[];
  sources: PaymentSource[];
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

export function TransactionForm({ categories, sources, initial, submitLabel, onSaved, onCancel }: TransactionFormProps) {
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

  // Credit needs a credit card or paylater. Other methods may use savings, or no source at all.
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
                  {source.name}
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
                  {source.name}
                </button>
              ))}
            </div>
          </div>
        )
      )}

      <div className="tx-field">
        <span className="tx-field-label">{t('form.category')}</span>
        <div className="category-grid" role="radiogroup" aria-label={t('form.category')}>
          {categories.map((category) => (
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
            </button>
          ))}
        </div>
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

/** The currency code shown before the amount field, e.g. "IDR" or "$". Taken from the formatted sample. */
function currencyPrefix(money: (amount: number) => string): string {
  // Format 0 and drop the digits, so the prefix follows the chosen currency and language.
  return money(0).replace(/[\d.,\s ]/g, '');
}
