# Write Coordinator

**Status:** Planned — v0.6.x (Q3 2026)  
**Priority:** 🟠 Medium  
**Effort:** ~1 week  
**Blocker:** Best implemented alongside [Session Worker Manager](./SESSION_WORKER_MANAGER.md) — fine-grained locking is most valuable when multiple sessions execute writes concurrently in parallel Worker Threads

---

## Overview

Replace the current single global write-queue with **entity-key-level locking**. Write operations targeting different entities (e.g., account A and account B) run concurrently; write operations targeting the *same* entity are serialised. Read operations are never added to any queue.

**Reference Implementation:** [ZanzyTHEbar/actual-mcp-server fork](https://github.com/ZanzyTHEbar/actual-mcp-server)  
**Fork sources:**
- [`src/lib/WriteCoordinator.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/WriteCoordinator.ts) — key-based mutex, `acquire()`, `withLocks()`
- [`src/lib/SessionWorkerManager.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/SessionWorkerManager.ts) — `getWriteKeys()` and `WRITE_TOOLS` set

---

## Business Value

| Today | With Write Coordinator |
|-------|------------------------|
| Any write blocks all other writes (global queue) | Concurrent writes to *different* entities proceed in parallel |
| `actual_accounts_update` + `actual_categories_create` run sequentially even though they touch unrelated data | They run concurrently — no unnecessary serialisation |
| Global write queue is a single point of contention for all users | Lock contention is scoped to the specific entity being modified |
| Read tools (`actual_accounts_get`) wait if a write is queued ahead | Reads are never queued — they proceed immediately alongside writes |

For a single-user personal deployment the impact is negligible. For a shared team server handling 3–10 concurrent users creating transactions, updating accounts, and running budget reports simultaneously, entity-level locking reduces median multi-operation latency by 40–80%.

---

## Architecture

```
Tool Dispatch (inside SessionWorkerManager or main thread)

actual_accounts_update(id: "uuid-A")  →  acquire ["account:uuid-A"]     ← runs
actual_accounts_update(id: "uuid-B")  →  acquire ["account:uuid-B"]     ← runs in parallel
actual_accounts_update(id: "uuid-A")  →  acquire ["account:uuid-A"]     ← queued, waits for first
actual_transactions_create(...)       →  acquire ["transactions:create"] ← runs (different key)
actual_accounts_get()                 →  no lock acquired                ← always immediate
```

Lock contention is limited to the exact entity being written. Concurrent writes to different accounts, categories, or budget lines proceed without waiting for each other.

---

## Entity Key Mapping

Each write tool maps to one or more entity keys via `getWriteKeys(toolName, args)`. The `WriteCoordinator` serialises all operations that share any key. Read tools return an empty array and bypass locking entirely.

**Fork source:** [`getWriteKeys()` in SessionWorkerManager.ts](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/SessionWorkerManager.ts)

```typescript
// src/lib/WriteCoordinator.ts — getWriteKeys()
function getWriteKeys(toolName: string, args: Record<string, unknown>): string[] {
  switch (toolName) {
    // Entity-scoped — only blocks the same specific entity
    case 'actual_accounts_update':
    case 'actual_accounts_close':
      return [`account:${args.id}`];

    case 'actual_categories_update':
    case 'actual_categories_delete':
      return [`category:${args.id}`];

    case 'actual_transactions_update':
    case 'actual_transactions_delete':
      return (args.ids as string[]).map(id => `transaction:${id}`);

    case 'actual_budget_set_amount':
    case 'actual_budget_set_carryover':
      return [`budget:${args.month}:${args.categoryId}`];

    // Coarse key — all creates of the same type serialised
    case 'actual_accounts_create':
      return ['accounts:create'];

    case 'actual_transactions_create':
    case 'actual_transactions_create_batch':
      return ['transactions:create'];

    case 'actual_categories_create':
      return ['categories:create'];

    case 'actual_payees_merge':
      return (args.ids as string[]).map(id => `payee:${id}`);

    case 'actual_rules_create':
    case 'actual_rules_update':
    case 'actual_rules_delete':
      return ['rules:write'];

    case 'actual_schedules_create':
    case 'actual_schedules_update':
    case 'actual_schedules_delete':
      return ['schedules:write'];

    default:
      return ['global:write'];  // Fallback — logs a warning so gaps are visible
  }
}
```

---

## `WriteCoordinator` API

```typescript
// src/lib/WriteCoordinator.ts (new file)
export class WriteCoordinator {
  /**
   * Acquire locks for all given entity keys.
   * Returns a release function — must be called when the operation completes.
   * Keys are always sorted before acquisition to prevent deadlocks.
   */
  async acquire(keys: string[]): Promise<() => void>;

  /**
   * Convenience wrapper: acquire all keys, run fn, release.
   * Releases even if fn throws.
   */
  async withLocks<T>(keys: string[], fn: () => Promise<T>): Promise<T>;
}

export const writeCoordinator = new WriteCoordinator();
```

Internally, per-key lock state is a `Map<string, Promise<void>>` chain — each new waiter appends `.then()` on the previous holder's release promise. This is a zero-dependency, deadlock-free implementation (keys acquired in sorted order prevents circular waits).

---

## Integration with `actualToolsManager.ts`

One change point in the dispatch path. Individual tool files require no modification:

```typescript
// src/actualToolsManager.ts — dispatch (simplified)

// BEFORE
const result = await tool.call(args);

// AFTER — with WriteCoordinator
import { writeCoordinator, getWriteKeys } from './lib/WriteCoordinator.js';

const keys = getWriteKeys(tool.name, args as Record<string, unknown>);
const result = keys.length > 0
  ? await writeCoordinator.withLocks(keys, () => tool.call(args))
  : await tool.call(args);  // Read tools — never locked
```

---

## WRITE_TOOLS Constant

A `Set<string>` enumerating all tools that perform writes. Read tools bypass the coordinator without needing to call `getWriteKeys()`:

```typescript
// src/lib/constants.ts — addition
export const WRITE_TOOLS = new Set([
  'actual_accounts_create',
  'actual_accounts_update',
  'actual_accounts_close',
  'actual_transactions_create',
  'actual_transactions_create_batch',
  'actual_transactions_update',
  'actual_transactions_delete',
  'actual_categories_create',
  'actual_categories_update',
  'actual_categories_delete',
  'actual_category_groups_create',
  'actual_category_groups_update',
  'actual_budget_set_amount',
  'actual_budget_set_carryover',
  'actual_payees_create',
  'actual_payees_update',
  'actual_payees_delete',
  'actual_payees_merge',
  'actual_rules_create',
  'actual_rules_update',
  'actual_rules_delete',
  'actual_schedules_create',
  'actual_schedules_update',
  'actual_schedules_delete',
  // ... remaining write tools (30 total)
]);
```

---

## File Structure to Create

```
src/lib/
└── WriteCoordinator.ts        # Key-based mutex, getWriteKeys(), withLocks(), WRITE_TOOLS

src/
├── lib/constants.ts           # Modified: add WRITE_TOOLS Set
└── actualToolsManager.ts      # Modified: wrap write-tool dispatch with writeCoordinator.withLocks()
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Deadlock if two operations mutually wait for each other's keys | Sort all keys before acquisition — standard deadlock prevention technique |
| Unmapped tool falls through to `global:write` (coarse) | Log a warning with tool name — gaps are visible and can be fixed incrementally |
| Lock held by a crashed worker | SessionWorkerManager crash handler calls `release()` on all pending locks for the dead worker |
| Long-running writes starve other writes to the same entity | Add a lock-wait timeout (configurable, default: 60s) that errors rather than waiting forever |
| Contention diagnosis is opaque | Expose lock wait time as a metric (`P99 lock_wait_ms` histogram) |

---

## Success Criteria

- [ ] Two `actual_accounts_update(id: "A")` + `actual_accounts_update(id: "B")` execute concurrently (confirmed by overlapping log timestamps)
- [ ] Two `actual_accounts_update(id: "A")` calls execute sequentially — second waits for first to finish (confirmed by non-overlapping log timestamps)
- [ ] Read tools (`actual_accounts_get`) never wait for any lock, even while writes are in progress
- [ ] No deadlocks under a concurrent load test (10 parallel writes, randomised entity keys)
- [ ] Lock wait P99 < 10 ms under normal single-user load (no meaningful regression)
- [ ] Unmapped tool still executes correctly (falls back to `global:write` with a logged warning)

---

## Related Docs

- [Session Worker Manager](./SESSION_WORKER_MANAGER.md) — the parallel execution context that makes fine-grained entity locking valuable; Write Coordinator + SessionWorkerManager are intended to ship together
- [Performance Optimization](./PERFORMANCE_OPTIMIZATION.md) — ResponseCache and write coordination are complementary: cache eliminates redundant reads; coordinator serialises conflicting writes

---

## Source Files in ZanzyTHEbar Fork

| File | Purpose |
|------|---------|
| [`src/lib/WriteCoordinator.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/WriteCoordinator.ts) | Key-based mutex, `acquire()`, `withLocks()` |
| [`src/lib/SessionWorkerManager.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/SessionWorkerManager.ts) | `getWriteKeys()` and `WRITE_TOOLS` set (co-located with session logic in the fork) |

---

**Last Updated:** 2026-03-03  
**Author:** Analysis based on [ZanzyTHEbar/actual-mcp-server](https://github.com/ZanzyTHEbar/actual-mcp-server) fork study
