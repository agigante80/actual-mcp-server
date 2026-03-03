# Improved Error Messages

**Status:** Planned — v0.5.x (Q2 2026)  
**Priority:** 🟠 Medium  
**Effort:** 2–3 days  
**Blocker:** None

---

## Overview

Replace terse, opaque error messages across all 60 tools with actionable, self-documenting errors that tell the AI (and the user) exactly what went wrong and how to fix it.

## Pattern

```typescript
// Before
throw new Error('Account not found');

// After
throw new Error(
  'Account "abc-123" not found. ' +
  'Use actual_accounts_list to see available accounts. ' +
  'Example account ID: {"id": "uuid-456", "name": "Checking"}'
);
```

## Negative Scenarios to Cover

The following error classes must each produce an actionable message with a "next step" hint:

| # | Scenario | Example input | Target error message |
|---|----------|--------------|----------------------|
| 1 | **Wrong date format** | `date: "2026/03/03"` | `"date must be YYYY-MM-DD (e.g. '2026-03-03'). Received: '2026/03/03'."` |
| 2 | **Unknown / disallowed field** | `{ foo: "bar" }` in `actual_accounts_update` | `"Unknown field 'foo'. Allowed fields: name, offbudget, closed."` |
| 3 | **Invalid / non-existent ID** | `account_id: "not-a-uuid"` | `"Account 'not-a-uuid' not found. Use actual_accounts_list to get valid IDs."` |
| 4 | **Missing required field** | omit `account_id` in `actual_transactions_create` | `"Missing required field 'account_id'. Provide the UUID of the target account."` |
| 5 | **Wrong type** | `amount: "fifty"` | `"'amount' must be an integer (cents). Received string 'fifty'. Example: -5000 for -$50.00."` |
| 6 | **Value outside allowed enum** | `status: "pending"` | `"Invalid value 'pending' for 'status'. Allowed values: cleared, uncleared."` |
| 7 | **Conflicting fields** | `closed: true` on an account with no transactions | `"Cannot close an account with no transactions — add a $0 dummy transaction first to avoid data loss."` |
| 8 | **Duplicate / already-exists** | payee name that already exists | `"Payee 'Supermarket' already exists (id: uuid-xyz). Use actual_payees_update to modify it."` |
| 9 | **Dependency not found** | `category_id` pointing to a deleted group | `"Category 'uuid-abc' not found — it may belong to a deleted group. Use actual_categories_list to see active categories."` |
| 10 | **Value out of range** | `limit: -1` or `amount: 0` where non-zero required | `"'limit' must be a positive integer. Received: -1."` |

### Zod vs. Actual API boundary

- Scenarios 1, 2, 4, 5, 6, 10 — caught at **Zod parse time** (before any API call); errors should surface as `ZodError` formatted messages.
- Scenarios 3, 7, 8, 9 — caught at **Actual API response time**; adapter must translate opaque API errors into the actionable format above.

---

## Scope

- [ ] Audit all `src/tools/*.ts` for bare `throw new Error(...)` calls
- [ ] Add entity-specific context (ID + entity type) to every "not found" error
- [ ] Include "next step" tool name suggestion in every error
- [ ] Add `example_value` hint wherever a UUID is expected
- [ ] Document error format in `docs/ARCHITECTURE.md`

## Error Template

```typescript
// src/lib/errors.ts (new file)
export function notFoundError(entityType: string, id: string, listTool: string): Error {
  return new Error(
    `${entityType} "${id}" not found. ` +
    `Use ${listTool} to see available ${entityType.toLowerCase()}s.`
  );
}
```

## Success Criteria

- [ ] All tools return actionable errors with next-step suggestions
- [ ] No raw UUIDs or stack traces exposed to end users
- [ ] Unit tests cover error message format for each tool category

---

## Implementation: Test Requirements

When this feature is implemented, the following tests **must** be added before it can be considered done.

---

### Unit Tests — `tests/unit/schema_validation.test.js`

Add one `it()` block per Zod-layer scenario (scenarios 1, 2, 4, 5, 6, 10 from the table above).
Each test must assert **both** that the error is thrown **and** that its message matches the actionable format.

```javascript
// Scenario 1 — wrong date format
it('actual_transactions_create rejects wrong date format with actionable message', () => {
  const err = assert.throws(
    () => InputSchema.parse({ account: VALID_UUID, amount: -5000, date: '2026/03/03' }),
  );
  assert.match(err.message, /YYYY-MM-DD/);
});

// Scenario 2 — unknown field (strict mode)
it('actual_accounts_update rejects unknown field with allowed-fields hint', () => {
  const err = assert.throws(
    () => InputSchema.parse({ id: VALID_UUID, foo: 'bar' }),
  );
  assert.match(err.message, /Unknown field|Allowed fields/i);
});

// Scenario 4 — missing required field
it('actual_transactions_create rejects missing account with actionable message', () => {
  const err = assert.throws(
    () => InputSchema.parse({ amount: -5000, date: '2026-03-03' }),
  );
  assert.match(err.message, /account/i);
});

// Scenario 5 — wrong type
it('actual_transactions_create rejects string amount with cents hint', () => {
  const err = assert.throws(
    () => InputSchema.parse({ account: VALID_UUID, amount: 'fifty', date: '2026-03-03' }),
  );
  assert.match(err.message, /integer|cents/i);
});

// Scenario 6 — invalid enum
it('actual_transactions_filter rejects unknown status with allowed-values hint', () => {
  const err = assert.throws(
    () => InputSchema.parse({ status: 'pending' }),
  );
  assert.match(err.message, /cleared|uncleared/i);
});

// Scenario 10 — out of range
it('actual_transactions_filter rejects negative limit with range hint', () => {
  const err = assert.throws(
    () => InputSchema.parse({ limit: -1 }),
  );
  assert.match(err.message, /positive/i);
});
```

Also add a meta-test asserting that **no tool's error response** contains a raw Node.js stack trace:

```javascript
it('no tool error exposes a raw stack trace to callers', async () => {
  // Stub adapter to throw, then call a sample tool with bad input and
  // verify the caught message does not contain 'at Object.' or 'node_modules'
});
```

---

### Manual Integration Tests — `tests/manual/tests/`

Add a dedicated **negative-path block** to the relevant module for each API-layer scenario (scenarios 3, 7, 8, 9).  
Use the sentinel name `__nonexistent_MCP_test_value__` or a guaranteed-missing UUID.

**`account.js`** — Scenario 3 (invalid ID) + Scenario 7 (close with no transactions):

```javascript
// Scenario 3: non-existent account ID
try {
  const res = await client.callTool('actual_accounts_get_balance', {
    id: '00000000-0000-0000-0000-000000000000',
  });
  const text = JSON.stringify(res);
  if (text.includes('not found') && (text.includes('actual_accounts_list') || text.includes('available'))) {
    console.log('  ✓ NEGATIVE get_balance: not-found message includes next-step hint');
  } else {
    console.log('  ❌ NEGATIVE get_balance: missing next-step hint in error:', text.slice(0, 200));
  }
} catch (err) {
  console.log('  ❌ NEGATIVE get_balance threw unexpectedly:', err.message);
}

// Scenario 7: close account with no transactions (should produce actionable error)
try {
  const emptyAcct = await client.callTool('actual_accounts_create', { name: `MCP-EmptyClose-${TS}` });
  const res = await client.callTool('actual_accounts_close', { id: emptyAcct.id });
  const text = JSON.stringify(res);
  if (text.includes('transaction') || text.includes('dummy') || res?.error) {
    console.log('  ✓ NEGATIVE close-empty: actionable error about missing transaction');
  } else {
    // If Actual silently closes it, report informational (API may allow it)
    console.log('  ℹ NEGATIVE close-empty: Actual allowed close with no transactions (no error raised)');
  }
  // cleanup
  await client.callTool('actual_accounts_delete', { id: emptyAcct.id });
} catch (err) {
  console.log('  ❌ NEGATIVE close-empty threw:', err.message);
}
```

**`payee.js`** — Scenario 8 (duplicate payee name):

```javascript
// Scenario 8: create payee with existing name — should return exists error with ID hint
try {
  const existing = await client.callTool('actual_payees_get', {});
  const firstName = Array.isArray(existing) && existing.length > 0 ? existing[0].name : null;
  if (firstName) {
    const res = await client.callTool('actual_payees_create', { name: firstName });
    const text = JSON.stringify(res);
    if (text.includes('already exists') || text.includes('id')) {
      console.log('  ✓ NEGATIVE duplicate payee: error includes existing ID hint');
    } else {
      console.log('  ⚠ NEGATIVE duplicate payee: Actual may silently allow duplicates:', text.slice(0, 150));
    }
  } else {
    console.log('  ℹ NEGATIVE duplicate payee: no existing payees to test against');
  }
} catch (err) {
  console.log('  ❌ NEGATIVE duplicate payee threw:', err.message);
}
```

**`category.js`** — Scenario 9 (dependency not found):

```javascript
// Scenario 9: create category in a deleted/non-existent group
try {
  const res = await client.callTool('actual_categories_create', {
    name: 'MCP-Cat-BadGroup-' + TS,
    group_id: '00000000-0000-0000-0000-000000000000',
  });
  const text = JSON.stringify(res);
  if (text.includes('not found') || text.includes('group') || res?.error) {
    console.log('  ✓ NEGATIVE bad group_id: actionable error about unknown group');
  } else {
    console.log('  ❌ NEGATIVE bad group_id: no error raised for non-existent group:', text.slice(0, 150));
  }
} catch (err) {
  console.log('  ❌ NEGATIVE bad group_id threw:', err.message);
}
```

> **Naming reminder**: all created entities use `MCP-{Type}-{TS}` so cleanup scripts can find and remove them.

---

### AI / LLM Prompt Tests — `tests/manual-prompt/`

Add a **Phase 1b — Error Message Quality** block to **`prompt-1-smoke.txt`** immediately after Phase 1,
and reference it in `tests/manual-prompt/README.md`.

**In `prompt-1-smoke.txt`** — add after the Phase 1 tool list:

```
**Phase 1b — Error Message Quality (4 checks — counts as ✓ informational, not tool tests):**

For each check: call the tool with the bad input, then evaluate whether the error message
is actionable (contains a "next step" or "allowed values" hint). Report ✓/✗/ℹ.

- actual_accounts_get_balance with id="00000000-0000-0000-0000-000000000000"
  ✓ if error message contains "not found" AND ("actual_accounts_list" OR "available")
  ✗ if error is generic ("error", "failed") with no next-step hint

- actual_transactions_create with date="2026/03/03" (wrong separator)
  ✓ if error message contains "YYYY-MM-DD" or similar format hint
  ✗ if error is generic

- actual_transactions_create with amount="fifty" (wrong type)
  ✓ if error message contains "integer" or "cents"
  ✗ if error is generic

- actual_accounts_update with { id: "<valid-account1-id>", foo: "bar" } (unknown field)
  ✓ if error message contains "Unknown field" or lists allowed fields
  ✗ if error is generic or the call succeeds silently
```

**In `tests/manual-prompt/README.md`** — update Phase Overview table to add this row:

```markdown
| 1b | Prompt 1 | 4 checks | Error message quality smoke (informational) |
```

And update the **"Adding a New Tool"** section with a note:

> When implementing the Improved Error Messages feature, also update Phase 1b in `prompt-1-smoke.txt` to add a check for any new error scenario added to the 10-scenario table in `docs/feature/IMPROVED_ERROR_MESSAGES.md`.

---

## References

- [`src/tools/`](../../src/tools/)
- [`src/lib/constants.ts`](../../src/lib/constants.ts)
- [`tests/unit/schema_validation.test.js`](../../tests/unit/schema_validation.test.js)
- [`tests/manual/tests/account.js`](../../tests/manual/tests/account.js)
- [`tests/manual/tests/payee.js`](../../tests/manual/tests/payee.js)
- [`tests/manual/tests/category.js`](../../tests/manual/tests/category.js)
- [`tests/manual-prompt/prompt-1-smoke.txt`](../../tests/manual-prompt/prompt-1-smoke.txt)
