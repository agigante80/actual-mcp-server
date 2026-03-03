# Multi-Budget Switching

**Status:** Planned — v0.5.x (Q2 2026)  
**Priority:** 🟠 Medium  
**Effort:** ~2 days  
**Blocker:** None

---

## Overview

Add a tool (`actual_budgets_switch`) to let an AI agent switch between multiple Actual Budget files in a single conversation, without reconnecting to the server.

## Tool

### `actual_budgets_switch`

```typescript
{
  budgetId: string;  // Sync ID of the target budget (UUID)
}
```

**Response:**
```json
{
  "success": true,
  "budgetId": "uuid-of-new-budget",
  "message": "Switched to budget 'Family Budget'"
}
```

### Supporting: `actual_budgets_list_available`
Returns all budgets accessible from the configured Actual server, so the AI can resolve names to IDs.

## Implementation

1. Call `api.shutdown()` to close the current budget and release resources
2. Clear internal caches (accounts, categories, payees) in `ActualConnectionPool`
3. Call `api.init(config)` + `api.downloadBudget({ syncId })` to open the new budget
4. Update `ActualConnectionPool` state with the new budget ID
5. Return success + new budget name

> **Note:** There is **no `closeBudget()` method** in `@actual-app/api`. Use `shutdown()` + `init()` + `downloadBudget()` — all three are present in `26.2.1` stable.

**Community reference**: [ahmadrazach fork](https://github.com/ahmadrazach/actual-mcp-server) prototyped `actual_budgets_auto_select` with a `BudgetRouter` utility. The approach is sound but uses a hardcoded keyword→budget mapping. Production implementation should use `actual_budgets_list_available` to let AI resolve names dynamically.

## New Files

```
src/tools/budgets_switch.ts
src/tools/budgets_list_available.ts
tests/unit/budgets_switch.test.js
```

## Actual Budget API Methods

All methods are documented on the [Actual Budget API Reference](https://actualbudget.org/docs/api/reference) page.

| Method | Description | In stable? | API Ref |
|--------|-------------|------------|--------|
| `getBudgets()` | List all available budget files on the server | ✅ `26.2.1` | [→](https://actualbudget.org/docs/api/reference#getbudgets) |
| `downloadBudget(syncId, opts?)` | Download and open a specific budget by sync ID | ✅ `26.2.1` | [→](https://actualbudget.org/docs/api/reference#downloadbudget) |
| `loadBudget(syncId)` | Load a locally cached budget file | ✅ `26.2.1` | [→](https://actualbudget.org/docs/api/reference#loadbudget) |
| `shutdown()` | Shut down API and release current budget | ✅ `26.2.1` | [→](https://actualbudget.org/docs/api/reference#shutdown) |
| `init(config)` | Re-initialize API for new budget connection | ✅ `26.2.1` | [→](https://actualbudget.org/docs/api/reference#init) |

> ⚠️ `closeBudget()` **does not exist** in the API. Use `shutdown()` + `init()` + `downloadBudget()` to switch budgets.

## References

- [Actual Budget API Reference](https://actualbudget.org/docs/api/reference)
- [ahmadrazach fork — BudgetRouter](https://github.com/ahmadrazach/actual-mcp-server/blob/main/src/utils/budget-router.ts)
- [`src/lib/actual-adapter.ts`](../../src/lib/actual-adapter.ts)
- [`src/lib/ActualConnectionPool.ts`](../../src/lib/ActualConnectionPool.ts)
- [`docs/NEW_TOOL_CHECKLIST.md`](../NEW_TOOL_CHECKLIST.md)
