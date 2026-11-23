import { OutOfRangeRefusal } from '../errors.js';

/**
 * Pure helpers for the income category guards of the budget writers (#759). The adapter reads
 * the month and the category and passes what it read in; nothing here touches the api.
 */

/**
 * True when the month has the tracking budget shape: an income group that carries a numeric
 * `budgeted`. An envelope budget returns income groups and categories with `received` only.
 * Anything malformed is not tracking, so the guard errs on the side of refusing.
 */
export function isTrackingBudgetMonth(budgetMonth: unknown): boolean {
  const groups = (budgetMonth as { categoryGroups?: unknown } | null | undefined)?.categoryGroups;
  if (!Array.isArray(groups)) return false;
  return groups.some(
    (g) => !!g && (g as { is_income?: unknown }).is_income === true && typeof (g as { budgeted?: unknown }).budgeted === 'number',
  );
}

const label = (category: { id: string; name?: string }): string =>
  category.name ? `"${category.name}" (${category.id})` : `"${category.id}"`;

/** set_amount on an income category of an envelope budget: nothing reads the row it would write. */
export function incomeSetAmountRefusal(category: { id: string; name?: string }): OutOfRangeRefusal {
  return new OutOfRangeRefusal(
    `Category ${label(category)} is not an expense category: on an envelope budget an income category ` +
      'has no budgeted amount, so setting one would change nothing. Nothing was written.',
    category.id,
  );
}

/** transfer into or out of an income category: a transfer moves budgeted money between expense categories. */
export function incomeTransferRefusal(category: { id: string; name?: string }): OutOfRangeRefusal {
  return new OutOfRangeRefusal(
    `Category ${label(category)} is not an expense category: a transfer moves budgeted money between ` +
      'expense categories. Nothing was written.',
    category.id,
  );
}
