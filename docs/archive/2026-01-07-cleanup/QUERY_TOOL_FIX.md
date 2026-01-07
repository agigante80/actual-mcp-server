# Query Tool Description Fix - Complete

## Problem

User reported that when asking the AI assistant "list last 5 transactions. Use the query tool", the AI made three failed attempts:

1. **First attempt**: Used `payee_name` field (doesn't exist)
   ```sql
   SELECT id, date, amount, payee_name, notes FROM transactions ORDER BY date DESC LIMIT 5
   ```

2. **Second/Third attempts**: Used GraphQL-like nested syntax (not supported)
   ```graphql
   query LastFiveTransactions {
     transactions(limit: 5, orderBy: { date: "desc" }) {
       id
       date
       amount
       payee {
         name
       }
     }
   }
   ```

## Root Cause

The `actual_query_run` tool description was misleading the AI:
- Showed 4 query formats as equally valid options
- Used incorrect example `payee_name` instead of correct `payee.name` 
- Included GraphQL nested object examples like `payee { name }` that aren't actually supported
- Did not emphasize SQL as the preferred/most reliable approach

## Solution Implemented

### 1. Rewrote Tool Description (src/tools/query_run.ts lines 12-49)

**Before**: Listed 4 formats with incorrect examples
**After**: Emphasizes SQL as "RECOMMENDED" with correct examples

Key changes:
- **Prominent SQL emphasis**: "**RECOMMENDED: Use SQL syntax** - Most reliable and well-tested format."
- **Fixed field names**: Changed all `payee_name` to `payee.name` (correct dot notation)
- **Removed misleading examples**: Removed GraphQL nested object syntax
- **Added "IMPORTANT - Field Names" section**: Explicitly lists correct dot notation
- **Added "Common Queries" section**: Provides practical SQL examples for typical use cases

### 2. Added GraphQL Syntax Detection (lines 53-56)

```typescript
if (input.query.trim().startsWith('query ') && input.query.includes('{') && input.query.includes('}')) {
  throw new Error(`GraphQL syntax is not fully supported. Please use SQL instead...`);
}
```

Proactively rejects GraphQL queries with helpful error message and SQL example.

### 3. Added Field Name Error Detection (lines 63-66)

```typescript
if (errorMessage.includes('payee_name') || errorMessage.includes('category_name') || errorMessage.includes('account_name')) {
  throw new Error(`Field name error: Use dot notation for joins.
• Use payee.name (NOT payee_name)
• Use category.name (NOT category_name)
• Use account.name (NOT account_name)

Example: SELECT id, date, amount, payee.name FROM transactions LIMIT 5`);
}
```

Catches common field name mistakes and provides corrected examples.

## Testing

Created `test-graphql-detection.mjs` to verify all error detection:

### Test Results

✅ **Test 1: GraphQL syntax rejection**
```
Query: query LastFiveTransactions { transactions(...) { ... } }
Result: Correctly rejected with helpful error message
Error: "GraphQL syntax is not fully supported. Please use SQL instead..."
```

✅ **Test 2: Field name error detection**
```
Query: SELECT id, payee_name FROM transactions LIMIT 5
Result: Correctly caught with correction
Error: "Field name error: Use dot notation for joins. Use payee.name (NOT payee_name)..."
```

✅ **Test 3: Correct SQL syntax**
```
Query: SELECT id, date, amount, payee.name FROM transactions ORDER BY date DESC LIMIT 5
Result: Query executes successfully
```

### Existing Tests
All existing tests still pass:
- ✅ `test-mcp-query.mjs`: 7/7 tests passing
- ✅ `test-query-validation.mjs`: 10/10 tests passing

## Deployment Status

✅ **Code Changes**: Built and deployed to Docker container
✅ **Container**: Rebuilt and restarted (actual-mcp-server-backend)
✅ **Verification**: All detection tests passing
✅ **Validation**: All existing query tests still passing

## Expected AI Behavior

When user asks: **"list last 5 transactions. Use the query tool"**

AI should now:
1. See SQL emphasized as "RECOMMENDED" approach
2. Use correct SQL syntax: `SELECT * FROM transactions ORDER BY date DESC LIMIT 5`
3. Use correct field names: `payee.name` NOT `payee_name`
4. Get immediate helpful error if they try GraphQL or wrong field names

## Files Modified

- `src/tools/query_run.ts` - Tool description and error handling
- `src/lib/query-validator.ts` - Display all 21 fields (previous fix)
- `test-graphql-detection.mjs` - New test for error detection (created)

## Documentation

New tool description is self-documenting with:
- Clear "RECOMMENDED" SQL section
- "IMPORTANT - Field Names" section with explicit corrections
- "Common Queries" section with practical examples
- Links to ActualQL documentation for advanced usage

## Next Steps

1. ✅ **Deployed**: Changes are live in Docker container
2. ⏳ **User Testing**: User should test with real AI interaction
3. ⏳ **Monitor**: Check if AI now uses correct SQL syntax
4. 📋 **Future**: Consider merging validation feature to main branch

## Success Criteria

✅ GraphQL syntax rejected with helpful error  
✅ Field name mistakes caught and corrected  
✅ SQL examples all use correct dot notation  
✅ Tool description emphasizes SQL as preferred approach  
✅ All tests passing (new + existing)  
✅ Changes deployed to Docker

---

**Status**: COMPLETE ✅  
**Date**: January 7, 2026  
**Version**: develop branch (validation + query fixes)
