# Schedules CRUD — Implementation Guide

**Status:** Ready to implement  
**Version target:** v0.5.x  
**Priority:** 🔴 High — completes 100% Actual Budget API coverage  
**Effort:** ~2 days  
**Blocker:** None — all 4 methods confirmed in `@actual-app/api@26.2.1` (stable)

> 📋 Follow [docs/NEW_TOOL_CHECKLIST.md](../NEW_TOOL_CHECKLIST.md) for each tool. The checklist
> table at the bottom of this file maps every step to the exact file and change needed.

---

## Actual Budget API Methods

Source: [actualbudget.org/docs/api/reference#schedule](https://actualbudget.org/docs/api/reference#schedule) — all confirmed present in `@actual-app/api@26.2.1`.

| Method | Signature | Returns | API ref |
|--------|-----------|---------|---------|
| `getSchedules` | `getSchedules()` | `Promise<Schedule[]>` | [→](https://actualbudget.org/docs/api/reference#getschedules) |
| `createSchedule` | `createSchedule({ schedule })` | `Promise<id>` | [→](https://actualbudget.org/docs/api/reference#createschedule) |
| `updateSchedule` | `updateSchedule(id, fields, resetNextDate?)` | `Promise<Schedule>` | [→](https://actualbudget.org/docs/api/reference#updateschedule) |
| `deleteSchedule` | `deleteSchedule(id)` | `Promise<null>` | [→](https://actualbudget.org/docs/api/reference#deleteschedule) |

> ⚠️ `updateSchedule` has an undocumented **3rd arg `resetNextDate?: boolean`** (present in `dist/methods.js`).
> Pass `true` to force `next_date` recalculation after changing the date/recurrence config.

---

## Schedule Object Shape

Full spec: [actualbudget.org/docs/api/reference#schedule-1](https://actualbudget.org/docs/api/reference#schedule-1)

```typescript
type Schedule = {
  // ── Read-only fields (do NOT supply on create) ───────────────────────────
  id?: string;          // UUID — auto-generated
  rule?: string;        // Auto-created underlying rule UUID — never supply
  next_date?: string;   // Next occurrence date — never supply on create

  // ── Writable fields ──────────────────────────────────────────────────────
  name?: string;               // Must be unique if provided
  completed?: boolean;
  posts_transaction?: boolean; // Auto-post transactions. Default: false
  payee?: string | null;       // Payee UUID. Default: null
  account?: string | null;     // Account UUID. Default: null

  // Amount: single number (cents) OR range (only with amountOp 'isbetween')
  amount?: number | { num1: number; num2: number };
  amountOp?: 'is' | 'isapprox' | 'isbetween';

  // Date: YYYY-MM-DD string (one-off) OR RecurConfig (recurring)
  date: string | RecurConfig; // Required on create
};

type RecurConfig = {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; // required
  start: string;          // YYYY-MM-DD — required
  endMode: 'never' | 'after_n_occurrences' | 'on_date'; // required
  interval?: number;      // Every N periods. Default: 1
  skipWeekend?: boolean;
  weekendSolveMode?: 'before' | 'after'; // When skipWeekend is true
  patterns?: object[];    // RecurPattern — weekday/month-day overrides
  endOccurrences?: number; // When endMode = 'after_n_occurrences'
  endDate?: string;        // YYYY-MM-DD. When endMode = 'on_date'
};
```

---

## The 4 Tools

### `actual_schedules_get`
**File:** `src/tools/schedules_get.ts`  
No required inputs. Returns all schedules as an array.

### `actual_schedules_create`
**File:** `src/tools/schedules_create.ts`

```typescript
const InputSchema = z.object({
  name: z.string().optional().describe('Unique name for the schedule'),
  payee: CommonSchemas.uuid.optional().describe('Payee UUID'),
  account: CommonSchemas.uuid.optional().describe('Account UUID'),
  amount: z.number().int().optional()
    .describe('Amount in cents (negative=expense, positive=income)'),
  amountOp: z.enum(['is', 'isapprox', 'isbetween']).optional().default('is'),
  date: z.union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD for a one-off schedule'),
    z.object({
      frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endMode: z.enum(['never', 'after_n_occurrences', 'on_date']),
      interval: z.number().int().positive().optional(),
      skipWeekend: z.boolean().optional(),
      weekendSolveMode: z.enum(['before', 'after']).optional(),
      endOccurrences: z.number().int().positive().optional(),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).describe('RecurConfig for a recurring schedule'),
  ]).describe('Date string (one-off) or RecurConfig object (recurring)'),
  posts_transaction: z.boolean().optional().default(false)
    .describe('Auto-post transactions on occurrence'),
});
```

### `actual_schedules_update`
**File:** `src/tools/schedules_update.ts`

```typescript
const InputSchema = z.object({
  id: CommonSchemas.uuid.describe('Schedule UUID to update'),
  name: z.string().optional(),
  payee: CommonSchemas.uuid.optional(),
  account: CommonSchemas.uuid.optional(),
  amount: z.number().int().optional(),
  amountOp: z.enum(['is', 'isapprox', 'isbetween']).optional(),
  date: z.union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    z.object({}).passthrough(),
  ]).optional(),
  posts_transaction: z.boolean().optional(),
  resetNextDate: z.boolean().optional().default(false)
    .describe('Set true to recalculate next_date after changing recurrence config'),
});
```

### `actual_schedules_delete`
**File:** `src/tools/schedules_delete.ts`

```typescript
const InputSchema = z.object({
  id: CommonSchemas.uuid.describe('Schedule UUID to delete'),
});
```

---

## Checklist Map

Track progress using [docs/NEW_TOOL_CHECKLIST.md](../NEW_TOOL_CHECKLIST.md). Apply each step once per tool (4×).

### Step 1 — Create tool files

| File to create | Adapter call |
|----------------|-------------|
| `src/tools/schedules_get.ts` | `adapter.getSchedules()` |
| `src/tools/schedules_create.ts` | `adapter.createSchedule(input)` |
| `src/tools/schedules_update.ts` | `adapter.updateSchedule(id, fields, resetNextDate)` |
| `src/tools/schedules_delete.ts` | `adapter.deleteSchedule(id)` |

### Step 2 — Register tools

- `src/tools/index.ts` — add 4 export lines
- `src/actualToolsManager.ts` — add to `IMPLEMENTED_TOOLS`:
  ```
  'actual_schedules_create',
  'actual_schedules_delete',
  'actual_schedules_get',
  'actual_schedules_update',
  ```

### Step 3 — Add adapter methods

Add to `src/lib/actual-adapter.ts` (follow the `withActualApi` + `withConcurrency` + `retry` pattern used by `getRules`, `createRule` etc.):

```typescript
import {
  getSchedules as rawGetSchedules,
  createSchedule as rawCreateSchedule,
  updateSchedule as rawUpdateSchedule,
  deleteSchedule as rawDeleteSchedule,
} from '@actual-app/api';

export async function getSchedules() {
  return withActualApi(async () =>
    withConcurrency(() => retry(() => rawGetSchedules() as Promise<unknown[]>))
  );
}

export async function createSchedule(schedule: unknown) {
  return withActualApi(async () =>
    withConcurrency(() =>
      retry(() => rawCreateSchedule(schedule as Record<string, unknown>) as Promise<string>)
    )
  );
}

export async function updateSchedule(id: string, fields: unknown, resetNextDate?: boolean) {
  return withActualApi(async () =>
    withConcurrency(() =>
      retry(() =>
        rawUpdateSchedule(id, fields as Record<string, unknown>, resetNextDate) as Promise<unknown>
      )
    )
  );
}

export async function deleteSchedule(id: string) {
  return withActualApi(async () =>
    withConcurrency(() => retry(() => rawDeleteSchedule(id) as Promise<null>))
  );
}
```

Also add all 4 to the default export object at the bottom of `actual-adapter.ts`.

### Step 4 — Unit tests

| File | Change |
|------|--------|
| `tests/unit/generated_tools.smoke.test.js` | Increment `EXPECTED_TOOL_COUNT` by 4. Add stub: `schedules_create` needs at minimum `{ date: '2026-01-01' }` |
| `tests/unit/schema_validation.test.js` | Negative tests: invalid `frequency`, invalid `endMode`, non-UUID `id`, `amountOp: 'invalid'` |

### Step 5 — Manual integration tests

New file: `tests/manual/tests/schedule.js`

| Test | Type |
|------|------|
| `actual_schedules_get` → assert result is array | positive |
| `actual_schedules_create` one-off (date string) → assert UUID returned | positive |
| `actual_schedules_create` monthly recurring (RecurConfig) → read back, assert `next_date` populated | positive |
| `actual_schedules_update` → change `name`, read back and verify | positive |
| `actual_schedules_update` with `resetNextDate: true` → change `date`, verify `next_date` changes | positive |
| `actual_schedules_delete` created schedule → verify no longer in list | positive |
| `actual_schedules_delete` non-existent UUID → assert error with context (not a crash) | negative |

Use naming pattern `MCP-Schedule-{timestamp}` so cleanup can find test data.  
Update `tests/manual/README.md` — add `schedule.js` to the module table.

### Step 6 — AI prompt test

File: `tests/manual/test-rules-comprehensive-prompt.txt`

Add a Schedules phase. Required scenarios:
- Positive: create monthly schedule → list all → update name → delete
- Negative: delete a UUID that does not exist → verify useful error returned

Update phase header count and preamble total (`56 tools` → `60 tools`).

### Step 7 — Documentation

| File | Change |
|------|--------|
| `README.md` | `56` → `60` tools; add 4 rows to tool table |
| `docs/PROJECT_OVERVIEW.md` | Tool count + API coverage % (100%) |
| `docs/ARCHITECTURE.md` | Add schedules domain entry |
| `docs/ROADMAP.md` | Mark Schedules CRUD `✅ IMPLEMENTED in v0.5.x` |
| `docker/description/long.md` | Tool count |
| `docker/description/short.md` | Tool count |

### Step 8 — Final validation

```bash
npm run build
npm run test:adapter
npm run test:unit-js
npm run verify-tools
npm audit --audit-level=moderate
```

### Step 9 — Commit

```
feat(tools): add actual_schedules_get/create/update/delete

- 4 schedule CRUD tools — 100% Actual Budget API coverage achieved
- Adapter: getSchedules, createSchedule, updateSchedule (+resetNextDate), deleteSchedule
- All methods confirmed in @actual-app/api@26.2.1 stable
- Tests: unit smoke + schema validation + manual integration (tests/manual/tests/schedule.js)
- Prompt: Schedules phase added to test-rules-comprehensive-prompt.txt
- Docs: README, PROJECT_OVERVIEW, ARCHITECTURE, ROADMAP, docker/description updated
- Total tools: 56 → 60
```

---

## References

- [Actual Budget API — Schedule](https://actualbudget.org/docs/api/reference#schedule)
  - [getSchedules](https://actualbudget.org/docs/api/reference#getschedules)
  - [createSchedule](https://actualbudget.org/docs/api/reference#createschedule)
  - [updateSchedule](https://actualbudget.org/docs/api/reference#updateschedule)
  - [deleteSchedule](https://actualbudget.org/docs/api/reference#deleteschedule)
  - [RecurConfig](https://actualbudget.org/docs/api/reference#recurconfig)
- [`src/lib/actual-adapter.ts`](../../src/lib/actual-adapter.ts) — adapter pattern reference
- [`src/tools/rules_create_or_update.ts`](../../src/tools/rules_create_or_update.ts) — complex schema reference
- [`src/actualToolsManager.ts`](../../src/actualToolsManager.ts)
- [`docs/NEW_TOOL_CHECKLIST.md`](../NEW_TOOL_CHECKLIST.md)
