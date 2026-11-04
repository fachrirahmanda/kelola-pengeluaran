import { useState, type CSSProperties } from 'react';
import { useBankList } from '../banks';

// The bank or e-wallet as a badge. A built-in bank shows its logo from public/banks: a bare id is <id>.svg (made by
// scripts/bank-icons.mjs). A name with an extension is that file: a .png is brand artwork shown on the bank's colour (BCA,
// Mandiri, blu), and any other file (.webp, .jpg) is an app icon that fills the badge (Jenius, ShopeePay).
// A bank without a logo, or whose logo fails to load, shows its short code on its colour. Without a bank (cash,
// other) it is a neutral badge with a dot.

export function BankBadge({ bankId, size = 40 }: { bankId?: string | null; size?: number }) {
  const { banks } = useBankList();
  const bank = bankId ? banks.find((item) => item.id === bankId) : undefined;
  const [logoFailed, setLogoFailed] = useState(false);
  const style = { '--bank-color': bank?.color ?? 'var(--fill-strong)', '--bank-text': bank?.textColor ?? 'var(--muted)', width: size, height: size } as CSSProperties;

  if (bank?.logo && !logoFailed) {
    const file = bank.logo.includes('.') ? bank.logo : `${bank.logo}.svg`;
    const onBrandColour = bank.logo.endsWith('.png');
    return (
      <span className={`bank-badge bank-badge-logo${onBrandColour ? ' bank-badge-brand' : ''}`} style={style} aria-hidden="true">
        <img src={`/banks/${file}`} alt="" width={size} height={size} onError={() => setLogoFailed(true)} />
      </span>
    );
  }
  return (
    <span className="bank-badge" style={style} aria-hidden="true">
      {bank?.short ?? '•'}
    </span>
  );
}
