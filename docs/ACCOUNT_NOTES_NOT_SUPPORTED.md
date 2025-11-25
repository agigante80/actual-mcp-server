# Account Notes Field - Not Supported

## Issue

AI agent attempted to update an account with a `notes` field:

```json
{
  "id": "d4f5e824-b6b5-4822-99d2-05976d2d67ee",
  "fields": {
    "notes": "Loan details:\n- Purpose: Dental treatment Spark\n..."
  }
}
```

Result: `Error processing tool: [MCP][actual-mcp][actual_accounts_update] tool call failed: fetch failed`

## Root Cause

Actual Budget's database schema does NOT support a `notes` field on accounts. The accounts table only has:
- `id` (UUID)
- `name` (string)  
- `balance` (number)
- `offbudget` (boolean)
- `closed` (boolean)

## Fix Applied

Already fixed in commit `81defe2`:
- Removed `notes` field from `accounts_update` tool validation
- Removed `notes` from OpenAPI Account schema
- Updated tool description to list only supported fields

## Current Behavior

The tool now correctly rejects the `notes` field with a clear error message:

```
Invalid account update data: fields: Unrecognized key(s) in object: 'notes'
```

## Recommendation for AI Agent

Since Actual Budget doesn't support account-level notes in the database, the AI agent should use one of these alternatives:

### Option 1: Use Transaction Notes
Create transactions with detailed notes attached to the account:
```json
{
  "account": "d4f5e824-b6b5-4822-99d2-05976d2d67ee",
  "date": "2024-10-15",
  "amount": -380000,  // €3,800 in cents
  "payee": "<loan-provider-payee-id>",
  "notes": "Loan details: Purpose: Dental treatment Spark, Principal: €3,800, Interest: 0%, Term: 24 monthly instalments, Monthly payment: €158.33, Agreement date: 15 Oct 2024, Debited from: Sabadell, Payment schedule: Nov 2024 – Oct 2026 (around the 1st of each month)",
  "category": "<loans-category-id>"
}
```

### Option 2: Use Account Name
Include key details in the account name (limited to 255 characters):
```json
{
  "id": "d4f5e824-b6b5-4822-99d2-05976d2d67ee",
  "fields": {
    "name": "Dental Loan (€158.33/mo, 24 months, 0% interest)"
  }
}
```

### Option 3: Create a Note Transaction
Create a zero-amount transaction to store the notes:
```json
{
  "account": "d4f5e824-b6b5-4822-99d2-05976d2d67ee",
  "date": "2024-10-15",
  "amount": 0,
  "notes": "[LOAN INFO] Purpose: Dental treatment Spark...",
  "category": null
}
```

## Supported Fields for accounts_update

```typescript
{
  "id": "<account-uuid>",  // Required
  "fields": {              // At least one required
    "name": "string",      // Account name (1-255 chars)
    "offbudget": boolean,  // Exclude from budget calculations
    "closed": boolean      // Mark account as closed
  }
}
```

## See Also

- `docs/REGRESSION_TESTING.md` - Details on database schema limitations
- Commit `81defe2` - Removal of unsupported fields
- Commit `6ea8c4d` - Rules stage fix (similar validation improvement)
