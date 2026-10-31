import { useEffect } from 'react';
import { Link } from 'react-router';
import { useSources } from '../data';
import { usePrefs } from '../prefs';
import { BankBadge } from './BankBadge';
import { Dropdown } from './Dropdown';

/**
 * The savings account a payment is debited from (installment, card bill, loan repayment). Only savings
 * accounts are offered: a credit card or paylater cannot pay by debit. Required unless `optional`, in
 * which case "Not recorded" is offered first. When required, the first account is picked to start with.
 */
export function DebitSourceField({ value, onChange, optional = false }: { value: string; onChange: (value: string) => void; optional?: boolean }) {
  const { t, money } = usePrefs();
  const { sources } = useSources();
  const savings = (sources ?? []).filter((source) => source.kind === 'savings');

  useEffect(() => {
    if (!optional && !value && savings.length > 0) onChange(savings[0].id);
  }, [optional, value, savings.length]);

  const label = optional ? t('pay.fromOptional') : t('pay.from');
  if (sources !== null && savings.length === 0) {
    return (
      <div className="tx-field">
        <span className="tx-field-label">{label}</span>
        <span className="tx-hint">
          <Link to="/sources">{t('pay.noSavings')}</Link>
        </span>
      </div>
    );
  }

  const options = [
    ...(optional ? [{ value: '', label: t('pay.fromNone') }] : []),
    ...savings.map((source) => ({
      value: source.id,
      label: `${source.name} · ${money(source.balance ?? 0)}`,
      icon: <BankBadge bankId={source.bank} size={20} />,
    })),
  ];
  return (
    <div className="tx-field">
      <span className="tx-field-label">{label}</span>
      <Dropdown value={value} options={options} onChange={onChange} ariaLabel={label} />
      <span className="tx-hint">{t('pay.fromHint')}</span>
    </div>
  );
}
