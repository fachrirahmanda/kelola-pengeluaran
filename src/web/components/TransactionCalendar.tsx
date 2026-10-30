import { useEffect, useMemo, useRef, useState, type CSSProperties, type TouchEvent } from 'react';
import { api } from '../api';
import { localeOf, monthLabel, todayInWib } from '../format';
import { usePrefs } from '../prefs';
import type { Transaction } from '../../shared/types';
import { Icon } from './Icon';
import { SkeletonRows } from './Skeleton';

// Transactions as a month calendar: what was counted (posted) on each day. On phones you change month by
// swiping the calendar sideways; on larger screens there are arrows as well. Pick a day to see its
// transactions in the list.

const pad = (value: number) => String(value).padStart(2, '0');
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
  const [error, setError] = useState('');
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
  const firstWeekday = (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7;
  const today = todayInWib();

  function step(by: number) {
    setDirection(by > 0 ? 1 : -1);
    setMonth((value) => shiftMonth(value, by));
  }

  useEffect(() => {
    let ignore = false;
    setItems(null);
    api
      .get<{ transactions: Transaction[] }>(`/transactions?from=${month}-01&to=${month}-${pad(days)}`)
      .then((data) => {
        if (!ignore) setItems(data.transactions);
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

  const totals = useMemo(() => {
    const byDay = new Map<string, { total: number; count: number }>();
    for (const item of items ?? []) {
      if (item.status !== 'posted' || !item.postedOn) continue;
      const entry = byDay.get(item.postedOn) ?? { total: 0, count: 0 };
      entry.total += item.amount;
      entry.count += 1;
      byDay.set(item.postedOn, entry);
    }
    return byDay;
  }, [items]);

  const monthTotal = [...totals.values()].reduce((sum, entry) => sum + entry.total, 0);
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Date(Date.UTC(2024, 0, 1 + index)).toLocaleDateString(localeOf(lang), { weekday: 'short', timeZone: 'UTC' }),
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
        <p className="hint m-0 cal-summary">{t('cal.monthTotal', { total: money(monthTotal) })}</p>

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
                if (day === null) return <span key={`empty-${index}`} className="cal-cell is-empty" aria-hidden="true" />;
                const key = `${month}-${pad(day)}`;
                const entry = totals.get(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`cal-cell${key === today ? ' is-today' : ''}${entry ? ' has-spend' : ''}`}
                    onClick={() => onPickDay(key)}
                    aria-label={`${key}${entry ? `, ${money(entry.total)}` : ''}`}
                  >
                    <span className="cal-day">{day}</span>
                    {entry && <span className="cal-dot" aria-hidden="true" />}
                    {entry && <span className="cal-total">{money(entry.total)}</span>}
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
