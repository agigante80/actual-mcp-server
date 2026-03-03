# Report Generation Tools

**Status:** Planned — v0.6.x (Q3 2026)  
**Priority:** 🟠 Medium  
**Effort:** ~1 week  
**Blocker:** None — implementable via `query()` + `runQuery()`

---

## Overview

Computed financial reports delivered as MCP tool responses. AI agents can generate spending summaries, income vs. expense comparisons, net worth snapshots, and budget adherence breakdowns without raw data manipulation.

## Tools

| Tool | Description |
|------|-------------|
| `actual_reports_spending_by_category` | Total spending per category for a date range |
| `actual_reports_income_vs_expenses` | Income vs. expense by month |
| `actual_reports_net_worth_trend` | Net worth over time (asset/liability accounts) |
| `actual_reports_budget_vs_actual` | Budgeted vs. actual spending per category |

## Sample Response — `actual_reports_spending_by_category`

```json
{
  "startDate": "2026-01-01",
  "endDate": "2026-01-31",
  "categories": [
    { "id": "uuid", "name": "Groceries", "totalSpent": -45230, "transactionCount": 12 },
    { "id": "uuid", "name": "Utilities", "totalSpent": -18700, "transactionCount": 3 }
  ],
  "totalSpent": -63930
}
```

## Implementation Notes

- Use ActualQL `query()` / `runQuery()` for aggregations — avoids loading all transactions into memory
- All amounts in cents (negative = expense, positive = income)
- Support `groupBy: 'month' | 'week'` for trending tools
- Support `accountIds?: string[]` filter on all tools

## New Files

```
src/tools/reports_spending_by_category.ts
src/tools/reports_income_vs_expenses.ts
src/tools/reports_net_worth_trend.ts
src/tools/reports_budget_vs_actual.ts
tests/unit/reports.test.js
```

## Actual Budget API Methods

All methods are documented on the [Actual Budget API Reference](https://actualbudget.org/docs/api/reference) page.

| Method | Description | API Ref |
|--------|-------------|---------|
| `q(table)` | Build an ActualQL query (fluent builder) | [→](https://actualbudget.org/docs/api/reference#q) |
| `runQuery(query)` | Execute an ActualQL query and return rows | [→](https://actualbudget.org/docs/api/reference#runquery) |
| `getBudgetMonth(month)` | Get budget totals for a given month (`YYYY-MM`) | [→](https://actualbudget.org/docs/api/reference#getbudgetmonth) |
| `getBudgetMonths()` | List all months that have budget data | [→](https://actualbudget.org/docs/api/reference#getbudgetmonths) |
| `getAccounts()` | List accounts (for net worth tool) | [→](https://actualbudget.org/docs/api/reference#getaccounts) |

## References

- [Actual Budget API Reference](https://actualbudget.org/docs/api/reference)
- [Actual Budget API – runQuery](https://actualbudget.org/docs/api/reference#runquery)
- [`src/lib/actual-schema.ts`](../../src/lib/actual-schema.ts)
- [`src/tools/transactions_summary_by_category.ts`](../../src/tools/transactions_summary_by_category.ts)
- [`docs/NEW_TOOL_CHECKLIST.md`](../NEW_TOOL_CHECKLIST.md)
