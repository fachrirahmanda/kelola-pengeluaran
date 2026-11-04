import { addMonths } from './recurring';

// The monthly period. Each data set chooses the day its month starts (1 to 28). With 1 it is the calendar
// month. With day D, a period is named by the month it ends in: "Nov 2026" with D = 25 runs from 25 Oct to
// 24 Nov. Periods are YYYY-MM keys, so budgets, reports and the dashboard keep the same key format.

export const MIN_PERIOD_START = 1;
export const MAX_PERIOD_START = 28;

const pad = (value: number) => String(value).padStart(2, '0');

/** The period (YYYY-MM) a date falls in. */
export function periodOf(isoDate: string, startDay: number): string {
  const month = isoDate.slice(0, 7);
  return startDay > 1 && Number(isoDate.slice(8, 10)) >= startDay ? addMonths(month, 1) : month;
}

/** First and last day of a period, both inclusive, as YYYY-MM-DD. */
export function periodRange(period: string, startDay: number): { from: string; to: string } {
  if (startDay <= 1) {
    const [year, month] = period.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { from: `${period}-01`, to: `${period}-${pad(lastDay)}` };
  }
  return { from: `${addMonths(period, -1)}-${pad(startDay)}`, to: `${period}-${pad(startDay - 1)}` };
}
