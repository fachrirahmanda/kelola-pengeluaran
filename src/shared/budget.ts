// Budget status, shared by the Worker and the web app: how much of a budget is spent, and when to warn.

/** From this share of the budget on, a category is "near" its budget. */
export const NEAR_RATIO = 0.8;

export type BudgetStatus = 'none' | 'ok' | 'near' | 'over';

/** No budget, under it, near it (80% or more), or over it. Spending exactly the budget is near, not over. */
export function budgetStatus(spent: number, amount: number | null): BudgetStatus {
  if (amount === null || amount <= 0) return 'none';
  if (spent > amount) return 'over';
  if (spent >= amount * NEAR_RATIO) return 'near';
  return 'ok';
}

export interface BudgetLine {
  categoryId: string;
  amount: number | null;
  spent: number;
}

/** One month of budgets: the total and every category with a budget or spending in it. */
export interface BudgetMonth {
  month: string;
  total: number | null;
  spent: number;
  categories: BudgetLine[];
}
