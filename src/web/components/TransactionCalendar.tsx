import { useEffect, useMemo, useRef, useState, type CSSProperties, type TouchEvent } from 'react';
import { api } from '../api';
import { localeOf, monthLabel, todayInWib } from '../format';
import { usePrefs } from '../prefs';
import type { Income, Transaction } from '../../shared/types';
import { Icon } from './Icon';
import { SkeletonRows } from './Skeleton';

// Transactions as a month calendar of tiles, Sunday first: on each day, what was spent (by the day it happened,
// as the list's date filter counts it, card purchases included) and any income, in short form (154,4K, 2,4M).
// The more a day's spending, the deeper its tile's tint; today's tile is dark, days still ahead are outlined.
// The month changes with the arrows, or by swiping the calendar sideways. Pick a day to see its transactions in
// the list.

const pad = (value: number) => String(value).padStart(2, '0');

/** Amounts in short form with K, M, B and T, in the language's number style: 950, 154,4K, 2,4M, 1M. */
function shortAmount(value: number, format: Intl.NumberFormat) {
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) if (value >= size) return `${format.format(Math.round((value / size) * 10) / 10)}${suffix}`;
  return format.format(value);
}
const SWIPE_MIN = 48;

/** The month as YYYY-MM, moved by a number of months. */
function shiftMonth(period: string, by: number) {
  const [year, month] = period.split('-').map(Number);
  const index = year * 12 + (month - 1) + by;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

export function TransactionCalendar({ onPickDay }: { onPickDay: (day: string) => void }) {
  const { t, money, lang } = usePrefs();
  const [month, setMonth] = useState(todayInWib().slice(0, 7));
  const [direction, setDirection] = useState<1 | -1>(1);
  const [items, setItems] = useState<Transaction[] | null>(null);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [error, setError] = useState('');
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
  // Sunday first: 0 is Sunday.
  const firstWeekday = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const today = todayInWib();

  function step(by: number) {
    setDirection(by > 0 ? 1 : -1);
    setMonth((value) => shiftMonth(value, by));
  }

  useEffect(() => {
    let ignore = false;
    setItems(null);
    const range = `from=${month}-01&to=${month}-${pad(days)}`;
    Promise.all([api.get<{ transactions: Transaction[] }>(`/transactions?${range}`), api.get<{ incomes: Income[] }>(`/incomes?${range}`)])
      .then(([spent, received]) => {
        if (ignore) return;
        // A transfer only moves money between accounts, so it is not spending.
        setItems(spent.transactions.filter((item) => item.method !== 'transfer'));
        setIncomes(received.incomes);
      })
      .catch(() => {
        if (!ignore) setError(t('cal.error'));
      });
    return () => {
      ignore = true;
    };
    // The month decides the range; the day count follows from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  // Each day's spending and income.
  const totals = useMemo(() => {
    const byDay = new Map<string, { spent: number; income: number }>();
    const entryOf = (day: string) => byDay.get(day) ?? byDay.set(day, { spent: 0, income: 0 }).get(day)!;
    for (const item of items ?? []) entryOf(item.occurredOn).spent += item.amount;
    for (const income of incomes) entryOf(income.occurredOn).income += income.amount;
    return byDay;
  }, [items, incomes]);

  const entries = [...totals.values()];
  const monthSpent = entries.reduce((sum, entry) => sum + entry.spent, 0);
  const monthIncome = entries.reduce((sum, entry) => sum + entry.income, 0);
  // The tint is relative to the month's biggest day.
  const maxSpent = Math.max(0, ...entries.map((entry) => entry.spent));
  const shortFormat = new Intl.NumberFormat(localeOf(lang), { maximumFractionDigits: 1 });
  // 7 January 2024 was a Sunday.
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Date(Date.UTC(2024, 0, 7 + index)).toLocaleDateString(localeOf(lang), { weekday: 'short', timeZone: 'UTC' }),
  );
  const cells: (number | null)[] = [...Array.from({ length: firstWeekday }, () => null), ...Array.from({ length: days }, (_, index) => index + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  // A sideways swipe changes the month. Vertical scrolling is left alone.
  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }
  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  }

  return (
    <section className="card tx-calendar">
      <div className="card-body stack">
        <div className="cal-head">
          <button type="button" className="cal-nav is-prev" onClick={() => step(-1)} aria-label={t('cal.prev')}>
            <Icon name="chevron-right" size={16} />
          </button>
          <strong className="cal-title">{monthLabel(month, lang)}</strong>
          <button type="button" className="cal-nav" onClick={() => step(1)} aria-label={t('cal.next')}>
            <Icon name="chevron-right" size={16} />
          </button>
        </div>
        <p className="hint m-0 cal-summary">
          {t('cal.monthSpent', { total: money(monthSpent) })}
          {monthIncome > 0 && (
            <>
              {' · '}
              <span className="cal-income">{t('cal.monthIncome', { total: money(monthIncome) })}</span>
            </>
          )}
        </p>

        {error && <p className="text-danger">{error}</p>}
        {items === null && !error ? (
          <SkeletonRows count={5} />
        ) : (
          <div className="cal-swipe" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <div className="cal-grid" role="grid" aria-label={monthLabel(month, lang)} key={month} style={{ '--cal-dir': direction } as CSSProperties}>
              {weekdays.map((name) => (
                <span key={name} className="cal-weekday" role="columnheader">
                  {name}
                </span>
              ))}
              {cells.map((day, index) => {
                if (day === null) return <span key={`empty-${index}`} className="cal-tile is-empty" aria-hidden="true" />;
                const key = `${month}-${pad(day)}`;
                const spent = totals.get(key)?.spent ?? 0;
                const income = totals.get(key)?.income ?? 0;
                const label = [key, spent ? money(spent) : '', income ? `+${money(income)}` : ''].filter(Boolean).join(', ');
                return (
                  <button
                    key={key}
                    type="button"
                    className={`cal-tile${key === today ? ' is-today' : ''}${spent ? ' has-spend' : ''}${key > today ? ' is-future' : ''}`}
                    style={spent ? ({ '--cal-heat': (spent / maxSpent).toFixed(2) } as CSSProperties) : undefined}
                    onClick={() => onPickDay(key)}
                    aria-label={label}
                  >
                    <span className="cal-tile-day">{day}</span>
                    {income > 0 && <span className="cal-tile-in">+{shortAmount(income, shortFormat)}</span>}
                    <span className="cal-tile-amount">{shortAmount(spent, shortFormat)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
