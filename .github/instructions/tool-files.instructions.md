---
applyTo: "src/tools/*.ts"
---

## Rules for MCP tool files (`src/tools/*.ts`)

- Tool name MUST follow `actual_{domain}_{action}` snake_case convention
- File name MUST match the tool name (e.g. `accounts_create.ts` for `actual_accounts_create`)
- InputSchema MUST use `z.object({...})` from Zod
- Use types from `CommonSchemas` in `src/lib/schemas/common.ts` for shared fields:
  - Dates → `CommonSchemas.date` (validates YYYY-MM-DD)
  - Account UUIDs → `CommonSchemas.accountId`
  - Amounts → `CommonSchemas.amountCents` (integer cents, never decimal dollars)
- The `call` function MUST `InputSchema.parse(args)` before any other logic
- **NEVER wrap an `adapter.*` call in a session of your own.** `adapter.*` methods already open one, and the API mutex (`withApiLock` in `actual-adapter.ts`) is NOT reentrant, so nesting deadlocks. What you observe is a ~30s stall then `Actual API operation timed out after 30000ms (ACTUAL_OP_TIMEOUT_MS)`, because #270 bounds each operation inside the lock and that timeout is what breaks the deadlock. Read that error as a probable nesting bug, not a slow server.
- Default to calling `adapter.*` methods. Do NOT reach for `@actual-app/api` just to avoid a wrapper.
- **Importing `@actual-app/api` directly is correct in one case:** when you are already INSIDE a single adapter session callback and need more than one operation in that one cycle. Then use the raw functions, because calling back through `adapter.*` from in there is the nesting deadlock above. Five tool files do this today, and they are the pattern to copy:
  - `rules_delete.ts`, `rules_create_or_update.ts`, `schedules_delete.ts`, `category_groups_delete.ts`: raw calls inside one `adapter.withWriteSession(...)`, which is how a read and a write share one cycle (#142)
  - `budget_updates_batch.ts`: raw calls inside `adapter.batchBudgetUpdates(...)`, a batch of pure writes
- Error messages must be actionable: include entity type, ID, and a suggested next tool
- After creating a tool file, you MUST:
  1. Export it from `src/tools/index.ts`
  2. Add the name to `IMPLEMENTED_TOOLS` in `src/actualToolsManager.ts`
  3. Run `npm run build` first (verify-tools reads from `dist/`, not `src/`)
  4. Run `npm run verify-tools` to confirm registration
- To check uncovered Actual API surface before implementing: `npm run check:coverage`
  (prints every `@actual-app/api` method against the current tool list; read-only, safe to run)

> On conflict, `CLAUDE.md` is authoritative over this file. It carries the same rules with fuller rationale.
