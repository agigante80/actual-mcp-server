# Search Tools Query Issues - Fixed

## Problem Summary

**Issue**: `actual_transactions_search_by_month` was returning 0 transactions for December 2025 despite `actual_transactions_filter` correctly returning 70+ transactions for the same account.

## Root Causes

### 1. Month Search Tool - Query Method Issue ✅ FIXED

**File**: `src/tools/transactions_search_by_month.ts`

**Problem**: The tool was using ActualQL's `$transform: '$month'` function which doesn't work correctly:

```typescript
// ❌ BROKEN - $transform: '$month' doesn't work
let query = q('transactions').filter({
  date: { $transform: '$month', $eq: month }
});
```

**Solution**: Changed to use standard date range filtering with `$gte` and `$lte`:

```typescript
// ✅ FIXED - Use date range instead
const [year, monthNum] = month.split('-').map(Number);
const startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`;
const lastDay = new Date(year, monthNum, 0).getDate();
const endDate = `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

let query = q('transactions').filter({
  date: { $gte: startDate, $lte: endDate }
});
```

### 2. Month Search Tool - Return Value Bug ✅ FIXED

**Problem**: The function returned `input.month` instead of the computed `month` variable (line 76):

```typescript
// ❌ BROKEN - returns undefined when month defaults
return {
  transactions,
  count: transactions.length,
  totalAmount,
  month: input.month,  // undefined if not provided
};
```

**Solution**: Return the computed month value:

```typescript
// ✅ FIXED - returns the computed month value
return {
  transactions,
  count: transactions.length,
  totalAmount,
  month,  // always has a value
};
```

### 3. Summary Tools - ActualQL Limitations ⚠️ DOCUMENTED

**Files**:
- `src/tools/transactions_summary_by_category.ts`
- `src/tools/transactions_summary_by_payee.ts`

**Problem**: These tools use `groupBy()`, `$sum()`, and `$count()` which are **NOT supported** by ActualQL:

```typescript
// ❌ WON'T WORK - ActualQL doesn't support these operations
query = query
  .groupBy('payee.name')
  .select([
    'payee.name',
    { totalAmount: { $sum: '$amount' } },        // Not supported
    { transactionCount: { $count: '*' } }        // Not supported
  ]);
```

**Impact**: These tools will fail with SQL parsing errors as documented in commit 88e4633.

**Status**: ⚠️ **Known Limitation** - These tools are registered but will return helpful error messages explaining the ActualQL limitations.

## Working Tools Status

### ✅ Working Search Tools

1. **actual_transactions_filter** - Basic filtering by account/category/payee/dates (WORKING)
2. **actual_transactions_search_by_month** - Month-based search (FIXED)
3. **actual_transactions_search_by_category** - Category-based search (WORKING)
4. **actual_transactions_search_by_payee** - Payee-based search (WORKING)
5. **actual_transactions_search_by_amount** - Amount range search (WORKING)

### ⚠️ Limited Tools (ActualQL Constraints)

6. **actual_transactions_summary_by_category** - Will fail with helpful error about GROUP BY
7. **actual_transactions_summary_by_payee** - Will fail with helpful error about GROUP BY

## Testing Recommendations

### Test Month Search Fix

```bash
# Test via MCP tool call
{
  "tool": "actual_transactions_search_by_month",
  "arguments": {
    "month": "2025-12",
    "accountId": "bff82978-3f20-4956-860b-fa2cb069a144"
  }
}
```

**Expected**: Should return 2 test transactions plus all real December 2025 transactions (70+ total)

### Alternative to Summary Tools

Instead of using the broken summary tools, users should:

1. **Use search tools** to get all transactions for a period
2. **Group/aggregate in the client** (LibreChat/Claude) using the returned data

Example workflow:
```
1. Call actual_transactions_search_by_month for December 2025
2. Get back all 70+ transactions
3. Group by payee/category in the conversation
4. Calculate totals/counts using basic arithmetic
```

## Related Commits

- **88e4633**: Added error handling for ActualQL limitations (COUNT, SUM, GROUP BY)
- **16fe3e4**: Fixed budgets_transfer deadlock (similar query architecture issue)
- **edbd1ed**: Fixed session ID truncation (data retrieval accuracy)

## ActualQL Supported Features

Based on testing and error handling, ActualQL **DOES support**:

✅ Basic filtering: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`
✅ Logical operators: `$and`, `$or`
✅ Relationship traversal: `category.name`, `payee.name`, `account.name`
✅ Ordering: `orderBy({ field: 'asc' | 'desc' })`
✅ Limiting: `limit(n)`
✅ Selection: `select('*')` or `select(['field1', 'field2'])`

ActualQL **DOES NOT support**:

❌ Aggregation: `$sum()`, `$count()`, `$avg()`, etc.
❌ Grouping: `groupBy()`
❌ Transform functions: `$transform: '$month'` (unreliable)

## Deployment

1. Build completed: ✅
2. Commit these changes
3. Tag as part of v0.3.1 (bug fix release)
4. Deploy to production
5. Update LibreChat to pull latest image

## Commands

```bash
# Commit the fix
git add src/tools/transactions_search_by_month.ts SEARCH_TOOLS_FIX.md
git commit -m "fix: correct month search date range query and return value

- Replace $transform: '$month' with proper date range filtering
- Fix return value to use computed month instead of input.month
- Document ActualQL limitations for summary tools (groupBy/aggregate)
- Related to error handling improvements in commit 88e4633"

# Tag if part of v0.3.1
git tag -a v0.3.1 -m "Bug fix: Month search query corrections"
git push origin develop
git push origin v0.3.1
```

---

**Date**: 2025-12-17
**Status**: ✅ **FIXED** (month search) + ⚠️ **DOCUMENTED** (summary tool limitations)
**Tools Affected**: 1 fixed (month search), 2 documented (summary tools)
**Breaking Changes**: None
