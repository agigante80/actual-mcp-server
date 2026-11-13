/**
 * compact-calls.js
 *
 * #680: the compact tool calls the SUPPORT code of the live suite (runner.js, residue.js,
 * cleanup.js) makes, in one place. The default tool surface publishes 15 compact tools; a
 * legacy `actual_*` name is refused there ("Tool ... is not available"), and the first refusal
 * in the cleanup phase used to end the whole run. The test modules in tests/manual/tests/ were
 * migrated in #681; this file is the same migration for the code around them.
 *
 * Every shape below was read from src/compact/ (list_entities.ts, manage_*.ts,
 * search_transactions.ts), and tests/unit/manual_support_compact.test.js runs each call through
 * the real compact dispatcher with a stubbed operations layer, so a bad argument fails a unit
 * test instead of a release gate. The compact tools return the legacy tool's value unchanged,
 * so the result shapes are the legacy ones:
 *
 *   list_entities type account         -> { result: [account] }       (client unwraps `result`)
 *   list_entities type payee|category  -> { result: [..] }
 *   list_entities type tag             -> [tag]
 *   list_entities type category_group  -> { groups: [..] }           (own key, #584)
 *   list_entities type rule            -> { rules: [..] }            (own key, #584)
 *   list_entities type schedule        -> { schedules: [..], count } (own key, #584)
 *   list_entities type budget_file scope server -> { result: [budget file] }
 *
 * PAGINATION: none of these listings paginates or caps. `limit` exists on list_entities only
 * for a `query` search (default 10, max 100), and this suite never passes `query`. A bare
 * `type` lists every entity, which is what the sweep and the zero-residue assertion need.
 * `search_transactions by account` has no limit either (`limit` is not a field of that row).
 */

/** The listings the sweep and the zero-residue assertion read, keyed by list_entities type. */
export const LISTING_TYPES = ['account', 'payee', 'category', 'category_group', 'rule', 'schedule', 'tag'];

/**
 * #584: three listings return their array under their own key, and both test clients pass that
 * shape through unchanged (unwrapToolResult strips only `result`). A key is read only from the
 * type that returns it.
 */
export const LISTING_KEY = {
  category_group: 'groups',
  rule: 'rules',
  schedule: 'schedules',
};

/** The call that lists every entity of one type. */
export const listCall = (type) => ['list_entities', { type }];

/** Stable label for a listing, used in `unreadable` and in messages. */
export const listingLabel = (type) => `list_entities type ${type}`;

/** The call that lists the budget files the server has. */
export const budgetFilesCall = () => ['list_entities', { type: 'budget_file', scope: 'server' }];

/** Every transaction of one account. No limit, no paging. */
export const accountTransactionsCall = (accountId) => ['search_transactions', { by: 'account', account_id: accountId }];

/** Delete and close calls, by kind. Each returns [toolName, args]. */
export const REMOVE = {
  transaction: (id) => ['manage_transactions', { action: 'delete', id }],
  tag: (id) => ['manage_tags', { action: 'delete', id }],
  rule: (id) => ['manage_rules', { action: 'delete', id }],
  schedule: (id) => ['manage_schedules', { action: 'delete', id }],
  payee: (id) => ['manage_payees', { action: 'delete', id }],
  category: (id) => ['manage_categories', { action: 'delete', entity: 'category', id }],
  group: (id) => ['manage_categories', { action: 'delete', entity: 'category_group', id }],
  account: (id) => ['manage_accounts', { action: 'delete', entity: 'account', id }],
  accountClose: (id) => ['manage_accounts', { action: 'close', id }],
};

/** Run one REMOVE call through `callTool`. */
export const remove = (callTool, kind, id) => callTool(...REMOVE[kind](id));
