// Recurring income (gaji). Shared by the Worker and the web app.
//
// A salary is paid on a day of every month. A shorter month pays on its last day. When that date is a
// Saturday or Sunday, it is paid on the Friday before.

import { addMonths } from './recurring';

const pad = (value: number) => String(value).padStart(2, '0');

/** The date a salary is paid in a month (YYYY-MM), as YYYY-MM-DD. */
export function payDateOf(month: string, payDay: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const date = new Date(Date.UTC(year, monthNumber - 1, Math.min(payDay, lastDay)));
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (weekday === 0) date.setUTCDate(date.getUTCDate() - 2);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** The first month whose pay date is today or later: this month, or next month if this month's has passed. */
export function firstUpcomingMonth(today: string, payDay: number): string {
  const month = today.slice(0, 7);
  return payDateOf(month, payDay) >= today ? month : addMonths(month, 1);
}

/**
 * The months from `startMonth` whose pay date has come by `today`. Next month is checked too: pay day 1
 * on a weekend is paid on the last Friday of the month before.
 */
export function dueMonths(startMonth: string, payDay: number, today: string): string[] {
  const months: string[] = [];
  const last = addMonths(today.slice(0, 7), 1);
  for (let month = startMonth; month <= last; month = addMonths(month, 1)) {
    if (payDateOf(month, payDay) <= today) months.push(month);
  }
  return months;
}
