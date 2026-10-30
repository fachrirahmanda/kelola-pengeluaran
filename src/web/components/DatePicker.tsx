import { useEffect, useId, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { Icon } from './Icon';
import { usePrefs } from '../prefs';
import { localeOf } from '../format';
import type { MessageKey } from '../i18n';

// Date field from Silpasala (components/DatePicker.tsx): a button that opens a themed calendar
// (react-day-picker) with shortcuts. The calendar lives in a native popover, so it shows above
// dialogs and isn't clipped by scrolling panels; it closes on outside click and Escape.
// Values are YYYY-MM-DD strings.

const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromIso = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toIso(d);
};
const todayIso = () => toIso(new Date());

export function DatePicker({
  value,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
  overdueWhenPast,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
  /** Show the value in red when it is before today (e.g. a due date that has passed). */
  overdueWhenPast?: boolean;
}) {
  const { t, lang } = usePrefs();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = value ? fromIso(value) : undefined;
  const overdue = overdueWhenPast && value !== null && value < todayIso();
  const labelFmt = new Intl.DateTimeFormat(localeOf(lang), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const shown = placeholder ?? t('date.none');

  // Place the popover under the trigger (or above it when there's no room), inside the window.
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
    const onToggle = (e: Event) => setOpen((e as ToggleEvent).newState === 'open');
    p.addEventListener('toggle', onToggle);
    return () => p.removeEventListener('toggle', onToggle);
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    // Only a new width closes it: iOS changes the height whenever its toolbar or keyboard moves.
    const width = innerWidth;
    const close = () => (innerWidth !== width ? pop.current?.hidePopover() : place());
    // Follow the trigger if the page or a panel scrolls.
    addEventListener('scroll', place, true);
    addEventListener('resize', close);
    return () => {
      removeEventListener('scroll', place, true);
      removeEventListener('resize', close);
    };
  }, [open]);

  const pick = (v: string | null) => {
    onChange(v);
    pop.current?.hidePopover();
    trigger.current?.focus();
  };

  const shortcut = (key: MessageKey, days: number) => (
    <button type="button" className="chip" onClick={() => pick(addDays(days))}>
      {t(key)}
    </button>
  );

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`input input-sm date-trigger${value ? '' : ' is-empty'}${overdue ? ' is-overdue' : ''}`}
        popoverTarget={id}
        disabled={disabled}
        aria-label={`${ariaLabel}: ${value ? labelFmt.format(fromIso(value)) : shown}`}
        aria-expanded={open}
      >
        <Icon name={overdue ? 'alert' : 'calendar'} size={14} />
        <span className="truncate">{value ? labelFmt.format(fromIso(value)) : shown}</span>
      </button>
      <div ref={pop} id={id} popover="auto" className="date-popover" role="dialog" aria-label={ariaLabel}>
        {open && (
          <>
            <DayPicker
              mode="single"
              selected={selected}
              defaultMonth={selected}
              onSelect={(d) => pick(d ? toIso(d) : null)}
              weekStartsOn={1}
              showOutsideDays
              fixedWeeks
              autoFocus
            />
            <div className="date-shortcuts">
              {shortcut('date.today', 0)}
              {shortcut('date.tomorrow', 1)}
              {shortcut('date.week', 7)}
              {value && (
                <button type="button" className="chip date-clear" onClick={() => pick(null)}>
                  <Icon name="x" size={11} /> {t('date.clear')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
