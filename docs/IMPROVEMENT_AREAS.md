# Improvement Areas

**Project:** Actual MCP Server  
**Version:** 0.1.0  
**Purpose:** Track known technical debt, missing features, and weak areas  
**Last Updated:** 2025-12-10

---

## 🎯 Purpose

This document identifies **known gaps, technical debt, and areas needing improvement** in the Actual MCP Server project. It serves as a comprehensive inventory of issues that don't block production but should be addressed over time.

---

## ✅ Recently Resolved

### 1. **Transaction Creation Now Fully Functional** (RESOLVED 2025-11-24)

**Previous Issue**: Transaction creation was a stub returning 'test-success'

**Resolution**:
- Implemented full `transactions_create` tool using `addTransactions()` API
- Added proper adapter lifecycle management (init/shutdown per operation)
- Handles API returning "ok" string instead of transaction ID
- Added comprehensive error handling and retry logic
- Verified working with integration tests and MCP tool cleanup

**Impact**: HIGH - Core functionality now operational

**Status**: ✅ FIXED and verified working

### 2. **Tool Registration Discrepancy** (RESOLVED 2025-12-10)

**Previous Issue**: 49 tools implemented but only 43 listed in IMPLEMENTED_TOOLS array

**Resolution**:
- Discovered 6 missing transaction search/summary tools:
  - `actual_transactions_search_by_amount`
  - `actual_transactions_search_by_category`
  - `actual_transactions_search_by_month`
  - `actual_transactions_search_by_payee`
  - `actual_transactions_summary_by_category`
  - `actual_transactions_summary_by_payee`
- All tools added to IMPLEMENTED_TOOLS array
- Tool count documentation updated throughout

**Impact**: MEDIUM - Documentation accuracy and tool tracking

**Status**: ✅ FIXED and verified working

---

## 🔴 Critical Gaps

### Missing Features

#### 1. **Dependency Updates Needed** (9 packages outdated)

**Impact**: Security patches, bug fixes, new features unavailable

**Details**:
- Outdated packages: 9 (1 major, 8 minor/patch)
- Security status: ✅ CLEAN (0 vulnerabilities)
- Major update pending: Express v4 → v5 (requires migration)
- Minor updates: MCP SDK (1.18.2 → 1.22.0), Axios (1.12.2 → 1.13.2)
- Patch updates: 6 packages ready for auto-merge
- Automation: ✅ Dependabot, Renovate, CI/CD configured

**User Impact**: Low - All current versions stable and secure

**Action Items**:
- [ ] Execute Phase 1: Batch patch updates (1-2 hours)
- [ ] Execute Phase 2: MCP SDK + Axios minor updates (2-4 hours)
- [ ] Plan Phase 3: Express v5 migration (Q1 2026, 8-16 hours)

**Status**: Automated dependency management fully configured, ready for execution

**Reference**: See `docs/archive/2025-11-24_dependency_audit.md` for detailed analysis

#### 2. **Schedule Tools Not Implemented** (4 tools missing)

**Impact**: Cannot manage recurring transactions via AI

**Details**:
- Missing: `getSchedules()`, `createSchedule()`, `updateSchedule()`, `deleteSchedule()`
- Root cause: Schedule methods require internal Actual API access not exposed in standard methods
- Workaround: Use `send()` API directly (requires research)
- Status: Planned for implementation

**User Impact**: High - schedules are core Actual Budget feature

**Recommendation**: Investigate internal API access and implement as priority feature

#### 2. **No Multi-Budget Switching**

**Impact**: Cannot switch active budget without reconnection

**Details**:
- Current: Single budget per server instance
- `budgets_get_all` lists available budgets but doesn't switch
- Switching requires: Disconnect → Reconnect with new sync ID
- Status: Multi-budget support exists but UX needs improvement

**User Impact**: Medium - affects users with multiple budgets

**Recommendation**: Add `budgets_switch` tool for seamless switching

---

## 🟠 Moderate Gaps

### Incomplete Coverage

#### 3. **No Report Generation Tools**

**Impact**: Users must manually generate reports

**Details**:
- Actual Budget has built-in reporting
- Not exposed via MCP tools
- Users must use Actual Budget UI for reports
- Status: Not planned - would require custom implementation

**User Impact**: Medium - users expect AI to generate financial reports

**Recommendation**: Create custom report tools:
- `reports_spending_by_category`
- `reports_income_vs_expenses`
- `reports_net_worth_trend`

#### 4. **No Goal Tracking Tools**

**Impact**: Cannot manage budget goals via AI

**Details**:
- Actual Budget supports goals/targets
- Not exposed in current API
- Status: API limitation

**User Impact**: Medium - goals are popular feature

**Recommendation**: Wait for upstream API support or use workarounds

#### 5. **Limited Transaction Search**

**Impact**: Cannot perform full-text search on transactions

**Details**:
- Current: Filter by fields (payee, category, amount, date)
- Missing: Full-text search across notes, payee names, etc.
- Workaround: Use `query_run` with SQL LIKE clauses
- Status: Functional but not user-friendly

**User Impact**: Medium - affects users with many transactions

**Recommendation**: Add `transactions_search` tool with natural language search

---

## 🟡 Minor Gaps

### Usability Issues

#### 6. **Generic Error Messages**

**Impact**: Users get unhelpful error responses

**Examples**:
- ❌ "Transaction failed"
- ✅ "Transaction failed: Account 'abc-123' not found. Use actual_accounts_list to see available accounts."

**Status**: Documented in [REFACTORING_PLAN.md](./REFACTORING_PLAN.md)

**Recommendation**: Improve error messages across all tools (High priority task)

#### 7. **No Input Suggestions**

**Impact**: Users don't know what values are valid

**Example**: Creating transaction requires categoryId but no way to discover valid IDs via error message

**Recommendation**: 
- Add helpful hints in error messages
- Link to list tools in error responses
- Provide example values

#### 8. **Limited Batch Operations**

**Impact**: Inefficient for bulk updates

**Details**:
- Current: Only `budgets_batch_updates` supports batching
- Missing: Batch transaction creation, bulk payee updates, etc.
- Status: Individual tools work but no batch variants

**Recommendation**: Add batch variants for high-volume operations

---

## 🔧 Technical Debt

### Code Quality Issues

#### 9. **Long Functions in Adapter Layer**

**Location**: `src/lib/actual-adapter.ts`

**Issue**: Some functions exceed 100 lines

**Impact**: Harder to maintain and test

**Examples**:
- Transaction filtering logic
- Complex retry logic

**Recommendation**: Extract helper functions, documented in [REFACTORING_PLAN.md](./REFACTORING_PLAN.md)

#### 10. **Duplicated Validation Logic**

**Location**: `src/tools/*.ts`

**Issue**: Similar Zod schemas repeated across tools

**Impact**: Harder to maintain consistency

**Example**: Account ID validation appears in 10+ tools

**Recommendation**: Create shared schema utilities in `src/lib/schemas.ts`

#### 11. **Magic Numbers Throughout Codebase**

**Locations**: Multiple files

**Examples**:
- Retry attempts: `3` (hardcoded)
- Retry delay: `1000` (ms, hardcoded)
- Default port: `3600` (hardcoded in multiple places)

**Impact**: Harder to configure and understand

**Recommendation**: Extract to `src/config/constants.ts`

#### 12. **Inconsistent Logging**

**Location**: All modules

**Issue**: Log messages don't follow consistent format

**Examples**:
- Some: `logger.info('[Module] Action: Details')`
- Others: `logger.info('Action details')`
- Missing: Request tracing IDs

**Impact**: Harder to debug production issues

**Recommendation**: Standardize logging format, add request IDs

---

### Architecture Limitations

#### 13. **No Request Tracing**

**Impact**: Cannot trace requests across components

**Details**:
- No correlation IDs for requests
- Cannot track request flow through system
- Makes debugging complex issues difficult

**Recommendation**: Add request ID middleware, pass through all layers

#### 14. **Single Connection to Actual Budget**

**Impact**: Potential bottleneck for concurrent requests

**Details**:
- One persistent connection
- Concurrent requests queued
- Works well for small/medium load but may struggle with high concurrency

**Recommendation**: Implement connection pooling (low priority - optimize after profiling)

#### 15. **No Caching Strategy**

**Impact**: Repeated requests hit Actual Budget API

**Details**:
- Account lists, categories, payees fetched repeatedly
- These rarely change but requested frequently
- Unnecessary load on Actual Budget server

**Recommendation**: Implement caching layer for read-heavy operations:
- Cache duration: 5 minutes for lists
- Invalidate on write operations
- Use `node-cache` or similar

---

### Testing Gaps

#### 16. **Low Integration Test Coverage**

**Current**: 0% integration test coverage

**Impact**: Don't test how components work together

**Missing**:
- Multi-step workflows
- Error propagation across layers
- Transaction boundaries

**Recommendation**: Add integration tests (see [TESTING_AND_RELIABILITY.md](./TESTING_AND_RELIABILITY.md))

#### 17. **No Load Testing**

**Impact**: Unknown performance limits

**Details**:
- Don't know maximum concurrent users
- Don't know request/second limits
- Don't know memory usage under load

**Recommendation**: Add load testing with Artillery or k6

#### 18. **No Chaos Testing**

**Impact**: Unknown resilience to failures

**Details**:
- Don't test behavior when Actual Budget is down
- Don't test behavior with network issues
- Don't test behavior with corrupt data

**Recommendation**: Add chaos engineering tests (low priority)

---

## 📝 Documentation Gaps

### Missing Documentation

#### 19. **No API Response Examples**

**Impact**: Developers don't know what responses look like

**Current**: Tool input schemas documented

**Missing**: Example responses for each tool

**Recommendation**: Add `docs/API_EXAMPLES.md` with request/response pairs

#### 20. **No Troubleshooting Guide**

**Impact**: Users struggle with common issues

**Missing**:
- Connection failure scenarios
- Authentication troubleshooting
- Performance optimization tips
- Common error codes and solutions

**Recommendation**: Create `docs/TROUBLESHOOTING.md`

#### 21. **Incomplete Type Documentation**

**Impact**: TypeScript developers need to read source code

**Missing**: JSDoc comments on public functions

**Recommendation**: Add JSDoc to all exported functions (low priority)

---

## 🔐 Security Considerations

### Security Debt

#### 22. **No Rate Limiting**

**Impact**: Vulnerable to abuse/DoS

**Details**:
- No per-client request limits
- Could overwhelm Actual Budget server
- No protection against brute force attacks

**Recommendation**: Add rate limiting middleware (high priority)

#### 23. **Secrets in Logs**

**Impact**: Potential credential exposure

**Details**:
- Error messages might leak sensitive data
- Debug logs might show full request/response
- Need audit of all log statements

**Recommendation**: Implement log sanitization (medium priority)

#### 24. **No Audit Logging**

**Impact**: Cannot track who did what

**Details**:
- No record of tool calls
- Cannot investigate security incidents
- No compliance support

**Recommendation**: Implement audit logging (low priority - single-user deployments don't need this)

#### 25. **Missing CSRF Protection**

**Impact**: Vulnerable to cross-site request forgery

**Details**:
- HTTP transport doesn't have CSRF tokens
- Relies on Bearer token only
- Could be vulnerable in browser contexts

**Recommendation**: Add CSRF protection for web-based clients (medium priority)

---

## 🚀 Performance Issues

### Known Slowdowns

#### 26. **Large Transaction Sets Cause Slowdown**

**Impact**: Filtering 10k+ transactions is slow (>2 seconds)

**Root Cause**: Client-side filtering in JavaScript

**Workaround**: Use `query_run` for complex queries

**Recommendation**: 
- Optimize filtering algorithm
- Consider server-side filtering
- Add pagination for large result sets

#### 27. **No Connection Pooling**

**Impact**: Sequential request processing

**Details**:
- Single connection limits parallelism
- Concurrent requests queued
- Affects performance under load

**Recommendation**: Implement connection pooling (after profiling)

#### 28. **Synchronous Budget Download on Startup**

**Impact**: Slow startup for large budgets

**Details**:
- Downloads entire budget on connect
- Large budgets (100k+ transactions) take 10+ seconds
- Blocks server startup

**Recommendation**: 
- Option to skip download
- Lazy loading of budget data
- Incremental sync

---

## 🐛 Known Issues

### Platform-Specific Issues

#### 29. **Alpine Native Module Warnings**

**Platform**: Docker (Alpine Linux)

**Impact**: Warning messages in logs

**Details**:
- `@actual-app/api` shows native module warnings
- Functionality works despite warnings
- Cosmetic issue only

**Workarounds**:
- Ignore warnings (current approach)
- Switch to Debian-based image

**Recommendation**: Document as known issue, no action needed

#### 30. **LibreChat SSE Authentication Limitation**

**Platform**: LibreChat client

**Impact**: Cannot use authenticated SSE transport with LibreChat

**Details**:
- Server supports Bearer token on SSE
- LibreChat SSE client doesn't send custom headers
- Not an MCP server bug - LibreChat limitation

**Workaround**: Use HTTP transport with LibreChat

**Recommendation**: Document limitation, no fix possible server-side

---

## 📊 Monitoring & Observability Gaps

### Missing Observability

#### 31. **Limited Metrics**

**Current**: Basic tool call counters

**Missing**:
- Latency percentiles (p50, p95, p99)
- Queue depth over time
- Connection status history
- Error rate trends

**Recommendation**: Enhance Prometheus metrics (medium priority)

#### 32. **No Distributed Tracing**

**Impact**: Cannot trace requests across services

**Details**:
- No OpenTelemetry integration
- Cannot correlate logs/metrics/traces
- Harder to debug complex issues

**Recommendation**: Add OpenTelemetry (low priority - overkill for single service)

#### 33. **Basic Health Check**

**Current**: Simple `{"status":"ok"}` response

**Missing**:
- Actual Budget connection status
- Queue depth
- Memory usage
- Uptime

**Recommendation**: Enhance `/health` endpoint with detailed status

---

## 🎯 Priority Recommendations

### High Priority (Fix Soon)

1. **Implement Schedules tools** - Completes API coverage
2. **Add rate limiting** - Security hardening
3. **Improve error messages** - User experience
4. **Add input sanitization** - Security hardening

### Medium Priority (Fix Eventually)

5. **Add report generation tools** - User value
6. **Improve caching** - Performance
7. **Add integration tests** - Quality assurance
8. **Add CSRF protection** - Security

### Low Priority (Nice to Have)

9. **Add connection pooling** - Performance (after profiling)
10. **Add audit logging** - Enterprise features
11. **Add distributed tracing** - Advanced observability
12. **Fix Alpine warnings** - Cosmetic

---

## 🔄 Review Process

### Monthly Reviews

Review this document monthly:
1. Mark resolved items
2. Add newly discovered issues
3. Re-prioritize based on user feedback
4. Update recommendations

### Quarterly Audits

Comprehensive audit quarterly:
1. Categorize all outstanding issues
2. Estimate effort for each fix
3. Create roadmap for improvements
4. Allocate resources to high-priority items

---

## 🔗 Related Documentation

- [Refactoring Plan](./REFACTORING_PLAN.md) - Tracked improvement tasks
- [Roadmap](./ROADMAP.md) - Future feature planning
- [Testing & Reliability](./TESTING_AND_RELIABILITY.md) - Quality standards
- [Security & Privacy](./SECURITY_AND_PRIVACY.md) - Security policies

---

## ✨ Summary

This project is **production-ready** but has room for improvement. The gaps documented here:

- ✅ **Do not block production use**
- ⚠️ **Should be addressed over time**
- 📝 **Are tracked and prioritized**
- 🔄 **Are reviewed regularly**

Focus on high-priority items first, especially those affecting security and user experience.
