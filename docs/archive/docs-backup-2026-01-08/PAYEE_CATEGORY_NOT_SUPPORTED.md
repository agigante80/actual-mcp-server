# Payee Category Field - Not Supported

## Issue

AI agent attempted to set a default category on a payee:

```json
{
  "id": "5641e83f-35c8-41c5-b6b1-e049613bd0d3",
  "fields": {
    "category": "2d46fe6e-d844-42c2-b938-b860c98978f2"
  }
}
```

Result: `Error processing tool: [MCP][actual-mcp][actual_payees_update] tool call failed: fetch failed`

## Root Cause

Actual Budget's database schema does NOT support a `category` field on payees. The payees table only has:
- `id` (UUID)
- `name` (string)
- `transfer_acct` (UUID, optional - for transfer payees linked to accounts)

The concept of "default category for a payee" doesn't exist in Actual Budget's data model.

## Fix Applied

Removed `category` field from:
- `payees_update` tool validation schema
- OpenAPI Payee schema  
- Tool description and examples

## Current Behavior

The tool now correctly rejects the `category` field with a clear error message:

```
Invalid payee update data: fields: Unrecognized key(s) in object: 'category'
```

## Why This Limitation Exists

Actual Budget uses **rules** to automatically categorize transactions based on payee, not a direct payee-to-category mapping. This design is more flexible because:

1. One payee can trigger different categories based on other conditions
2. Rules can check amount, notes, account, etc. alongside payee
3. Multiple rules can apply to the same payee

## Recommendation for AI Agent

To automatically categorize transactions from a specific payee, **create a rule** instead:

### Use rules_create to Auto-Categorize by Payee

```json
{
  "stage": "post",
  "conditionsOp": "and",
  "conditions": [
    {
      "field": "payee",
      "op": "is",
      "value": "5641e83f-35c8-41c5-b6b1-e049613bd0d3",
      "type": "id"
    }
  ],
  "actions": [
    {
      "op": "set",
      "field": "category",
      "value": "2d46fe6e-d844-42c2-b938-b860c98978f2",
      "type": "id"
    }
  ]
}
```

This creates a rule that:
- Triggers when a transaction has the specified payee
- Automatically sets the category to the desired value
- Runs on all future transactions matching this payee

### Additional Rule Examples

**Categorize by payee name pattern:**
```json
{
  "conditions": [
    {
      "field": "payee",
      "op": "contains",
      "value": "Amazon",
      "type": "string"
    }
  ],
  "actions": [
    {
      "field": "category",
      "value": "<shopping-category-id>",
      "type": "id"
    }
  ]
}
```

**Complex rule with amount threshold:**
```json
{
  "conditionsOp": "and",
  "conditions": [
    {
      "field": "payee",
      "op": "is",
      "value": "<grocery-payee-id>",
      "type": "id"
    },
    {
      "field": "amount",
      "op": "lte",
      "value": -5000
    }
  ],
  "actions": [
    {
      "field": "category",
      "value": "<large-purchase-category-id>",
      "type": "id"
    }
  ]
}
```

## Supported Fields for payees_update

```typescript
{
  "id": "<payee-uuid>",    // Required
  "fields": {              // At least one required
    "name": "string",      // Payee name (1-255 chars)
    "transfer_acct": "uuid" // Mark as transfer payee (optional)
  }
}
```

## When to Use transfer_acct

The `transfer_acct` field is for special "transfer payees" that represent money moving between your own accounts:

```json
{
  "id": "<payee-uuid>",
  "fields": {
    "name": "Transfer : Checking → Savings",
    "transfer_acct": "<savings-account-uuid>"
  }
}
```

This links the payee to an account, so Actual Budget can properly track transfers and avoid double-counting money.

## See Also

- `actual_rules_create` - Create rules to auto-categorize transactions
- `actual_rules_get` - View existing rules
- `actual_payee_rules_get` - Get rules for a specific payee
- `docs/ACCOUNT_NOTES_NOT_SUPPORTED.md` - Similar database limitation
- `docs/REGRESSION_TESTING.md` - Details on database schema discovery
