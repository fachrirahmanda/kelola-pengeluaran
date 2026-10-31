import { useState } from 'react';
import { DebtForm } from '../pages/LoansPage';
import { useCategories, useSources } from '../data';
import type { MessageKey } from '../i18n';
import { usePrefs } from '../prefs';
import { IncomeForm } from './IncomeSection';
import { SidePanel, usePhone } from './SidePanel';
import { SkeletonForm } from './Skeleton';
import { TransactionForm } from './TransactionForm';

// The Add form: one panel with a tab for each thing that can be added. Each tab is the same form as on the page
// that owns those records, so saving works the same from here. It is the side panel on desktop and a popup on phones.
// Installments and loans share one tab (see DebtForm).

export type AddKind = 'expense' | 'income' | 'transfer' | 'debt';

const KINDS: { value: AddKind; label: MessageKey }[] = [
  { value: 'expense', label: 'add.expense' },
  { value: 'income', label: 'add.income' },
  { value: 'transfer', label: 'add.transfer' },
  { value: 'debt', label: 'add.debt' },
];

export function AddPanel({ open, onClose, kind, onKindChange, onSaved }: { open: boolean; onClose: () => void; kind: AddKind; onKindChange: (kind: AddKind) => void; onSaved: () => void }) {
  const { t, money } = usePrefs();
  // On phones the panel is a popup, so it has a Cancel; on desktop it is always there.
  const phone = usePhone();
  const { categories } = useCategories();
  const { sources, holders } = useSources();
  const [error, setError] = useState('');
  const savings = (sources ?? []).filter((source) => source.kind === 'savings');

  function choose(next: AddKind) {
    setError('');
    onKindChange(next);
  }

  return (
    <SidePanel open={open} onClose={onClose} title={t('add.title')}>
      <div className="tabs add-tabs" role="tablist" aria-label={t('add.title')}>
        {KINDS.map((item) => (
          <button key={item.value} type="button" role="tab" className="tab" aria-selected={kind === item.value} onClick={() => choose(item.value)}>
            {t(item.label)}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      {kind === 'expense' &&
        (categories && sources ? (
          <TransactionForm
            categories={categories}
            sources={sources}
            holders={holders}
            submitLabel={t('form.save')}
            onSaved={(transaction) => {
              window.DS?.toast(t('catat.saved', { amount: money(transaction.amount) }), { variant: 'success' });
              onSaved();
            }}
          />
        ) : (
          <SkeletonForm />
        ))}

      {kind === 'income' &&
        (sources === null ? (
          <SkeletonForm />
        ) : savings.length === 0 ? (
          <p className="hint">{t('pay.noSavings')}</p>
        ) : (
          <IncomeForm savings={savings} initialSourceId={savings[0].id} onDone={onSaved} onCancel={phone ? onClose : undefined} />
        ))}

      {kind === 'transfer' &&
        (categories && sources ? (
          <TransactionForm
            transferOnly
            categories={categories}
            sources={sources}
            holders={holders}
            submitLabel={t('form.save')}
            onSaved={(transaction) => {
              window.DS?.toast(t('transfer.saved', { amount: money(transaction.amount) }), { variant: 'success' });
              onSaved();
            }}
          />
        ) : (
          <SkeletonForm />
        ))}

      {kind === 'debt' && <DebtForm onSaved={onSaved} onError={setError} />}
    </SidePanel>
  );
}
