import { useState, type CSSProperties, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { BankBadge } from '../components/BankBadge';
import { Dropdown } from '../components/Dropdown';
import { Icon } from '../components/Icon';
import { IncomeSection } from '../components/IncomeSection';
import { SalarySection } from '../components/SalarySection';
import { SkeletonRows } from '../components/Skeleton';
import { useAuth } from '../auth';
import { useSources } from '../data';
import { initialsOf } from '../components/Notifications';
import { BANKS, bankById } from '../../shared/banks';
import { usePrefs } from '../prefs';
import type { MessageKey } from '../i18n';
import { SOURCE_KINDS, isBilledKind, type PaymentSource, type SourceHolder, type SourceKind } from '../../shared/types';

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
  holderId: string | null;
}

/** Whose sources the page shows: everyone's, the shared ones, or one person's. */
type HolderFilter = 'all' | 'shared' | string;

/** A person's photo, or their initials. */
function HolderAvatar({ holder, size = 22 }: { holder: SourceHolder; size?: number }) {
  return (
    <span className="ws-avatar holder-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
      {holder.avatarUrl ? <img src={holder.avatarUrl} alt="" referrerPolicy="no-referrer" /> : initialsOf(holder.name, holder.email)}
    </span>
  );
}

const holderName = (holder: SourceHolder) => holder.name || holder.email;

/** Sources of funds: the wallets, savings and cards that money moves through. Each one has its own balance or limit. */
export function SourcesPage() {
  const { t } = usePrefs();
  const { sources, holders, reload } = useSources();
  const [filter, setFilter] = useState<HolderFilter>('all');
  // A filter for someone who is no longer in the data set falls back to everyone.
  const activeFilter = filter === 'all' || filter === 'shared' || holders.some((holder) => holder.userId === filter) ? filter : 'all';
  const shown =
    sources === null || activeFilter === 'all'
      ? sources
      : sources.filter((source) => (activeFilter === 'shared' ? !source.holderId : source.holderId === activeFilter));
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
    await api.patch(`/sources/${source.id}`, {
      name: input.name,
      closingDay: input.closingDay,
      paymentDay: input.paymentDay,
      openingBalance: input.openingBalance,
      creditLimit: input.creditLimit,
      bank: input.bank,
      holderId: input.holderId,
    });
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
        {holders.length > 1 && (
          <div className="chip-row holder-filter" role="radiogroup" aria-label={t('holder.filter')}>
            <button type="button" role="radio" aria-checked={activeFilter === 'all'} className="pill" onClick={() => setFilter('all')}>
              {t('holder.all')}
            </button>
            {holders.map((holder) => (
              <button key={holder.userId} type="button" role="radio" aria-checked={activeFilter === holder.userId} className="pill holder-pill" onClick={() => setFilter(holder.userId)}>
                <HolderAvatar holder={holder} size={18} />
                {holderName(holder)}
              </button>
            ))}
            <button type="button" role="radio" aria-checked={activeFilter === 'shared'} className="pill" onClick={() => setFilter('shared')}>
              {t('holder.shared')}
            </button>
          </div>
        )}
        <SourceCards
          sources={shown}
          holders={holders}
          filtered={activeFilter !== 'all'}
          editingId={editingId}
          onEdit={setEditingId}
          onIncome={setIncomeId}
          onRemove={(source) => void remove(source)}
          onSave={(source, input) => update(source, input)}
          onCancel={() => setEditingId(null)}
        />

        <div className="card" style={{ marginTop: 'var(--space-4)' }}>
          <div className="card-body">
            <h3 className="card-title">{t('settings.addTitle')}</h3>
            <SourceEditor
              key={createKey}
              holders={holders}
              defaultHolderId={activeFilter !== 'all' && activeFilter !== 'shared' ? activeFilter : undefined}
              submitLabel={t('settings.create')}
              onSave={create}
            />
          </div>
        </div>
      </section>

      <IncomeSection sources={sources} addFor={incomeId} onAddFor={setIncomeId} onChanged={() => void reload()} />

      <SalarySection sources={sources} onChanged={() => void reload()} />
    </>
  );
}

interface SourceEditorProps {
  initial?: PaymentSource;
  holders: SourceHolder[];
  /** For a new source: who it belongs to at first. Defaults to the signed-in person. */
  defaultHolderId?: string;
  submitLabel: string;
  onSave: (input: SourceInput) => Promise<void>;
  onCancel?: () => void;
}

/** Name, type and billing days. The type is fixed once a source exists, because transactions depend on it. */
function SourceEditor({ initial, holders, defaultHolderId, submitLabel, onSave, onCancel }: SourceEditorProps) {
  const { t } = usePrefs();
  const { user } = useAuth();
  // Until the person picks one, a new source belongs to the default holder; the list of people can arrive
  // after the form appears, so the default is worked out on each render.
  const [pickedHolderId, setHolderId] = useState<string | null>(initial ? (initial.holderId ?? '') : null);
  const preferred = defaultHolderId ?? user?.id;
  const holderId = pickedHolderId ?? (holders.some((holder) => holder.userId === preferred) ? preferred! : '');
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
      holderId: holderId || null,
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

      {holders.length > 0 && (
        <div className="tx-field">
          <span className="tx-field-label">{t('holder.label')}</span>
          <Dropdown
            value={holderId}
            options={[
              ...holders.map((holder) => ({ value: holder.userId, label: holderName(holder), icon: <HolderAvatar holder={holder} size={20} /> })),
              { value: '', label: t('holder.sharedOption') },
            ]}
            onChange={setHolderId}
            ariaLabel={t('holder.label')}
          />
          <span className="tx-hint">{t('holder.hint')}</span>
        </div>
      )}

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

interface SourceCardsProps {
  sources: PaymentSource[] | null;
  holders: SourceHolder[];
  /** Whether a holder filter is on, for the empty message. */
  filtered: boolean;
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
function SourceCards({ sources, holders, filtered, editingId, onEdit, onIncome, onRemove, onSave, onCancel }: SourceCardsProps) {
  const { t, money } = usePrefs();
  if (sources === null) return <SkeletonRows count={2} />;
  if (sources.length === 0) {
    return (
      <div className="empty">
        <p>{filtered ? t('holder.empty') : t('settings.empty')}</p>
      </div>
    );
  }
  return (
    <div className="source-grid">
      {sources.map((source) => {
        const holder = holders.find((person) => person.userId === source.holderId);
        return editingId === source.id ? (
          <div key={source.id} className="card source-card source-card-wide">
            <div className="card-body">
              <SourceEditor initial={source} holders={holders} submitLabel={t('form.save')} onSave={(input) => onSave(source, input)} onCancel={onCancel} />
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

              {holders.length > 1 && (
                <span className="source-holder text-sm">
                  {holder ? <HolderAvatar holder={holder} size={20} /> : <Icon name="users" size={14} />}
                  <span className="truncate">{holder ? holderName(holder) : t('holder.shared')}</span>
                </span>
              )}

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
                <button type="button" className="icon-btn icon-btn-sm icon-btn-plain icon-btn-soft" onClick={() => onEdit(source.id)} aria-label={t('cat.edit')} title={t('cat.edit')}>
                  <Icon name="edit" size={15} />
                </button>
                <button type="button" className="icon-btn icon-btn-sm icon-btn-plain icon-btn-soft text-danger" onClick={() => onRemove(source)} aria-label={t('cat.delete')} title={t('cat.delete')}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
