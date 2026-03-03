# Pattern Matching — Basic (Phases 1–2)

**Status:** Planned — v0.5.x  
**Priority:** 🟠 Medium-High  
**Effort:** ~1 week (Phases 1–2)  
**Blocker:** None  
**Continued by:** [Pattern Matching — Regex & Smart Matching (Phases 3–4)](./PATTERN_MATCHING_REGEX.md)

---

## Overview

Adds `contains` / `startsWith` / `endsWith` pattern search across payees, categories, and accounts. Solves the "I don't know the exact name" problem for AI agents — the primary cause of tool call failures when users ask about a payee or category by an approximate name.

Phases 1–2 deliver ~90% of the real-world benefit with low risk and no new security surface. Regex and smart matching are deferred to [Phases 3–4](./PATTERN_MATCHING_REGEX.md).

---

## Phase 1 — Basic Patterns (v0.5.x)

Two new tools:

| Tool | Description |
|------|-------------|
| `actual_transactions_search_by_payee_pattern` | Search transactions by payee name using `startsWith`, `contains`, or `endsWith` |
| `actual_transactions_search_by_category_pattern` | Same, for category names |

- Case-insensitive by default
- All existing filters still apply (date range, amount range, account)
- New shared utility: `src/lib/patternMatcher.ts` — used by all pattern tools
- **Effort:** 2–3 days

### Example

```json
{
  "tool": "actual_transactions_search_by_payee_pattern",
  "args": {
    "pattern": "amazon",
    "matchType": "contains",
    "startDate": "2026-01-01",
    "endDate": "2026-03-01"
  }
}
```

---

## Phase 2 — Extended Types (v0.5.x)

- `actual_accounts_search_pattern` — find accounts by partial name
- `accountNamePattern` parameter added to existing transaction search tools (filter by account name pattern rather than ID)
- **Word-boundary matching:** `"market"` matches `"Super Market"` but not `"Marketing"`
- **Multiple patterns:** `patterns: ["Amazon", "AWS"]` — OR-match across a list
- **Effort:** 3–4 days

### Example

```json
{
  "tool": "actual_transactions_search_by_payee_pattern",
  "args": {
    "patterns": ["Netflix", "Spotify", "Disney"],
    "matchType": "contains"
  }
}
```

---

## New Files

```
src/lib/patternMatcher.ts                               # Core matching utility (contains/startsWith/endsWith/word-boundary)
src/tools/transactions_search_by_payee_pattern.ts       # actual_transactions_search_by_payee_pattern
src/tools/transactions_search_by_category_pattern.ts    # actual_transactions_search_by_category_pattern
src/tools/accounts_search_pattern.ts                    # actual_accounts_search_pattern
tests/unit/patternMatcher.test.js                        # Unit tests: all matchTypes, case-insensitivity, multi-pattern, word-boundary
```

---

## Success Criteria

- [ ] 90%+ of "payee not found" tool failures eliminated (measured against a sample of real LibreChat conversations)
- [ ] All three tools respect existing date/amount/account filters
- [ ] `patterns: []` multi-pattern OR-match returns correct union of results
- [ ] Word-boundary option correctly excludes partial stem matches
- [ ] All matchTypes covered by unit tests with positive and negative cases

---

## Actual Budget API Methods

Pattern matching wraps existing Actual API list methods — no new API calls.

| Method | Used by | API Ref |
|--------|---------|----------|
| `getTransactions(accountId, startDate, endDate)` | Payee & category pattern search | [→](https://actualbudget.org/docs/api/reference#gettransactions) |
| `getPayees()` | Resolve payee name → ID for pattern results | [→](https://actualbudget.org/docs/api/reference#getpayees) |
| `getAccounts()` | Account name pattern search | [→](https://actualbudget.org/docs/api/reference#getaccounts) |
| `getCategories()` | Category name pattern search | [→](https://actualbudget.org/docs/api/reference#getcategories) |

---

## References

- [Phases 3–4: Regex & Smart Matching](./PATTERN_MATCHING_REGEX.md)
- [Actual Budget API Reference](https://actualbudget.org/docs/api/reference)
- [`src/tools/`](../../src/tools/)
- [`src/lib/schemas/common.ts`](../../src/lib/schemas/common.ts)
- [`docs/NEW_TOOL_CHECKLIST.md`](../NEW_TOOL_CHECKLIST.md)

---

**Last Updated:** 2026-03-03
