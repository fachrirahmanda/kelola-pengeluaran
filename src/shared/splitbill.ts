// Split bill: who owes what. Money is whole rupiah. An item's amount is shared equally by the people it is assigned
// to (any remainder goes to the first of them). Tax and service are shared out in proportion to what each person
// ordered. An item with nobody assigned is not in anyone's share, and is reported as unassigned.

export interface SplitItem {
  name: string;
  amount: number;
  /** Indexes into the bill's people list. */
  people: number[];
}

export interface SplitShare {
  subtotal: number;
  tax: number;
  service: number;
  total: number;
}

/** Shares `total` in whole numbers in proportion to `weights`; the rounding goes to the largest remainders. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((weight) => (total * weight) / sum);
  const out = raw.map((value) => Math.floor(value));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((value, index) => ({ index, remainder: value - Math.floor(value) })).sort((a, b) => b.remainder - a.remainder);
  for (const { index } of order) {
    if (rest <= 0) break;
    out[index] += 1;
    rest -= 1;
  }
  return out;
}

/** Everyone's share of a bill, and the part of the items that nobody has been assigned to. */
export function splitShares(peopleCount: number, items: SplitItem[], tax: number, service: number): { shares: SplitShare[]; unassigned: number } {
  const subtotals = Array.from({ length: peopleCount }, () => 0);
  let unassigned = 0;
  for (const item of items) {
    const assigned = item.people.filter((index) => index >= 0 && index < peopleCount);
    if (assigned.length === 0) {
      unassigned += item.amount;
      continue;
    }
    const parts = allocate(item.amount, assigned.map(() => 1));
    assigned.forEach((index, position) => {
      subtotals[index] += parts[position];
    });
  }
  const taxes = allocate(tax, subtotals);
  const services = allocate(service, subtotals);
  const shares = subtotals.map((subtotal, index) => ({
    subtotal,
    tax: taxes[index],
    service: services[index],
    total: subtotal + taxes[index] + services[index],
  }));
  return { shares, unassigned };
}
