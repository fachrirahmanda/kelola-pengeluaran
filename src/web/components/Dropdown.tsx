import type { ReactNode } from 'react';
import { Select } from './Select';

// Dropdown for the app: a thin wrapper around Select (the Silpasala pattern), with the simple
// options shape used across Neraca.

export interface DropdownOption {
  value: string;
  label: string;
  /** Optional leading icon, e.g. a flag. */
  icon?: ReactNode;
}

export function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  searchable,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  /** Always offer search, even with few options. Long lists are searchable anyway. */
  searchable?: boolean;
}) {
  return <Select value={value} options={options} onChange={(next) => onChange(next ?? '')} ariaLabel={ariaLabel} className={className} searchable={searchable} size="md" />;
}
