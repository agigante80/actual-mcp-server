# Roadmap

**Project:** Actual MCP Server  
**Version:** 0.4.31  
**Last Updated:** 2026-03-03

> 📋 **Implementing a planned item?** Follow [docs/NEW_TOOL_CHECKLIST.md](./NEW_TOOL_CHECKLIST.md) — mandatory 9-step process for all new tools.

---

## 🔴 Short-Term (v0.5.x)

| Feature | Summary | Risk | Detail |
|---------|---------|------|--------|
| [Tags CRUD](./feature/TAGS_CRUD.md) | 4 tools for managing transaction tags — blocked until Tags ship in a stable `@actual-app/api` release. | 🟡 **External** — implementation is trivial; risk is that the upstream API shape changes between preview and stable, requiring rework after unblock | [→](./feature/TAGS_CRUD.md) |
| [Improved Error Messages](./feature/IMPROVED_ERROR_MESSAGES.md) | Actionable Zod-layer error messages across all tools — wrong date formats, invalid enums, wrong types all return hints like "use YYYY-MM-DD" or "allowed values: cleared, uncleared". API-layer not-found errors are covered by Fix Tool Reliability above. | 🟢 **Low** — purely additive response-shape changes; no architectural impact | [→](./feature/IMPROVED_ERROR_MESSAGES.md) |

---

## 🟠 Medium-Term (v0.5.x–v0.6.x)

| Feature | Summary | Risk | Detail |
|---------|---------|------|--------|
| [Pattern Matching — Basic](./feature/PATTERN_MATCHING.md) | contains/startsWith/endsWith search across payees, categories, and accounts; word-boundary and multi-pattern OR support. Solves ~90% of AI "payee not found" failures. | 🟢 **Low** — wraps existing ActualQL list methods; no new security surface; purely additive new tools | [→](./feature/PATTERN_MATCHING.md) |
| [Hybrid Search Engine](./feature/CF4_HYBRID_SEARCH.md) | Natural-language transaction search combining BM25 full-text, vector embeddings, and metadata filters (RRF). | 🔴 **Very High** — new DB engine (libsql), 384-dim vector schema fixed at creation (changing it requires full re-index), ~50 MB ML model with cold-start latency on first run, 15+ new files, `@actual-app/api` thread-safety unvalidated inside search sync | [→](./feature/CF4_HYBRID_SEARCH.md) |
| [Security Hardening](./feature/SECURITY_HARDENING.md) | Rate limiting, request sanitization, CSRF protection, and security headers via `express-rate-limit` + `helmet`. | 🟠 **Medium** — rate-limit thresholds that are too tight will throttle AI clients making many rapid sequential tool calls; misconfigured CORS/CSP headers can silently break LibreChat integration | [→](./feature/SECURITY_HARDENING.md) |
| [Performance Optimization](./feature/PERFORMANCE_OPTIMIZATION.md) | Tag-invalidated response cache (LRU + TTL + SWR), write-tool cache invalidation, cached reference helpers (`getCachedAccounts` etc.), and cursor pagination for large budgets. | 🟠 **Medium** — a missing invalidation tag causes silent stale reads; `ResponseCache` singleton placement becomes a hard constraint once Session Worker Manager ships (must live in manager process, not workers) | [→](./feature/PERFORMANCE_OPTIMIZATION.md) |
| [Session Worker Manager](./feature/SESSION_WORKER_MANAGER.md) | Per-session Node.js Worker Threads with isolated Actual Budget connections — prevents one user's operations from blocking another's. | 🔴 **High** — `@actual-app/api` is not documented as Worker Thread–safe; two workers sharing a `dataDir` risk file-lock conflicts; worker crash mid-write requires state recovery; adds async message-passing complexity throughout the dispatch path | [→](./feature/SESSION_WORKER_MANAGER.md) |
| [Write Coordinator](./feature/WRITE_COORDINATOR.md) | Entity-key-level write locking — concurrent writes to different entities proceed in parallel; same-entity writes are serialised. Replaces the current global write queue. | 🟠 **Medium** — deadlock if key-sort discipline lapses; unmapped tools silently fall back to a global write lock (correctness gap, not crash); lock-wait timeouts add new error paths that tools must handle | [→](./feature/WRITE_COORDINATOR.md) |


---

## 🟢 Long-Term (v0.7.x+)

| Feature | Summary | Risk | Detail |
|---------|---------|------|--------|
| [Pattern Matching — Regex & Smart](./feature/PATTERN_MATCHING_REGEX.md) | Regex `matchType` with ReDoS protection, fuzzy matching (Levenshtein), company name templates, and multi-field search. Requires Phases 1–2 as prerequisite. | 🟠 **Medium** — regex introduces a ReDoS attack surface requiring timeout enforcement and a static complexity checker before production use | [→](./feature/PATTERN_MATCHING_REGEX.md) |
| [AI / ML Enhancements](./feature/AI_ML_ENHANCEMENTS.md) | On-device anomaly detection, category auto-suggestion, budget recommendations, and spend prediction. | 🔴 **High** — inference quality is non-deterministic and untestable with standard unit tests; model drift over time; large runtime deps; on-device inference performance on typical server hardware is unproven | [→](./feature/AI_ML_ENHANCEMENTS.md) |
| [Advanced Integrations](./feature/ADVANCED_INTEGRATIONS.md) | Plaid bank connectivity, outbound webhooks, Zapier/n8n triggers, and email/SMS notifications. | 🔴 **Very High** — Plaid requires full OAuth + credential storage + regulatory compliance (bank-level data handling); third-party uptime adds external SLA dependency; webhook delivery-at-least-once semantics are complex | [→](./feature/ADVANCED_INTEGRATIONS.md) |
| [Enhanced Observability](./feature/ENHANCED_OBSERVABILITY.md) | Latency histograms, request tracing with correlation IDs, structured logging, and Grafana dashboards. | 🟢 **Low** — purely additive instrumentation; `prom-client` already present; no functional changes to existing tools | [→](./feature/ENHANCED_OBSERVABILITY.md) |
| [Multi-Client Support](./feature/MULTI_CLIENT_SUPPORT.md) | Verify Claude Desktop, add a REST API wrapper, and publish Python/Node SDK examples. | 🟢 **Low** — mostly testing and documentation; SDK publishing is operational not architectural risk | [→](./feature/MULTI_CLIENT_SUPPORT.md) |
| [Report Generation](./feature/REPORT_GENERATION.md) | Computed financial reports — spending by category, income vs. expenses, net worth trend, budget vs. actual. | 🟠 **Medium** — aggregation correctness is subtle: transfer transactions double-count income/expense, mid-month budget changes affect period attribution, incomplete months skew trend lines | [→](./feature/REPORT_GENERATION.md) |
| [Goal Tracking](./feature/GOAL_TRACKING.md) | Create and track savings goals linked to accounts or budget categories with live progress. | 🟠 **Medium** — no native Goals API exists; requires a custom sidecar persistence layer (JSON or SQLite) that must survive `@actual-app/api` version upgrades; `currentAmount` derivation is non-trivial for goals spanning multiple accounts or categories | [→](./feature/GOAL_TRACKING.md) |



---

## 🔗 Related Documentation

- [Architecture](./ARCHITECTURE.md)
- [New Tool Checklist](./NEW_TOOL_CHECKLIST.md)
- [Security & Privacy](./SECURITY_AND_PRIVACY.md)
- [Testing & Reliability](./TESTING_AND_RELIABILITY.md)
- [Project Overview](./PROJECT_OVERVIEW.md)
