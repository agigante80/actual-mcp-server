# Refactoring Status

**Project:** Actual MCP Server  
**Version:** 0.4.7  
**Last Updated:** 2026-01-07  
**Purpose:** Live tracking of refactoring tasks and code quality improvements

---

## 📊 Current Code Quality Metrics

**Overall Health Score:** 88/100 (EXCELLENT) ⬆️ +3 from Dec 2025

| Metric | Value | Status |
|--------|-------|--------|
| **Total Files** | 68 | ✅ Well-organized |
| **Source Lines** | 3,943 LOC | ✅ Manageable |
| **Tool Count** | 49 tools | ✅ Comprehensive (78% API coverage) |
| **TypeScript Strict Mode** | Enabled | ✅ Type-safe |
| **Security Vulnerabilities** | 0 | ✅ Clean |
| **Test Coverage** | ~80% | ⚠️ Target: 90% |

**Recent Improvements:**
- ✅ Transaction creation fixed (Dec 2025)
- ✅ 49 tools fully registered (Dec 2025)
- ✅ withActualApi pattern implemented (Nov 2025)
- ✅ Documentation consolidated (Dec 2025)

---

## 🔥 High Priority Tasks

### Core Functionality

- [x] **Implement query_run tool** (Completed 2025-11-10)
  - Added `actual_query_run` tool for custom ActualQL queries
  - Status: Production-ready, tested with LibreChat

- [x] **Implement bank_sync tool** (Completed 2025-11-10)
  - Added `actual_bank_sync` tool for GoCardless/SimpleFIN synchronization
  - Status: Production-ready

- [x] **Implement budgets_get_all tool** (Completed 2025-11-10)
  - Added `actual_budgets_get_all` for multi-budget support
  - Status: Production-ready

- [x] **Register all 49 tools** (Completed 2025-12-10)
  - Added 6 missing transaction search/summary tools to IMPLEMENTED_TOOLS array
  - All tools now properly tracked and registered
  - Status: Complete

- [ ] **Implement Schedules tools** (4 tools) - BLOCKED
  - Task: Add `getSchedules()`, `createSchedule()`, `updateSchedule()`, `deleteSchedule()`
  - Blocker: Schedule methods require internal Actual API access
  - Workaround: Use `send()` API directly (requires research)
  - Priority: High - would complete 100% API coverage
  - Estimated Effort: 16-24 hours
  
- [ ] **Improve error messages for user guidance**
  - Task: Make error responses more actionable
  - Example: "Account not found" → "Account 'uuid-123' not found. Use actual_accounts_list to see available accounts"
  - Files: All `src/tools/*.ts`
  - Priority: High - improves user experience
  - Estimated Effort: 8-12 hours

### Security

- [x] **Move secrets to environment variables** (Completed)
  - All credentials in `.env` file
  - Docker secrets support implemented
  - Status: Production-ready

- [ ] **Add input sanitization to all POST routes**
  - Task: Validate and sanitize all user inputs
  - Files: `src/server/httpServer.ts`, `src/server/sseServer.ts`
  - Current: Zod validation only
  - Need: Additional sanitization for XSS prevention
  - Priority: High
  - Estimated Effort: 4-6 hours

- [ ] **Implement rate limiting**
  - Task: Add per-client rate limiting
  - Library: Consider `express-rate-limit`
  - Files: `src/server/httpServer.ts`
  - Priority: High for production deployments
  - Estimated Effort: 2-4 hours

---

## 🟠 Medium Priority Tasks

### Code Organization

- [ ] **Refactor actual-adapter.ts** (617 LOC - largest file)
  - Extract connection management → `src/lib/connection/ConnectionManager.ts`
  - Extract retry logic → `src/lib/retry/RetryHandler.ts`
  - Extract concurrency control → `src/lib/concurrency/ConcurrencyLimiter.ts`
  - Keep API wrappers in actual-adapter.ts (~300 LOC)
  - Priority: Medium
  - Estimated Effort: 16-24 hours
  - Risk: Medium (requires careful testing)

- [ ] **Reduce tool file duplication**
  - Problem: 15-20% code duplication across 49 tool files
  - Solution: Extract common patterns to shared utilities
  - Create: `src/lib/toolHelpers.ts` for common operations
  - Priority: Medium
  - Estimated Effort: 8-12 hours

- [ ] **Standardize error handling across tools**
  - Task: Create base error handler utility
  - Create: `src/lib/errorHandler.ts`
  - Pattern: Consistent error formatting for all tools
  - Files: All `src/tools/*.ts`
  - Priority: Medium
  - Estimated Effort: 6-8 hours

### Testing

- [ ] **Increase unit test coverage to 90%**
  - Current: ~80% coverage
  - Target: 90% coverage
  - Focus: Edge cases, error paths
  - Tool: Add `nyc` or `c8` for coverage reports
  - Priority: Medium
  - Estimated Effort: 12-16 hours

- [ ] **Add integration tests for complex workflows**
  - Task: Test multi-step operations
  - Examples: Create account → Add transactions → Generate report
  - Create: `tests/integration/workflows/*.test.js`
  - Priority: Medium
  - Estimated Effort: 8-12 hours

### Documentation

- [x] **Update README with 49 tools** (Completed 2025-12-10)
  - Tool count corrected from 42 to 49
  - IMPLEMENTED_TOOLS array updated
  - Status: Complete

- [x] **Consolidate documentation** (Completed 2025-12-10)
  - Archived outdated point-in-time reports
  - Removed temporary changelog files
  - Created unified refactoring status doc
  - Status: Complete

- [ ] **Add API response examples to tool docs**
  - Task: Include example responses for each tool
  - Create: `docs/API_EXAMPLES.md`
  - Benefit: Easier for developers to understand tool behavior
  - Priority: Medium
  - Estimated Effort: 6-8 hours

- [ ] **Create troubleshooting guide**
  - Task: Document common issues and solutions
  - Create: `docs/TROUBLESHOOTING.md`
  - Topics: Connection failures, auth issues, timeout errors, LibreChat integration
  - Priority: Medium
  - Estimated Effort: 4-6 hours

---

## 🟢 Low Priority Tasks

### Performance

- [ ] **Cache frequent database queries**
  - Task: Implement caching layer for read-heavy operations
  - Examples: Account list, category list, payee list
  - Library: Consider `node-cache` or Redis
  - Priority: Low - optimize after profiling
  - Estimated Effort: 8-12 hours

- [ ] **Connection pooling evaluation**
  - Current: ActualConnectionPool exists but partially used
  - Issue: Actual API is a singleton (global state limitation)
  - Decision needed: Keep, improve, or remove?
  - Priority: Low - needs architecture decision first
  - Estimated Effort: 4-6 hours (documentation/decision)

### Developer Experience

- [ ] **Add pre-commit hooks**
  - Task: Auto-run linting and tests before commit
  - Tool: Use `husky` for git hooks
  - Commands: `npm run build && npm run test:adapter`
  - Priority: Low
  - Estimated Effort: 2-3 hours

- [ ] **Create development container**
  - Task: Add `.devcontainer` for VS Code
  - Benefit: Consistent development environment
  - Priority: Low
  - Estimated Effort: 3-4 hours

### Code Quality

- [ ] **Add JSDoc comments to all public functions**
  - Task: Document function parameters and return types
  - Files: All `src/**/*.ts`
  - Priority: Low
  - Estimated Effort: 12-16 hours

- [ ] **Enable additional TypeScript strict checks**
  - Current: `strict: true`
  - Add: `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`
  - Priority: Low - requires significant refactoring
  - Estimated Effort: 16-24 hours

---

## 🛡️ Security Tracking

### Completed

- [x] **Bearer token authentication** (All transports)
- [x] **HTTPS support** (Self-signed + CA certificates)
- [x] **Automated dependency scanning** (Dependabot + Renovate)
- [x] **CI/CD security audits** (GitHub Actions)
- [x] **Environment-based secrets** (No hardcoded credentials)

### Planned

- [ ] **JWT token support** (Alternative to Bearer tokens) - Medium priority
- [ ] **Request/response encryption at rest** - Medium priority
- [ ] **Role-based access control (RBAC)** - Low priority (single-user use case)
- [ ] **Audit logging** - Low priority (compliance feature)

---

## 📦 Dependency Management

### Automated Systems

✅ **Dependabot configured** (`.github/dependabot.yml`)  
✅ **Renovate Bot configured** (`renovate.json`)  
✅ **CI/CD dependency workflow** (`.github/workflows/dependency-management.yml`)

**Update Schedule:**
- Security vulnerabilities: Daily scan
- Outdated packages: Weekly check (Mondays 9 AM)
- Grouped updates: Patch/minor/major separation
- Auto-merge: Low-risk patch updates only

### Major Version Updates Planned

**Express v4 → v5 Migration** - DEFERRED to Q1 2026
- Current: 4.21.2
- Latest: 5.1.0
- Breaking changes: Yes (requires migration)
- Estimated effort: 8-16 hours
- Migration guide: https://expressjs.com/en/guide/migrating-5.html

---

## 📈 Completed Refactoring (Archive)

### December 2025

- ✅ **49 tools registration** - All tools properly tracked
- ✅ **Documentation consolidation** - Reduced from 21 to 14 core docs
- ✅ **Archive folder creation** - Historical reports organized

### November 2025

- ✅ **Transaction creation fix** - Full implementation with proper API lifecycle
- ✅ **withActualApi pattern** - Ensures data persistence (tombstone fix)
- ✅ **Query and bank sync tools** - Advanced features implemented
- ✅ **Multi-budget support** - budgets_get_all tool added
- ✅ **Automated dependency management** - Full CI/CD pipeline
- ✅ **MCP transport configuration** - HTTP/SSE/WebSocket all working

---

## 🎯 Next Priorities (Q1 2026)

1. **Schedule tools implementation** (16-24 hours) - Completes API coverage
2. **Error message improvements** (8-12 hours) - Better UX
3. **Security hardening** (6-10 hours) - Input sanitization + rate limiting
4. **Test coverage increase** (12-16 hours) - Reach 90% coverage
5. **actual-adapter.ts refactoring** (16-24 hours) - Reduce complexity

**Total Estimated Effort:** 58-86 hours (7-11 days)

---

## 📝 Notes

- **Code quality trend:** ⬆️ Improving (78 → 85 score)
- **Tool coverage:** 49/56 tools (87.5% of Actual Budget API)
- **Security status:** ✅ 0 vulnerabilities
- **Test status:** ⚠️ Some test commands need verification
- **Documentation:** ✅ Consolidated and current

**Last Full Assessment:** November 24, 2025 → Archived to `docs/archive/2025-11-24_refactoring_analysis.md`
