import type { Lang } from './i18n';
import { periodOf, periodRange } from '../shared/period';

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

/** First and last day of the monthly period a date falls in, as YYYY-MM-DD (startDay 1 is the calendar month). */
export function monthRange(isoDate: string, startDay = 1): { from: string; to: string } {
  return periodRange(periodOf(isoDate, startDay), startDay);
}

/** "2026-10" -> "October 2026" in English, "Oktober 2026" in Indonesian. */
export function monthLabel(period: string, lang: Lang): string {
  return new Date(`${period}-01T00:00:00`).toLocaleDateString(localeOf(lang), { month: 'long', year: 'numeric' });
}
