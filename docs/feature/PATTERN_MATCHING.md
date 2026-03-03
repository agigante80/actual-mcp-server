# Pattern Matching Enhancement

**Status:** Planned — Phased (v0.5.x → v0.6.x)  
**Priority:** 🟠 Medium-High  
**Effort:** 3–4 weeks total (4 phases)  
**Blocker:** None

---

## Overview

Progressive enhancement of search tools with pattern matching support — from simple `contains`/`startsWith` to full regex — across payees, categories, accounts, and other entities. Solves the "I don't know the exact name" problem for AI agents.

## Phases

### Phase 1 — Basic Patterns (v0.5.x)
Two new tools:

| Tool | Description |
|------|-------------|
| `actual_transactions_search_by_payee_pattern` | Search by `startsWith`, `contains`, `endsWith` |
| `actual_transactions_search_by_category_pattern` | Same, for categories |

- Case-insensitive by default
- All existing filters still apply (date, amount, account)
- New shared utility: `src/lib/patternMatcher.ts`
- **Effort**: 2–3 days

### Phase 2 — Extended Types (v0.5.x)
- `actual_accounts_search_pattern` — find accounts by partial name
- `accountNamePattern` parameter added to existing transaction search tools
- Word-boundary matching option: `"market"` matches `"Super Market"` but not `"Marketing"`
- Multiple pattern support: `patterns: ["Amazon", "AWS"]`
- **Effort**: 3–4 days

### Phase 3 — Regex (v0.6.x)
- `matchType: 'regex'` added to all pattern tools
- Safety: regex complexity limits + 100ms timeout enforcement (ReDoS prevention)
- Pattern blacklist for known dangerous patterns
- **Effort**: 4–5 days

### Phase 4 — Smart Matching (v0.6.x+)
- Fuzzy matching (Levenshtein distance) to handle typos
- Pattern templates: `"company"` → matches LLC, Inc, Corp
- Multi-field patterns (payee + category + notes simultaneously)
- **Effort**: 1–2 weeks

## New Files

```
src/lib/patternMatcher.ts        # Core matching utility
src/tools/transactions_search_by_payee_pattern.ts
src/tools/transactions_search_by_category_pattern.ts
src/tools/accounts_search_pattern.ts
tests/unit/patternMatcher.test.js
```

## Success Criteria

- Phase 1: 90%+ of "payee not found" errors eliminated
- Phase 3: Zero ReDoS incidents; <100ms regex p95
- Phase 4: AI agents self-generate effective patterns

## Actual Budget API Methods

Pattern matching tools wrap existing Actual API list methods. All are documented on the [Actual Budget API Reference](https://actualbudget.org/docs/api/reference) page.

| Method | Used by | API Ref |
|--------|--------|---------|
| `getTransactions(accountId, startDate, endDate)` | Payee & category pattern search | [→](https://actualbudget.org/docs/api/reference#gettransactions) |
| `getPayees()` | Resolve payee name → ID for pattern results | [→](https://actualbudget.org/docs/api/reference#getpayees) |
| `getAccounts()` | Account name pattern search | [→](https://actualbudget.org/docs/api/reference#getaccounts) |
| `getCategories()` | Category name pattern search | [→](https://actualbudget.org/docs/api/reference#getcategories) |

## References

- [Actual Budget API Reference](https://actualbudget.org/docs/api/reference)
- [`src/tools/`](../../src/tools/)
- [`src/lib/schemas/common.ts`](../../src/lib/schemas/common.ts)
- [`docs/NEW_TOOL_CHECKLIST.md`](../NEW_TOOL_CHECKLIST.md)
