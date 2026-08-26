# Write-effect audit

<!-- audited-api-version: 26.8.1 -->

Which write tools can report success for an upstream call that completed without doing
anything? This file is the answer, per tool, with the evidence and the date it was taken.

It exists because two instances of that shape (#347, #349) were found by accident, months
apart, and neither by a test. The point of a table is that the next one is found by
looking.

**Read the disposition column as a claim about a specific version.** Everything here was
established against `@actual-app/api` 26.8.1. Upstream can turn a throwing path into a
silent one in any release. The staleness reminder in `.github/workflows/api-surface-drift.yml`
reports when the installed version has moved past the audited one. That lane is
deliberately non-blocking: see "Why the reminder cannot be a gate" below.

### How this version was verified

The table was first built against 26.8.0 and then re-verified mechanically against 26.8.1
by matching each load-bearing upstream construct in the CONFIRMED rows against the newer
source map: both `closeAccount` early returns, the zero-transaction `db.deleteAccount`, the
`balance is non-zero` throw, the bare `db.update` in `reopenAccount`, the `deleteRule` and
`holdForNextMonth` boolean returns, both silent payee returns, and the `calcBufferedAmount`
clamp. All nine still hold. Anyone moving the marker again should do the same and say so
here, because a marker that moves without a re-check is worse than a stale one: it looks
verified.

## How to re-run this audit

`@actual-app/api` ships its full upstream TypeScript source inside its bundle source map,
so the audit runs offline against the exact build installed, with no live server and no
guessing which upstream tag matches the package.

```js
// from the repo root, one off
const fs = require('fs'), path = require('path');
const m = JSON.parse(fs.readFileSync('node_modules/@actual-app/api/dist/index.js.map', 'utf8'));
m.sources.forEach((s, i) => {
  const c = m.sourcesContent[i];
  if (c == null) return;
  const p = path.join('/tmp/upstream', s.replace(/^(\.\.\/)+/, ''));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, c);
});
```

That yields roughly 1140 files including all of `loot-core/src/server`. Trace a tool as:
`methods.ts` (the published signature) to `loot-core/src/server/api.ts` (the `api/*`
handler) to the domain app (`accounts/app.ts`, `payees/app.ts`, `budget/app.ts`, ...) to
`db/index.ts`. The base table schema is in `dist/default-db.sqlite`; later columns are in
`dist/migrations/*.sql`.

## What the published documentation is and is not good for

The [API reference](https://actualbudget.org/docs/api/reference/) is authoritative for
SIGNATURES and is how the missing `transferAccountId` parameter on `actual_accounts_close`
was found. It is NOT usable for return values or failure behaviour:

| Method | Documented | Actually returns at 26.8.1 |
|---|---|---|
| `deleteRule` | `Promise<null>` | `boolean`, `false` when a schedule owns the rule |
| `holdBudgetForNextMonth` | `Promise<null>` | `boolean`, `false` when to-budget is not positive |
| `updateTransaction` | `Promise<null>` | array of updated ids, `[]` when nothing matched |
| `deleteTransaction` | `Promise<null>` | array of deleted ids, `[]` when nothing matched |
| `addTransactions` | `Promise<id[]>` | the string `'ok'` |
| `updatePayee` | `Promise<id>` | not an id |

The reference documents no error behaviour for a non-existent id anywhere, which is why a
reader who checks the docs concludes there is nothing to check.

## The four shapes

A tool that ends in `return { success: true }` is not wrong by default. When the adapter
throws on failure, the literal is accurate. It becomes a lie in four distinct ways:

- **A, the API already told us.** The call returns `false` or `[]` and the tool discards
  it. This is [CWE-252](https://cwe.mitre.org/data/definitions/252.html). Free to fix.
- **B, guarded early-return.** Upstream checks state and returns without acting
  (`if (!account || account.closed === 1) return;`). Costs one read.
- **C, CRDT phantom insert.** `db.update` does not run a SQL UPDATE. It sends CRDT
  messages, and the apply path INSERTs when the row was absent, so an update against an
  unknown id CREATES a partial row rather than matching nothing.
- **D, unvalidated foreign key.** The write succeeds against a target that does not exist
  and leaves orphans.

## Why the reminder cannot be a gate

The scheduled release train bumps `@actual-app/api` automatically. A blocking staleness
check would fail that train on a routine upstream bump, which is the exact failure #321
was written to remove: a test whose result changed with no commit killed the train for two
nights and blocked a security PR behind a red that nobody had caused. The reminder reports;
a human re-runs the extraction and re-reads the handlers whose disposition depends on
upstream throwing.

## The table

Disposition values:

- **CONFIRMED**: upstream can complete without effect AND no guard in this server catches
  it. Every one has a ticket.
- **SAFE**: either upstream throws, or `src/lib/actual-adapter.ts` or the tool guards it.
  The guard is named so a future reader can check it still exists.
- **UNKNOWN**: not traced. Not a claim of safety.

A finding is only real when BOTH halves fail: upstream no-ops and we do not catch it. Two
of the original ten findings failed that second test and were downgraded (see the
correction on #350), which is why the guard column exists at all.

Where a row says a ticket LANDED, the fix is on the branch that carried this file, not
merely proposed. Where it says OPEN, the ticket exists and the behaviour is still present.

### CONFIRMED

| Tool | Upstream call | Shape | Evidence at 26.8.1 | Ticket |
|---|---|---|---|---|
| `actual_accounts_close` | `closeAccount` | B | `accounts/app.ts:613` early return on missing or already-closed; `:620` deletes a zero-transaction account; `transferAccountId` documented but not exposed by our schema | #357 LANDED |
| `actual_accounts_reopen` | `reopenAccount` | C | `accounts/app.ts:702` bare `db.update`; phantom row is visible in `getAccounts()` | #358 LANDED |
| `actual_accounts_update` | `updateAccount` | C | `db/index.ts` `updateAccount` to `update()` | #360 LANDED |
| `actual_categories_update` | `updateCategory` | C | `budget/app.ts` `updateCategory` to `db.updateCategory`; phantom is INVISIBLE (orphan `cat_group`) | #360 LANDED |
| `actual_category_groups_update` | `updateCategoryGroup` | C | same shape | #360 LANDED |
| `actual_payees_update` | `updatePayee` | C | `payees/app.ts` `batchChangePayees` to `db.updatePayee` | #360 LANDED |
| `actual_payees_delete` (transfer payee) | `deletePayee` | B | `db/index.ts` `deletePayee`: `if (transfer_acct) return;`. Our adapter checked existence only, and `getPayees()` includes transfer payees | #356 LANDED |
| `actual_payees_merge` | `mergePayees` | B | `db/index.ts` `mergePayees`: silent return on a transfer target, silent filter of transfer sources, raw TypeError on an unknown id | #356 LANDED |
| `actual_rules_delete` (schedule-owned) | `deleteRule` | A | `transactions/transaction-rules.ts:236` returns `false`; the tool discarded it | #355 LANDED |
| `actual_budgets_holdForNextMonth` | `holdBudgetForNextMonth` | A | `budget/actions.ts` returns `false` when to-budget is not positive | #355 LANDED |
| `actual_transactions_create` | `addTransactions` | D | `accounts/sync.ts:961` never validates `acctId`; `api.ts:552` returns `'ok'` unconditionally | #359 LANDED |
| `actual_budgets_setAmount` (month) | `setBudgetAmount` | D | `api.ts:466` omits the `validateMonth` its three siblings call, and the tool's schema did not check the format either. The guard now refuses any month outside the budget's own bounds, which upstream `getBudgetRange` computes as earliest-transaction-month minus 3 to current-month plus 12. A budget with no transactions yet therefore cannot be back-filled further than 3 months, which is upstream's rule, not ours | #361 LANDED |

### SAFE

| Tool | What makes it safe |
|---|---|
| `actual_accounts_delete` | verify-after in the tool (#347) |
| `actual_budgets_import` | fixed in #349 |
| `actual_transactions_delete` | adapter pre-flight by id with `splits: 'all'` (#212/#305); upstream also returns `[]` |
| `actual_transactions_update` | same pre-flight (#212/#305) |
| `actual_categories_delete` | adapter pre-check, AND upstream throws `Category with id X not found.` |
| `actual_category_groups_delete` | tool pre-check against `getCategoryGroups()`, which includes hidden groups when called with no argument |
| `actual_schedules_delete` | tool pre-check against `getSchedules()`, plus constraint-error translation |
| `actual_schedules_update` | upstream throws `Schedule X not found` (`api.ts:920`) |
| `actual_tags_delete` | adapter pre-check against `getTags()` |
| `actual_tags_update` | adapter throws `notFoundMsg('Tag', ...)` |
| `actual_rules_update` | adapter throws `Rule with id <id> not found` |
| `actual_payees_delete` (unknown id) | adapter pre-check against `getPayees()` |
| `actual_budgets_setAmount` (unknown category) | adapter pre-check since #89 |
| `actual_budgets_setCarryover` | upstream validates BOTH month and category |
| `actual_budgets_resetHold` | `setBuffer(month, 0)`, no conditional path |
| `actual_transfers_create` | adapter validates both accounts, refuses closed ones, and requires the destination transfer payee |
| `actual_notes_update` | the tool validates the entity id against four listings to prevent orphan notes |
| `actual_session_close` | pool only, not an Actual write |

### Scope: which tools belong in this table at all

Every tool that WRITES. Read-only tools (`*_get`, `*_list`, `*_search_by_*`, `*_summary_*`,
`actual_entities_search`, `actual_server_info`, `actual_preferences_get`,
`actual_session_list`, `actual_get_id_by_name`) cannot report success for a write that did
not happen, so they are out of scope by construction and are deliberately absent.

`actual_query_run` is the one judgement call: it is read-oriented and its SQL is checked by
`src/lib/query-validator.ts`, but it is the only tool that could in principle reach a write
path through raw SQL. Listed as UNKNOWN rather than assumed read-only.

### UNKNOWN

Not traced in the 2026-08-25 pass. Absence from the CONFIRMED table is not evidence of
safety.

`actual_accounts_create`, `actual_schedules_create`, `actual_budgets_switch`,
`actual_budgets_export`, `actual_budgets_transfer`, `actual_budget_updates_batch`,
`actual_categories_create`, `actual_category_groups_create`, `actual_rules_create`,
`actual_rules_create_or_update`, `actual_payees_create`, `actual_tags_create`,
`actual_transactions_import`, `actual_transactions_update_batch`, `actual_bank_sync`,
`actual_query_run`.

`actual_accounts_create` and `actual_schedules_create` were missing from this file entirely
until the architectural review of PR #367 noticed. That is the failure mode this document
warns about in its own opening: a table that silently omits a case reads as coverage. A
membership test that fails CI when an `IMPLEMENTED_TOOLS` entry appears in no row would make
it structural rather than a matter of care, and is tracked in #370.

`actual_transactions_import` is the one worth doing next: it routes through
`importTransactions` to `reconcileTransactions`, which takes `acctId` without looking it
up, so it may share `actual_transactions_create`'s shape D exactly.

## Two findings that were WRONG, and why the guard column exists

The first pass of this audit traced `methods.ts` to `api.ts` to the domain handler to
`db/index.ts`, and it traced the tool files. It did not check `src/lib/actual-adapter.ts`
method by method. Two findings were overstated as a result:

- **`budgets_setAmount` was reported as accepting an unknown category.** It has not since
  #89: `adapter.setBudgetAmount` reads `getCategories()` and throws. Only the month-range
  half survived.
- **The update family was reported as six tools.** `adapter.updateTag` and
  `adapter.updateRule` already throw a not-found. Four remain.

So a finding is only real when BOTH halves fail: upstream can complete without effect AND
no guard in this server catches it. Trace upstream, then trace the adapter method, then
trace the tool. Skipping the middle step produced a 20 percent false-positive rate on the
first pass.

## Where a guard belongs (#371)

Most READ-THEN-WRITE guards now live in `src/lib/actual-adapter.ts`, not in the tool. Three of them
(`accounts_close`, `accounts_reopen`, `budgets_holdForNextMonth`) were briefly in the tool
layer and were moved.

**Five read-then-write guards are still in the tool layer, deliberately not migrated in that pass**, and saying so
matters because an earlier version of this paragraph claimed the rule was universal when it
was not: `rules_delete` (itself a CONFIRMED row), `category_groups_delete`,
`schedules_delete`, `rules_create_or_update` and `notes_update`. They work, and they predate
the rule. Migrating them is tracked in #376.

`actual_accounts_delete` is deliberately not in that list: its guard is a verify-AFTER (#347),
not a read-then-write, and the SAFE table already records it as living in the tool. The single-cycle read-decide-write property never required
the raw api, and putting it in the adapter keeps `retry` on the reads, keeps one
observability call site per operation, and leaves no unguarded `adapter.*` method for a
future caller to reach for. The tool owns the schema and the response wording; the adapter
owns whether the write is allowed to happen.

## The tests this class needs

Two habits, learned from the tickets above:

- **Assert the EFFECT, not the call.** Several E2E tests called a write tool and logged a
  checkmark. They passed whether or not anything happened, which is the same failure the
  tools had.
- **Check the stub is telling the truth.** `tests/unit/rules_delete.test.js` stubbed
  `deleteRule` as returning `undefined`, encoding the same wrong assumption the tool made.
  A stub that mirrors the bug cannot catch the bug.

A cheap way to prove a new test is not vacuous: remove the guard from `dist/`, confirm the
test fails, restore it, confirm the test passes. Every fix in this audit was checked that
way.
