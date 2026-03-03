# Improved Error Messages

**Status:** Planned — v0.5.x (Q2 2026)  
**Priority:** 🟠 Medium  
**Effort:** 2–3 days  
**Blocker:** None

---

## Overview

Replace terse, opaque error messages across all 56 tools with actionable, self-documenting errors that tell the AI (and the user) exactly what went wrong and how to fix it.

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

## References

- [`src/tools/`](../../src/tools/)
- [`src/lib/constants.ts`](../../src/lib/constants.ts)
