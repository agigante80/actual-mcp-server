# Regression Testing for Fixed Tools

This document describes the regression tests added to verify the four tools recently fixed based on real-world AI agent errors.

## Overview

The manual integration test suite (`tests/manual/actual-mcp-integration-test.js`) now includes specific regression tests for:

1. **rules_create** - Optional 'op' field
2. **budget_updates_batch** - Large batch handling and error resilience  
3. **accounts_update** - Strict field validation
4. **payees_update** - Category field support and strict validation

## Test Coverage

### 1. rules_create - Optional 'op' Field

**Issue Fixed:** AI agents were omitting the required 'op' field in rule actions, causing validation errors.

**Test Location:** `rulesTests()` function

**Test Code:**
```javascript
// REGRESSION TEST: Create rule without 'op' field (should default to 'set')
const ruleWithoutOp = await callTool("actual_rules_create", { 
  stage: "pre",
  conditionsOp: "and",
  conditions: [
    { field: "notes", op: "contains", value: "no-op-test" }
  ],
  actions: [
    { field: "category", value: context.categoryId } // No 'op' field
  ]
});
```

**Expected Result:** Rule created successfully with 'op' defaulting to 'set'

### 2. budget_updates_batch - Large Batches

**Issues Fixed:** 
- Large batches (31+ operations) causing fetch failures
- All-or-nothing behavior with no error recovery

**Test Location:** `budgetTests()` function

**Test Code:**
```javascript
// Test 1: Large batch with 35 operations
const largeBatch = [];
for (let i = 0; i < 35; i++) {
  largeBatch.push({ 
    month: currentDate, 
    categoryId: context.categoryId, 
    amount: 10000 + (i * 100) 
  });
}
const batchResult = await callTool("actual_budget_updates_batch", { 
  operations: largeBatch
});

// Test 2: Mixed batch with valid and invalid operations
const mixedBatch = [
  { month: currentDate, categoryId: context.categoryId, amount: 70000 }, // Valid
  { month: "invalid-date", categoryId: context.categoryId, amount: 80000 }, // Invalid
  { month: currentDate, categoryId: context.categoryId, amount: 90000 }, // Valid
];
const mixedResult = await callTool("actual_budget_updates_batch", { 
  operations: mixedBatch
});
// Should report: successCount: 2, failureCount: 1
```

**Expected Results:**
- Large batch completes without fetch failures
- Mixed batch continues on errors and reports partial success

### 3. accounts_update - Strict Validation

**Issues Fixed:**
- Generic field validation accepting any fields
- Typos silently ignored by API
- Missing fields in schema (offbudget, closed)

**Test Location:** `accountTests()` function

**Test Code:**
```javascript
// Test 1: Update multiple valid fields
await callTool("actual_accounts_update", { 
  id: accountId,
  fields: { 
    name: accountName + "-Updated",
    offbudget: true
  }
});

// Test 2: Strict validation rejects invalid fields
try {
  await callTool("actual_accounts_update", { 
    id: accountId,
    fields: { invalidField: "should fail" }
  });
  // Should throw error
} catch (err) {
  // Expected: "Unrecognized key" error
}
```

**Expected Results:**
- Multiple valid fields update successfully
- Invalid field names rejected with clear error message

### 4. payees_update - Category Support

**Issues Fixed:**
- Missing category field support
- Generic field validation
- No strict mode validation

**Test Location:** `payeeTests()` function

**Test Code:**
```javascript
// Test 1: Set default category on payee
await callTool("actual_payees_update", { 
  id: payeeId,
  fields: { 
    category: context.categoryId
  }
});

// Test 2: Strict validation rejects invalid fields
try {
  await callTool("actual_payees_update", { 
    id: payeeId,
    fields: { invalidField: "should fail" }
  });
  // Should throw error
} catch (err) {
  // Expected: "Unrecognized key" error
}
```

**Expected Results:**
- Category field updates successfully
- Invalid field names rejected with clear error message

## Running the Tests

### Quick Test (with running Actual container)

```bash
# If Actual Budget is already running on port 5006
cd tests/manual
./quick-test-regression.sh
```

### Full Test (starts everything)

```bash
# Starts MCP server, connects to Actual, runs all tests
cd tests/manual
./test-regression-fixes.sh http://localhost:3600/http YOUR_AUTH_TOKEN
```

### Manual Test with Specific Level

```bash
# Run full test suite with all regression scenarios
node actual-mcp-integration-test.js http://localhost:3600/http TOKEN full yes

# Run just smoke tests (basic connectivity)
node actual-mcp-integration-test.js http://localhost:3600/http TOKEN smoke

# Run normal tests (accounts only, with regression tests)
node actual-mcp-integration-test.js http://localhost:3600/http TOKEN normal yes
```

## Important Findings

### Actual Budget Database Schema Limitations

During testing, we discovered that the Actual Budget database schema does NOT support some fields we had in our OpenAPI schema:

**Accounts** - Supported fields only:
- ✅ id (UUID)
- ✅ name (string)
- ✅ balance (number)
- ✅ offbudget (boolean)
- ✅ closed (boolean)
- ❌ notes (NOT in database)

**Payees** - Supported fields only:
- ✅ id (UUID)
- ✅ name (string)
- ✅ category (UUID, optional)
- ✅ transfer_acct (UUID, optional)
- ❌ notes (NOT in database)

**Actions Taken:**
1. Removed unsupported fields from OpenAPI schema
2. Removed unsupported fields from tool validation schemas
3. Updated tool descriptions to reflect actual capabilities
4. Regenerated TypeScript types from corrected OpenAPI schema

## Test Results

When run against Actual Budget container on port 5006:

✅ All regression tests pass
✅ Strict validation working correctly
✅ Invalid fields rejected with clear errors
✅ Large batches handled gracefully
✅ Error resilience working in batch operations
✅ Optional 'op' field defaults to 'set' correctly
✅ Category field on payees works correctly

## Related Commits

- `ea4c1e2` - fix(rules_create): make 'op' field optional with default
- `74c2159` - fix(budget_updates_batch): add error resilience
- `a30afe0` - fix(accounts_update): add strict validation
- `174412c` - feat(schema): add missing Account fields
- `08633a8` - fix(payees_update): add strict validation
- `81defe2` - test: add regression tests and fix unsupported fields

## Next Steps

Consider adding:
1. Automated regression test runs in CI (requires Docker)
2. Schema validation against actual database
3. Field discovery tool to map all supported fields
4. Documentation of Actual Budget API limitations
