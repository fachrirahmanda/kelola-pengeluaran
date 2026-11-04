// The installment and savings maths of the calculator. The same rules are what Ask AI is told to use. Money is in
// whole rupiah; the rate is a percentage per year, and each month uses a twelfth of it.

/** Flat-rate loan (bunga flat): the interest is on the whole amount for the whole term. */
export function flatMonthly(principal: number, yearlyPercent: number, months: number): number {
  const years = months / 12;
  return (principal + principal * (yearlyPercent / 100) * years) / months;
}

/** Effective-rate loan (annuity): the interest is on the amount still owed, so each payment is the same. */
export function annuityMonthly(principal: number, yearlyPercent: number, months: number): number {
  const rate = yearlyPercent / 100 / 12;
  if (rate === 0) return principal / months;
  return (principal * rate) / (1 - (1 + rate) ** -months);
}

/** Saving every month to reach a goal, with the return the savings earn each month. */
export function goalMonthly(goal: number, yearlyPercent: number, months: number): number {
  const rate = yearlyPercent / 100 / 12;
  if (rate === 0) return goal / months;
  return (goal * rate) / ((1 + rate) ** months - 1);
}
