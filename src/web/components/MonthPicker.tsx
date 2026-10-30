import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Icon } from './Icon';
import { usePrefs } from '../prefs';
import { localeOf, todayInWib } from '../format';

// Month field, in the same style as the date picker: a field that opens a small card with the year and a
// grid of the twelve months. Values are YYYY-MM strings. Months after `max` (or before `min`) are disabled.

const pad = (value: number) => String(value).padStart(2, '0');

export function MonthPicker({
  value,
  onChange,
  min,
  max,
  ariaLabel,
  placeholder,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  min?: string;
  max?: string;
  ariaLabel: string;
  placeholder?: string;
}) {
  const { t, lang } = usePrefs();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number((value ?? todayInWib()).slice(0, 4)));
  const current = todayInWib().slice(0, 7);
  const shownLabel = value ? new Intl.DateTimeFormat(localeOf(lang), { month: 'short', year: 'numeric' }).format(new Date(`${value}-01T00:00:00`)) : (placeholder ?? t('date.none'));
  const monthNames = Array.from({ length: 12 }, (_, index) => new Date(2024, index, 1).toLocaleDateString(localeOf(lang), { month: 'short' }));

  // Place the card under the field (or above it if there's no room), inside the window.
  const place = () => {
    const tr = trigger.current;
    const p = pop.current;
    if (!tr || !p) return;
    const r = tr.getBoundingClientRect();
    const h = p.offsetHeight;
    const w = p.offsetWidth;
    const below = r.bottom + 6 + h <= innerHeight - 8;
    p.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
    p.style.left = `${Math.min(Math.max(8, r.left), innerWidth - w - 8)}px`;
  };

  useEffect(() => {
    const p = pop.current!;
    const onToggle = (event: Event) => setOpen((event as ToggleEvent).newState === 'open');
    p.addEventListener('toggle', onToggle);
    return () => p.removeEventListener('toggle', onToggle);
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    addEventListener('scroll', place, true);
    addEventListener('resize', place);
    return () => {
      removeEventListener('scroll', place, true);
      removeEventListener('resize', place);
    };
  }, [open]);

  const isDisabled = (candidate: string) => (max !== undefined && candidate > max) || (min !== undefined && candidate < min);

  function pick(candidate: string | null) {
    onChange(candidate);
    pop.current?.hidePopover();
    trigger.current?.focus();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`input input-sm date-trigger${value ? '' : ' is-empty'}`}
        popoverTarget={id}
        aria-label={`${ariaLabel}: ${shownLabel}`}
        aria-expanded={open}
        onClick={() => {
          if (!open) setYear(Number((value ?? current).slice(0, 4)));
        }}
      >
        <Icon name="calendar" size={14} />
        <span className="truncate">{shownLabel}</span>
      </button>
      <div ref={pop} id={id} popover="auto" className="month-popover" role="dialog" aria-label={ariaLabel}>
        <div className="month-head">
          <button type="button" className="month-nav is-prev" onClick={() => setYear((y) => y - 1)} aria-label={t('cal.prev')}>
            <Icon name="chevron-right" size={16} />
          </button>
          <strong>{year}</strong>
          <button type="button" className="month-nav" onClick={() => setYear((y) => y + 1)} aria-label={t('cal.next')}>
            <Icon name="chevron-right" size={16} />
          </button>
        </div>
        <div className="month-grid">
          {monthNames.map((name, index) => {
            const candidate = `${year}-${pad(index + 1)}`;
            const selected = candidate === value;
            return (
              <button
                key={candidate}
                type="button"
                className={`month-cell${selected ? ' is-selected' : ''}${candidate === current ? ' is-current' : ''}`}
                style={{ '--month-index': index } as CSSProperties}
                disabled={isDisabled(candidate)}
                onClick={() => pick(candidate)}
              >
                {name}
              </button>
            );
          })}
        </div>
        <div className="month-foot">
          <button type="button" className="chip" disabled={isDisabled(current)} onClick={() => pick(current)}>
            {t('date.thisMonth')}
          </button>
          {value && (
            <button type="button" className="chip date-clear" onClick={() => pick(null)}>
              <Icon name="x" size={11} /> {t('date.clear')}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
