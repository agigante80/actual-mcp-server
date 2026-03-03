# Performance Optimization

**Status:** Planned — v0.5.x (Q2 2026)  
**Priority:** 🟠 Medium  
**Effort:** ~1 week  
**Blocker:** None (connection pooling already in place)

---

## Overview

Add response caching for read-heavy operations and pagination for large result sets to keep the server responsive with large budgets (10k+ transactions).

## Scope

### 1. Response Caching
- In-memory cache (TTL-based) for accounts, categories, and payees lists
- Cache invalidated on any write/update operation to the same entity type
- Configurable TTL via env: `CACHE_TTL_SECONDS` (default: 60)

```typescript
// src/lib/cache.ts (new file)
import NodeCache from 'node-cache';
export const entityCache = new NodeCache({ stdTTL: 60, checkperiod: 10 });
```

### 2. Pagination
- Add `limit` + `offset` (or `cursor`) parameters to all list/search tools
- Default page size: 100 (configurable)
- Response includes `{ data: [...], total: N, hasMore: boolean, nextOffset: N }`

Affected tools:
- `actual_transactions_get`
- `actual_transactions_search_by_*`
- `actual_payees_get`
- `actual_rules_get`

### 3. Transaction Filtering Optimization
- Push date/account filters into the Actual API call instead of applying client-side
- Reduces memory pressure for large date ranges

## New Dependencies

```bash
npm install node-cache
```

## Success Criteria

- [ ] 50%+ latency reduction for cached reads
- [ ] Handle 100k transactions without OOM
- [ ] Pagination verified in LibreChat multi-turn conversation

## References

- [node-cache](https://www.npmjs.com/package/node-cache)
- [`src/lib/actual-adapter.ts`](../../src/lib/actual-adapter.ts)
- [`src/lib/ActualConnectionPool.ts`](../../src/lib/ActualConnectionPool.ts)
- [`src/lib/constants.ts`](../../src/lib/constants.ts)
