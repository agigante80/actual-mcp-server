# Roadmap

**Project:** Actual MCP Server  
**Version:** 0.4.20  
**Purpose:** Future improvements and feature planning  
**Last Updated:** 2026-03-03

> 📋 **Implementing a planned item?** Follow the step-by-step process in [docs/NEW_TOOL_CHECKLIST.md](./NEW_TOOL_CHECKLIST.md) — it covers tool file, registration, unit tests, manual tests (positive + negative), AI prompt update, and all documentation files that must be updated before committing.

---

## 🎯 Vision

Transform the Actual MCP Server from a **functional bridge** into a **production-grade, enterprise-ready platform** for AI-powered financial management.

---

## 📊 Roadmap Overview

### Current State (v0.4.16)

- ✅ **56 MCP tools** covering ~84% of Actual Budget API
- ✅ **LibreChat & LobeChat verified** - all tools working
- ✅ **Production-ready** - Docker images, CI/CD, HTTPS
- ✅ **Security-conscious** - Bearer auth, input validation, 0 vulnerabilities
- ✅ **Well-documented** - Comprehensive documentation ecosystem
- ✅ **HTTP-only transport** - SSE transport removed; HTTP is the sole supported transport

### Target State (v1.0.0)

- 🎯 **100% API coverage** - All Actual Budget features (4 schedule tools remaining)
- 🎯 **Enterprise-grade security** - RBAC, audit logging, rate limiting
- 🎯 **Advanced features** - Reports, goals, multi-budget workflows
- 🎯 **Production-hardened** - Load tested, highly available
- 🎯 **Multi-client support** - LibreChat, Claude Desktop, custom clients

---

## 🚀 Short-Term (Q1 2026)

### 🔴 High Priority

#### 1. **Complete API Coverage (4 tools)**
**Target**: v0.5.x (Q2 2026)

**Features**:
- [ ] Implement `actual_schedules_get`
- [ ] Implement `actual_schedules_create`
- [ ] Implement `actual_schedules_update`
- [ ] Implement `actual_schedules_delete`

**Impact**: Achieves 100% Actual Budget API coverage

---

#### 2. **Pattern Matching Enhancement Roadmap**
**Target**: v0.3.0 - v0.5.0 (Phased approach)

**Vision**: Progressive enhancement from basic pattern matching to full regex support across all search tools.

##### Phase 1: Basic Pattern Matching (v0.3.0 - Q2 2026)
**Goal**: Add simple, safe pattern matching for common use cases

**New Tools**:
- [ ] `actual_transactions_search_by_payee_pattern`
  - Supports: `startsWith`, `contains`, `endsWith`
  - Returns transactions from ALL matching payees
  - Example: "Amazon" matches "Amazon", "Amazon Prime", "Amazon Web Services"
  
- [ ] `actual_transactions_search_by_category_pattern`
  - Same pattern types as payee
  - Useful for finding category groups (e.g., "Util" → "Utilities", "Utility Bills")

**Implementation Details**:
- Case-insensitive matching by default
- Returns aggregated results with source entity name in each transaction
- All existing filters (date range, amount, account) still apply
- Clear error messages for zero matches

**Benefits**:
- ✅ Solves "I don't know the exact name" problem
- ✅ Handles typos and variations gracefully
- ✅ No breaking changes to existing tools
- ✅ Safe, predictable behavior

**Affected Components**:
- 2 new tool files (`transactions_search_by_payee_pattern.ts`, `transactions_search_by_category_pattern.ts`)
- Shared pattern matching utility (`src/lib/patternMatcher.ts`)
- 2 new test files
- Tool registry update (`actualToolsManager.ts`)

**Estimated Effort**: 2-3 days
- Day 1: Implement payee pattern tool + utility + tests
- Day 2: Implement category pattern tool + tests
- Day 3: Integration testing, documentation

---

##### Phase 2: Extended Pattern Support (v0.4.0 - Q3 2026)
**Goal**: Add advanced pattern matching to more entity types

**New Tools/Features**:
- [ ] `actual_accounts_search_pattern`
  - Find accounts by partial name
  - Example: "Check" → "Checking", "Check Account", "Business Checking"
  
- [ ] Account name matching in transaction search tools
  - Add `accountNamePattern` parameter alongside `accountId`
  - Auto-resolve account name patterns to UUIDs
  - Example: `{ accountNamePattern: "Sav", matchType: "startsWith" }` → finds all savings accounts

- [ ] Payee/Category pattern in summary tools
  - `actual_transactions_summary_by_payee` with pattern support
  - `actual_transactions_summary_by_category` with pattern support
  - Aggregate spending across matched entities

**Enhanced Matching**:
- [ ] Case sensitivity option (`caseSensitive: boolean`)
- [ ] Word boundary matching (`wordBoundary: boolean`)
  - Example: "market" with wordBoundary → "Super Market" ✅, "Marketing" ❌
- [ ] Multiple pattern support
  - Example: `patterns: ["Amazon", "AWS"]` → matches both

**Benefits**:
- ✅ Consistent pattern matching across all entity types
- ✅ More powerful filtering without complexity
- ✅ Better UX for users who don't memorize exact names

**Estimated Effort**: 3-4 days

---

##### Phase 3: Regex Support (v0.5.0 - Q4 2026)
**Goal**: Full regex capabilities for power users and complex queries

**Enhanced Tools**:
- [ ] Add `matchType: 'regex'` to all pattern tools
- [ ] Regex pattern validation and safety checks
- [ ] Regex timeout protection (prevent ReDoS attacks)
- [ ] Regex complexity limits

**Implementation**:
```typescript
// Example: Find all transactions to companies ending in LLC or Inc
{
  payeePattern: "^.*(LLC|Inc\\.?)$",
  matchType: "regex"
}

// Example: Find transactions with amounts matching patterns
{
  payeePattern: "Store|Market|Shop",
  matchType: "regex",
  minAmount: -10000
}
```

**Security Considerations**:
- [ ] Regex complexity analyzer (prevent catastrophic backtracking)
- [ ] Timeout enforcement (max 100ms per regex execution)
- [ ] Pattern blacklist (dangerous regex patterns)
- [ ] Audit logging for regex usage
- [ ] Documentation on safe regex patterns

**Testing Requirements**:
- [ ] ReDoS attack prevention tests
- [ ] Performance benchmarks (1000+ payees)
- [ ] Edge case validation (special characters, Unicode)
- [ ] Security audit of regex engine

**Benefits**:
- ✅ Ultimate flexibility for power users
- ✅ Complex multi-condition searches
- ✅ Supports advanced AI-generated queries
- ✅ No need for multiple tool calls

**Risks & Mitigations**:
- ⚠️ **Risk**: ReDoS attacks → **Mitigation**: Timeout + complexity limits
- ⚠️ **Risk**: Hard to debug → **Mitigation**: Better error messages
- ⚠️ **Risk**: AI might generate invalid regex → **Mitigation**: Validation + fallback

**Estimated Effort**: 4-5 days
- Day 1-2: Regex engine integration with safety checks
- Day 3: Security testing and hardening
- Day 4: Performance testing and optimization
- Day 5: Documentation and examples

---

##### Phase 4: Advanced Pattern Features (v0.6.0 - 2027)
**Goal**: AI-assisted pattern generation and smart matching

**Features**:
- [ ] Fuzzy matching (Levenshtein distance)
  - Handle typos automatically
  - Example: "Amazom" → suggests "Amazon"
  
- [ ] Natural language patterns
  - AI converts "show me grocery stores" → regex pattern
  - Pre-built pattern library (common categories)

- [ ] Pattern templates
  - `template: "email"` → matches email-like payee names
  - `template: "website"` → matches URL-like payees
  - `template: "company"` → matches "Inc", "LLC", "Corp", etc.

- [ ] Multi-field pattern matching
  - Search across payee + category + notes simultaneously
  - Example: "Find all Amazon purchases in Electronics category"

- [ ] Pattern statistics and suggestions
  - "Top 10 payee patterns used"
  - "Did you mean: [similar patterns]"

**Benefits**:
- ✅ Extremely user-friendly
- ✅ Reduces cognitive load
- ✅ Learns from usage patterns
- ✅ AI agents can self-optimize queries

**Estimated Effort**: 1-2 weeks

---

##### Rollout Strategy

**Backward Compatibility**:
- ✅ Existing exact-match tools remain unchanged
- ✅ Pattern tools are opt-in additions
- ✅ No breaking changes across all phases

**Documentation Updates**:
- [ ] Pattern matching guide with examples
- [ ] Regex safety best practices
- [ ] AI prompt templates for pattern usage
- [ ] Migration guide (exact → pattern tools)

**Testing Strategy**:
- [ ] Unit tests: Pattern matching logic (all match types)
- [ ] Integration tests: Full search flows with patterns
- [ ] Performance tests: 10k+ entities, complex regex
- [ ] Security tests: ReDoS, injection attempts
- [ ] E2E tests: LibreChat integration with pattern tools

**Monitoring & Metrics**:
- [ ] Track pattern tool usage vs exact match
- [ ] Monitor regex timeout incidents
- [ ] Measure query performance impact
- [ ] Collect pattern match success rates

---

##### Success Criteria

**Phase 1 (Basic Patterns)**:
- ✅ 90%+ of "payee not found" errors eliminated
- ✅ <50ms performance overhead per search
- ✅ Zero breaking changes to existing tools

**Phase 3 (Regex)**:
- ✅ Zero ReDoS incidents in production
- ✅ <100ms regex execution time (95th percentile)
- ✅ Positive user feedback on flexibility

**Phase 4 (Advanced)**:
- ✅ 50%+ of searches use pattern tools
- ✅ AI agents self-generate effective patterns
- ✅ User satisfaction score >4.5/5

---

##### Risk Assessment

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Regex ReDoS attack | High | Medium | Timeout + complexity limits + testing |
| Performance degradation | Medium | Low | Benchmarking + optimization |
| AI misuse of patterns | Medium | Medium | Clear tool descriptions + examples |
| Pattern complexity confusion | Low | High | Documentation + templates |
| Backward compatibility break | High | Low | Strict versioning + testing |

---

##### Tools Benefiting from Pattern Matching

**Immediate Benefit** (Phase 1-2):
1. ✅ `actual_transactions_search_by_payee` → `_pattern` variant
2. ✅ `actual_transactions_search_by_category` → `_pattern` variant
3. ✅ `actual_transactions_summary_by_payee` → pattern support
4. ✅ `actual_transactions_summary_by_category` → pattern support

**Future Benefit** (Phase 2-3):
5. ✅ `actual_accounts_list` → filter by name pattern
6. ✅ `actual_categories_list` → filter by name pattern
7. ✅ `actual_payees_list` → filter by name pattern
8. ✅ `actual_rules_get` → find rules by pattern

**Advanced** (Phase 4):
9. ✅ Multi-entity search (payee + category + account patterns)
10. ✅ Cross-budget pattern search (if multi-budget support added)

---

**Pattern Matching Priority**: 🟠 Medium-High (Post v0.2.0)  
**Total Estimated Timeline**: 6-8 months (phased rollout)  
**Total Estimated Effort**: 3-4 weeks development time (spread across releases)

**Technical Approach**:
- Research internal Actual API access
- Use `send()` method for schedule operations
- Add comprehensive tests for schedule tools

**Success Criteria**:
- All 57 tools implemented (53 current + 4 schedules)
- LibreChat integration verified
- Documentation updated

---

#### 2. **Security Hardening**
**Target**: v0.5.x (Q2 2026)

**Features**:
- [ ] Add rate limiting middleware
- [ ] Implement request/response sanitization
- [ ] Add CSRF protection for HTTP transport
- [ ] Improve error messages (no information leakage)

**Impact**: Production-ready security posture

**Technical Approach**:
- Use `express-rate-limit` for rate limiting
- Create sanitization middleware
- Add CSRF token validation
- Audit all error messages

**Success Criteria**:
- No high/critical security audit findings
- Rate limiting tested under load
- OWASP Top 10 compliance improved

---

#### 3. **Improved Error Messages**
**Target**: v0.5.x (Q2 2026)

**Features**:
- [ ] Actionable error messages for all tools
- [ ] Suggest next steps in errors
- [ ] Link to relevant list tools
- [ ] Provide example values

**Impact**: Better user experience

**Example**:
```typescript
// Before
throw new Error('Account not found');

// After
throw new Error(
  'Account "abc-123" not found. ' +
  'Use actual_accounts_list to see available accounts. ' +
  'Example: {"id": "uuid-456", "name": "Checking"}'
);
```

**Success Criteria**:
- All tools have helpful error messages
- User testing shows improved experience
- Documentation includes error handling guide

---

#### 4. **Multi-Budget Switching**
**Target**: v0.5.x (Q2 2026)

**Features**:
- [ ] Add `actual_budgets_switch` tool
- [ ] Seamless switching without reconnection
- [ ] Preserve tool state across switches
- [ ] Update cache management

**Impact**: Better multi-budget support

**Technical Approach**:
- Disconnect from current budget
- Connect to new budget
- Update internal state
- Clear/update cache

**Success Criteria**:
- Switch budgets in <5 seconds
- No data loss during switch
- LibreChat integration verified

**Community Reference**: The [ahmadrazach fork](https://github.com/ahmadrazach/actual-mcp-server) prototyped this as [`actual_budgets_auto_select`](https://github.com/ahmadrazach/actual-mcp-server/blob/main/src/tools/budgets_auto_select.ts) with a [`BudgetRouter`](https://github.com/ahmadrazach/actual-mcp-server/blob/main/src/utils/budget-router.ts) utility. The approach: take a free-text `query` + optional `budget_arg`, keyword-match against a mapping table, then call `adapter.setActiveBudget(id)`. **Limitation**: the routing table is hardcoded to the author's personal budget names (`Faqir Farms`, `Azhar Home`, `Nadeem Home`) — a production implementation should drive the keyword→budget map from an env var or config file, or simply rely on `actual_budgets_get_all` + `actual_get_id_by_name` to let the AI resolve the budget name without a hardcoded mapping.

---

### 🟠 Medium Priority

#### 5. **Integration Test Suite**
**Target**: v0.5.x (Q2 2026)

> **Status (2026-03-02)**: The `tests/manual/` suite covers all 53 tools against a live MCP server across 6 levels (sanity → full). Playwright E2E covers 53/53 tools in Docker. The old `tests/integration/` directory was removed and replaced with comprehensive manual + Docker E2E coverage.

**Features**:
- [ ] Test multi-step workflows
- [ ] Test error propagation
- [ ] Test concurrent operations
- [ ] Test transaction boundaries

**Impact**: Higher confidence in refactoring

**Technical Approach**:
- Use `@playwright/test` for integration tests
- Create test fixtures for common scenarios
- Add to CI/CD pipeline

**Success Criteria**:
- 50%+ integration test coverage
- All critical workflows tested
- CI/CD integration complete

---

#### 6. **Performance Optimization**
**Target**: v0.5.x (Q2 2026)

> **Status (2026-03-02)**: Connection pooling is implemented (`src/lib/ActualConnectionPool.ts`). Concurrency limiting (5 parallel ops) is active. Remaining items: response caching, pagination for large result sets.

**Features**:
- [ ] Add caching layer for read-heavy operations
- [ ] Optimize transaction filtering
- [ ] Implement connection pooling
- [ ] Add pagination for large result sets

**Impact**: Better performance for power users

**Technical Approach**:
- Use `node-cache` for in-memory caching
- Optimize filtering algorithms
- Profile with real-world data
- Add pagination API

**Success Criteria**:
- 50% reduction in response time for cached operations
- Handle 10k+ transactions efficiently
- Load testing passes

---

#### 6b. **New APIs Discovered in Official Docs (2026-03-02)**
**Target**: v0.5.x (Q2 2026)

During a review of the [official Actual Budget API reference](https://actualbudget.org/docs/api/reference) on 2026-03-02, the following APIs were found to be present in the upstream library but **not yet exposed as MCP tools**. These are lower-priority additions scheduled for a later release.

---

##### Tags CRUD (4 new tools)
The API exposes a full Tags domain that is not yet implemented.

**New tools**:
- [ ] `actual_tags_get` — `getTags()` → `Promise<Tag[]>`
- [ ] `actual_tags_create` — `createTag(tag)` → `Promise<id>`
- [ ] `actual_tags_update` — `updateTag(id, fields)` → `Promise<null>`
- [ ] `actual_tags_delete` — `deleteTag(id)` → `Promise<null>`

**Tag object shape**:
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | id | no | Auto-generated |
| `tag` | string | yes | The tag text |
| `color` | string | no | Hex color string |
| `description` | string | no | Free-text description |

**Example**:
```typescript
await createTag({ tag: 'groceries', color: '#ff0000', description: 'Grocery shopping expenses' });
```

---

##### Lookup by Name (1 new tool) — ✅ IMPLEMENTED in v0.4.14
- ✅ `actual_get_id_by_name` — `getIDByName(type, name)` → `Promise<string>`

Resolves a human-readable name to a UUID for any of the following entity types: `accounts`, `schedules`, `categories`, `payees`. Useful for AI agents that receive a name from the user and need to pass an ID to other tools.

**Parameters**: `type` (one of `accounts | schedules | categories | payees`), `name` (string)  
**Status**: Implemented and registered. Tests cover all 4 entity types.

---

##### Server Version (1 new tool) — ✅ IMPLEMENTED in v0.4.14
- ✅ `actual_server_get_version` — `getServerVersion()` → `Promise<{version: string} | {error: string}>`

Returns the running Actual Budget server version string. Complements the existing `actual_server_info` tool with authoritative upstream version data.  
**Status**: Implemented and registered.

---

**Implemented**: 2 of 6 tools (`actual_get_id_by_name`, `actual_server_get_version`) — shipped in v0.4.14  
**Pending (Tags CRUD)**: 4 tools (`actual_tags_get`, `actual_tags_create`, `actual_tags_update`, `actual_tags_delete`) — blocked pending stable API release  
**Note**: Tags CRUD (`getTags`, `createTag`, `updateTag`, `deleteTag`) is only available in the Actual Budget **nightly build** (`26.3.0-nightly`). This project pins `@actual-app/api ^26.2.1` (stable). Tags tools will be implemented once Tags are included in a stable release.  
**Priority**: 🟡 Low — additive, no breaking changes  
**Effort**: ~1 day implementation + tests (Tags, once stable API available)

---

## 🌿 Community Fork Improvements (ZanzyTHEbar)

**Reference fork**: [ZanzyTHEbar/actual-mcp-server](https://github.com/ZanzyTHEbar/actual-mcp-server) — v0.4.8, 305 commits ahead of `agigante80:main` at time of analysis (2026-03-02)

The ZanzyTHEbar fork introduced several tools and architectural features that are worth evaluating and porting. Three tools are straightforward ports (all required adapter methods already exist in `src/lib/actual-adapter.ts`). The hybrid search engine is significant new infrastructure. Multi-user auth is a long-term enterprise feature.

**Key commit**: [`909399a`](https://github.com/ZanzyTHEbar/actual-mcp-server/commit/909399af35233fdf1d82c03a3fc1e38c1dce44b0) — "feat(tools): add rules upsert, batch update, uncategorized, search, a…"

---

### 🟢 Short-Term Ports (1-2 days each — adapter methods already in place)

#### CF-1. `actual_transactions_update_batch` — ✅ IMPLEMENTED in v0.4.16

**Fork source**: [`src/tools/transactions_update_batch.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/tools/transactions_update_batch.ts) (76 lines)

**Purpose**: Update multiple transactions in a single MCP call with per-item success/failure isolation. Reduces AI round-trips by up to 100× for bulk re-categorization workflows.

**Input schema** (`updates` array, min 1, max 100 items):
```typescript
{
  updates: Array<{
    id: string;              // Transaction UUID to update
    fields: {
      account?: string;        // Account ID
      date?: string;           // YYYY-MM-DD
      amount?: number;         // Cents (negative = expense, positive = income)
      payee?: string;          // Payee UUID
      payee_name?: string;     // Payee display name
      imported_payee?: string; // Original imported payee string
      category?: string;       // Category UUID
      notes?: string;
      cleared?: boolean;
    }
  }>  // min: 1, max: 100
}
```

**Return shape**:
```json
{
  "succeeded": [{"id": "txn-uuid-1"}],
  "failed":    [{"id": "txn-uuid-2", "error": "Not found"}],
  "total": 2,
  "successCount": 1,
  "failureCount": 1
}
```

**Implementation details**:
- Calls `adapter.updateTransaction(id, fields)` for each item **sequentially** (not parallel) for clean error isolation
- Per-item `try/catch` — partial failures do not abort the batch
- `adapter.updateTransaction()` already exists in `src/lib/actual-adapter.ts` (line 495)

**Use case**: "Categorize all of these 30 transactions as Groceries" — the AI gets all transaction IDs from `actual_transactions_uncategorized` and fires a single batch call.

**Estimated Effort**: ~1 day
- Port Zod schema + tool definition → `src/tools/transactions_update_batch.ts`
- Register in `actualToolsManager.ts`
- Unit tests

**Priority**: 🟢 High — significant UX improvement

---

#### CF-2. `actual_transactions_uncategorized` — ✅ IMPLEMENTED in v0.4.16

**Fork source**: [`src/tools/transactions_uncategorized.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/tools/transactions_uncategorized.ts) (58 lines)

**Purpose**: List uncategorized transactions (`category == null`) with summary totals for a date range. Designed as the entry point for AI-driven cleanup workflows — pair it with `actual_transactions_update_batch` and `actual_rules_create_or_update` for a complete categorization loop.

**Input schema**:
```typescript
{
  startDate?: string;  // YYYY-MM-DD (default: first day of current month)
  endDate?: string;    // YYYY-MM-DD (default: today)
  accountId?: string;  // Optional: filter to one account
  limit?: number;      // Max results, default 500
}
```

**Return shape**:
```json
{
  "result": {
    "transactions": [...],
    "summary": {
      "count": 42,
      "totalAmount": -123456
    },
    "dateRange": {
      "startDate": "2026-03-01",
      "endDate": "2026-03-31"
    }
  }
}
```

**Implementation details**:
- Calls `adapter.getTransactions(accountId, startDate, endDate)` (already exists)
- Client-side filter: `txns.filter(txn => txn.category == null)`
- Slices to `limit`, computes `totalAmount` via `reduce`
- No new adapter methods required

**Estimated Effort**: ~0.5 day (trivially simple)

**Priority**: 🟢 High — common workflow entry point

---

#### CF-3. `actual_rules_create_or_update` — ✅ IMPLEMENTED in v0.4.16

**Fork source**: [`src/tools/rules_create_or_update.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/tools/rules_create_or_update.ts) (196 lines)

**Purpose**: Idempotent rule creation — upsert semantics that deduplicate by condition set. An AI agent can safely call this repeatedly without creating duplicate rules.

**Input schema**:
```typescript
{
  stage?: 'pre' | 'post';          // default: 'pre'
  conditionsOp?: 'and' | 'or';     // default: 'and'
  conditions: Array<{
    field: string;   // 'imported_payee', 'payee', 'account', 'category', 'notes', 'amount', 'date'
    op: string;      // 'is', 'contains', 'matches', 'doesNotContain', 'isNot',
                     // 'gte', 'lte', 'gt', 'lt', 'isapprox', 'oneOf', 'notOneOf'
    value: string | number;
    type?: string;   // 'string', 'number', 'id'
  }>;
  actions: Array<{
    op: string;      // 'set', 'set-split-amount', 'link-schedule', 'prepend-notes', 'append-notes'
    field?: string;  // required for 'set': 'category', 'payee', 'notes', 'cleared', 'account'
    value: string | number | boolean | object;
    type?: string;   // 'id', 'string', 'number', 'boolean'
    options?: object;
  }>;
}
```

**Return shape**:
```json
{ "id": "rule-uuid", "created": true }
```
`created: true` → new rule created; `created: false` → existing rule updated (actions replaced).

**Upsert matching logic**:
1. Fetch all existing rules via `adapter.getRules()`
2. Match by: same `conditionsOp` **AND** identical set of `(field, op, value)` triples (order-independent — uses `Set<canonicalize(condition)>`)
3. On match: call `adapter.updateRule(id, {stage, conditionsOp, conditions, actions})` — actions are **replaced**, not merged
4. No match: call `adapter.createRule(data)` — returns new rule UUID

**Built-in validation** (from field/operator compatibility matrix):
- `imported_payee`, `notes`, `description` (string): `contains`, `matches`, `doesNotContain`, `is`, `isNot`
- `payee`, `account`, `category` (UUID/id): `is`, `isNot`, `oneOf`, `notOneOf` — value must be a UUID
- `amount` (number): `is`, `gte`, `lte`, `gt`, `lt`, `isapprox`
- `date`: `is`, `gte`, `lte`, `gt`, `lt`
- `oneOf`/`notOneOf` require array values

**Adapter methods**: All three already exist in `src/lib/actual-adapter.ts`:
- `adapter.getRules()` — line 532
- `adapter.createRule()` — line 539
- `adapter.updateRule()` — line 547

**Use case**: "Create a rule: any transaction imported as 'STARBUCKS*' → set category to Coffee." Running the same call twice leaves only one rule.

**Estimated Effort**: ~1.5 days
- Port upsert logic + validation + `canonicalize()` helper
- Register in `actualToolsManager.ts`
- Unit tests (create path, update path, validation errors)

**Priority**: 🟢 High — enables safe AI-driven rule management

---

### 🟡 Medium-Term (Significant Infrastructure — 2-4 weeks)

#### CF-4. Hybrid Search Engine (`actual_hybrid_search`, `actual_search_similar`, `actual_search_index_info`)

**Fork sources**:
- [`src/tools/hybrid_search.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/tools/hybrid_search.ts) (265 lines)
- [`src/tools/search_similar.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/tools/search_similar.ts) (151 lines)
- [`src/tools/search_index_info.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/tools/search_index_info.ts) (58 lines)
- `src/lib/search/` — full `SearchIndex`, `HybridSearchEngine`, `EmbeddingProvider`, `syncState` infrastructure (not yet fetched; substantial module)

**Purpose**: Intelligent natural-language transaction search combining three scoring dimensions with **Reciprocal Rank Fusion (RRF)**:
1. **BM25 full-text search** — SQLite FTS5 keyword matching
2. **Vector similarity** — cosine distance on stored embedding vectors (`vector_distance_cos()` SQLite extension)
3. **Metadata filters** — account / category / payee / date / amount structured filters

**`actual_hybrid_search` input schema**:
```typescript
{
  query?: string;       // Natural language: "groceries last month", "Amazon over $50"
  accountId?: string;
  categoryId?: string;
  payeeId?: string;
  startDate?: string;   // YYYY-MM-DD
  endDate?: string;     // YYYY-MM-DD
  minAmount?: number;   // cents
  maxAmount?: number;   // cents
  limit?: number;       // default 25
  mode?: 'hybrid' | 'fulltext' | 'vector' | 'metadata';  // default 'hybrid'
}
```

Auto-downgrade: if embedding provider unavailable, `hybrid`/`vector` modes automatically fall back to `fulltext`.

**`actual_search_similar` input schema**:
```typescript
{
  transactionId: string;    // Find transactions similar to this one by vector cosine distance
  excludeSamePayee?: boolean;
  limit?: number;
}
```
Requires the search index to be populated first (call `actual_hybrid_search` to trigger sync).

**`actual_search_index_info`**: No inputs. Returns index health: transaction count, last sync time, index size, embedding provider name/status, and active config values (`SEARCH_ENABLED`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `SEARCH_INDEX_DIR`).

**Architecture**:
- Separate SQLite database stored in `SEARCH_INDEX_DIR` (not Actual Budget's DB)
- `SearchIndex` manages FTS5 + vector column storage and incremental sync
- `HybridSearchEngine` executes multi-mode queries, merges results with RRF scoring
- `EmbeddingProvider` interface — supports `local` (bundled model) and remote providers (OpenAI, etc.)
- Response cache (TTL-based) for accounts/categories/payees reference data
- `isSearchIndexSynced()` / `ensureSynced()` — lazy population on first search call

**New env vars required**:
```bash
SEARCH_ENABLED=true
SEARCH_INDEX_DIR=./actual-data      # Where the SQLite search index is stored
EMBEDDING_PROVIDER=local            # or 'openai', 'ollama', etc.
EMBEDDING_MODEL=default
```

**Estimated Effort**: 2-4 weeks
- Week 1: SQLite FTS5 search index infrastructure + BM25 search
- Week 2: Embedding provider integration + vector search (`vector_distance_cos`)
- Week 3: RRF scoring merger, `search_similar`, `search_index_info` tools
- Week 4: Incremental sync, Docker volume integration, tests, documentation

**Priority**: 🟡 Medium — powerful capability but substantial complexity trade-off

> **Note**: Our existing [Pattern Matching Enhancement Roadmap](#2-pattern-matching-enhancement-roadmap) achieves ~70% of the `actual_hybrid_search` use cases (keyword search by payee/category) with far less infrastructure. Recommend completing Phases 1-2 of that roadmap before committing to the full search engine.

---

### ✅ Completed (CF-5 — v0.4.19)

#### CF-5. Multi-User Authentication via OIDC (`mcp-auth`) — **IMPLEMENTED in v0.4.19**

**Status**: ✅ Shipped. Branch `feat/cf5-oidc-auth` merged to `develop`.

**Files created/modified**:
- `src/auth/setup.ts` — `createMcpAuth()` factory with lazy discovery config
- `src/auth/budget-acl.ts` — per-user budget ACL (email / sub / group principals), ~170 lines
- `src/server/httpServer.ts` — wired `protectedResourceMetadataRouter()` + `bearerAuth()` + `budgetAclMiddleware`
- `src/config.ts` — `AUTH_PROVIDER`, `OIDC_ISSUER`, `OIDC_RESOURCE`, `OIDC_SCOPES`, `AUTH_BUDGET_ACL`
- `tests/unit/auth-acl.test.js` — 21 ACL test assertions (8 scenarios)
- `.env.example` — full OIDC documentation section with Keycloak / Azure AD / Auth0 examples

**Backward compatible**: `AUTH_PROVIDER=none` (default) leaves `MCP_SSE_AUTHORIZATION` static token behavior unchanged.

**Casdoor v2.13 compatibility** (v0.4.20): Casdoor auth-code flow JWTs omit the `scope` claim, causing `missing_required_scopes` with the `mcp-auth` default validator. Resolution: custom `jose` JWKS verifier in `httpServer.ts` bypasses `fetchServerConfig()` PKCE validation entirely, and `OIDC_SCOPES=` (empty) disables scope enforcement. Server logs `Scopes required: (none)`. Verified end-to-end with LibreChat + Casdoor v2.13 — 56 tools loading in both OIDC and static-Bearer instances simultaneously.

---

### 🔵 Long-Term (High Complexity — 1 week)

#### CF-5. Multi-User Authentication via OIDC (`mcp-auth`) [original planning notes below]

**Library**: [`mcp-auth`](https://www.npmjs.com/package/mcp-auth) v0.2.0 — provider-agnostic OAuth 2.1 / OIDC library built specifically for MCP servers. Replaces a hand-rolled OIDC implementation (ZanzyTHEbar's 6-file `src/auth/` module using `jose`) with a single maintained dependency that is fully compliant with the **MCP spec 2025-03-26 authorization requirements**.

**Why `mcp-auth` instead of porting ZanzyTHEbar's hand-rolled approach**:

The MCP specification (2025-03-26) formally **requires OAuth 2.1** for authorization. `mcp-auth` is purpose-built to implement exactly this spec:

| Capability | ZanzyTHEbar (`jose`) | `mcp-auth` |
|---|---|---|
| JWT validation | ✅ manual JWKS fetch | ✅ automatic |
| Authorization Server Discovery | ❌ not implemented | ✅ `fetchServerConfig()` auto-discovers |
| `/.well-known/oauth-protected-resource` endpoint | ❌ not implemented | ✅ `protectedResourceMetadataRouter()` |
| Scope enforcement | ❌ not implemented | ✅ `requiredScopes` in `bearerAuth()` |
| MCP spec 2025-03-26 compliance | ❌ partial | ✅ full |
| Custom code to maintain | ~300 lines | ~50 lines wiring |
| Dependencies | `jose` | `mcp-auth` (6 transitive deps) |

**Purpose**: Enterprise multi-user support — authenticate individual users via OIDC instead of a single shared Bearer token (`MCP_SSE_AUTHORIZATION`), with optional per-user budget ACLs.

**OIDC covers all practical LDAP/AD needs:**

OIDC is the identity layer on top of OAuth 2.0. Every major IdP federates LDAP/AD internally:

| User directory | Path to OIDC |
|---|---|
| Azure AD / Entra ID | Already OIDC-native |
| Active Directory | Keycloak (one Docker container, built-in LDAP wizard) |
| OpenLDAP | Keycloak / Authentik / Dex → OIDC |
| Google Workspace | Already OIDC-native |
| Okta / Auth0 | Already OIDC-native |

**Configuration**:
```bash
AUTH_PROVIDER=oidc
OIDC_ISSUER=https://auth.example.com/realms/myapp   # any OIDC-compliant IdP
OIDC_RESOURCE=https://actual-mcp.example.com         # this server's resource identifier URL
OIDC_SCOPES=read,write                               # comma-separated required scopes
AUTH_BUDGET_ACL={"alice@example.com": ["budget-sync-1"], "group:admin": ["*"]}
```

**How it works**: `mcp-auth` auto-discovers the JWKS endpoint from `OIDC_ISSUER/.well-known/openid-configuration`, validates incoming `Authorization: Bearer <JWT>` tokens, and enforces `requiredScopes`. Our thin wrapper then applies `AUTH_BUDGET_ACL` per-user budget filtering on top.

**Integration wiring** (approximate — full API is the server's Express app):
```typescript
// src/auth/setup.ts
import { MCPAuth, fetchServerConfig } from 'mcp-auth';

export async function createMcpAuth() {
  if (process.env.AUTH_PROVIDER !== 'oidc') return null;

  const authServerConfig = await fetchServerConfig(process.env.OIDC_ISSUER!, { type: 'oidc' });
  const resource = process.env.OIDC_RESOURCE!;
  const scopes = (process.env.OIDC_SCOPES ?? 'read').split(',');

  return new MCPAuth({
    protectedResources: {
      metadata: {
        resource,
        authorizationServers: [authServerConfig],
        scopesSupported: scopes,
      },
    },
  });
}

// src/server/httpServer.ts — add before routes:
const mcpAuth = await createMcpAuth();
if (mcpAuth) {
  app.use(mcpAuth.protectedResourceMetadataRouter());   // serves /.well-known/oauth-protected-resource
  app.use(mcpAuth.bearerAuth('jwt', {
    resource: process.env.OIDC_RESOURCE!,
    audience: process.env.OIDC_RESOURCE!,
    requiredScopes: scopes,
  }));
}
// req.auth.claims now available in every tool call
```

**Budget ACL** — thin custom layer on top (not provided by `mcp-auth`):
```typescript
// src/auth/budget-acl.ts — minimal, ~60 lines
// Uses req.auth.claims.sub / email / groups to enforce AUTH_BUDGET_ACL map
// canAccessBudget(claims, budgetId): boolean
```

**Implementation scope** (much smaller than porting ZanzyTHEbar):
- `src/auth/setup.ts` — `createMcpAuth()` factory (~40 lines)
- `src/auth/budget-acl.ts` — per-user budget ACL enforcement (~60 lines)
- `src/server/httpServer.ts` — wire `protectedResourceMetadataRouter()` + `bearerAuth()` (~10 lines)
- `src/config.ts` — add `AUTH_PROVIDER`, `OIDC_ISSUER`, `OIDC_RESOURCE`, `OIDC_SCOPES`, `AUTH_BUDGET_ACL` to Zod schema
- Unit tests: ACL logic + middleware wiring (mock `mcp-auth`)
- Documentation + Keycloak quick-start guide for LDAP/AD users

**Features**:
- Full MCP spec 2025-03-26 OAuth 2.1 compliance (Authorization Server Discovery, JWKS, scopes)
- `/.well-known/oauth-protected-resource` endpoint served automatically
- Per-user budget ACL via `AUTH_BUDGET_ACL` JSON map
- Group-based ACLs (`"group:admin": ["*"]` = admin group accesses all budgets)
- Backward-compatible: `AUTH_PROVIDER=none` (default) leaves existing `MCP_SSE_AUTHORIZATION` untouched

**New dependency**: `mcp-auth` v0.2.0 (MIT, 2,168 weekly downloads, TypeScript-native, actively tracking MCP spec changes)

**Zod compatibility note**: Project runs Zod 4.x natively (`z.toJSONSchema()` built in). Verify `mcp-auth`'s transitive deps are compatible with Zod 4.x before installing.

**No breaking changes**: `AUTH_PROVIDER` defaults to `none`

**For users with bare LDAP/AD and no OIDC IdP**: Run Keycloak as a sidecar (`docker compose`). LDAP federation wizard in admin UI, OIDC endpoint ready in ~10 minutes.

**Estimated Effort**: ~1 week (significantly reduced vs. hand-rolling — `mcp-auth` handles the hard OAuth 2.1 plumbing)

**Priority**: 🔵 Low for single-user deployments; **High** for self-hosted teams sharing one Actual Budget instance

---

## 🔄 Medium-Term (3-6 Months)

### 🟠 Recommended

#### 7. **Report Generation Tools**
**Target**: v0.4.0 (March 2026)

**Features**:
- [ ] `actual_reports_spending_by_category`
- [ ] `actual_reports_income_vs_expenses`
- [ ] `actual_reports_net_worth_trend`
- [ ] `actual_reports_budget_vs_actual`
- [ ] Custom date ranges and grouping

**Impact**: High user value - AI can generate financial reports

**Technical Approach**:
- Use `query_run` internally for complex queries
- Format results for easy consumption
- Support multiple output formats (JSON, CSV)

**Success Criteria**:
- 5+ report tools implemented
- LibreChat can generate reports conversationally
- Documentation includes report examples

---

#### 8. **Goal Tracking Tools**
**Target**: v0.4.0 (March 2026)

**Features**:
- [ ] `actual_goals_list`
- [ ] `actual_goals_create`
- [ ] `actual_goals_update`
- [ ] `actual_goals_get_progress`
- [ ] `actual_goals_delete`

**Impact**: Complete feature parity with Actual Budget UI

**Technical Approach**:
- Wait for upstream API support OR
- Implement using custom queries
- Track progress over time

**Success Criteria**:
- Goal management via AI conversations
- Progress tracking works correctly
- Integration with budget tools

---

#### 9. **Advanced Search & Filtering**
**Target**: v0.4.0 (March 2026)

**Features**:
- [ ] Full-text search across transactions
- [ ] Natural language date ranges ("last month", "Q1 2025")
- [ ] Fuzzy payee matching
- [ ] Smart category suggestions

**Impact**: Better user experience for large datasets

**Technical Approach**:
- Use SQLite FTS5 for full-text search
- Parse natural language dates with `date-fns`
- Implement fuzzy matching algorithm
- Use ML for category suggestions (optional)

**Success Criteria**:
- Search 100k+ transactions in <1 second
- Natural language queries work
- High relevance in search results

---

#### 10. **Enhanced Observability**
**Target**: v0.5.0 (May 2026)

**Features**:
- [ ] Detailed Prometheus metrics (latency percentiles, queue depth)
- [ ] Enhanced health check endpoint
- [ ] Request tracing with correlation IDs
- [ ] Log aggregation support (structured JSON logs)

**Impact**: Better production monitoring

**Technical Approach**:
- Extend Prometheus metrics
- Add OpenTelemetry (optional)
- Implement request ID middleware
- Structure logs for ELK/Loki

**Success Criteria**:
- Full observability stack deployed
- Dashboards created (Grafana)
- Alerting configured

---

## 🌟 Long-Term (6+ Months)

### 🟢 Future Enhancements

#### 11. **Multi-Client Support**
**Target**: v0.6.0 (August 2026)

**Features**:
- [ ] Claude Desktop integration
- [ ] Custom MCP client SDKs
- [ ] REST API wrapper (in addition to MCP)
- [ ] GraphQL API (optional)

**Impact**: Broader ecosystem adoption

**Technical Approach**:
- Test with Claude Desktop
- Create SDK examples (Python, JavaScript)
- Add REST endpoints alongside MCP
- Consider GraphQL layer

**Success Criteria**:
- Multiple clients verified
- SDK documentation complete
- Examples for each client type

---

#### 12. **Enterprise Features**
**Target**: v0.7.0 (November 2026)

**Features**:
- [ ] Role-Based Access Control (RBAC)
- [ ] Audit logging
- [ ] Multi-tenant support
- [ ] SSO/SAML integration
- [ ] Compliance reporting (SOC 2, GDPR)

**Impact**: Enterprise-ready platform

**Technical Approach**:
- Design permission system
- Implement audit log storage
- Add tenant isolation
- Integrate SSO providers

**Success Criteria**:
- RBAC fully functional
- Audit logs comprehensive
- Multi-tenant tested
- Compliance certified

---

#### 13. **High Availability & Scalability**
**Target**: v0.8.0 (February 2027)

**Features**:
- [ ] Horizontal scaling support
- [ ] Load balancing
- [ ] Redis-backed caching
- [ ] Session management
- [ ] Kubernetes Helm charts

**Impact**: Support large-scale deployments

**Technical Approach**:
- Stateless server design
- External cache (Redis)
- Session store (Redis)
- K8s deployment templates

**Success Criteria**:
- Scale to 1000+ concurrent users
- <100ms p95 latency
- 99.9% uptime

---

#### 14. **AI/ML Enhancements**
**Target**: v0.9.0 (May 2027)

**Features**:
- [ ] Spending anomaly detection
- [ ] Category auto-suggestion (ML-based)
- [ ] Budget recommendation engine
- [ ] Fraud detection
- [ ] Predictive analytics

**Impact**: Intelligent financial insights

**Technical Approach**:
- Train models on transaction data
- Use lightweight models (TensorFlow.js)
- Privacy-preserving ML (on-device)

**Success Criteria**:
- High accuracy (>90%)
- Fast inference (<100ms)
- Privacy-compliant

---

#### 15. **Advanced Integrations**
**Target**: v1.0.0 (August 2027)

**Features**:
- [ ] Plaid integration (bank connectivity)
- [ ] Zapier/IFTTT workflows
- [ ] Webhook support
- [ ] Email/SMS notifications
- [ ] Mobile app API

**Impact**: Complete ecosystem

**Technical Approach**:
- Integrate external APIs
- Build webhook system
- Add notification service

**Success Criteria**:
- Major integrations working
- Webhook reliability >99%
- Notification delivery <1 minute

---

## 🎯 Version Milestones

### v0.4.15–v0.4.16 (March 2026) — Community ports + batch tools
- ✅ 56 tools (84% API coverage, +3 from community fork ports)
- ✅ `actual_transactions_update_batch` — batch-update up to 100 transactions in one call (adapted from [ZanzyTHEbar fork](https://github.com/ZanzyTHEbar/actual-mcp-server))
- ✅ `actual_transactions_uncategorized` — list transactions with no category, ideal for AI-driven cleanup (adapted from ZanzyTHEbar fork)
- ✅ `actual_rules_create_or_update` — idempotent rule upsert, prevents duplicate rules (adapted from ZanzyTHEbar fork)
- ✅ `docs/NEW_TOOL_CHECKLIST.md` — 9-step checklist for adding new tools

### v0.4.13–v0.4.14 (March 2026) — Lookup tools + version info
- ✅ 53 tools (84% API coverage)
- ✅ Session management tools (`actual_session_list`, `actual_session_close`)
- ✅ Server info tool (`actual_server_info`)
- ✅ `actual_server_get_version` — Actual Budget server version (new in v0.4.14)
- ✅ `actual_get_id_by_name` — name→UUID lookup for accounts/categories/payees/schedules (new in v0.4.14)
- ✅ 6 exclusive ActualQL-powered search/summary tools
- ✅ Connection pooling (`ActualConnectionPool.ts`)
- ✅ Comprehensive test suite (unit, Docker E2E 53/53, manual integration)
- ✅ SSE transport removed — HTTP is the sole supported transport
- ✅ Security fixes: ajv, qs, minimatch, diff CVEs resolved
- [ ] Schedules tools — still pending
- [ ] Tags CRUD tools — blocked on nightly API (stable release awaited)
- [ ] Security hardening (rate limiting, CSRF) — still pending

### v0.5.x - "API Complete + Security" (Q2 2026)
- [ ] Schedules CRUD (4 tools)
- [ ] Tags CRUD (4 tools) — waiting for stable `@actual-app/api` release (currently nightly-only)
- [ ] Rate limiting + CSRF protection
- [ ] Improved error messages
- [ ] Multi-budget switching

### v0.6.0 - "Feature Complete" (Q3 2026)
- [ ] Report generation tools
- [ ] Goal tracking tools
- [ ] Advanced search & filtering
- [ ] Natural language date ranges

### v0.7.0 - "Production Grade" (Q4 2026)
- [ ] Enhanced observability (OpenTelemetry, Grafana)
- [ ] Load testing & benchmarks
- [ ] Documentation complete

### v1.0.0 - "Enterprise Ready" (2027)
- [ ] RBAC & multi-tenant
- [ ] Advanced integrations
- [ ] ML/AI features
- [ ] Full ecosystem

---

## 🤖 AI Assistance Opportunities

AI agents can help with:

### High-Impact AI Tasks

1. **Test Writing** (High priority)
   - Generate unit tests for all tools
   - Create integration test scenarios
   - Write E2E test cases

2. **Documentation** (High priority)
   - Keep docs in sync with code
   - Generate API examples
   - Create troubleshooting guides

3. **Code Quality** (Medium priority)
   - Refactor long functions
   - Extract duplicated code
   - Improve error handling

4. **Security Audits** (Medium priority)
   - Scan for vulnerabilities
   - Review authentication logic
   - Check for leaked secrets

5. **Performance Analysis** (Low priority)
   - Profile code execution
   - Identify bottlenecks
   - Suggest optimizations

---

## 🔄 Quarterly Reviews

### Q4 2025 (October-December) — Completed
**Actual delivered**:
- ✅ 51 tools (above original 46-tool plan)
- ✅ Session management tools added
- ✅ 6 exclusive ActualQL search/summary tools added
- ✅ Comprehensive Docker E2E test suite (51/51 tools)
- ❌ Schedules tools — deferred
- ❌ Rate limiting / CSRF — deferred

### Q1 2026 (March early) — Additional deliveries
- ✅ `actual_get_id_by_name` — name→UUID entity lookup (accounts/categories/payees/schedules)
- ✅ `actual_server_get_version` — Actual Budget server version
- ✅ All docs updated to 53 tools / 84% API coverage
- ✅ Manual test suite expanded to cover all 53 tools

### Q1 2026 (January-March) — In progress
**Focus**: Test quality, documentation, remaining API coverage

**Delivered so far**:
- ✅ Unit test suite (3 files, 53-tool smoke + 23 schema assertions)
- ✅ Documentation audit and updates (ARCHITECTURE, TESTING, SECURITY)
- ✅ SSE transport removed (HTTP-only, cleaner codebase)
- ✅ Security: CVEs resolved for ajv, qs, minimatch, diff
- ✅ `actual_get_id_by_name` — name→UUID lookup (all 4 entity types)
- ✅ `actual_server_get_version` — Actual Budget server version tool
- ⏳ Tags CRUD tools — waiting for stable API (currently nightly `26.3.0-nightly` only)
- ⏳ Schedules tools (planned)
- ⏳ Rate limiting (planned)

### Q2 2026 (April-June)
**Focus**: Production readiness

**Deliverables**:
- v0.5.0 release
- Observability complete
- Load testing passed
- High availability verified

### Q3 2026 (July-September)
**Focus**: Ecosystem growth

**Deliverables**:
- v0.6.0 release
- Multi-client support
- SDK documentation
- Community engagement

---

## 📊 Success Metrics

### Technical Metrics

| Metric | Current | v0.5.0 Target | v1.0.0 Target |
|--------|---------|---------------|---------------|
| **API Coverage** | 84% (53 tools, missing schedules/tags) | ~90% (+ schedules, tags) | 100% + reports |
| **Test Coverage** | 53/53 E2E, 3 unit files, 23 schema assertions | 90% | 95% |
| **Response Time (p95)** | <500ms | <200ms | <100ms |
| **Uptime** | N/A | 99.5% | 99.9% |
| **Concurrent Users** | ~10 | ~100 | ~1000 |
| **Security Score** | B+ | A | A+ |

### Adoption Metrics

| Metric | Current | 6-Month Target | 12-Month Target |
|--------|---------|----------------|-----------------|
| **Docker Pulls** | <1000 | 10,000 | 50,000 |
| **GitHub Stars** | <50 | 500 | 2,000 |
| **Active Users** | <100 | 1,000 | 10,000 |
| **Contributing Devs** | 1-2 | 5-10 | 20-50 |

---

## 🔗 Related Documentation

- [Project Overview](./PROJECT_OVERVIEW.md) - Current state
- [Architecture](./ARCHITECTURE.md) - Technical design
- [Security & Privacy](./SECURITY_AND_PRIVACY.md) - Security roadmap
- [Testing & Reliability](./TESTING_AND_RELIABILITY.md) - Testing strategy

---

## 📝 How to Contribute

### For Developers

1. Check this roadmap for upcoming features
2. Pick a high-priority item
3. Create GitHub issue discussing approach
4. Follow **[docs/NEW_TOOL_CHECKLIST.md](./NEW_TOOL_CHECKLIST.md)** — mandatory step-by-step checklist covering implementation, unit tests, manual integration tests, AI prompt update, and all documentation files
5. Submit pull request

### For Users

1. Use the server and provide feedback
2. Report bugs and suggest improvements
3. Share use cases and workflows
4. Help with documentation

### For AI Agents

1. Focus on high-impact AI tasks
2. Write tests for existing features
3. Improve documentation
4. Refactor code quality issues

---

## ✨ Summary

**The Actual MCP Server is production-ready today**, but this roadmap outlines the path to becoming an **enterprise-grade, AI-powered financial management platform**.

**Priorities**:
1. 🔴 **Complete API coverage** (v0.2.0)
2. 🔴 **Security hardening** (v0.2.0)
3. 🟠 **Performance optimization** (v0.3.0)
4. 🟠 **Advanced features** (v0.4.0-v0.5.0)
5. 🟢 **Enterprise features** (v0.6.0-v1.0.0)

**Timeline**: v1.0.0 targeted for August 2027 (21 months)

**Next Milestone**: v0.5.x — Schedules + Tags (once stable API available) + security hardening (Q2 2026)
