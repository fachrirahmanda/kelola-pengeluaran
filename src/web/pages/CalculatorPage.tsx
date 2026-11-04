import { useState } from 'react';
import { Link } from 'react-router';
import { usePrefs } from '../prefs';
import { annuityMonthly, flatMonthly, goalMonthly } from '../../shared/calculator';

type Mode = 'loan' | 'goal';
type Method = 'annuity' | 'flat';

const MAX_MONTHS = 600;

/** Digits only, for an amount in rupiah. */
const digitsOf = (value: string) => value.replace(/\D/g, '').slice(0, 13);
/** A percentage, typed with a comma or a dot. */
const percentOf = (value: string) => (value.trim() === '' ? NaN : Number(value.replace(',', '.')));
const percentInput = (value: string) => value.replace(/[^\d.,]/g, '').slice(0, 6);

/**
 * Fields for an installment (what it costs, after an optional down payment) or a savings goal (what to put in each
 * month), and the result.
 */
export function CalculatorPage() {
  const { t, money } = usePrefs();
  const [mode, setMode] = useState<Mode>('loan');
  const [method, setMethod] = useState<Method>('annuity');
  const [amount, setAmount] = useState('');
  const [down, setDown] = useState('');
  const [rate, setRate] = useState('');
  const [months, setMonths] = useState('');

  const price = Number(amount);
  const downPayment = Number(down) || 0;
  const financed = price - downPayment;
  const yearly = percentOf(rate);
  const term = Number(months);
  // What is paid over the months: the financed part for an installment, the whole target for a savings goal.
  const sum = mode === 'loan' ? financed : price;
  const ready =
    price > 0 &&
    downPayment >= 0 &&
    sum > 0 &&
    Number.isFinite(yearly) &&
    yearly >= 0 &&
    Number.isInteger(term) &&
    term >= 1 &&
    term <= MAX_MONTHS;

  let monthly = 0;
  if (ready) {
    if (mode === 'loan') monthly = method === 'flat' ? flatMonthly(sum, yearly, term) : annuityMonthly(sum, yearly, term);
    else monthly = goalMonthly(sum, yearly, term);
  }
  const paidOverTerm = monthly * term;

  const results: { label: string; value: string }[] =
    mode === 'loan'
      ? [
          { label: t('calc.financed'), value: money(Math.round(financed)) },
          { label: t('calc.monthly'), value: money(Math.round(monthly)) },
          { label: t('calc.totalPaid'), value: money(Math.round(paidOverTerm + downPayment)) },
          { label: t('calc.interest'), value: money(Math.round(paidOverTerm - financed)) },
        ]
      : [
          { label: t('calc.monthlySave'), value: money(Math.round(monthly)) },
          { label: t('calc.totalSaved'), value: money(Math.round(paidOverTerm)) },
          { label: t('calc.earned'), value: money(Math.round(price - paidOverTerm)) },
        ];

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/loans" className="text-sm text-muted tx-back">
            ‹ {t('calc.back')}
          </Link>
          <h2>{t('calc.title')}</h2>
          <p className="hint">{t('calc.subtitle')}</p>
        </div>
      </div>

      <div className="card">
        <div className="card-body stack">
          <div className="tx-field">
            <span className="tx-field-label">{t('calc.mode')}</span>
            <div className="chip-row" role="radiogroup" aria-label={t('calc.mode')}>
              {(['loan', 'goal'] as Mode[]).map((option) => (
                <button key={option} type="button" role="radio" aria-checked={mode === option} className="pill" onClick={() => setMode(option)}>
                  {t(option === 'loan' ? 'calc.loan' : 'calc.goal')}
                </button>
              ))}
            </div>
          </div>

          <label className="tx-field">
            <span className="tx-field-label">{t(mode === 'loan' ? 'calc.amount' : 'calc.target')}</span>
            <input type="text" inputMode="numeric" className="input" value={amount} onChange={(event) => setAmount(digitsOf(event.target.value))} placeholder="0" />
          </label>

          {mode === 'loan' && (
            <label className="tx-field">
              <span className="tx-field-label">{t('calc.down')}</span>
              <input type="text" inputMode="numeric" className="input" value={down} onChange={(event) => setDown(digitsOf(event.target.value))} placeholder="0" />
              <span className="tx-hint">{t('calc.downHint')}</span>
            </label>
          )}

          <label className="tx-field">
            <span className="tx-field-label">{t(mode === 'loan' ? 'calc.rate' : 'calc.return')}</span>
            <input type="text" inputMode="decimal" className="input" value={rate} onChange={(event) => setRate(percentInput(event.target.value))} placeholder="0" />
          </label>

          <label className="tx-field">
            <span className="tx-field-label">{t('calc.months')}</span>
            <input
              type="text"
              inputMode="numeric"
              className="input"
              value={months}
              onChange={(event) => setMonths(event.target.value.replace(/\D/g, '').slice(0, 3))}
              placeholder="0"
            />
          </label>

          {mode === 'loan' && (
            <div className="tx-field">
              <span className="tx-field-label">{t('calc.method')}</span>
              <div className="chip-row" role="radiogroup" aria-label={t('calc.method')}>
                {(['annuity', 'flat'] as Method[]).map((option) => (
                  <button key={option} type="button" role="radio" aria-checked={method === option} className="pill" onClick={() => setMethod(option)}>
                    {t(option === 'annuity' ? 'calc.annuity' : 'calc.flat')}
                  </button>
                ))}
              </div>
              <span className="tx-hint">{t(method === 'flat' ? 'calc.flatHint' : 'calc.annuityHint')}</span>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-body stack">
          {ready ? (
            results.map((row) => (
              <div key={row.label} className="list-row">
                <span className="text-muted">{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))
          ) : (
            <p className="text-muted">{t('calc.empty')}</p>
          )}
        </div>
      </div>
    </>
  );
}
