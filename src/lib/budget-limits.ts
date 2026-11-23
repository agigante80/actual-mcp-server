/**
 * The largest budget amount, in cents, that Actual can store (#759).
 *
 * Upstream `setBudget` runs the amount through `safeNumber`, which allows only
 * `2 ** 51 - 1` (2251799813685247) and throws "can't safely perform arithmetic" above it.
 * Zod's `.int()` bound is `Number.MAX_SAFE_INTEGER` (2 ** 53 - 1), so without this limit an
 * amount between the two passed validation and failed inside the write.
 */
export const MAX_BUDGET_AMOUNT_CENTS = 2 ** 51 - 1;
