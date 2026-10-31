import { useState, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiRequestError } from '../api';
import { BankBadge } from '../components/BankBadge';
import { Dropdown } from '../components/Dropdown';
import { Icon } from '../components/Icon';
import { SidePanel, usePhone } from '../components/SidePanel';
import { SalarySection } from '../components/SalarySection';
import { SkeletonRows } from '../components/Skeleton';
import { useAuth } from '../auth';
import { useBills, useSources } from '../data';
import { todayInWib } from '../format';
import { initialsOf } from '../components/Notifications';
import { bankKinds, type Bank } from '../../shared/banks';
import { useBankList } from '../banks';
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
  billingDay: number | null;
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
  const { bills } = useBills();
  // A card's bill state: unpaid once its billing date has come and it is still open (with its due date), paid
  // when its last bill was paid. Cards with no bill yet have none.
  const today = todayInWib();
  const billStates = new Map<string, BillState>();
  for (const bill of bills?.paid ?? []) billStates.set(bill.sourceId, { status: 'paid' });
  for (const bill of bills?.open ?? []) {
    if (bill.billingOn > today) continue;
    const earliest = billStates.get(bill.sourceId);
    const dueOn = earliest?.status === 'unpaid' && earliest.dueOn < bill.dueOn ? earliest.dueOn : bill.dueOn;
    billStates.set(bill.sourceId, { status: 'unpaid', dueOn });
  }
  const [filter, setFilter] = useState<HolderFilter>('all');
  // A filter for someone who is no longer in the data set falls back to everyone.
  const activeFilter = filter === 'all' || filter === 'shared' || holders.some((holder) => holder.userId === filter) ? filter : 'all';
  const shown =
    sources === null || activeFilter === 'all'
      ? sources
      : sources.filter((source) => (activeFilter === 'shared' ? !source.holderId : source.holderId === activeFilter));
  // Add and edit open one side panel (New transaction's pattern): the popup on phones, the column on the right on desktop.
  const phone = usePhone();
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentSource | null>(null);
  const [createKey, setCreateKey] = useState(0);
  const [error, setError] = useState('');

  function openAdd() {
    setEditing(null);
    setPanelOpen(true);
  }

  function openEdit(source: PaymentSource) {
    setEditing(source);
    setPanelOpen(true);
  }

  // Closing returns the panel to Add, so the next open (and the desktop column) shows the add form again.
  function closePanel() {
    setPanelOpen(false);
    setEditing(null);
  }

  async function create(input: SourceInput) {
    await api.post('/sources', input);
    window.DS?.toast(t('settings.added', { name: input.name }), { variant: 'success' });
    setCreateKey((key) => key + 1);
    closePanel();
    await reload();
  }

  async function update(source: PaymentSource, input: SourceInput) {
    await api.patch(`/sources/${source.id}`, {
      name: input.name,
      billingDay: input.billingDay,
      paymentDay: input.paymentDay,
      openingBalance: input.openingBalance,
      creditLimit: input.creditLimit,
      bank: input.bank,
      holderId: input.holderId,
    });
    closePanel();
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
        {phone && (
          <button type="button" className="btn btn-primary" onClick={openAdd}>
            <Icon name="plus" size={16} />
            {t('settings.create')}
          </button>
        )}
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
        <SourceCards sources={shown} holders={holders} filtered={activeFilter !== 'all'} billStates={billStates} onEdit={openEdit} onRemove={(source) => void remove(source)} />
      </section>

      <SidePanel open={panelOpen} onClose={closePanel} title={editing ? t('cat.edit') : t('settings.addTitle')}>
        {editing ? (
          <SourceEditor key={editing.id} initial={editing} holders={holders} submitLabel={t('form.save')} onSave={(input) => update(editing, input)} onCancel={closePanel} />
        ) : (
          <SourceEditor
            key={createKey}
            holders={holders}
            defaultHolderId={activeFilter !== 'all' && activeFilter !== 'shared' ? activeFilter : undefined}
            submitLabel={t('settings.create')}
            onSave={create}
            onCancel={phone ? closePanel : undefined}
          />
        )}
      </SidePanel>


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
  const [billingDay, setBillingDay] = useState(initial?.billingDay ? String(initial.billingDay) : '');
  const [paymentDay, setPaymentDay] = useState(initial?.paymentDay ? String(initial.paymentDay) : '');
  const [openingBalance, setOpeningBalance] = useState(initial?.openingBalance ? String(initial.openingBalance) : '');
  const [creditLimit, setCreditLimit] = useState(initial?.creditLimit ? String(initial.creditLimit) : '');
  const [bank, setBank] = useState(initial?.bank ?? '');
  const { banks } = useBankList();
  // A bank holds only some kinds of source: the kinds it does not hold are not offered.
  const selectedBank = banks.find((item) => item.id === bank);
  const allowedKinds: readonly SourceKind[] = selectedBank ? bankKinds(selectedBank) : SOURCE_KINDS;
  function chooseBank(id: string) {
    setBank(id);
    const next = banks.find((item) => item.id === id);
    if (next && !bankKinds(next).includes(kind)) setKind(bankKinds(next)[0]);
  }
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
      billingDay: billed ? Number(billingDay) : null,
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
          {SOURCE_KINDS.filter((option) => !!initial || allowedKinds.includes(option)).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={kind === option}
              className="pill"
              disabled={!!initial}
              onClick={() => {
                setKind(option);
                if (selectedBank && !bankKinds(selectedBank).includes(option)) setBank('');
              }}
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
          options={[{ value: '', label: t('settings.noBank') }, ...banks.filter((option) => bankKinds(option).includes(kind)).map((option) => ({ value: option.id, label: option.name, icon: <BankBadge bankId={option.id} size={22} /> }))]}
          onChange={chooseBank}
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
            <span className="tx-field-label">{t('settings.billingDay')}</span>
            <input
              type="number"
              inputMode="numeric"
              min={3}
              max={28}
              className="input"
              value={billingDay}
              onChange={(event) => setBillingDay(event.target.value)}
              required
            />
            <span className="tx-hint">{t('settings.billingHint')}</span>
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
  /** Each card's bill state (see billStates on the page). */
  billStates: Map<string, BillState>;
  onEdit: (source: PaymentSource) => void;
  onRemove: (source: PaymentSource) => void;
}

/** The bank colours the card face: a wallet card in the bank's colour, a neutral one for cash. */
function cardColours(bank: Bank | undefined): CSSProperties {
  return { '--bank-color': bank?.color ?? '#3f3f46', '--bank-text': bank?.textColor ?? '#ffffff' } as CSSProperties;
}

/** The sources as cards: the bank badge, the balance or the limit, and the actions. One card opens for editing. */
/** A card's bill: paid, or unpaid with the date it is due. */
type BillState = { status: 'paid' } | { status: 'unpaid'; dueOn: string };

function SourceCards({ sources, holders, filtered, billStates, onEdit, onRemove }: SourceCardsProps) {
  const { t, money, date } = usePrefs();
  const { banks } = useBankList();
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
        const state = billStates.get(source.id);
        // The card's one figure: the balance, what is left of a credit limit, or what is owed.
        const figure = source.kind === 'savings' ? (source.balance ?? 0) : source.creditLimit ? source.creditLimit - (source.owed ?? 0) : (source.owed ?? 0);
        const label = source.kind === 'savings' ? t('settings.balanceLabel') : source.creditLimit ? t('settings.availableLabel') : t('settings.unpaidLabel');
        return (
          <div key={source.id} className="source-slot">
          <article className="card source-card" style={cardColours(banks.find((item) => item.id === source.bank))}>
            <div className="card-body">
              <div className="source-card-head">
                <BankBadge bankId={source.bank} />
                <strong className="grow truncate source-card-name">{source.name}</strong>
                <span className="source-card-kind">{t(KIND_KEYS[source.kind])}</span>
              </div>

              <div className="source-card-amount">
                <span className="source-card-label">
                  <span className="text-sm text-muted">{label}</span>
                  {state && <span className={`badge ${state.status === 'unpaid' ? 'badge-warning' : 'badge-success'}`}>{t(state.status === 'unpaid' ? 'settings.billUnpaid' : 'settings.billPaid')}</span>}
                </span>
                <strong className="source-amount">{money(figure)}</strong>
                {source.kind !== 'savings' && source.creditLimit ? <span className="text-sm text-muted">{`${t('settings.creditLimit')}: ${money(source.creditLimit)}`}</span> : null}
              </div>

              <div className="source-actions">
                {holders.length > 1 &&
                  (holder ? (
                    <span className="source-card-holder" title={holderName(holder)}>
                      <HolderAvatar holder={holder} size={24} />
                    </span>
                  ) : (
                    <span className="source-card-holder" title={t('holder.shared')}>
                      <span className="ws-avatar holder-avatar" style={{ width: 24, height: 24 }} aria-hidden="true">
                        <Icon name="users" size={13} />
                      </span>
                    </span>
                  ))}
                {state?.status === 'unpaid' && (
                  <Link to={`/bills?source=${source.id}`} className="source-card-bills">
                    {t('settings.viewBills')}
                  </Link>
                )}
                <button type="button" className="icon-btn icon-btn-sm icon-btn-plain icon-btn-soft" onClick={() => onEdit(source)} aria-label={t('cat.edit')} title={t('cat.edit')}>
                  <Icon name="edit" size={15} />
                </button>
                <button type="button" className="icon-btn icon-btn-sm icon-btn-plain icon-btn-soft text-danger" onClick={() => onRemove(source)} aria-label={t('cat.delete')} title={t('cat.delete')}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </div>
          </article>
          {state?.status === 'unpaid' && (
            <p className="source-due-warning" role="status">
              {t('settings.dueWarning', { date: date(state.dueOn) })}
            </p>
          )}
          </div>
        );
      })}
    </div>
  );
}
