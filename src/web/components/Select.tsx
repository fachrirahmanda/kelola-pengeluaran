import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import ReactSelect, { type ControlProps, type MenuListProps, components } from 'react-select';

// Themed dropdown, the same pattern as Silpasala's components/Select.tsx. The field is a plain
// button; clicking it opens a panel (a native popover) with an optional search box and the options.
// The panel is react-select, so typing filters and the arrow keys, Enter and Escape work as usual.
// Styles live in styles.css under "dropdowns" (classes rs__*).

export interface Option<V extends string = string> {
  value: V;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

const CHEVRON = (
  <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CHECK = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="rs-check">
    <path d="M5 12l5 5L20 7" />
  </svg>
);

const SEARCH = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="rs-search-icon">
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </svg>
);

function OptionLabel({ option, selected }: { option: Option; selected?: boolean }) {
  return (
    <span className="rs-label">
      {option.icon && <span className="rs-icon">{option.icon}</span>}
      <span className="rs-text" title={option.label}>
        {option.label}
      </span>
      {selected && CHECK}
    </span>
  );
}

function SearchControl(props: ControlProps<Option, false>) {
  return (
    <components.Control {...props}>
      {SEARCH}
      {props.children}
    </components.Control>
  );
}

// Plain scrolling list. react-select keeps the focused option in view through innerRef.
function MenuList(props: MenuListProps<Option, false>) {
  const list = useRef<HTMLDivElement | null>(null);
  // When the panel opens, react-select scrolls the selected option into view, and that moved the first item under
  // the search box. The list starts at the top instead; the user scrolls to the rest.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (list.current) list.current.scrollTop = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div
      ref={(node) => {
        list.current = node;
        const ref = props.innerRef as unknown;
        if (typeof ref === 'function') ref(node);
        else if (ref && typeof ref === 'object') (ref as { current: HTMLDivElement | null }).current = node;
      }}
      className="rs__menu-list"
      {...props.innerProps}
    >
      {props.children}
    </div>
  );
}

/** Phones and tablets are touch-first: there the search box does not take focus, so the keyboard stays shut until it is tapped. */
const touchDevice = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export function Select<V extends string>({
  value,
  options,
  onChange,
  placeholder = '—',
  disabled,
  searchable,
  size = 'md',
  className,
  ariaLabel,
}: {
  value: V | null;
  options: Option<V>[];
  onChange: (value: V | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Show a search box in the panel. Defaults to on when there are more than 6 options. */
  searchable?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value) ?? null;
  const withSearch = searchable ?? options.length > 6;

  // Place the panel under the field, or above it when there is no room below. On phones the visible area is
  // the visual viewport: it shrinks when the keyboard opens, so the panel is placed inside that.
  const place = () => {
    const t = trigger.current;
    const p = pop.current;
    if (!t || !p) return;
    const vv = window.visualViewport;
    const top = vv?.offsetTop ?? 0;
    const height = vv?.height ?? innerHeight;
    const width = vv?.width ?? innerWidth;
    const r = t.getBoundingClientRect();
    p.style.width = `${Math.max(r.width, 200)}px`;
    p.style.maxHeight = `${Math.max(160, height - 24)}px`;
    const h = Math.min(p.offsetHeight, height - 24);
    const w = p.offsetWidth;
    const below = r.bottom + 6 + h <= top + height - 8;
    p.style.top = `${below ? r.bottom + 6 : Math.max(top + 8, r.top - h - 6)}px`;
    p.style.left = `${Math.min(Math.max(8, r.left), width - w - 8)}px`;
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
    const vv = window.visualViewport;
    addEventListener('resize', place);
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    return () => {
      removeEventListener('resize', place);
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
    };
  }, [open]);

  const close = () => {
    pop.current?.hidePopover();
    trigger.current?.focus();
  };

  return (
    <div className={`rs rs-${size} ${className ?? ''}`}>
      <button
        ref={trigger}
        type="button"
        className={`rs__control${open ? ' rs__control--menu-is-open' : ''}${disabled ? ' rs__control--is-disabled' : ''}`}
        popoverTarget={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${ariaLabel}: ${selected?.label ?? placeholder}`}
        title={selected?.label}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            pop.current?.showPopover();
          }
        }}
      >
        <span className="rs__value-container">
          {selected ? (
            <span className="rs__single-value">
              <OptionLabel option={selected} />
            </span>
          ) : (
            <span className="rs__placeholder">{placeholder}</span>
          )}
        </span>
        <span className="rs__indicators">
          <span className="rs__dropdown-indicator">{CHEVRON}</span>
        </span>
      </button>

      <div ref={pop} id={id} popover="auto" className={`select-popover${withSearch ? '' : ' is-plain'}`}>
        {open && (
          <ReactSelect<Option<V>, false>
            unstyled
            className="rs-pop"
            classNamePrefix="rs"
            options={options}
            value={selected}
            onChange={(o) => {
              onChange(o ? o.value : null);
              close();
            }}
            isSearchable={withSearch}
            isOptionDisabled={(o) => !!o.disabled}
            placeholder="Search…"
            aria-label={ariaLabel}
            autoFocus={!touchDevice()}
            menuIsOpen
            controlShouldRenderValue={false}
            backspaceRemovesValue={false}
            tabSelectsValue={false}
            noOptionsMessage={() => '—'}
            components={{ Control: SearchControl as never, MenuList: MenuList as never, DropdownIndicator: null, IndicatorSeparator: null }}
            formatOptionLabel={(o, { selectValue }) => <OptionLabel option={o} selected={selectValue.some((s) => s.value === o.value)} />}
            // Escape and Tab close the panel and return to the field.
            onKeyDown={(e) => {
              if (e.key === 'Escape' || e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
