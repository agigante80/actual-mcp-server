# Pattern Matching — Regex & Smart Matching (Phases 3–4)

**Status:** Planned — v0.6.x  
**Priority:** 🟠 Medium  
**Effort:** ~2 weeks (Phases 3–4)  
**Blocker:** [Pattern Matching — Basic (Phases 1–2)](./PATTERN_MATCHING.md) must ship first — Phase 3 extends the `patternMatcher.ts` utility and tool schemas introduced there

---

## Overview

Extends the basic pattern matching tools (Phases 1–2) with full regular expression support and AI-friendly smart matching (fuzzy search, company name templates, multi-field matching). These phases address edge cases that `contains`/`startsWith` cannot cover, at the cost of increased implementation complexity and a new security surface (ReDoS).

> **Note:** Phases 1–2 eliminate ~90% of the AI "I can't find that payee" failures. Phases 3–4 should only be prioritised once real-world usage of Phases 1–2 surfaces specific patterns that simpler matching cannot handle.

---

## Phase 3 — Regex (v0.6.x)

### What It Adds

- `matchType: 'regex'` added as a valid option on all existing pattern tools:
  - `actual_transactions_search_by_payee_pattern`
  - `actual_transactions_search_by_category_pattern`
  - `actual_accounts_search_pattern`

### Example Usage

```json
{
  "tool": "actual_transactions_search_by_payee_pattern",
  "args": {
    "pattern": "^(Amazon|AWS)(\\s+Prime)?$",
    "matchType": "regex",
    "caseSensitive": false
  }
}
```

### Safety Requirements (mandatory before shipping)

| Control | Implementation |
|---------|---------------|
| Complexity limit | Reject patterns with catastrophic backtracking potential (e.g. `(a+)+`) before evaluation |
| Execution timeout | 100 ms hard timeout per match operation; returns `{ error: "regex_timeout" }` on breach |
| Pattern blacklist | Refuse known ReDoS patterns; log and alert on blacklist hits |
| Input length cap | Maximum pattern length: 500 characters |
| No external input | Patterns accepted only from MCP tool args (already Zod-validated); never interpolated from transaction data |

**Effort:** 4–5 days

---

## Phase 4 — Smart Matching (v0.6.x+)

### What It Adds

- **Fuzzy matching** (Levenshtein distance ≤ 2): `"Amazn"` matches `"Amazon"`; handles OCR errors and user typos in payee names
- **Company name templates**: `matchType: 'company'` expands to OR-match common business suffixes — e.g. `"Acme"` matches `"Acme LLC"`, `"Acme Inc."`, `"Acme Corporation"`, `"ACME"`, etc.
- **Multi-field patterns**: Single query matched across payee + category + notes simultaneously — e.g. find all transactions mentioning `"subscription"` in any field

### Example Usage

```json
{
  "tool": "actual_transactions_search_by_payee_pattern",
  "args": {
    "pattern": "Amazn",
    "matchType": "fuzzy",
    "maxDistance": 2
  }
}
```

**Effort:** 1–2 weeks

---

## Files Modified / Created (in addition to Phase 1–2 files)

```
src/lib/patternMatcher.ts          # Extended: regex execution + timeout enforcement + fuzzy + templates
src/lib/patternMatcher.regex.ts    # ReDoS detector, complexity limit, blacklist (new file)
tests/unit/patternMatcher.test.js  # Extended: regex cases, ReDoS attempts, fuzzy, multi-field
```

---

## Success Criteria

- [ ] Regex `matchType` available on all three pattern tools
- [ ] Zero ReDoS incidents under a fuzz-testing run of 10,000 random patterns
- [ ] Regex execution p95 < 100 ms across all tested patterns
- [ ] Blacklisted patterns return a structured error, not a 500
- [ ] Fuzzy matching correctly handles payee names with 1–2 character differences (verified against real transaction data)
- [ ] Company template matching covers the 20 most common business suffix forms

---

## Risk

🟠 **Medium** — ReDoS is the primary risk: a single malicious or poorly crafted regex pattern can block the entire Node.js event loop for seconds. The timeout + complexity checker must be implemented before this feature is enabled in production. Fuzzy matching (Phase 4) adds a CPU cost proportional to the number of transactions × pattern candidates; must be benchmarked against a 10k-transaction budget before ship.

---

## Actual Budget API Methods

Same as Phase 1–2 — no new API methods required; pattern evaluation happens in-process after fetching entity lists.

| Method | Used by | API Ref |
|--------|---------|---------|
| `getTransactions(accountId, startDate, endDate)` | Payee & category pattern search | [→](https://actualbudget.org/docs/api/reference#gettransactions) |
| `getPayees()` | Resolve payee name → ID for pattern results | [→](https://actualbudget.org/docs/api/reference#getpayees) |
| `getAccounts()` | Account name pattern search | [→](https://actualbudget.org/docs/api/reference#getaccounts) |
| `getCategories()` | Category name pattern search | [→](https://actualbudget.org/docs/api/reference#getcategories) |

---

## References

- [Prerequisite: Pattern Matching — Basic (Phases 1–2)](./PATTERN_MATCHING.md)
- [OWASP ReDoS guidance](https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS)
- [safe-regex npm package](https://www.npmjs.com/package/safe-regex) — static ReDoS detector
- [Levenshtein distance (Wikipedia)](https://en.wikipedia.org/wiki/Levenshtein_distance)
- [Actual Budget API Reference](https://actualbudget.org/docs/api/reference)
- [`src/lib/patternMatcher.ts`](../../src/lib/patternMatcher.ts)
- [`docs/NEW_TOOL_CHECKLIST.md`](../NEW_TOOL_CHECKLIST.md)

---

**Last Updated:** 2026-03-03
