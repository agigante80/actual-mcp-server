# Performance Optimization — Response Cache & Cached References

**Status:** Planned — v0.5.x (Q2 2026)  
**Priority:** 🟠 Medium  
**Effort:** ~1.5 weeks  
**Blocker:** None (connection pooling already in place)

---

## Overview

Add a sophisticated in-memory **tag-invalidated response cache** for read-heavy operations plus **cached reference helpers** for frequently-accessed entity lists (accounts, categories, payees). This reduces redundant Actual Budget API calls and lowers latency for read operations while maintaining data consistency through automatic cache invalidation on writes.

**Reference Implementation:** [ZanzyTHEbar/actual-mcp-server fork](https://github.com/ZanzyTHEbar/actual-mcp-server), which implements this as a foundational layer shared by all tools and the hybrid search engine. This feature generalises the fork's search-scoped cache into a project-wide caching layer.

---

## Scope

### 1. Tag-Invalidated ResponseCache

A general-purpose in-memory cache with four key properties:

- **LRU eviction** — bounded memory; oldest-unused entries evicted first when the cache is full
- **TTL expiry** — entries expire after a configurable duration (default: 30s for volatile data, 10 min for stable entity references)
- **Tag-based invalidation** — each cached entry is tagged with one or more entity tags (`accounts`, `categories`, `payees`, `transactions`, `budgets`, `rules`, `search`). Any successful write to an entity type immediately evicts all same-tagged cache entries.
- **Stale-While-Revalidate (SWR)** — expired entries may be served stale once while a background refresh runs, preventing thundering-herd on popular read endpoints

**Fork source:** [`src/lib/search/ResponseCache.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/ResponseCache.ts)

```typescript
// src/lib/cache/ResponseCache.ts (new file)
export type CacheTag =
  | 'accounts'
  | 'categories'
  | 'payees'
  | 'transactions'
  | 'budgets'
  | 'rules'
  | 'search';

export interface CacheOptions {
  ttlMs: number;      // Time-to-live in milliseconds
  tags: CacheTag[];   // Entity tags for bulk invalidation
  swr?: boolean;      // Serve stale-while-revalidate (default: false)
}

export class ResponseCache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, options: CacheOptions): void;
  invalidateTags(tags: CacheTag[]): void;
  clear(): void;
}

export const responseCache = new ResponseCache();
```

### 2. CacheInvalidator — Write Tool → Tag Mapping

A static mapping from every write tool name to the set of cache tags it invalidates. Called automatically in the tool dispatch path after every successful write — no changes needed in individual tool files.

**Fork source:** [`src/lib/search/CacheInvalidator.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/CacheInvalidator.ts)

```typescript
// src/lib/cache/CacheInvalidator.ts (new file)
const WRITE_TOOL_INVALIDATION_MAP: Record<string, CacheTag[]> = {
  actual_accounts_create:         ['accounts'],
  actual_accounts_update:         ['accounts'],
  actual_accounts_close:          ['accounts'],
  actual_transactions_create:     ['transactions'],
  actual_transactions_update:     ['transactions'],
  actual_transactions_delete:     ['transactions'],
  actual_categories_create:       ['categories'],
  actual_categories_update:       ['categories'],
  actual_categories_delete:       ['categories'],
  actual_budget_set_amount:       ['budgets'],
  actual_payees_merge:            ['payees', 'transactions'],
  actual_rules_create:            ['rules'],
  actual_rules_update:            ['rules'],
  actual_rules_delete:            ['rules'],
  // ... all 30 write tools
};

export function invalidateForTool(toolName: string): void {
  const tags = WRITE_TOOL_INVALIDATION_MAP[toolName] ?? [];
  if (tags.length > 0) responseCache.invalidateTags(tags);
}
```

The `invalidateForTool()` call is inserted once into `actualToolsManager.ts`'s dispatch path — after a write tool returns successfully. No individual tool files require modification.

### 3. cachedRefs.ts — Fast Entity Reference Lookup

Helper functions that return frequently-needed entity lists (accounts, categories, payees) from the cache, hitting Actual Budget only on cache miss. These are used by any tool that resolves names or validates IDs — replacing direct `adapter.getAccounts()` calls that currently run every invocation.

**Fork source:** [`src/lib/cachedRefs.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/cachedRefs.ts)

```typescript
// src/lib/cache/cachedRefs.ts (new file)
import adapter from '../actual-adapter.js';
import { responseCache } from './ResponseCache.js';

const REFS_TTL_MS = 10 * 60 * 1000; // 10 minutes — accounts/categories rarely change

export async function getCachedAccounts(): Promise<Account[]> {
  const cached = responseCache.get<Account[]>('refs:accounts');
  if (cached) return cached;
  const accounts = await adapter.getAccounts();
  responseCache.set('refs:accounts', accounts, { ttlMs: REFS_TTL_MS, tags: ['accounts'] });
  return accounts;
}

export async function getCachedPayees(): Promise<Payee[]>;
export async function getCachedCategories(): Promise<Category[]>;
export async function getCachedCategoryGroups(): Promise<CategoryGroup[]>;
```

A 10-minute TTL means up to 600× fewer Actual Budget API calls for stable reference data in an active session.

### 4. Pagination for Large Result Sets

Add `limit` + `offset` parameters to all list/search tools. Reduces memory pressure for large budgets (10k+ transactions).

Affected tools:
- `actual_transactions_get`
- `actual_transactions_search_by_*`
- `actual_payees_get`
- `actual_rules_get`

Response shape:
```typescript
{ data: T[], total: number, hasMore: boolean, nextOffset: number }
```

### 5. Transaction Filtering Optimisation

Push date/account filters into the Actual API call instead of applying them client-side. Reduces memory pressure for large date ranges and avoids loading thousands of transactions only to discard most.

---

## File Structure to Create

```
src/lib/cache/
├── ResponseCache.ts       # LRU + TTL + tag invalidation + SWR
├── CacheInvalidator.ts    # Write-tool → cache-tag mapping + invalidateForTool()
├── cachedRefs.ts          # getCachedAccounts / getCachedPayees / getCachedCategories
└── index.ts               # Barrel export

src/
└── actualToolsManager.ts  # Modified: add invalidateForTool() call in dispatch path
```

---

## Integration Points with Other Features

- **Hybrid Search Engine** ([docs/feature/CF4_HYBRID_SEARCH.md](./CF4_HYBRID_SEARCH.md)): The `ResponseCache` is first introduced as part of the hybrid search pipeline (caching search results tagged `['search', 'transactions']`). This feature generalises it to all tools. Both share the same singleton instance.
- **Session Worker Manager** ([docs/feature/SESSION_WORKER_MANAGER.md](./SESSION_WORKER_MANAGER.md)): When Worker Threads are in use, the `ResponseCache` singleton must live in the manager process. Workers communicate cache operations via messages — the cache is never replicated per-worker.

---

## New Dependencies

No new npm packages are required. The LRU cache can be implemented with a small hand-rolled `Map`-based structure (< 100 lines), or with the zero-dependency [`lru-cache`](https://www.npmjs.com/package/lru-cache) package. Either approach avoids the `node-cache` npm package originally planned for this feature.

| Approach | Package | Notes |
|----------|---------|-------|
| Hand-rolled | none | `Map` + doubly-linked list, ~80 lines, zero dependencies |
| lru-cache | `lru-cache` | Production-grade, well-tested, ~30 KB, 0 transitive deps |

---

## Success Criteria

- [ ] `getCachedAccounts()` returns a cached result on second call within TTL window (< 1 ms vs ~50 ms cold)
- [ ] Cache is invalidated immediately after any write tool succeeds (verified by unit test)
- [ ] Tag invalidation removes **all** entries for the affected entity type, not just the exact key
- [ ] SWR: expired entries still served while background refresh runs (no visible latency spike)
- [ ] 50%+ latency reduction for tools that resolve references (accounts, categories, payees)
- [ ] Handle 100k transactions without OOM (pagination tested)
- [ ] No behaviour change when cache is disabled or cleared (purely additive optimisation)
- [ ] Pagination verified in LibreChat multi-turn conversation

---

## References

- **ZanzyTHEbar fork — ResponseCache.ts:** [`src/lib/search/ResponseCache.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/ResponseCache.ts)
- **ZanzyTHEbar fork — CacheInvalidator.ts:** [`src/lib/search/CacheInvalidator.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/CacheInvalidator.ts)
- **ZanzyTHEbar fork — cachedRefs.ts:** [`src/lib/cachedRefs.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/cachedRefs.ts)
- **lru-cache npm:** <https://www.npmjs.com/package/lru-cache>
- [`src/lib/actual-adapter.ts`](../../src/lib/actual-adapter.ts) — Actual API wrapper
- [`src/lib/ActualConnectionPool.ts`](../../src/lib/ActualConnectionPool.ts) — connection management
- [`src/lib/constants.ts`](../../src/lib/constants.ts) — add `CACHE_TTL_*` constants here
- [Related: CF4 Hybrid Search](./CF4_HYBRID_SEARCH.md)
- [Related: Session Worker Manager](./SESSION_WORKER_MANAGER.md)
