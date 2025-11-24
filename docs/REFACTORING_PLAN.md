# Refactoring & Code Quality Plan

**Project:** Actual MCP Server  
**Version:** 0.1.0  
**Purpose:** Live tracking of ongoing refactoring and code improvements  
**Last Updated:** 2025-11-11

---

## 🎯 Purpose

This document maintains a **live, checkbox-style record** of refactoring tasks, code quality improvements, and technical debt resolution. Tasks are organized by priority and domain.

> **Note**: AI agents must automatically update this file when tasks are completed or new tasks are identified.

---

## 🔥 High Priority (Critical)

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

- [ ] **Implement Schedules tools** (4 tools)
  - Task: Add `getSchedules()`, `createSchedule()`, `updateSchedule()`, `deleteSchedule()`
  - Blocker: Schedule methods require internal Actual API access
  - Workaround: Use `send()` API directly
  - Priority: High - completes 100% API coverage
  - Assigned: Pending
  
- [ ] **Improve error messages for user guidance**
  - Task: Make error responses more actionable
  - Example: "Account not found" → "Account 'uuid-123' not found. Use actual_accounts_list to see available accounts"
  - Files: All `src/tools/*.ts`
  - Priority: High - improves user experience

### Security

- [x] **Move secrets to environment variables** (Completed - initial implementation)
  - All credentials in `.env` file
  - Docker secrets support implemented
  - Status: Production-ready

- [ ] **Add input sanitization to all POST routes**
  - Task: Validate and sanitize all user inputs
  - Files: `src/server/httpServer.ts`, `src/server/sseServer.ts`
  - Current: Zod validation only
  - Need: Additional sanitization for XSS prevention
  - Priority: High

- [ ] **Implement rate limiting**
  - Task: Add per-client rate limiting
  - Library: Consider `express-rate-limit`
  - Files: `src/server/httpServer.ts`
  - Priority: High for production deployments

---

## 🟠 Medium Priority (Recommended)

### Code Organization

- [ ] **Modularize transport server logic**
  - Task: Extract common logic from HTTP/SSE/WebSocket servers
  - Create: `src/server/common.ts` with shared utilities
  - Files: `src/server/*.ts`
  - Benefit: Reduce code duplication, easier maintenance
  - Priority: Medium

- [ ] **Extract constants to dedicated file**
  - Task: Move magic numbers and strings to `src/config/constants.ts`
  - Examples: Default ports, retry limits, timeout values
  - Files: All `src/**/*.ts`
  - Benefit: Single source of truth for configuration
  - Priority: Medium

- [ ] **Standardize error handling across tools**
  - Task: Create base error handler utility
  - Create: `src/lib/errorHandler.ts`
  - Pattern: Consistent error formatting for all tools
  - Files: All `src/tools/*.ts`
  - Priority: Medium

- [ ] **Improve logging consistency**
  - Task: Standardize log messages across modules
  - Pattern: `[ModuleName] Action: Details`
  - Add: Request IDs for tracing
  - Files: All `src/**/*.ts`
  - Priority: Medium

### Testing

- [ ] **Increase unit test coverage to 90%**
  - Current: ~80% coverage
  - Target: 90% coverage
  - Focus: Edge cases, error paths
  - Tool: Consider adding `nyc` or `c8` for coverage reports
  - Priority: Medium

- [ ] **Add integration tests for complex workflows**
  - Task: Test multi-step operations
  - Examples: Create account → Add transactions → Generate report
  - Create: `test/integration/workflows/*.test.js`
  - Priority: Medium

- [ ] **Add load testing suite**
  - Task: Performance testing for concurrent requests
  - Tool: Consider `artillery` or `k6`
  - Metrics: Requests/sec, latency, error rates
  - Priority: Medium

### Documentation

- [x] **Update README with 42 tools** (Completed 2025-11-10)
  - Tool count updated
  - Categories updated to 9
  - Status: Current

- [x] **Document MCP_TRANSPORT_MODE** (Completed 2025-11-11)
  - Added to README.md
  - Added to docker/description/long.md
  - Added to .env.example
  - Status: Complete

- [ ] **Add API response examples to tool docs**
  - Task: Include example responses for each tool
  - Create: `docs/API_EXAMPLES.md`
  - Benefit: Easier for developers to understand tool behavior
  - Priority: Medium

- [ ] **Create troubleshooting guide**
  - Task: Document common issues and solutions
  - Create: `docs/TROUBLESHOOTING.md`
  - Topics: Connection failures, auth issues, timeout errors
  - Priority: Medium

---

## 🟢 Low Priority (Optional)

### Performance

- [ ] **Cache frequent database queries**
  - Task: Implement caching layer for read-heavy operations
  - Examples: Account list, category list, payee list
  - Library: Consider `node-cache` or Redis
  - Benefit: Reduce load on Actual Budget server
  - Priority: Low - optimize after profiling

- [ ] **Optimize transaction filtering**
  - Task: Improve performance for large transaction sets
  - File: `src/tools/transactions_filter.ts`
  - Approach: Server-side filtering vs client-side
  - Priority: Low - only needed for users with 10k+ transactions

- [ ] **Implement connection pooling**
  - Current: Single connection to Actual Budget
  - Task: Support multiple concurrent connections
  - Benefit: Better handling of parallel requests
  - Priority: Low - current approach works well

### Developer Experience

- [ ] **Add pre-commit hooks**
  - Task: Auto-run linting and tests before commit
  - Tool: Use `husky` for git hooks
  - Commands: `npm run build && npm run test:adapter`
  - Priority: Low - helps prevent broken commits

- [ ] **Create development container**
  - Task: Add `.devcontainer` for VS Code
  - Benefit: Consistent development environment
  - Priority: Low - nice to have

- [ ] **Add debug configurations**
  - Task: Create `.vscode/launch.json` for debugging
  - Configs: Debug server, debug tests, debug specific tool
  - Priority: Low

### Code Quality

- [ ] **Add JSDoc comments to all public functions**
  - Task: Document function parameters and return types
  - Files: All `src/**/*.ts`
  - Benefit: Better IDE autocomplete
  - Priority: Low

- [ ] **Enable additional TypeScript strict checks**
  - Current: `strict: true`
  - Add: `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`
  - Benefit: Catch more potential bugs
  - Priority: Low - requires significant refactoring

- [ ] **Reduce cyclomatic complexity**
  - Task: Break down complex functions
  - Target: Max complexity of 10 per function
  - Tool: Add `eslint-plugin-complexity`
  - Priority: Low

---

## 🛡️ Security Improvements

### Authentication & Authorization

- [x] **Add Bearer token authentication** (Completed)
  - HTTP transport: ✅ Working
  - SSE transport: ✅ Server-side implemented (client limitation)
  - WebSocket transport: ✅ Implemented
  - Status: Production-ready

- [ ] **Add JWT token support**
  - Task: Alternative to Bearer tokens
  - Library: `jsonwebtoken`
  - Benefit: Token expiration, refresh tokens
  - Priority: Medium - depends on use case

- [ ] **Implement role-based access control (RBAC)**
  - Task: Different permission levels for tools
  - Example: Read-only vs full access
  - Priority: Low - single-user deployments don't need this

### Data Protection

- [x] **HTTPS support** (Completed)
  - Self-signed certificates: ✅ Working
  - CA certificates: ✅ Supported
  - Status: Production-ready

- [ ] **Add request/response encryption at rest**
  - Task: Encrypt sensitive data in logs
  - Approach: Redact passwords, tokens in log output
  - Files: `src/logger.ts`
  - Priority: Medium

- [ ] **Implement audit logging**
  - Task: Track all tool calls for security audit
  - Format: Who, what, when, result
  - Storage: Separate audit log file
  - Priority: Low - useful for compliance

### Vulnerability Management

- [x] **Regular npm audit** (CI/CD automated)
  - GitHub Actions runs `npm audit` on every push
  - Status: Automated

- [x] **Add Dependabot for automated updates** (Completed 2025-11-24)
  - Dependabot configured: `.github/dependabot.yml`
  - Renovate Bot configured: `renovate.json`
  - Weekly scans for security vulnerabilities
  - Grouped updates: patch/minor/major
  - Auto-merge for low-risk updates
  - Status: Production-ready

- [x] **Dependency management automation** (Completed 2025-11-24)
  - CI/CD workflow: `.github/workflows/dependency-management.yml`
  - Automated security audits (weekly)
  - Outdated package detection
  - Dependency dashboard generation
  - Breaking change detection
  - Status: Fully automated

- [ ] **Add SAST (Static Analysis Security Testing)**
  - Tool: Consider `semgrep` or `CodeQL`
  - Integration: GitHub Actions workflow
  - Priority: Low

---

## 📦 Dependency Management

### Major Version Updates

- [ ] **Express v4 → v5 Migration**
  - Current: Express 4.21.2
  - Latest: Express 5.1.0
  - Status: DEFERRED (planned for Q1 2026)
  - Breaking Changes: Yes (requires significant migration)
  - Migration Guide: https://expressjs.com/en/guide/migrating-5.html
  - Impact: HIGH - Core HTTP server framework
  - Estimated Effort: 8-16 hours
  - Files Affected:
    - `src/server/httpServer.ts` (primary)
    - `src/server/sseServer.ts`
    - All Express middleware
  - Migration Tasks:
    - [ ] Review Express v5 migration guide
    - [ ] Update deprecated API usage (res.sendfile → res.sendFile)
    - [ ] Refactor promise-based middleware
    - [ ] Update error handling for async routes
    - [ ] Update @types/express to v5
    - [ ] Full integration testing
    - [ ] Load testing and performance validation
  - Priority: Low - Current version stable and secure

### Minor/Patch Updates

- [ ] **MCP SDK Update (1.18.2 → 1.22.0)**
  - Type: Minor version update (4 versions behind)
  - Risk: MEDIUM - Core protocol SDK
  - Breaking Changes: Review changelog required
  - Impact: All 42 MCP tools
  - Testing Required: Comprehensive tool validation
  - Estimated Effort: 2-4 hours
  - Priority: HIGH - Keep protocol SDK current

- [ ] **Axios Update (1.12.2 → 1.13.2)**
  - Type: Minor version update
  - Risk: LOW - HTTP client library
  - Breaking Changes: None expected
  - Testing Required: HTTP request validation
  - Estimated Effort: 1 hour
  - Priority: MEDIUM

- [ ] **Batch Patch Updates**
  - dotenv: 17.2.2 → 17.2.3
  - @playwright/test: 1.56.0 → 1.56.1
  - @types/express: 5.0.3 → 5.0.5
  - @types/node: 24.5.2 → 24.10.1
  - nodemon: 3.1.10 → 3.1.11
  - typescript: 5.9.2 → 5.9.3
  - Risk: LOW - All patch versions
  - Auto-merge: Yes (after CI passes)
  - Priority: HIGH - Security patches and bug fixes

### Dependency Pinning

- [ ] **Pin LibreChat Git Dependency**
  - Current: `github:danny-avila/LibreChat#main` (tracks branch)
  - Risk: HIGH - Unpredictable changes
  - Recommendation: Pin to specific commit SHA
  - Task: Find stable commit, update package.json
  - Priority: MEDIUM - Improve build reproducibility

---

## 📊 Observability Improvements

### Monitoring

- [x] **Prometheus metrics** (Completed)
  - `/metrics` endpoint implemented
  - Metrics: Tool call counts, errors
  - Status: Production-ready

- [ ] **Add detailed performance metrics**
  - Metrics: Latency per tool, queue depth, connection status
  - Priority: Medium

- [ ] **Add health check details**
  - Current: Simple `{"status":"ok"}`
  - Enhanced: Include Actual Budget connection status, queue depth, uptime
  - File: `src/server/httpServer.ts`
  - Priority: Low

### Logging

- [x] **Structured logging with Winston** (Completed)
  - Daily rotation implemented
  - Debug mode available
  - Status: Production-ready

- [ ] **Add distributed tracing**
  - Task: OpenTelemetry integration
  - Benefit: Trace requests across services
  - Priority: Low - overkill for single service

- [ ] **Add log aggregation**
  - Task: Ship logs to external service
  - Options: ELK stack, CloudWatch, Grafana Loki
  - Priority: Low - depends on deployment environment

---

## 🚀 Feature Enhancements

### New Capabilities

- [ ] **Add report generation tools**
  - Task: Create tools for common financial reports
  - Examples: Spending by category, income vs expenses, net worth over time
  - Priority: Medium

- [ ] **Add goal tracking tools**
  - Task: Integrate with Actual Budget's goal features
  - Tools: Set goals, track progress, get goal status
  - Priority: Medium

- [ ] **Add batch transaction import from CSV**
  - Task: Wrapper around `transactions_import` with CSV parsing
  - Priority: Low

### Integration Improvements

- [ ] **Support multiple Actual Budget servers**
  - Task: Switch between servers at runtime
  - Use case: Manage multiple users' budgets
  - Priority: Low

- [ ] **Add webhook support**
  - Task: Notify external services on budget changes
  - Use case: Integration with other automation tools
  - Priority: Low

- [ ] **Create REST API wrapper**
  - Task: Expose tools as traditional REST API (in addition to MCP)
  - Benefit: Easier integration for non-MCP clients
  - Priority: Low

---

## 🎯 Technical Debt

### Known Issues

- [ ] **Alpine native module warnings**
  - Issue: `@actual-app/api` shows native module warnings on Alpine
  - Impact: Warnings only, functionality works
  - Solution: Switch to Debian-based image or ignore
  - Priority: Low - cosmetic issue

- [ ] **Large transaction sets cause slowdown**
  - Issue: Filtering 10k+ transactions is slow
  - Root cause: Client-side filtering
  - Solution: Implement server-side filtering in Actual Budget API
  - Priority: Low - affects power users only

- [ ] **Incomplete type definitions**
  - Issue: Some `@actual-app/api` types are missing
  - Workaround: Custom type definitions in `types/`
  - Solution: Contribute to upstream project
  - Priority: Low

### Code Smells

- [ ] **Long functions in adapter layer**
  - Files: `src/lib/actual-adapter.ts`
  - Issue: Some functions exceed 100 lines
  - Solution: Extract helper functions
  - Priority: Low

- [ ] **Duplicated validation logic**
  - Files: Multiple `src/tools/*.ts`
  - Issue: Similar Zod schemas repeated
  - Solution: Create shared schema utilities
  - Priority: Low

- [ ] **Magic numbers in retry logic**
  - Files: `src/lib/actual-adapter.ts`
  - Issue: Hardcoded retry attempts (3) and delays (1000ms)
  - Solution: Move to configuration
  - Priority: Low

---

## 📋 Completed Tasks

### Recent Completions

- [x] **Add query_run tool** (2025-11-10)
  - Custom ActualQL queries
  - Tested and documented

- [x] **Add bank_sync tool** (2025-11-10)
  - GoCardless/SimpleFIN integration
  - Tested and documented

- [x] **Add budgets_get_all tool** (2025-11-10)
  - Multi-budget support
  - Tested and documented

- [x] **Fix @actual-app/api version** (2025-11-10)
  - Upgraded from 25.9.0 to 25.11.0
  - Resolved "Could not get remote files" bug

- [x] **Make transport mode configurable** (2025-11-11)
  - Added `MCP_TRANSPORT_MODE` environment variable
  - HTTP default in Docker
  - Documentation updated

- [x] **Remove --http-testing code** (2025-11-11)
  - Cleaned up testing transport mode
  - Simplified codebase

- [x] **Document MCP_TRANSPORT_MODE** (2025-11-11)
  - Updated README.md
  - Updated Docker long description
  - Updated .env.example

### Historical Completions

- [x] **Initial project setup** (2025-11-08)
- [x] **Docker configuration** (2025-11-08)
- [x] **CI/CD pipeline** (2025-11-08)
- [x] **LibreChat integration** (2025-11-09)
- [x] **HTTPS support** (2025-11-09)
- [x] **Bearer token authentication** (2025-11-09)

---

## 🔄 Maintenance Tasks

### Regular Maintenance (Monthly)

- [ ] **Update dependencies**
  - Run: `npm update`
  - Test: Full test suite
  - Review: Breaking changes in changelog

- [ ] **Review and close stale issues**
  - Check GitHub issues
  - Close resolved or outdated issues

- [ ] **Update documentation**
  - Review all docs for accuracy
  - Update version numbers
  - Refresh examples

### Regular Maintenance (Quarterly)

- [ ] **Security audit**
  - Run: `npm audit fix`
  - Review: High/critical vulnerabilities
  - Update: Dependencies with security patches

- [ ] **Performance review**
  - Run: Load tests
  - Analyze: Bottlenecks
  - Optimize: Critical paths

- [ ] **Code quality review**
  - Tool: Run complexity analysis
  - Refactor: Overly complex functions
  - Document: Architecture decisions

---

## 📝 How to Use This Document

### For Developers

1. **Starting new work**: Check this document for planned tasks
2. **Completing a task**: Mark with `[x]` and add completion date
3. **Identifying new issues**: Add to appropriate priority section
4. **Regular reviews**: Update priorities based on project needs

### For AI Agents

1. **After completing refactoring**: Update checkbox and add date
2. **When adding features**: Check if task already planned
3. **Finding bugs**: Add to appropriate section with details
4. **Code quality issues**: Document in Technical Debt section

### Priority Guidelines

- **🔥 High**: Critical for functionality or security
- **🟠 Medium**: Improves quality or user experience
- **🟢 Low**: Nice-to-have, optimize later

---

## 🔗 Related Documentation

- [Improvement Areas](./IMPROVEMENT_AREAS.md) - Detailed analysis of gaps
- [Roadmap](./ROADMAP.md) - Future feature planning
- [Testing & Reliability](./TESTING_AND_RELIABILITY.md) - Testing standards
- [Architecture](./ARCHITECTURE.md) - System design details
