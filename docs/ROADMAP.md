# Roadmap

**Project:** Actual MCP Server  
**Version:** 0.4.20  
**Last Updated:** 2026-03-03

> 📋 **Implementing a planned item?** Follow [docs/NEW_TOOL_CHECKLIST.md](./NEW_TOOL_CHECKLIST.md) — mandatory 9-step process for all new tools.

---

## 🔴 Short-Term (v0.5.x)

| Feature | Summary | Detail |
|---------|---------|--------|
| [Schedules CRUD](./feature/SCHEDULES_CRUD.md) | 4 tools to create, read, update, and delete recurring transactions — completes 100% API coverage. | [→](./feature/SCHEDULES_CRUD.md) |
| [Tags CRUD](./feature/TAGS_CRUD.md) | 4 tools for managing transaction tags — blocked until Tags ship in a stable `@actual-app/api` release. | [→](./feature/TAGS_CRUD.md) |
| [Multi-Budget Switching](./feature/MULTI_BUDGET_SWITCHING.md) | Switch between Actual Budget files mid-conversation without reconnecting. | [→](./feature/MULTI_BUDGET_SWITCHING.md) |
| [Improved Error Messages](./feature/IMPROVED_ERROR_MESSAGES.md) | Actionable errors across all tools — every failure tells the AI what went wrong and which tool to call next. | [→](./feature/IMPROVED_ERROR_MESSAGES.md) |

---

## 🟠 Medium-Term (v0.5.x–v0.6.x)

| Feature | Summary | Detail |
|---------|---------|--------|
| [Pattern Matching](./feature/PATTERN_MATCHING.md) | startsWith/contains/endsWith and regex search across payees, categories, and accounts — phased rollout. | [→](./feature/PATTERN_MATCHING.md) |
| [Hybrid Search Engine](./feature/CF4_HYBRID_SEARCH.md) | Natural-language transaction search combining BM25 full-text, vector embeddings, and metadata filters (RRF). | [→](./feature/CF4_HYBRID_SEARCH.md) |
| [Security Hardening](./feature/SECURITY_HARDENING.md) | Rate limiting, request sanitization, CSRF protection, and security headers via `express-rate-limit` + `helmet`. | [→](./feature/SECURITY_HARDENING.md) |


---

## 🟢 Long-Term (v0.7.x+)

| Feature | Summary | Detail |
|---------|---------|--------|
| [AI / ML Enhancements](./feature/AI_ML_ENHANCEMENTS.md) | On-device anomaly detection, category auto-suggestion, budget recommendations, and spend prediction. | [→](./feature/AI_ML_ENHANCEMENTS.md) |
| [Advanced Integrations](./feature/ADVANCED_INTEGRATIONS.md) | Plaid bank connectivity, outbound webhooks, Zapier/n8n triggers, and email/SMS notifications. | [→](./feature/ADVANCED_INTEGRATIONS.md) |
| [Enhanced Observability](./feature/ENHANCED_OBSERVABILITY.md) | Latency histograms, request tracing with correlation IDs, structured logging, and Grafana dashboards. | [→](./feature/ENHANCED_OBSERVABILITY.md) |
| [Multi-Client Support](./feature/MULTI_CLIENT_SUPPORT.md) | Verify Claude Desktop, add a REST API wrapper, and publish Python/Node SDK examples. | [→](./feature/MULTI_CLIENT_SUPPORT.md) |
| [Performance Optimization](./feature/PERFORMANCE_OPTIMIZATION.md) | TTL-based response caching and cursor pagination for large budgets (10k+ transactions). | [→](./feature/PERFORMANCE_OPTIMIZATION.md) |
| [Report Generation](./feature/REPORT_GENERATION.md) | Computed financial reports — spending by category, income vs. expenses, net worth trend, budget vs. actual. | [→](./feature/REPORT_GENERATION.md) |
| [Goal Tracking](./feature/GOAL_TRACKING.md) | Create and track savings goals linked to accounts or budget categories with live progress. | [→](./feature/GOAL_TRACKING.md) |



---

## 🔗 Related Documentation

- [Architecture](./ARCHITECTURE.md)
- [New Tool Checklist](./NEW_TOOL_CHECKLIST.md)
- [Security & Privacy](./SECURITY_AND_PRIVACY.md)
- [Testing & Reliability](./TESTING_AND_RELIABILITY.md)
- [Project Overview](./PROJECT_OVERVIEW.md)
