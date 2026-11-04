import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiRequestError } from '../api';
import { DatePicker } from '../components/DatePicker';
import { DebitSourceField } from '../components/DebitSourceField';
import { Dropdown } from '../components/Dropdown';
import { Icon } from '../components/Icon';
import { SkeletonRows } from '../components/Skeleton';
import { useAuth } from '../auth';
import { useCategories, useSources, useWorkspace } from '../data';
import { todayInWib } from '../format';
import { usePrefs } from '../prefs';
import { splitShares, type SplitItem } from '../../shared/splitbill';

// Split bill: the list of bills, and the editor for one. A photo of the invoice fills the items as a starting list;
// each item is shared with the people chosen for it. Tax and service start at 0 and are shared out in proportion to
// what each person ordered. People who are registered accounts (you, or a member) can be recorded as expenses.

const MAX_SIDE = 1600;
const NAME_MAX = 60;
const PERSON_MAX = 30;
const MAX_PEOPLE = 20;

interface SplitBillRow {
  id: string;
  name: string;
  date: string;
  people: number;
  recorded: boolean;
  total: number;
}

interface PersonDraft {
  name: string;
  userId: string | null;
}

/** A photo, scaled down and sent as JPEG so the upload stays small. */
async function shrinkImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Split bills: the history, and an editor for one bill (or a new one). */
export function SplitBillPage() {
  const { id } = useParams();
  if (id) return <SplitBillEditor key={id} id={id} />;
  return <SplitBillList />;
}

function SplitBillList() {
  const { t, money, date } = usePrefs();
  const [bills, setBills] = useState<SplitBillRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<{ bills: SplitBillRow[] }>('/split-bills')
      .then((data) => setBills(data.bills))
      .catch((requestError: unknown) => setError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network')));
  }, []);

  return (
    <>
      <div className="page-header">
        <div>
          <h2>{t('split.title')}</h2>
          <p className="hint">{t('split.subtitle')}</p>
        </div>
        <Link to="/split/new" className="btn btn-primary">
          <Icon name="plus" size={16} />
          {t('split.new')}
        </Link>
      </div>

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      {bills === null ? (
        <div className="card">
          <SkeletonRows count={3} />
        </div>
      ) : bills.length === 0 ? (
        <div className="card">
          <div className="empty">
            <p>{t('split.none')}</p>
          </div>
        </div>
      ) : (
        <div className="card">
          {bills.map((bill) => (
            <Link key={bill.id} to={`/split/${bill.id}`} className="list-row">
              <div className="source-main">
                <span className="source-name">{bill.name}</span>
                <span className="source-meta">
                  {date(bill.date)} · {t('split.people', { count: bill.people })}
                  {bill.recorded && ` · ${t('split.recordedBadge')}`}
                </span>
              </div>
              <span className="amount">{money(bill.total)}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

interface DraftItem {
  name: string;
  amount: string;
  people: number[];
}

interface Draft {
  name: string;
  date: string;
  tax: string;
  service: string;
  people: PersonDraft[];
  items: DraftItem[];
}

const BLANK: Draft = { name: '', date: todayInWib(), tax: '0', service: '0', people: [], items: [] };

const digitsOf = (value: string) => value.replace(/\D/g, '').slice(0, 13);

/** The editor for one bill. `id` is "new" for a bill not saved yet. */
function SplitBillEditor({ id }: { id: string }) {
  const { t, money, date, categoryName } = usePrefs();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { state: workspace } = useWorkspace();
  const { categories } = useCategories();
  const { sources } = useSources();
  const isNew = id === 'new';
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [recorded, setRecorded] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [personName, setPersonName] = useState('');
  const [error, setError] = useState('');
  // Recording to transactions.
  const [recordDate, setRecordDate] = useState(todayInWib());
  const [recordCategory, setRecordCategory] = useState('');
  const [recordMethod, setRecordMethod] = useState<'debit' | 'credit'>('debit');
  const [recordSource, setRecordSource] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordNote, setRecordNote] = useState('');

  function loadBill() {
    api
      .get<{ bill: { name: string; date: string; tax: number; service: number; recorded: boolean; people: PersonDraft[]; items: { name: string; amount: number; people: number[] }[] } }>(`/split-bills/${id}`)
      .then((data) => {
        const bill = data.bill;
        setDraft({
          name: bill.name,
          date: bill.date,
          tax: String(bill.tax),
          service: String(bill.service),
          people: bill.people.map((person) => ({ name: person.name, userId: person.userId })),
          items: bill.items.map((item) => ({ name: item.name, amount: String(item.amount), people: item.people })),
        });
        setRecorded(bill.recorded);
        setLoading(false);
      })
      .catch(() => {
        setNotFound(true);
        setLoading(false);
      });
  }

  useEffect(() => {
    if (!isNew) loadBill();
  }, [id, isNew]);

  // The accounts that can be added to a bill: you, and the members of the data set who are not on it yet.
  const linkable: { userId: string; name: string }[] = [];
  if (user) linkable.push({ userId: user.id, name: user.name || t('split.you') });
  // A member is not in the members list (only the owner sees that), so the owner is added from the workspace itself.
  if (workspace?.workspace.role === 'member') linkable.push({ userId: workspace.workspace.ownerId, name: workspace.workspace.ownerName || workspace.workspace.ownerEmail });
  for (const member of workspace?.workspace.members ?? []) {
    if (!linkable.some((entry) => entry.userId === member.userId)) linkable.push({ userId: member.userId, name: member.name || member.email });
  }
  const addable = linkable.filter((entry) => !draft.people.some((person) => person.userId === entry.userId));

  const itemsForShares: SplitItem[] = draft.items.map((item) => ({ name: item.name, amount: Number(item.amount) || 0, people: item.people }));
  const { shares, unassigned } = splitShares(draft.people.length, itemsForShares, Number(draft.tax) || 0, Number(draft.service) || 0);
  const itemsTotal = itemsForShares.reduce((sum, item) => sum + item.amount, 0);
  const grandTotal = itemsTotal + (Number(draft.tax) || 0) + (Number(draft.service) || 0);
  // People who can be recorded: registered accounts with something to pay, not yet recorded.
  const recordable = draft.people.filter((person, index) => person.userId && shares[index].total > 0).length;
  const locked = recorded;

  function update(changes: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...changes }));
  }

  function updateItem(index: number, changes: Partial<DraftItem>) {
    setDraft((current) => ({ ...current, items: current.items.map((item, position) => (position === index ? { ...item, ...changes } : item)) }));
  }

  function addPerson(person: PersonDraft) {
    if (draft.people.length >= MAX_PEOPLE) return;
    update({ people: [...draft.people, person] });
  }

  function addTypedPerson() {
    const name = personName.trim().slice(0, PERSON_MAX);
    if (!name) return;
    addPerson({ name, userId: null });
    setPersonName('');
  }

  // Removing a person also takes them out of every item, and moves the people after them up one place.
  function removePerson(index: number) {
    setDraft((current) => ({
      ...current,
      people: current.people.filter((_, position) => position !== index),
      items: current.items.map((item) => ({
        ...item,
        people: item.people.filter((person) => person !== index).map((person) => (person > index ? person - 1 : person)),
      })),
    }));
  }

  function togglePerson(itemIndex: number, person: number) {
    const item = draft.items[itemIndex];
    const people = item.people.includes(person) ? item.people.filter((value) => value !== person) : [...item.people, person];
    updateItem(itemIndex, { people });
  }

  function toggleEveryone(itemIndex: number) {
    const everyone = draft.people.map((_, index) => index);
    const item = draft.items[itemIndex];
    updateItem(itemIndex, { people: item.people.length === everyone.length ? [] : everyone });
  }

  function removeItem(index: number) {
    setDraft((current) => ({ ...current, items: current.items.filter((_, position) => position !== index) }));
  }

  async function scan(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setScanning(true);
    setError('');
    try {
      const image = await shrinkImage(file);
      const result = await api.post<{ items: { name: string; amount: number }[]; tax: number; service: number }>('/split-bills/scan', { image });
      setDraft((current) => ({
        ...current,
        items: [...current.items, ...result.items.map((item) => ({ name: item.name, amount: String(item.amount), people: [] }))],
        tax: current.tax === '0' && result.tax > 0 ? String(result.tax) : current.tax,
        service: current.service === '0' && result.service > 0 ? String(result.service) : current.service,
      }));
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('split.scanError'));
    } finally {
      setScanning(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!draft.name.trim()) return setError(t('split.needName'));
    if (draft.people.length === 0) return setError(t('split.needPeople'));
    if (draft.items.length === 0) return setError(t('split.needItems'));
    const payload = {
      name: draft.name.trim().slice(0, NAME_MAX),
      date: draft.date,
      tax: Number(draft.tax) || 0,
      service: Number(draft.service) || 0,
      people: draft.people,
      items: draft.items.map((item) => ({ name: item.name.trim() || 'Item', amount: Number(item.amount) || 0, people: item.people })),
    };
    setSaving(true);
    try {
      if (isNew) {
        const created = await api.post<{ id: string }>('/split-bills', payload);
        window.DS?.toast(t('split.saved'), { variant: 'success' });
        navigate(`/split/${created.id}`, { replace: true });
      } else {
        await api.put(`/split-bills/${id}`, payload);
        window.DS?.toast(t('split.saved'), { variant: 'success' });
      }
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`${t('split.confirmDelete', { name: draft.name })}\n${t('split.keepsRecords')}`)) return;
    try {
      await api.delete(`/split-bills/${id}`);
      window.DS?.toast(t('split.deleted'));
      navigate('/split');
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    }
  }

  async function unrecord() {
    if (!window.confirm(t('split.unrecordConfirm'))) return;
    setRecordNote('');
    try {
      await api.delete(`/split-bills/${id}/record`);
      window.DS?.toast(t('split.unrecordedToast'));
      loadBill();
    } catch (requestError) {
      setRecordNote(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    }
  }

  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRecordNote('');
    if (!recordCategory) return setRecordNote(t('split.needCategory'));
    setRecording(true);
    try {
      const result = await api.post<{ recorded: number }>(`/split-bills/${id}/record`, {
        date: recordDate,
        categoryId: recordCategory,
        method: recordMethod,
        sourceId: recordSource || null,
      });
      window.DS?.toast(t('split.recordedToast', { count: result.recorded }), { variant: 'success' });
      loadBill();
    } catch (requestError) {
      setRecordNote(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    } finally {
      setRecording(false);
    }
  }

  const back = (
    <Link to="/split" className="text-sm text-muted tx-back">
      ‹ {t('split.back')}
    </Link>
  );

  if (loading) {
    return (
      <div className="card">
        <SkeletonRows count={3} />
      </div>
    );
  }
  if (notFound) {
    return (
      <>
        <div className="page-header">
          <div>{back}</div>
        </div>
        <div className="card">
          <div className="empty">
            <p>{t('split.notFound')}</p>
          </div>
        </div>
      </>
    );
  }

  const categoryOptions = (categories ?? []).map((category) => ({ value: category.id, label: `${category.icon} ${categoryName(category.name)}` }));
  const creditSources = (sources ?? []).filter((source) => source.kind === 'credit_card' || source.kind === 'paylater');

  return (
    <>
      <form onSubmit={(event) => void save(event)} noValidate>
        <div className="page-header">
          <div>
            {back}
            <h2>{isNew ? t('split.new') : draft.name}</h2>
            {!isNew && <p className="hint">{date(draft.date)}</p>}
          </div>
        </div>

        {locked && (
          <p className="text-sm text-muted" role="status">
            {t('split.lockedNote')}
          </p>
        )}

        {error && (
          <p className="text-danger" role="alert">
            {error}
          </p>
        )}

        <div className="card">
          <div className="card-body stack">
            <label className="tx-field scan-field">
              <span className="tx-field-label">{t('split.scan')}</span>
              <span className="btn">
                <Icon name="image" size={16} />
                {scanning ? t('split.scanning') : t('split.scanPick')}
                <input type="file" accept="image/*" capture="environment" onChange={(event) => void scan(event)} disabled={scanning || locked} hidden />
              </span>
              <span className="tx-hint">{t('split.scanHint')}</span>
            </label>

            <label className="tx-field">
              <span className="tx-field-label">{t('split.name')}</span>
              <input type="text" className="input" value={draft.name} maxLength={NAME_MAX} disabled={locked} onChange={(event) => update({ name: event.target.value })} />
            </label>

            <div className="tx-field">
              <span className="tx-field-label">{t('split.date')}</span>
              <DatePicker value={draft.date} onChange={(value) => update({ date: value ?? draft.date })} ariaLabel={t('split.date')} />
            </div>

            <div className="tx-field">
              <span className="tx-field-label">{t('split.people')}</span>
              <div className="chip-row">
                {draft.people.map((person, index) => (
                  <span key={`${person.name}-${index}`} className="pill">
                    {person.name}
                    {person.userId && <span className="text-muted"> · {t('split.account')}</span>}
                    {!locked && (
                      <button type="button" className="icon-btn icon-btn-sm icon-btn-plain" onClick={() => removePerson(index)} aria-label={t('split.removePerson', { name: person.name })}>
                        <Icon name="x" size={12} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {!locked && addable.length > 0 && (
                <div className="chip-row" role="group" aria-label={t('split.addAccount')}>
                  {addable.map((entry) => (
                    <button key={entry.userId} type="button" className="pill" onClick={() => addPerson({ name: entry.name, userId: entry.userId })}>
                      + {entry.name}
                    </button>
                  ))}
                </div>
              )}
              {!locked && (
                <div className="row-actions">
                  <input
                    type="text"
                    className="input grow"
                    value={personName}
                    maxLength={PERSON_MAX}
                    placeholder={t('split.personPlaceholder')}
                    onChange={(event) => setPersonName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addTypedPerson();
                      }
                    }}
                  />
                  <button type="button" className="btn" onClick={addTypedPerson} disabled={!personName.trim()}>
                    {t('split.addPerson')}
                  </button>
                </div>
              )}
            </div>

            <div className="tx-field-row">
              <label className="tx-field">
                <span className="tx-field-label">{t('split.tax')}</span>
                <input type="text" inputMode="numeric" className="input" value={draft.tax} disabled={locked} onChange={(event) => update({ tax: digitsOf(event.target.value) || '0' })} />
              </label>
              <label className="tx-field">
                <span className="tx-field-label">{t('split.service')}</span>
                <input type="text" inputMode="numeric" className="input" value={draft.service} disabled={locked} onChange={(event) => update({ service: digitsOf(event.target.value) || '0' })} />
              </label>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body stack">
            <h4 className="section-heading">{t('split.items')}</h4>
            {draft.items.length === 0 && <p className="text-sm text-muted">{t('split.noItems')}</p>}
            {draft.items.map((item, index) => (
              <div key={index} className="split-item">
                <div className="row-actions">
                  <input type="text" className="input grow" value={item.name} placeholder={t('split.itemName')} disabled={locked} onChange={(event) => updateItem(index, { name: event.target.value })} />
                  <input
                    type="text"
                    inputMode="numeric"
                    className="input split-item-amount"
                    value={item.amount}
                    placeholder={t('split.itemAmount')}
                    disabled={locked}
                    onChange={(event) => updateItem(index, { amount: digitsOf(event.target.value) })}
                  />
                  {!locked && (
                    <button type="button" className="icon-btn icon-btn-sm icon-btn-plain icon-btn-soft text-danger" onClick={() => removeItem(index)} aria-label={t('tx.delete')}>
                      <Icon name="trash" size={15} />
                    </button>
                  )}
                </div>
                <div className="chip-row" role="group" aria-label={t('split.assignTo')}>
                  <button type="button" className="pill" aria-pressed={draft.people.length > 0 && item.people.length === draft.people.length} disabled={locked} onClick={() => toggleEveryone(index)}>
                    {t('split.everyone')}
                  </button>
                  {draft.people.map((person, personIndex) => (
                    <button
                      key={`${person.name}-${personIndex}`}
                      type="button"
                      className="pill"
                      aria-pressed={item.people.includes(personIndex)}
                      disabled={locked}
                      onClick={() => togglePerson(index, personIndex)}
                    >
                      {person.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!locked && (
              <div>
                <button type="button" className="btn" onClick={() => update({ items: [...draft.items, { name: '', amount: '', people: [] }] })}>
                  <Icon name="plus" size={16} />
                  {t('split.addItem')}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-body stack">
            <h4 className="section-heading">{t('split.summary')}</h4>
            {draft.people.length === 0 ? (
              <p className="text-sm text-muted">{t('split.needPeople')}</p>
            ) : (
              shares.map((share, index) => (
                <div key={index} className="list-row">
                  <span>{draft.people[index].name}</span>
                  <span className="split-share">
                    <strong>{money(share.total)}</strong>
                    <span className="text-sm text-muted">{t('split.shareLine', { items: money(share.subtotal), tax: money(share.tax), service: money(share.service) })}</span>
                  </span>
                </div>
              ))
            )}
            {unassigned > 0 && <p className="text-sm text-danger">{t('split.unassigned', { amount: money(unassigned) })}</p>}
            <div className="list-row">
              <span className="text-muted">{t('split.total')}</span>
              <strong>{money(grandTotal)}</strong>
            </div>
          </div>
        </div>

        <div className="tx-detail-actions">
          {!isNew && !locked && (
            <button type="button" className="btn btn-danger-soft" onClick={() => void remove()}>
              {t('split.delete')}
            </button>
          )}
          {!locked && (
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t('form.saving') : t('split.save')}
            </button>
          )}
        </div>
      </form>

      {!isNew && (
        <div className="card split-record">
          <div className="card-body stack">
            <h4 className="section-heading">{t('split.recordTitle')}</h4>
            {locked && (
              <>
                <p className="text-sm text-muted">{t('split.recordedNote')}</p>
                <button type="button" className="btn btn-danger-soft" onClick={() => void unrecord()}>
                  {t('split.unrecord')}
                </button>
                {recordNote && (
                  <p className="text-danger" role="alert">
                    {recordNote}
                  </p>
                )}
              </>
            )}
            {!locked && recordable === 0 && <p className="text-sm text-muted">{t('split.recordNone')}</p>}
            {!locked && recordable > 0 && (
              <form className="stack" onSubmit={(event) => void record(event)} noValidate>
                <p className="text-sm text-muted">{t('split.recordHint', { count: recordable })}</p>
                <div className="tx-field">
                  <span className="tx-field-label">{t('split.recordDate')}</span>
                  <DatePicker value={recordDate} onChange={(value) => setRecordDate(value ?? recordDate)} ariaLabel={t('split.recordDate')} />
                </div>
                <div className="tx-field">
                  <span className="tx-field-label">{t('tx.category')}</span>
                  <Dropdown value={recordCategory} options={[{ value: '', label: t('split.chooseCategory') }, ...categoryOptions]} onChange={setRecordCategory} ariaLabel={t('tx.category')} />
                </div>
                <div className="tx-field">
                  <span className="tx-field-label">{t('form.method')}</span>
                  <div className="chip-row" role="radiogroup" aria-label={t('form.method')}>
                    <button type="button" role="radio" aria-checked={recordMethod === 'debit'} className="pill" onClick={() => setRecordMethod('debit')}>
                      {t('rec.method.debit')}
                    </button>
                    <button type="button" role="radio" aria-checked={recordMethod === 'credit'} className="pill" onClick={() => setRecordMethod('credit')}>
                      {t('split.creditCard')}
                    </button>
                  </div>
                </div>
                {recordMethod === 'debit' ? (
                  <DebitSourceField value={recordSource} onChange={setRecordSource} />
                ) : (
                  <div className="tx-field">
                    <span className="tx-field-label">{t('split.cardSource')}</span>
                    <Dropdown
                      value={recordSource}
                      options={[{ value: '', label: t('split.chooseCard') }, ...creditSources.map((source) => ({ value: source.id, label: source.name }))]}
                      onChange={setRecordSource}
                      ariaLabel={t('split.cardSource')}
                    />
                  </div>
                )}
                {recordNote && (
                  <p className="text-danger" role="alert">
                    {recordNote}
                  </p>
                )}
                <button type="submit" className="btn btn-primary" disabled={recording}>
                  {recording ? t('form.saving') : t('split.recordButton')}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
