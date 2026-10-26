/**
 * tests/manual/context.js
 *
 * Ownership of the ids the integration modules share through `context`.
 *
 * #590: modules borrow a PRE-EXISTING category when the budget has one and store its id
 * in `context.categoryId`, the slot the runner's cleanup phase deletes at the end of the run.
 * That deleted one real category per transport leg on every mutating run, and the zero-residue
 * assertion could not see it because it only looks for objects the suite ADDED. Ownership is
 * therefore recorded here, never inferred: a borrow site goes through `borrowCategory`, and the
 * cleanup phase asks `isBorrowedCategory` before it deletes. Modules keep reading
 * `context.categoryId` as their working id, so nothing else changes.
 *
 * #591: a borrow is safe only for a module that uses the category as a VALUE (a rule action, a
 * read). budget.js wrote month amounts onto its borrowed category and never restored them, so it
 * no longer borrows: it creates its own group and categories and leaves this slot alone, so
 * two modules borrow today (rules.js, batch_uncategorized_rules_upsert.js). A module that
 * needs to WRITE to a category must create one, not borrow.
 *
 * A guard in tests/unit/manual_borrowed_category.test.js fails when a module writes a borrowed
 * id into `context.categoryId` without this helper.
 */

/**
 * Record `id` as the working category AND as borrowed from the budget (not created by the suite).
 * @param {object} context
 * @param {string} id
 */
export function borrowCategory(context, id) {
  context.categoryId = id;
  context.borrowedCategoryIds = Array.isArray(context.borrowedCategoryIds)
    ? context.borrowedCategoryIds
    : [];
  if (!context.borrowedCategoryIds.includes(id)) context.borrowedCategoryIds.push(id);
}

/**
 * The cleanup phase's decision for the shared category slot: delete `context.categoryId` only
 * when it is set and the suite did not merely borrow it. Lives here so the runner and the unit
 * test call the same function rather than two copies of the rule.
 * @param {object} context
 */
export function shouldDeleteCategory(context) {
  return Boolean(context.categoryId) && !isBorrowedCategory(context, context.categoryId);
}

/**
 * True when `id` was borrowed from the budget and must not be deleted by the suite.
 * @param {object} context
 * @param {string | null | undefined} id
 */
export function isBorrowedCategory(context, id) {
  return Boolean(id) && Array.isArray(context.borrowedCategoryIds) && context.borrowedCategoryIds.includes(id);
}
