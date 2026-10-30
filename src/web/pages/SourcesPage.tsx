import { useState, type CSSProperties, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { BankBadge } from '../components/BankBadge';
import { DatePicker } from '../components/DatePicker';
import { Dropdown } from '../components/Dropdown';
import { Icon } from '../components/Icon';
import { SkeletonRows } from '../components/Skeleton';
import { useSources } from '../data';
import { BANKS, bankById } from '../../shared/banks';
import { todayInWib } from '../format';
import { usePrefs } from '../prefs';
import type { MessageKey } from '../i18n';
import { SOURCE_KINDS, isBilledKind, type PaymentSource, type SourceKind } from '../../shared/types';

const NAME_MAX = 40;

const KIND_KEYS: Record<SourceKind, MessageKey> = {
  savings: 'source.savings',
  credit_card: 'source.credit_card',
  paylater: 'source.paylater',
};

interface SourceInput {
  name: string;
  kind: SourceKind;
  closingDay: number | null;
  paymentDay: number | null;
  openingBalance: number;
  creditLimit: number | null;
  bank: string | null;
}

/** Sources of funds: the wallets, savings and cards that money moves through. Each one has its own balance or limit. */
export function SourcesPage() {
  const { t } = usePrefs();
  const { sources, reload } = useSources();
  const [incomeId, setIncomeId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createKey, setCreateKey] = useState(0);
  const [error, setError] = useState('');

  async function create(input: SourceInput) {
    await api.post('/sources', input);
    window.DS?.toast(t('settings.added', { name: input.name }), { variant: 'success' });
    setCreateKey((key) => key + 1);
    await reload();
  }

  async function update(source: PaymentSource, input: SourceInput) {
    await api.patch(`/sources/${source.id}`, { name: input.name, closingDay: input.closingDay, paymentDay: input.paymentDay });
    setEditingId(null);
    window.DS?.toast(t('settings.updated'), { variant: 'success' });
    await reload();
  }

  async function remove(source: PaymentSource) {
    if (!window.confirm(t('settings.confirmDelete', { name: source.name }))) return;
    setError('');
    try {
      await api.delete(`/sources/${source.id}`);
      window.DS?.toast(t('settings.deleted'));
      await reload();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('settings.deleteError'));
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>{t('settings.sources')}</h2>
          <p className="hint">{t('settings.sourcesHint')}</p>
        </div>
      </div>

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      <section className="settings-section" aria-label={t('settings.sources')}>
        <SourceCards
          sources={sources}
          editingId={editingId}
          onEdit={setEditingId}
          onIncome={setIncomeId}
          onRemove={(source) => void remove(source)}
          onSave={(source, input) => update(source, input)}
          onCancel={() => setEditingId(null)}
        />

        {incomeId && (
          <div className="card" style={{ marginTop: 'var(--space-4)' }}>
            <div className="card-body">
              <h3 className="card-title">{t('income.title', { name: sources?.find((source) => source.id === incomeId)?.name ?? '' })}</h3>
              <IncomeForm
                sourceId={incomeId}
                onDone={() => {
                  setIncomeId(null);
                  reload();
                }}
                onCancel={() => setIncomeId(null)}
              />
            </div>
          </div>
        )}

        <div className="card" style={{ marginTop: 'var(--space-4)' }}>
          <div className="card-body">
            <h3 className="card-title">{t('settings.addTitle')}</h3>
            <SourceEditor key={createKey} submitLabel={t('settings.create')} onSave={create} />
          </div>
        </div>
      </section>
    </>
  );
}

interface SourceEditorProps {
  initial?: PaymentSource;
  submitLabel: string;
  onSave: (input: SourceInput) => Promise<void>;
  onCancel?: () => void;
}

/** Name, type and billing days. The type is fixed once a source exists, because transactions depend on it. */
function SourceEditor({ initial, submitLabel, onSave, onCancel }: SourceEditorProps) {
  const { t } = usePrefs();
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<SourceKind>(initial?.kind ?? 'savings');
  const [closingDay, setClosingDay] = useState(initial?.closingDay ? String(initial.closingDay) : '');
  const [paymentDay, setPaymentDay] = useState(initial?.paymentDay ? String(initial.paymentDay) : '');
  const [openingBalance, setOpeningBalance] = useState(initial?.openingBalance ? String(initial.openingBalance) : '');
  const [creditLimit, setCreditLimit] = useState(initial?.creditLimit ? String(initial.creditLimit) : '');
  const [bank, setBank] = useState(initial?.bank ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const billed = isBilledKind(kind);
    const input: SourceInput = {
      bank: bank || null,
      name: name.trim(),
      kind,
      closingDay: billed ? Number(closingDay) : null,
      paymentDay: billed ? Number(paymentDay) : null,
      openingBalance: billed ? 0 : Number(openingBalance.replace(/\D/g, '')) || 0,
      creditLimit: billed && creditLimit.replace(/\D/g, '') ? Number(creditLimit.replace(/\D/g, '')) : null,
    };
    setSaving(true);
    try {
      await onSave(input);
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack-lg" onSubmit={(event) => void handleSubmit(event)} noValidate>
      <label className="tx-field">
        <span className="tx-field-label">{t('settings.name')}</span>
        <input type="text" className="input" value={name} maxLength={NAME_MAX} onChange={(event) => setName(event.target.value)} required />
      </label>

      <div className="tx-field">
        <span className="tx-field-label">{t('settings.kind')}</span>
        <div className="chip-row" role="radiogroup" aria-label={t('settings.kind')}>
          {SOURCE_KINDS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={kind === option}
              className="pill"
              disabled={!!initial}
              onClick={() => setKind(option)}
            >
              {t(KIND_KEYS[option])}
            </button>
          ))}
        </div>
        {initial && <p className="tx-hint">{t('settings.kindLocked')}</p>}
      </div>

      <div className="tx-field">
        <span className="tx-field-label">{t('settings.bank')}</span>
        <Dropdown
          value={bank}
          options={[{ value: '', label: t('settings.noBank') }, ...BANKS.map((option) => ({ value: option.id, label: option.name, icon: <BankBadge bankId={option.id} size={22} /> }))]}
          onChange={setBank}
          ariaLabel={t('settings.bank')}
          searchable
        />
      </div>

      <label className="tx-field">
        <span className="tx-field-label">{isBilledKind(kind) ? t('settings.creditLimit') : t('settings.openingBalance')}</span>
        <input
          type="text"
          inputMode="numeric"
          className="input"
          placeholder={isBilledKind(kind) ? t('settings.noLimit') : '0'}
          value={isBilledKind(kind) ? creditLimit : openingBalance}
          onChange={(event) => (isBilledKind(kind) ? setCreditLimit : setOpeningBalance)(event.target.value.replace(/\D/g, ''))}
        />
        <span className="tx-hint">{isBilledKind(kind) ? t('settings.limitHint') : t('settings.openingHint')}</span>
      </label>

      {isBilledKind(kind) && (
        <div className="tx-grid">
          <label className="tx-field">
            <span className="tx-field-label">{t('settings.closingDay')}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={28}
              className="input"
              value={closingDay}
              onChange={(event) => setClosingDay(event.target.value)}
              required
            />
            <span className="tx-hint">{t('settings.dayRange')}</span>
          </label>
          <label className="tx-field">
            <span className="tx-field-label">{t('settings.paymentDay')}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={28}
              className="input"
              value={paymentDay}
              onChange={(event) => setPaymentDay(event.target.value)}
              required
            />
            <span className="tx-hint">{t('settings.dayRange')}</span>
          </label>
        </div>
      )}

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
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? t('form.saving') : submitLabel}
        </button>
      </div>
    </form>
  );
}

/** Income into a wallet: money that came in (gaji, transfer masuk). It raises the balance and is not spending. */
function IncomeForm({ sourceId, onDone, onCancel }: { sourceId: string; onDone: () => void; onCancel: () => void }) {
  const { t } = usePrefs();
  const [amount, setAmount] = useState('');
  const [occurredOn, setOccurredOn] = useState(todayInWib());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post(`/sources/${sourceId}/income`, { amount: Number(amount.replace(/\D/g, '')) || 0, occurredOn, note });
      window.DS?.toast(t('income.saved'), { variant: 'success' });
      onDone();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('income.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack-lg" onSubmit={(event) => void submit(event)} noValidate>
      <label className="tx-field">
        <span className="tx-field-label">{t('income.amount')}</span>
        <input className="input" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))} required />
      </label>
      <div className="tx-field">
        <span className="tx-field-label">{t('income.date')}</span>
        <DatePicker value={occurredOn} onChange={(value) => setOccurredOn(value ?? todayInWib())} ariaLabel={t('income.date')} />
      </div>
      <label className="tx-field">
        <span className="tx-field-label">{t('income.note')}</span>
        <input className="input" value={note} maxLength={80} onChange={(event) => setNote(event.target.value)} />
      </label>
      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving || !Number(amount)}>
          {saving ? t('form.saving') : t('income.save')}
        </button>
      </div>
    </form>
  );
}

interface SourceCardsProps {
  sources: PaymentSource[] | null;
  editingId: string | null;
  onEdit: (id: string | null) => void;
  onIncome: (id: string) => void;
  onRemove: (source: PaymentSource) => void;
  onSave: (source: PaymentSource, input: SourceInput) => Promise<void>;
  onCancel: () => void;
}

/** The bank colours the card face: a wallet card in the bank's colour, a neutral one for cash. */
function cardColours(bankId: string | null | undefined): CSSProperties {
  const bank = bankById(bankId);
  return { '--bank-color': bank?.color ?? '#3f3f46', '--bank-text': bank?.textColor ?? '#ffffff' } as CSSProperties;
}

/** The sources as cards: the bank badge, the balance or the limit, and the actions. One card opens for editing. */
function SourceCards({ sources, editingId, onEdit, onIncome, onRemove, onSave, onCancel }: SourceCardsProps) {
  const { t, money } = usePrefs();
  if (sources === null) return <SkeletonRows count={2} />;
  if (sources.length === 0) {
    return (
      <div className="empty">
        <p>{t('settings.empty')}</p>
      </div>
    );
  }
  return (
    <div className="source-grid">
      {sources.map((source) =>
        editingId === source.id ? (
          <div key={source.id} className="card source-card source-card-wide">
            <div className="card-body">
              <SourceEditor initial={source} submitLabel={t('form.save')} onSave={(input) => onSave(source, input)} onCancel={onCancel} />
            </div>
          </div>
        ) : (
          <article key={source.id} className="card source-card" style={cardColours(source.bank)}>
            <div className="card-body stack">
              <div className="source-card-head">
                <BankBadge bankId={source.bank} />
                <div className="grow source-card-title">
                  <strong className="truncate">{source.name}</strong>
                  <span className="text-sm text-muted">
                    {t(KIND_KEYS[source.kind])}
                    {isBilledKind(source.kind) && source.closingDay && source.paymentDay
                      ? ` · ${t('settings.days', { closing: source.closingDay, payment: source.paymentDay })}`
                      : ''}
                  </span>
                </div>
              </div>

              {source.kind === 'savings' ? (
                <div>
                  <span className="text-sm text-muted">{t('settings.balanceLabel')}</span>
                  <strong className="source-amount">{money(source.balance ?? 0)}</strong>
                </div>
              ) : source.creditLimit ? (
                <div className="stack">
                  <div>
                    <span className="text-sm text-muted">{t('settings.availableLabel')}</span>
                    <strong className="source-amount">{money(source.creditLimit - (source.owed ?? 0))}</strong>
                  </div>
                  <div className="bar-track" role="img" aria-label={t('settings.unpaidOfLimit', { owed: money(source.owed ?? 0), limit: money(source.creditLimit) })}>
                    <span className="bar-fill" style={{ width: `${Math.min(100, ((source.owed ?? 0) / source.creditLimit) * 100)}%`, background: 'var(--accent)' }} />
                  </div>
                  <span className="text-sm text-muted">{t('settings.unpaidOfLimit', { owed: money(source.owed ?? 0), limit: money(source.creditLimit) })}</span>
                </div>
              ) : (
                <div>
                  <span className="text-sm text-muted">{t('settings.unpaidLabel')}</span>
                  <strong className="source-amount">{money(source.owed ?? 0)}</strong>
                </div>
              )}

              <div className="source-actions">
                {source.kind === 'savings' && (
                  <button type="button" className="icon-btn icon-btn-sm icon-btn-plain" onClick={() => onIncome(source.id)} aria-label={t('income.add')} title={t('income.add')}>
                    <Icon name="plus" size={15} />
                  </button>
                )}
                <button type="button" className="icon-btn icon-btn-sm icon-btn-plain" onClick={() => onEdit(source.id)} aria-label={t('cat.edit')} title={t('cat.edit')}>
                  <Icon name="edit" size={15} />
                </button>
                <button type="button" className="icon-btn icon-btn-sm icon-btn-plain text-danger" onClick={() => onRemove(source)} aria-label={t('cat.delete')} title={t('cat.delete')}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </div>
          </article>
        ),
      )}
    </div>
  );
}
