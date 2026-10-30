// Installments and recurring payments (monthly). Shared by the Worker and the web app.
//
// An item has a start date and an optional number of months. Installment n (1-based) is due in
// the month of the start date plus n-1 months. Without a number of months it never ends.

const pad = (value: number) => String(value).padStart(2, '0');

/** Adds months to a YYYY-MM period, e.g. ("2026-11", 3) -> "2027-02". */
export function addMonths(period: string, months: number): string {
  const [year, month] = period.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** The month (YYYY-MM) a date falls in. */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** The month installment `installment` (1-based) is due in. */
export function dueMonthOf(startDate: string, installment: number): string {
  return addMonths(monthOf(startDate), installment - 1);
}

/** The due date of an installment: the start day, or the last day of the month if it is shorter. */
export function dueDateOf(startDate: string, installment: number): string {
  const period = dueMonthOf(startDate, installment);
  const [year, month] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(Number(startDate.slice(8, 10)), lastDay);
  return `${period}-${pad(day)}`;
}

/** Installments paid so far are counted from the payments; the next one is paidCount + 1. */
export function nextInstallment(paidCount: number, totalMonths: number | null): number | null {
  const next = paidCount + 1;
  if (totalMonths !== null && next > totalMonths) return null;
  return next;
}
