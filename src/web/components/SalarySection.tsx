import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { usePrefs } from '../prefs';
import type { PaymentSource, Salary } from '../../shared/types';
import { BankBadge } from './BankBadge';
import { Dropdown } from './Dropdown';
import { Icon } from './Icon';
import { SkeletonRows } from './Skeleton';

// Recurring income (gaji) on the Sources page: each one is recorded into its savings account on payday, so the
// balance goes up by itself. A pay date on a Saturday or Sunday moves to the Friday before.

interface SalaryInput {
  sourceId: string;
  name: string;
  amount: number;
  payDay: number;
}

export function SalarySection({ sources, onChanged }: { sources: PaymentSource[] | null; onChanged: () => void }) {
  const { t, money, date } = usePrefs();
  const [salaries, setSalaries] = useState<Salary[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const savings = (sources ?? []).filter((source) => source.kind === 'savings');

  useEffect(() => {
    api
      .get<{ salaries: Salary[] }>('/salaries')
      .then((data) => setSalaries(data.salaries))
      .catch(() => setSalaries([]));
  }, []);

  async function save(input: SalaryInput, id?: string) {
    const data = id ? await api.patch<{ salaries: Salary[] }>(`/salaries/${id}`, input) : await api.post<{ salaries: Salary[] }>('/salaries', input);
    setSalaries(data.salaries);
    setEditingId(null);
    setAdding(false);
    window.DS?.toast(t('salary.saved'), { variant: 'success' });
    onChanged();
  }

  async function remove(salary: Salary) {
    if (!window.confirm(t('salary.confirmDelete', { name: salary.name }))) return;
    setError('');
    try {
      await api.delete(`/salaries/${salary.id}`);
      setSalaries((list) => (list ?? []).filter((item) => item.id !== salary.id));
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    }
  }

  return (
    <section className="settings-section" aria-labelledby="salary-title">
      <div className="section-head">
        <div>
          <h3 id="salary-title" className="section-heading">
            {t('salary.title')}
          </h3>
          <p className="hint">{t('salary.hint')}</p>
        </div>
        {!adding && savings.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} />
            {t('salary.add')}
          </button>
        )}
      </div>

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="card">
        {salaries === null ? (
          <SkeletonRows count={1} />
        ) : (
          <>
            {salaries.length === 0 && !adding && (
              <div className="empty">
                <p>{savings.length > 0 ? t('salary.empty') : t('pay.noSavings')}</p>
              </div>
            )}
            {salaries.map((salary) =>
              editingId === salary.id ? (
                <div key={salary.id} className="card-body">
                  <SalaryEditor initial={salary} savings={savings} onSave={(input) => save(input, salary.id)} onCancel={() => setEditingId(null)} />
                </div>
              ) : (
                <div key={salary.id} className="list-row salary-row">
                  <span className="salary-row-badge">
                    <BankBadge bankId={savings.find((source) => source.id === salary.sourceId)?.bank} size={32} />
                  </span>
                  <div className="source-main grow salary-row-main">
                    <span className="source-name">{salary.name}</span>
                    <span className="source-meta">
                      {t('salary.line', { name: salary.sourceName, day: salary.payDay })} · {t('salary.next', { date: date(salary.nextPayDate) })}
                    </span>
                  </div>
                  <span className="amount text-success salary-row-amount">+{money(salary.amount)}</span>
                  <div className="row-actions salary-row-actions">
                    <button type="button" className="icon-btn icon-btn-sm icon-btn-plain icon-btn-soft" onClick={() => setEditingId(salary.id)} aria-label={t('cat.edit')} title={t('cat.edit')}>
                      <Icon name="edit" size={15} />
                    </button>
                    <button type="button" className="icon-btn icon-btn-sm icon-btn-plain icon-btn-soft text-danger" onClick={() => void remove(salary)} aria-label={t('cat.delete')} title={t('cat.delete')}>
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </div>
              ),
            )}
            {adding && (
              <div className="card-body">
                <SalaryEditor savings={savings} onSave={(input) => save(input)} onCancel={() => setAdding(false)} />
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function SalaryEditor({ initial, savings, onSave, onCancel }: { initial?: Salary; savings: PaymentSource[]; onSave: (input: SalaryInput) => Promise<void>; onCancel: () => void }) {
  const { t, money } = usePrefs();
  const [name, setName] = useState(initial?.name ?? t('salary.defaultName'));
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [sourceId, setSourceId] = useState(initial?.sourceId ?? savings[0]?.id ?? '');
  const [payDay, setPayDay] = useState(initial ? String(initial.payDay) : '25');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const day = Number(payDay);
  const valid = name.trim() && Number(amount) > 0 && sourceId && Number.isInteger(day) && day >= 1 && day <= 31;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSave({ sourceId, name: name.trim(), amount: Number(amount), payDay: day });
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack-lg" onSubmit={(event) => void submit(event)} noValidate>
      <label className="tx-field">
        <span className="tx-field-label">{t('salary.name')}</span>
        <input className="input" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label className="tx-field">
        <span className="tx-field-label">{t('salary.amount')}</span>
        <input className="input" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, '').slice(0, 13))} required />
        {amount && <span className="tx-hint">{money(Number(amount))}</span>}
      </label>
      <div className="tx-field">
        <span className="tx-field-label">{t('salary.account')}</span>
        <Dropdown
          value={sourceId}
          options={savings.map((source) => ({ value: source.id, label: `${source.name} · ${money(source.balance ?? 0)}`, icon: <BankBadge bankId={source.bank} size={20} /> }))}
          onChange={setSourceId}
          ariaLabel={t('salary.account')}
        />
      </div>
      <label className="tx-field">
        <span className="tx-field-label">{t('salary.payDay')}</span>
        <input type="number" inputMode="numeric" min={1} max={31} className="input" value={payDay} onChange={(event) => setPayDay(event.target.value)} required />
        <span className="tx-hint">{t('salary.payDayHint')}</span>
      </label>

      {!initial && <p className="tx-hint">{t('salary.startHint')}</p>}
      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary btn-lg" disabled={saving || !valid}>
          {saving ? t('form.saving') : t('form.save')}
        </button>
      </div>
    </form>
  );
}
