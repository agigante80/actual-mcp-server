# Goal Tracking Tools

**Status:** Planned — v0.6.x (Q3 2026)  
**Priority:** 🟠 Medium  
**Effort:** ~1 week  
**Blocker:** Upstream Actual Budget API support required (or custom query implementation)

---

## Overview

Tools to create, track, and update savings goals within Actual Budget. Enables AI-driven progress reporting ("Am I on track for my emergency fund?").

## Tools

| Tool | Description |
|------|-------------|
| `actual_goals_list` | List all savings goals with current progress |
| `actual_goals_create` | Create a new goal (target amount, deadline) |
| `actual_goals_update` | Update goal target or deadline |
| `actual_goals_get_progress` | Get progress toward a specific goal |
| `actual_goals_delete` | Remove a goal |

## Goal Object Shape

```typescript
{
  id: string;
  name: string;
  targetAmount: number;   // Cents
  currentAmount: number;  // Cents — derived from linked account/category balance
  deadline?: string;       // YYYY-MM-DD
  accountId?: string;      // Linked account
  categoryId?: string;     // Linked budget category
  progressPct: number;     // 0–100
}
```

## Implementation Options

1. **Native API** (preferred): Use Actual Budget's internal goal API if/when available
2. **Custom storage**: Store goals in a lightweight JSON sidecar file or separate SQLite table alongside the budget; derive `currentAmount` from the Actual API at read time

## Success Criteria

- [ ] Create/read/update/delete goals conversationally in LibreChat
- [ ] Progress accurately reflects live Actual Budget balances
- [ ] Works without Actual Budget UI goal features (custom implementation fallback)

## Actual Budget API Methods

Goals are not natively in the API — progress is derived from live data. The following methods from the [Actual Budget API Reference](https://actualbudget.org/docs/api/reference) are used to read current balances:

| Method | Description | API Ref |
|--------|-------------|---------|
| `getAccounts()` | Get account balances (for account-linked goals) | [→](https://actualbudget.org/docs/api/reference#getaccounts) |
| `getCategories()` | Get categories (for budget-category-linked goals) | [→](https://actualbudget.org/docs/api/reference#getcategories) |
| `getBudgetMonth(month)` | Get category budget + spent amounts for progress % | [→](https://actualbudget.org/docs/api/reference#getbudgetmonth) |
| `runQuery(query)` | Aggregate transactions for custom progress calculation | [→](https://actualbudget.org/docs/api/reference#runquery) |

## References

- [Actual Budget API Reference](https://actualbudget.org/docs/api/reference)
- [`src/lib/actual-adapter.ts`](../../src/lib/actual-adapter.ts)
- [`docs/NEW_TOOL_CHECKLIST.md`](../NEW_TOOL_CHECKLIST.md)
