import type { Lang } from './i18n';

export const CURRENCIES = ['IDR', 'USD', 'EUR', 'GBP', 'SGD', 'MYR', 'JPY'] as const;
export type Currency = (typeof CURRENCIES)[number];

export function localeOf(lang: Lang): string {
  return lang === 'id' ? 'id-ID' : 'en-US';
}

/** 150000 with IDR in English -> "IDR 150,000". Amounts are whole units, so no decimals. */
export function formatMoney(amount: number, currency: string, lang: Lang): string {
  return new Intl.NumberFormat(localeOf(lang), { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

/** "2026-10-29" -> "29 Oct 2026" (English) or "29 Okt 2026" (Indonesian). */
export function formatDate(isoDate: string, lang: Lang): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(localeOf(lang), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Today's date in WIB as YYYY-MM-DD, the format used for transaction dates. */
export function todayInWib(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** First and last day of the month of an ISO date, as YYYY-MM-DD. */
export function monthRange(isoDate: string): { from: string; to: string } {
  const [year, month] = isoDate.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = isoDate.slice(0, 7);
  return { from: `${prefix}-01`, to: `${prefix}-${String(lastDay).padStart(2, '0')}` };
}

/** "2026-10" -> "October 2026" in English, "Oktober 2026" in Indonesian. */
export function monthLabel(period: string, lang: Lang): string {
  return new Date(`${period}-01T00:00:00`).toLocaleDateString(localeOf(lang), { month: 'long', year: 'numeric' });
}
