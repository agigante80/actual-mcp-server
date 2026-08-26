/**
 * MCP tool annotations for the 74-tool surface (#379).
 *
 * The Model Context Protocol lets a server describe each tool's NATURE to clients, so a
 * model or a UI can know which tools mutate a budget BEFORE calling one. This file is the
 * single source of that classification, and `ActualMCPConnection` attaches it to every
 * `tools/list` entry.
 *
 * THE SPEC'S DEFAULTS ARE ALREADY CONSERVATIVE, which shapes what is worth declaring.
 * From `schema/2025-06-18/schema.ts`:
 *
 *   readOnlyHint     default false   "the tool does not modify its environment"
 *   destructiveHint  default TRUE    "may perform destructive updates"; only meaningful when readOnlyHint is false
 *   idempotentHint   default false   "calling repeatedly with the same arguments has no additional effect"
 *   openWorldHint    default TRUE    "may interact with an open world of external entities"
 *
 * So a tool that declares nothing is already treated as write-capable, destructive and
 * open-world. The value here is therefore NOT warning about the dangerous tools; it is
 * telling clients which tools are SAFE, and correcting `openWorldHint`, whose default is
 * wrong for 73 of our 74 tools: this server's domain is one Actual Budget instance, a
 * CLOSED world. Only `actual_bank_sync` reaches outside it, to GoCardless or SimpleFIN.
 *
 * THESE ARE HINTS, NEVER A GUARD. The spec is explicit: "all properties in ToolAnnotations
 * are hints. They are not guaranteed to provide a faithful description of tool behavior",
 * and "Clients should never make tool use decisions based on ToolAnnotations received from
 * untrusted servers." Nothing in `src/` may branch on an annotation. Authorisation stays in
 * `budget-acl.ts`, and refusal stays in the adapter guards.
 *
 * WHY A CENTRAL TABLE rather than a field on each tool. `types/tool.d.ts` is in CLAUDE.md's
 * do-not-modify tier, and most tools use the legacy `ToolDefinition` shape, so a per-tool
 * `annotations` field needs that permission first. A table also puts the whole
 * classification on one screen next to the reasoning, which is what makes it auditable
 * against `docs/audit/write-effect-audit.md`, and `tests/unit/tool_annotations.test.js`
 * makes omission impossible. Moving to per-tool declarations later is mechanical.
 */

import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/**
 * The ONLY tool that reaches outside this Actual instance. Bank sync calls a third-party
 * aggregator (GoCardless / SimpleFIN), which is the textbook "open world".
 */
const OPEN_WORLD = new Set<string>(['actual_bank_sync']);

/**
 * Tools that provably change NOTHING. Verified mechanically by
 * `tests/unit/tool_annotations.test.js`, which resolves each tool's `adapter.*` calls and
 * fails if one of these reaches `queueWriteOperation`.
 *
 * Claimed only where it is certain. Three read-path tools are deliberately absent because
 * "does not modify its environment" is false for them, and a wrong `true` here is worse
 * than no annotation at all:
 *
 *   actual_bank_sync       runs through `withActualApi` (the read path) but IMPORTS
 *                          transactions, so the call graph says read and reality says
 *                          write. Reality wins.
 *   actual_budgets_export  writes a zip into the server's data directory.
 *   actual_budgets_switch  changes the session's active budget and persists a preference.
 *   actual_session_close   closes a pooled connection: server state, not budget data.
 */
const READ_ONLY = new Set<string>([
  'actual_accounts_get_balance',
  'actual_accounts_list',
  'actual_budgets_get_all',
  'actual_budgets_getMonth',
  'actual_budgets_getMonths',
  'actual_budgets_list_available',
  'actual_categories_get',
  'actual_category_groups_get',
  'actual_entities_search',
  'actual_get_id_by_name',
  'actual_notes_get',
  'actual_payee_rules_get',
  'actual_payees_common_list',
  'actual_payees_get',
  'actual_preferences_get',
  'actual_query_run',
  'actual_rules_get',
  'actual_schedules_get',
  'actual_server_get_version',
  'actual_server_info',
  'actual_session_list',
  'actual_tags_list',
  'actual_transactions_filter',
  'actual_transactions_get',
  'actual_transactions_search_by_amount',
  'actual_transactions_search_by_category',
  'actual_transactions_search_by_month',
  'actual_transactions_search_by_payee',
  'actual_transactions_summary_by_category',
  'actual_transactions_summary_by_payee',
  'actual_transactions_uncategorized',
]);

/**
 * Write tools that REMOVE data or make an irreversible change. Everything else that writes
 * is additive or an in-place field update, which the spec calls not-destructive.
 *
 * `accounts_close` is in this list and it is the interesting one: Actual REMOVES an account
 * that has no transactions rather than closing it (documented in the tool's own description
 * and in #357), so a close can be a delete.
 */
const DESTRUCTIVE = new Set<string>([
  'actual_accounts_close',
  'actual_accounts_delete',
  // Upstream `reconcileTransactions` overwrites fields on transactions that ALREADY exist
  // (imported_id, imported_payee, cleared, raw_synced_data) and propagates cleared and date
  // onto split children.
  //
  // NOTE that `actual_transactions_import` calls the same upstream function and is NOT
  // marked destructive, which needs a reason rather than an accident. The difference is the
  // `date` rewrite: bank sync honours the per-account `sync-update-dates-<id>` preference,
  // so a user who enabled it gets EXISTING transaction dates rewritten by a tool they did
  // not point at those rows. An explicit import only touches what the caller handed it.
  // Under the policy above (a field overwrite is additive) that is the line, and it is a
  // judgement call rather than a derivation.
  'actual_bank_sync',
  'actual_budgets_export',
  'actual_budgets_import',
  'actual_categories_delete',
  'actual_category_groups_delete',
  'actual_payees_delete',
  'actual_payees_merge',
  'actual_rules_delete',
  'actual_schedules_delete',
  'actual_tags_delete',
  'actual_transactions_delete',
  // THE NON-OBVIOUS ONE. `fields.subtransactions` (CommonSchemas, `.strict()`) has no `id`,
  // so upstream's `makeChild` mints a fresh UUID for every child and `diffItems` tombstones
  // every existing one. Editing one amount on a six-way split DELETES all six rows and
  // creates six new ones with new ids, breaking any external reference to them. That also
  // makes it non-idempotent, which is why it is absent from IDEMPOTENT below.
  'actual_transactions_update',
  // Removes a live pooled connection. With no `sessionId` it closes the OLDEST IDLE
  // session, so a client that auto-approves non-destructive tools could let a model loop it
  // and drain the pool, reproducing the per-operation re-login burst #134 exists to prevent.
  'actual_session_close',
]);

/**
 * Write tools that only ADD or set a field in place: not destructive.
 *
 * This set exists to make the classification TOTAL. Without it, a tool nobody classified
 * fell through every set and `annotationsFor` published `destructiveHint: false` and
 * `openWorldHint: false`, which INVERTS the spec's conservative defaults (both default to
 * true) into positive safety claims about a tool nobody had looked at. Silence has to be
 * impossible here, not merely discouraged, and `tests/unit/tool_annotations.test.js`
 * asserts every registered tool appears in exactly one of READ_ONLY, DESTRUCTIVE or
 * ADDITIVE.
 *
 * THE POLICY, stated so the boundary is a decision rather than an omission: overwriting a
 * FIELD on an existing row is additive; removing or replacing a ROW is destructive. So
 * `budgets_setAmount` and `accounts_update` are additive, while `transactions_update` is
 * not, because on the split path it deletes and recreates child rows.
 */
const ADDITIVE = new Set<string>([
  'actual_accounts_create',
  'actual_accounts_reopen',
  'actual_accounts_update',
  'actual_budgets_switch',
  'actual_budgets_holdForNextMonth',
  'actual_budgets_resetHold',
  'actual_budgets_setAmount',
  'actual_budgets_setCarryover',
  'actual_budgets_transfer',
  'actual_budget_updates_batch',
  'actual_categories_create',
  'actual_categories_update',
  'actual_category_groups_create',
  'actual_category_groups_update',
  'actual_payees_create',
  'actual_payees_update',
  'actual_rules_create',
  'actual_rules_create_or_update',
  'actual_rules_update',
  'actual_schedules_create',
  'actual_schedules_update',
  'actual_transactions_create',
  'actual_transactions_import',
  'actual_transactions_update_batch',
  'actual_transfers_create',
  'actual_tags_create',
  'actual_tags_update',
  'actual_notes_update',
]);

/**
 * Write tools where repeating the SAME call leaves the same STATE.
 *
 * THE STANDARD USED, because it is the judgement call in this file. The spec says
 * idempotent means "calling the tool repeatedly with the same arguments will have no
 * additional effect on the its environment". That is about STATE, not about the response,
 * so a tool that refuses the second call while changing nothing still qualifies. This
 * matters most for the delete family: since #376/#377 they THROW a NotFoundRefusal for an
 * absent id rather than reporting success, but the second call writes nothing, so the state
 * after one delete and after five is identical. A client deciding whether a timed-out write
 * is safe to retry cares about the state, which is exactly what this flag answers.
 *
 * Values are taken from `docs/audit/write-effect-audit.md` rather than guessed, so each one
 * has a history behind it.
 *
 * The exclusions are the point:
 *   most `*_create`             each call makes ANOTHER entity, so the state differs
 *   budgets_holdForNextMonth    upstream ADDS to the buffer, so a retry holds twice (#355)
 *   budgets_transfer            moves money again on each call
 *   payees_merge                the sources are gone after the first
 *   bank_sync                   imports whatever is new upstream
 *   transactions_import         adds rows; de-dup is a bank-sync property, not a promise here
 *
 * `actual_tags_create` is the create that IS idempotent, and it is easy to miss: it upserts
 * on the tag word, so a repeat updates the existing tag and returns the same id. Its own
 * description says so and `docker-all-tools.e2e.spec.ts` asserts it. `categories_create` is
 * deliberately NOT here: it REJECTS a duplicate rather than upserting, and whether upstream
 * truly refuses every duplicate is not something this file should assume.
 */
const IDEMPOTENT = new Set<string>([
  // NOT the same question as #165's "safe to re-issue". `tests/unit/adapter_nonidempotent_no_retry.test.js`
  // pins several of these as non-idempotent for RETRY purposes, and both are right: the MCP
  // spec asks whether repeating leaves the same STATE (a second delete writes nothing),
  // while #165 asks whether re-issuing an in-flight write can corrupt or mislead. A client
  // reading this flag to decide "auto-retry after a timeout?" should still respect #165, so
  // the two lists disagreeing on paper is expected and is recorded here rather than left to
  // be re-litigated.
  //
  // `actual_session_close` is deliberately ABSENT: called with no sessionId it closes the
  // OLDEST IDLE session, so repeating it closes a DIFFERENT session each time until the
  // pool is empty. That is the literal negation of the flag.
  'actual_accounts_close',
  'actual_accounts_delete',
  'actual_accounts_reopen',
  'actual_accounts_update',
  'actual_budget_updates_batch',
  'actual_budgets_resetHold',
  'actual_budgets_setAmount',
  'actual_budgets_setCarryover',
  'actual_budgets_switch',
  'actual_categories_delete',
  'actual_categories_update',
  'actual_category_groups_delete',
  'actual_category_groups_update',
  'actual_notes_update',
  'actual_payees_delete',
  'actual_payees_update',
  'actual_rules_create_or_update',
  'actual_rules_delete',
  'actual_rules_update',
  'actual_schedules_delete',
  'actual_schedules_update',
  'actual_tags_create',
  'actual_tags_delete',
  'actual_tags_update',
  'actual_transactions_delete',
  'actual_transactions_update_batch',
]);

/** The sets, exported so the guard can check them without re-deriving the rules. */
export const _ANNOTATION_SETS = { OPEN_WORLD, READ_ONLY, DESTRUCTIVE, ADDITIVE, IDEMPOTENT } as const;

/**
 * Annotations for one tool.
 *
 * Every field is declared explicitly, including where the value equals the spec default.
 * Silence and "declared false" are indistinguishable to a client, but they are very
 * different to the guard: it must be able to tell "this tool was classified as a write"
 * from "somebody forgot to classify it".
 */
export function annotationsFor(toolName: string): ToolAnnotations {
  const readOnly = READ_ONLY.has(toolName);
  const classified = readOnly || DESTRUCTIVE.has(toolName) || ADDITIVE.has(toolName);

  if (!classified) {
    // A tool nobody classified. OMIT `destructiveHint` and `openWorldHint` so the spec's
    // own defaults apply, which are `true` for both: unknown reads as destructive and
    // open-world, the conservative answer. Returning `false` here would have published a
    // positive SAFETY claim about code nobody had looked at, which is strictly worse than
    // saying nothing. The guard fails the build on this case; the shape here is what
    // protects clients in the window before someone notices.
    return { readOnlyHint: false, idempotentHint: false };
  }

  return {
    readOnlyHint: readOnly,
    // Meaningful only when readOnlyHint is false; declared either way so the table round
    // trips, and a read-only tool is trivially non-destructive.
    destructiveHint: readOnly ? false : DESTRUCTIVE.has(toolName),
    idempotentHint: readOnly ? true : IDEMPOTENT.has(toolName),
    openWorldHint: OPEN_WORLD.has(toolName),
  };
}
