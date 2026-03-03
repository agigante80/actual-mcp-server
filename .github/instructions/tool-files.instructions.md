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
- All Actual API calls MUST go through `adapter.*` methods — never import `@actual-app/api` directly
- `adapter.*` methods already use `withActualApi` — do NOT add a second wrapper
- Error messages must be actionable: include entity type, ID, and a suggested next tool
- After creating a tool file, you MUST:
  1. Export it from `src/tools/index.ts`
  2. Add the name to `IMPLEMENTED_TOOLS` in `src/actualToolsManager.ts`
  3. Run `npm run build` first (verify-tools reads from `dist/`, not `src/`)
  4. Run `npm run verify-tools` to confirm registration
- To check uncovered Actual API surface before implementing: `npm run check:coverage`
  (prints all `@actual-app/api` methods vs current tool list — read-only, safe to run)
