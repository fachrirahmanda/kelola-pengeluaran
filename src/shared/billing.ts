// Credit card and paylater billing. Shared by the Worker and the web app, so both agree on which
// bill a transaction belongs to and when a bill is due.
//
// A bill is named by its period: the month it closes in, as YYYY-MM. A transaction dated on or
// before the closing day belongs to that month's bill; a later one belongs to the next month's.
// The bill is due on the payment day: in the closing month if the payment day comes after the
// closing day, otherwise in the following month.

const pad = (value: number) => String(value).padStart(2, '0');

/** The bill period (YYYY-MM) a transaction date falls into, for a card closing on `closingDay`. */
export function billPeriodOf(occurredOn: string, closingDay: number): string {
  const [year, month, day] = occurredOn.split('-').map(Number);
  if (day <= closingDay) return `${year}-${pad(month)}`;
  const next = new Date(Date.UTC(year, month, 1)); // first day of the next month
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}`;
}

/** The date a bill for `period` closes, YYYY-MM-DD. */
export function closesOn(period: string, closingDay: number): string {
  return `${period}-${pad(closingDay)}`;
}

/** The date a bill for `period` is due, YYYY-MM-DD. */
export function dueOn(period: string, closingDay: number, paymentDay: number): string {
  const [year, month] = period.split('-').map(Number);
  const dueMonth = paymentDay > closingDay ? new Date(Date.UTC(year, month - 1, 1)) : new Date(Date.UTC(year, month, 1));
  return `${dueMonth.getUTCFullYear()}-${pad(dueMonth.getUTCMonth() + 1)}-${pad(paymentDay)}`;
}
