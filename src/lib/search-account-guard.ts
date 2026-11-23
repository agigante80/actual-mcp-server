import { OutOfRangeRefusal } from './errors.js';

/**
 * #756: the category, month and filter transaction searches exclude off-budget accounts on
 * purpose (#81: an off-budget transaction cannot carry a category). They apply that exclusion to
 * the rows after the fetch, so an EXPLICIT accountId naming such an account used to come back as
 * an empty result that reads as "no transactions". This refuses it instead, with a typed refusal.
 *
 * Pure and read-only: it looks at the account listing the tool already fetched (so the budget
 * ACL applied to that listing applies here) and fetches nothing. An id that is not in the listing
 * returns silently, because the not-found answer belongs to the caller and must not be
 * replaced, and an account the listing hides is never named.
 *
 * The message names the LEGACY tool: the compact layer rewrites it to
 * `search_transactions with by account` (src/compact/dispatch.ts), and shared text in src/
 * never names a compact tool.
 */
export function refuseOffBudgetAccount(
  accounts: readonly { id?: string; offbudget?: boolean }[],
  accountId: string | null | undefined,
): void {
  if (!accountId) return;
  const account = accounts.find((a) => a?.id === accountId);
  if (account?.offbudget !== true) return;
  throw new OutOfRangeRefusal(
    `Account ${accountId} is off-budget, and this search excludes off-budget accounts (their transactions cannot carry categories). Use actual_transactions_get to read it.`,
    accountId,
  );
}
