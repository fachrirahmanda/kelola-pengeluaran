import { useState, type CSSProperties } from 'react';
import { bankById } from '../../shared/banks';

// The bank or e-wallet as a badge. The logo comes from public/banks/<id>.png when that file exists;
// otherwise, or if it fails to load, the badge shows the bank's colour and short code. Without a bank
// (cash, other) it is a neutral badge with a dot.

export function BankBadge({ bankId, size = 40 }: { bankId?: string | null; size?: number }) {
  const bank = bankById(bankId);
  const [logoFailed, setLogoFailed] = useState(false);
  const style = { '--bank-color': bank?.color ?? 'var(--fill-strong)', '--bank-text': bank?.textColor ?? 'var(--muted)', width: size, height: size } as CSSProperties;

  if (bank && !logoFailed) {
    return (
      <span className="bank-badge bank-badge-logo" style={style} aria-hidden="true">
        <img src={`/banks/${bank.id}.png`} alt="" width={size} height={size} onError={() => setLogoFailed(true)} />
      </span>
    );
  }
  return (
    <span className="bank-badge" style={style} aria-hidden="true">
      {bank?.short ?? '•'}
    </span>
  );
}
