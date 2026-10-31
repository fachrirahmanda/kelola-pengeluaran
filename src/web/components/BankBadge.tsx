import { useState, type CSSProperties } from 'react';
import { useBankList } from '../banks';

// The bank or e-wallet as a badge. A built-in bank shows its logo (public/banks/<logo>.svg, made by
// scripts/bank-icons.mjs); a bank without one, or whose logo fails to load, shows its short code on its colour.
// Without a bank (cash, other) it is a neutral badge with a dot.

export function BankBadge({ bankId, size = 40 }: { bankId?: string | null; size?: number }) {
  const { banks } = useBankList();
  const bank = bankId ? banks.find((item) => item.id === bankId) : undefined;
  const [logoFailed, setLogoFailed] = useState(false);
  const style = { '--bank-color': bank?.color ?? 'var(--fill-strong)', '--bank-text': bank?.textColor ?? 'var(--muted)', width: size, height: size } as CSSProperties;

  if (bank?.logo && !logoFailed) {
    return (
      <span className="bank-badge bank-badge-logo" style={style} aria-hidden="true">
        <img src={`/banks/${bank.logo}.svg`} alt="" width={size} height={size} onError={() => setLogoFailed(true)} />
      </span>
    );
  }
  return (
    <span className="bank-badge" style={style} aria-hidden="true">
      {bank?.short ?? '•'}
    </span>
  );
}
