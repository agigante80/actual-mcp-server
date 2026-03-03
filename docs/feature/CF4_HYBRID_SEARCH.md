# CF-4: Hybrid Search Engine

**Feature:** `actual_hybrid_search` + `actual_search_similar` + `actual_search_index_info`  
**Status:** 🟡 Planned — Medium Priority  
**Target Version:** v0.5.x (Q3 2026)  
**Estimated Effort:** 2–4 weeks  
**Reference Fork:** [ZanzyTHEbar/actual-mcp-server](https://github.com/ZanzyTHEbar/actual-mcp-server)  
**Last Analyzed:** 2026-03-03

---

## Overview

Intelligent natural-language transaction search that combines three scoring dimensions and merges them with **Reciprocal Rank Fusion (RRF)**:

1. **BM25 full-text search** — SQLite FTS5 keyword matching
2. **Vector similarity** — cosine distance on stored 384-dim float32 embeddings
3. **Metadata filters** — account / category / payee / date / amount structured filters

An LLM agent can issue a query like `"coffee shops last month"` or `"Amazon over $50"` and receive results ranked by relevance across all three dimensions simultaneously.

> **Pre-requisite reading:** [docs/ROADMAP.md — CF-4 section](../ROADMAP.md#cf-4-hybrid-search-engine-actual_hybrid_search-actual_search_similar-actual_search_index_info)

---

## 3 New MCP Tools

### `actual_hybrid_search` — primary tool

```typescript
// Input schema
{
  query?: string;     // Natural language: "groceries last month", "Amazon over $50"
  accountId?: string;
  categoryId?: string;
  payeeId?: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  minAmount?: number; // cents
  maxAmount?: number; // cents
  limit?: number;     // default 25
  mode?: 'hybrid' | 'fulltext' | 'vector' | 'metadata'; // default 'hybrid'
}

// Output per result
{
  id, date, amount, payee_name, category_name, account_name,
  score: number,              // RRF score
  matchedBy: ('fts' | 'vector' | 'metadata')[],
  amount_display: "$50.00",
  type: "expense" | "income"
}
// Plus top-level: totalMatched, mode, timing.totalMs, timing.embeddingMs, indexStats, embeddingProvider
```

**Auto-downgrade**: if the embedding provider is unavailable, `hybrid`/`vector` modes automatically fall back to `fulltext`.

---

### `actual_search_similar` — find related transactions

```typescript
// Input
{
  transactionId: string;      // Find transactions similar to this one
  excludeSamePayee?: boolean;
  limit?: number;
}
```

Uses vector cosine distance against pre-computed embeddings. Requires `actual_hybrid_search` to have been called at least once to populate the index.

**Fork source:** [`src/tools/search_similar.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/tools/search_similar.ts) (151 lines)

---

### `actual_search_index_info` — index health

No inputs. Returns:
- Transaction count in the index
- Last sync timestamp
- Index size on disk
- Embedding provider name + availability status
- Active config: `SEARCH_ENABLED`, `SEARCH_INDEX_DIR`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`
- Whether index is synced (`isSearchIndexSynced()`)

**Fork source:** [`src/tools/search_index_info.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/tools/search_index_info.ts) (58 lines)

---

## Full Pipeline (step by step)

### Step 1 — Query analysis (`queryAnalyzer.ts`)

Parses the natural-language query for:
- **Intent**: keyword search vs. semantic question vs. filter-only
- **Implicit amount ranges**: `"over $50"` → `maxAmount=-5000` (negative cents convention)
- **Implicit date ranges**: `"last month"` → `startDate`/`endDate`
- **Recommended mode**: auto-selects `fulltext`, `vector`, `hybrid`, or `metadata` based on what was detected

**Fork source:** [`src/lib/search/queryAnalyzer.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/queryAnalyzer.ts)

---

### Step 2 — FTS query preparation

1. **Sanitize**: strip dangerous FTS5 characters from raw user input
2. **Strip extracted fragments**: remove amount/date text already captured in step 1 (prevents double-counting)
3. **Expand with synonyms** (`queryExpansion.ts`): `"food"` → `"food" OR "grocery" OR "groceries"`

**Fork source:** [`src/lib/search/queryExpansion.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/queryExpansion.ts)

---

### Step 3 — Embedding generation

Only for `hybrid` or `vector` mode. Passes the original query text to the configured `EmbeddingProvider`, producing a 384-dimensional float32 vector.

If the provider is unavailable: auto-downgrades to `fulltext`.

**Fork source:** [`src/lib/search/providers/`](https://github.com/ZanzyTHEbar/actual-mcp-server/tree/main/src/lib/search/providers)  
Supported providers: `HuggingFaceLocalProvider`, `OllamaProvider`, `OpenAICompatibleProvider`

---

### Step 4 — SQL execution against the libsql search index

The index is a **separate SQLite/libsql database** (not Actual Budget's DB), stored in `SEARCH_INDEX_DIR`. Schema:

- `transactions` table — denormalized rows with `F32_BLOB` vector column (`embedding`)
- `fts_transactions` — FTS5 virtual table over notes + payee_name + category_name
- `content_hash` per row — enables incremental sync (only changed rows are re-indexed)

In `hybrid` mode, one SQL query with CTEs runs FTS + vector simultaneously:

```sql
WITH
  fts_matches AS (
    SELECT txn_id, row_number() OVER (ORDER BY rank) AS rank_num
    FROM fts_transactions WHERE fts_transactions MATCH ? LIMIT ?
  ),
  vec_scored AS (
    SELECT id AS txn_id,
           vector_distance_cos(embedding, vector32(?)) AS dist
    FROM transactions WHERE embedding IS NOT NULL
  ),
  vec_matches AS (
    SELECT txn_id, row_number() OVER (ORDER BY dist) AS rank_num
    FROM vec_scored ORDER BY dist LIMIT ?
  ),
  fused AS (
    SELECT COALESCE(f.txn_id, v.txn_id) AS txn_id,
           f.rank_num AS fts_rank, v.rank_num AS vec_rank,
           (COALESCE(1.0 / (60 + f.rank_num), 0.0) * {wFts}   -- FTS weight default 1.0
          + COALESCE(1.0 / (60 + v.rank_num), 0.0) * {wVec})  -- Vec weight default 0.8
           AS rrf_score
    FROM fts_matches f FULL OUTER JOIN vec_matches v ON f.txn_id = v.txn_id
  )
SELECT fused.rrf_score, fused.fts_rank, fused.vec_rank, t.*
FROM fused JOIN transactions t ON t.id = fused.txn_id
WHERE <metadata filters>
ORDER BY fused.rrf_score DESC LIMIT ?
```

RRF constant K=60 (standard). Default weights: FTS=1.0, Vec=0.8.

**Fork source:** [`src/lib/search/HybridSearchEngine.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/HybridSearchEngine.ts)

#### Mode dispatch table

| `mode` | Execution |
|--------|-----------|
| `hybrid` | FTS5 + vector + RRF (SQL above) |
| `fulltext` | FTS5 BM25 only |
| `vector` | `vector_distance_cos` only |
| `metadata` | Structured filters only, order by date DESC |
| `hybrid` (no text) | Falls back to `metadata` |
| `hybrid` (no embedding) | Falls back to `fulltext` |

---

### Step 5 — Lazy index sync (`ensureSynced`)

On the **first call**, pulls all transactions + reference data (accounts/categories/payees) from the Actual API via `withActualApi`, denormalizes, embeds, and writes to the libsql index. Marks synced with `markSearchIndexSynced()`.

Subsequent calls skip sync until any **write tool** triggers `markSearchIndexDirty()` via `CacheInvalidator.ts`.

**Fork source:** [`src/lib/search/syncState.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/syncState.ts)  
**Fork source:** [`src/lib/search/CacheInvalidator.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/CacheInvalidator.ts)

---

### Step 6 — Zero-result retry

If auto-derived amount/date filters produced zero results but the FTS query had text, automatically retries without those auto-derived filters. User-explicit filters are never relaxed.

---

### Step 7 — Response cache (2 minutes)

Results cached by `JSON.stringify(query)` key with tags `['search', 'transactions']` (LRU + TTL via `ResponseCache.ts`).

**Fork source:** [`src/lib/search/ResponseCache.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/ResponseCache.ts)

---

## Architecture Diagram

```
MCP Tools
  actual_hybrid_search ──────────────────────────────────────────┐
  actual_search_similar ─────────────────────────────────────┐   │
  actual_search_index_info ──────────────────────────────┐   │   │
                                                          │   │   │
Search Engine                                             │   │   │
  SearchIndex (libsql)                                    ↓   ↓   ↓
    ├── FTS5 virtual table (fts_transactions)         HybridSearchEngine
    ├── F32_BLOB vector column (embedding)                │
    └── Incremental sync (content_hash)             EmbeddingPipeline
                                                          │
Embedding Providers                                       ↓
  ├── HuggingFaceLocalProvider (384-dim, bundled)   EmbeddingProvider
  ├── OllamaProvider                                (interface)
  └── OpenAICompatibleProvider
```

---

## File Structure to Create

```
src/lib/search/
├── index.ts              # Barrel export
├── types.ts              # SearchResult, HybridSearchQuery, SearchFilters, etc.
├── ResponseCache.ts      # LRU + TTL + tag invalidation
├── CacheInvalidator.ts   # Write-tool → cache-tag mapping
├── syncState.ts          # markSearchIndexDirty / isSearchIndexSynced
├── SearchIndex.ts        # libsql index: FTS5 + vectors + incremental sync
├── HybridSearchEngine.ts # RRF merge logic (all 4 modes)
├── EmbeddingPipeline.ts  # Batch embedding + buildTransactionText()
├── queryAnalyzer.ts      # Intent detection + amount/date extraction
├── queryExpansion.ts     # Synonym expansion for FTS queries
├── embedding-codec.ts    # embeddingToF32Blob, f32BlobToEmbedding
├── searchRuntime.ts      # Singleton: SearchIndex + HybridSearchEngine + Provider
└── providers/
    ├── types.ts           # EmbeddingProvider interface
    ├── factory.ts         # createEmbeddingProvider() with fallback chain
    ├── index.ts
    ├── HuggingFaceLocalProvider.ts
    ├── OllamaProvider.ts
    └── OpenAICompatibleProvider.ts

src/tools/
├── hybrid_search.ts       # actual_hybrid_search tool definition
├── search_similar.ts      # actual_search_similar tool definition
└── search_index_info.ts   # actual_search_index_info tool definition

tests/unit/
└── hybrid_search.test.js  # FTS, vector, hybrid, metadata, filter tests
```

---

## New Environment Variables

```bash
# Required to enable the feature
SEARCH_ENABLED=true

# Where the libsql search index DB is stored (separate from Actual's data)
SEARCH_INDEX_DIR=./actual-data   # or /data/search for Docker volume

# Embedding provider selection
EMBEDDING_PROVIDER=local          # 'local' | 'ollama' | 'openai'
EMBEDDING_MODEL=default           # model name / url depends on provider

# Provider-specific (when EMBEDDING_PROVIDER=ollama)
OLLAMA_BASE_URL=http://localhost:11434

# Provider-specific (when EMBEDDING_PROVIDER=openai)
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1   # or custom OpenAI-compatible endpoint
```

**Feature is opt-in**: when `SEARCH_ENABLED` is absent or `false`, all three tools are excluded from `IMPLEMENTED_TOOLS` (tool exports are `null`, skipped by `actualToolsManager`).

---

## New Dependencies Required

| Package | Purpose | Notes |
|---------|---------|-------|
| `@libsql/client` or `better-sqlite3` + vector extension | SQLite + `vector_distance_cos()` | ZanzyTHEbar uses libsql which has built-in vector support |
| `@xenova/transformers` | Local HuggingFace embedding model (384-dim) | ~50MB model downloaded on first run |
| Existing `zod`, `winston` | Already in project | No new dep needed |

> **Critical decision before starting**: Verify `libsql` vs `better-sqlite3 + sqlite-vec` for the vector extension. ZanzyTHEbar uses libsql (Turso's fork), which bundles `vector32()` / `vector_distance_cos()`. The standard `better-sqlite3` requires the [`sqlite-vec`](https://github.com/asg017/sqlite-vec) loadable extension separately.

---

## Implementation Phases

### Week 1 — Search Index Infrastructure
- [ ] Create `src/lib/search/types.ts` — all interfaces
- [ ] Create `src/lib/search/SearchIndex.ts` — libsql schema, FTS5 table, F32_BLOB column, `open()` / `close()` / `indexTransactions()` / `populateAccounts()` / `populateCategories()` / `populatePayees()`
- [ ] Create `src/lib/search/EmbeddingPipeline.ts` — `buildTransactionText()`, batch embed loop
- [ ] Create `src/lib/search/syncState.ts` — dirty flag + budget ID tracking
- [ ] Unit test: index creation, FTS search, incremental sync

### Week 2 — Embedding Providers + Vector Search
- [ ] Create `src/lib/search/providers/types.ts` — `EmbeddingProvider` interface
- [ ] Implement `HuggingFaceLocalProvider.ts` (`@xenova/transformers`, 384-dim)
- [ ] Implement `OllamaProvider.ts`
- [ ] Implement `OpenAICompatibleProvider.ts`
- [ ] Create `providers/factory.ts` — fallback chain: configured → local HuggingFace → null (FTS-only)
- [ ] Create `src/lib/search/embedding-codec.ts` — `embeddingToF32Blob`, `f32BlobToEmbedding`
- [ ] Unit test: provider loading, embedding shape (must be 384-dim), vector storage

### Week 3 — Hybrid Search Engine + Tools
- [ ] Create `src/lib/search/queryAnalyzer.ts` — intent detection, amount/date extraction
- [ ] Create `src/lib/search/queryExpansion.ts` — synonym OR-groups for FTS
- [ ] Create `src/lib/search/HybridSearchEngine.ts` — all 4 mode executors + RRF merge SQL
- [ ] Create `src/lib/search/ResponseCache.ts` — LRU + TTL + tag invalidation
- [ ] Create `src/lib/search/CacheInvalidator.ts` — write-tool → `markSearchIndexDirty()`
- [ ] Create `src/lib/search/searchRuntime.ts` — singleton lifecycle
- [ ] Create `src/tools/hybrid_search.ts`, `search_similar.ts`, `search_index_info.ts`
- [ ] Register tools in `actualToolsManager.ts` (only when `SEARCH_ENABLED=true`)
- [ ] Unit test: all 4 modes, RRF scoring, filter combinations, zero-result retry

### Week 4 — Integration, Docker, Docs
- [ ] Update `docker-compose.yaml` — mount `SEARCH_INDEX_DIR` as named volume
- [ ] Update `.env.example` — document all 5 new vars
- [ ] Add manual integration test in `tests/manual/`
- [ ] Run `npm run build && npm run test:adapter && npm run test:unit-js`
- [ ] Update `docs/ARCHITECTURE.md` — search module section
- [ ] Update `docs/ROADMAP.md` — mark CF-4 complete
- [ ] Run `npm run docs:sync` + bump version

---

## Key Decisions for Review

Before starting implementation, agree on:

1. **libsql vs better-sqlite3 + sqlite-vec**
   - libsql: bundled vector support, Turso ecosystem, used by ZanzyTHEbar
   - better-sqlite3 + sqlite-vec: more common, but requires loadable extension (may complicate Docker)
   - Reference: [sqlite-vec on GitHub](https://github.com/asg017/sqlite-vec)

2. **Embedding dimensions (384 vs 768 vs 1536)**
   - ZanzyTHEbar hardcodes 384 (matches `all-MiniLM-L6-v2`)
   - Schema is fixed at init time — changing later requires re-indexing all transactions
   - Reference: [EMBEDDING_DIMS in searchRuntime.ts](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/searchRuntime.ts#L17)

3. **Default embedding provider**
   - `local` (bundled HuggingFace, ~50MB download on first run, no external dep) — recommended
   - `ollama` (requires separate Ollama server running locally)
   - `openai` (requires API key + cost)

4. **SEARCH_INDEX_DIR Docker volume strategy**
   - Must be a persistent named volume, not tmpfs
   - Separate from `ACTUAL_DATA_DIR` to avoid conflicts with Actual Budget's data

5. **Relation to Pattern Matching (roadmap note)**
   - The [Pattern Matching Enhancement Roadmap](../ROADMAP.md#2-pattern-matching-enhancement-roadmap) covers ~70% of `actual_hybrid_search` use cases (keyword search by payee/category) with far less infrastructure
   - Recommend completing Pattern Matching Phases 1–2 before committing to CF-4

---

## Source Files to Study in ZanzyTHEbar Fork

All links point to the fork's `main` branch at time of analysis (2026-03-03):

| File | Lines | Purpose |
|------|-------|---------|
| [`src/tools/hybrid_search.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/tools/hybrid_search.ts) | ~265 | Tool definition, `ensureSynced()`, mode auto-downgrade |
| [`src/tools/search_similar.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/tools/search_similar.ts) | ~151 | Vector cosine similarity lookup |
| [`src/tools/search_index_info.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/tools/search_index_info.ts) | ~58 | Index health stats |
| [`src/lib/search/HybridSearchEngine.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/HybridSearchEngine.ts) | ~504 | Core RRF merge logic, all 4 mode executors |
| [`src/lib/search/SearchIndex.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/SearchIndex.ts) | ~212+ | libsql schema, FTS5, F32_BLOB, incremental sync |
| [`src/lib/search/searchRuntime.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/searchRuntime.ts) | ~98 | Singleton init + provider lifecycle |
| [`src/lib/search/ResponseCache.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/ResponseCache.ts) | — | LRU + TTL + tag invalidation + SWR |
| [`src/lib/search/CacheInvalidator.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/CacheInvalidator.ts) | — | Write-tool → cache-tag mapping |
| [`src/lib/search/syncState.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/syncState.ts) | — | Dirty flag, `markSearchIndexDirty/Synced` |
| [`src/lib/search/queryAnalyzer.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/queryAnalyzer.ts) | — | Intent detection, amount/date extraction |
| [`src/lib/search/queryExpansion.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/queryExpansion.ts) | — | Synonym OR-groups for FTS5 |
| [`src/lib/search/EmbeddingPipeline.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/EmbeddingPipeline.ts) | — | `buildTransactionText()`, batch embed |
| [`src/lib/search/types.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/types.ts) | ~187 | All interfaces: `HybridSearchQuery`, `SearchFilters`, `SearchResult`, etc. |
| [`src/lib/search/providers/`](https://github.com/ZanzyTHEbar/actual-mcp-server/tree/main/src/lib/search/providers) | — | Provider factory + 3 implementations |
| [`src/lib/search/index.ts`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/src/lib/search/index.ts) | ~22 | Barrel export |
| [`tests/unit/hybrid_search.test.js`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/tests/unit/hybrid_search.test.js) | ~316 | Full unit test suite (all 11 scenarios) |
| [`docs/ARCHITECTURE.md#search-module`](https://github.com/ZanzyTHEbar/actual-mcp-server/blob/main/docs/ARCHITECTURE.md#L757) | — | ZanzyTHEbar's architecture doc for the module |

---

## External References

- [SQLite FTS5 documentation](https://www.sqlite.org/fts5.html) — BM25 ranking, tokenizers, MATCH syntax
- [sqlite-vec extension](https://github.com/asg017/sqlite-vec) — vector search for standard SQLite
- [libsql (Turso)](https://github.com/tursodatabase/libsql) — SQLite fork with native vector support
- [Reciprocal Rank Fusion (RRF) paper](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf) — the scoring algorithm used
- [@xenova/transformers](https://huggingface.co/docs/transformers.js) — in-process HuggingFace models for Node.js
- [all-MiniLM-L6-v2 model](https://huggingface.co/Xenova/all-MiniLM-L6-v2) — 384-dim sentence embedding model used by ZanzyTHEbar
- [Actual Budget API reference](https://actualbudget.org/docs/api/reference) — upstream `getTransactions()` shape
- [ZanzyTHEbar key commit 909399a](https://github.com/ZanzyTHEbar/actual-mcp-server/commit/909399af35233fdf1d82c03a3fc1e38c1dce44b0) — initial hybrid search introduction

---

## Related Internal Docs

- [docs/ROADMAP.md — CF-4](../ROADMAP.md#cf-4-hybrid-search-engine-actual_hybrid_search-actual_search_similar-actual_search_index_info)
- [docs/ROADMAP.md — Pattern Matching](../ROADMAP.md#2-pattern-matching-enhancement-roadmap) — lighter alternative covering ~70% of use cases
- [docs/NEW_TOOL_CHECKLIST.md](../NEW_TOOL_CHECKLIST.md) — mandatory 9-step checklist to follow when implementing
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md) — existing architecture to extend
- [src/lib/actual-adapter.ts](../../src/lib/actual-adapter.ts) — `withActualApi` wrapper (required for all Actual API calls)
- [src/actualToolsManager.ts](../../src/actualToolsManager.ts) — `IMPLEMENTED_TOOLS` array to update

---

**Last Updated:** 2026-03-03  
**Author:** Analysis based on [ZanzyTHEbar/actual-mcp-server](https://github.com/ZanzyTHEbar/actual-mcp-server) fork study
