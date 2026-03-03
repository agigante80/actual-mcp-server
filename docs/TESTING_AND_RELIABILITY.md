# Testing & Reliability

**Project:** Actual MCP Server  
**Version:** 0.4.21  
**Purpose:** Define testing philosophy, frameworks, and enforcement policies  
**Last Updated:** 2026-03-02

---

## 🎯 Testing Philosophy

### Core Principles

1. **Test Before Commit**: No code is committed without passing tests
2. **Test Pyramid**: Unit tests (most) → Integration tests → E2E tests (least)
3. **Fail Fast**: Tests catch issues early in development
4. **Continuous Testing**: CI/CD runs full test suite on every push
5. **Real-World Scenarios**: Tests reflect actual usage patterns

### Testing Goals

- **Prevent Regressions**: Catch breaking changes before they reach production
- **Document Behavior**: Tests serve as living documentation
- **Enable Refactoring**: High coverage enables confident code changes
- **Ensure Reliability**: Production code works as expected

---

## 🧪 Testing Frameworks & Tools

### Testing Stack

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js Built-in** | Native | Unit test runner |
| **TypeScript** | ^5.9.2 | Type checking (compile-time testing) |
| **Playwright** | ^1.56.0 | End-to-end testing |
| **Custom Adapter Tests** | N/A | Smoke tests for Actual API |
| **npm audit** | Native | Security vulnerability scanning |

### Test Categories

```
tests/
├── unit/                    # Unit tests (fast, isolated, offline)
│   ├── transactions_create.test.js        # Zod schema validation (transactions_create)
│   ├── generated_tools.smoke.test.js      # All 56 tools: stub adapter + correctness assertions
│   └── schema_validation.test.js          # Negative-path schema tests (5 complex schemas)
├── e2e/                     # End-to-end tests
│   ├── mcp-client.playwright.spec.ts      # Protocol tests (fast, no Docker)
│   ├── docker.e2e.spec.ts                 # Docker smoke integration (full stack)
│   ├── docker-all-tools.e2e.spec.ts       # All-tools Docker E2E (56 tools)
│   └── run-docker-e2e.sh                  # Docker test orchestrator
└── manual/                  # Live integration tests (real Actual Budget)
    ├── index.js              # Entry point, level-gated execution
    ├── cleanup.js            # Standalone MCP-* data cleanup
    └── tests/               # Per-domain test modules (10 files)
```

**Docker-based E2E Tests**: Full stack integration testing with real Actual Budget server in Docker.

---

## 🏃 Running Tests

### Quick Start

```bash
# Run all tests (recommended)
npm run test:all

# Run protocol tests (fast, ~10s)
npm run test:e2e

# Run Docker integration tests (thorough, ~60s)
npm run test:e2e:docker
```

### Test Types

| Command | Type | Speed | Scope | When to Use |
|---------|------|-------|-------|-------------|
| `npm run test:adapter` | Smoke | ⚡ 30s | Adapter layer | Pre-commit |
| `npm run test:unit-js` | Unit | ⚡ 5s | Single unit | Development |
| `npm run test:e2e` | Protocol | ⚡ 10s | MCP protocol | Pre-commit |
| `npm run test:e2e:docker` | Integration | 🐢 60s | Full stack | Pre-merge |
| `npm run test:all` | All | 🐢 90s | Everything | Before release |

### Pre-Commit Tests (Essential)

```bash
# Essential tests before commit
npm run build                    # TypeScript compilation & type checking
npm run test:adapter             # Adapter smoke tests (30s)
npm run test:unit-js             # Unit + schema tests (3s)
npm audit --audit-level=moderate # Security check
```

### Full Test Suite

```bash
# Complete test suite
npm run test:all             # Runs: adapter + unit + Docker E2E (smoke)

# Or run individually:
npm run build                # Build TypeScript
npm run test:adapter         # Adapter tests
npm run test:unit-js         # Unit tests: schema, smoke, negative-path
npm run test:e2e             # Protocol tests (fast, no Docker)
npm run test:e2e:docker      # Docker integration smoke (thorough)
npm audit                    # Security audit
```

### Docker E2E Tests

**Full stack integration testing with real Actual Budget server:**

```bash
# Run Docker-based E2E tests (quick smoke tests)
npm run test:e2e:docker

# Run comprehensive ALL TOOLS test (50+ tests)
npx playwright test tests/e2e/docker-all-tools.e2e.spec.ts

# Advanced options
./tests/e2e/run-docker-e2e.sh --no-cleanup   # Leave containers for debugging
./tests/e2e/run-docker-e2e.sh --verbose      # Detailed output
./tests/e2e/run-docker-e2e.sh --build-only   # Just build, don't test
```

**What Docker E2E tests verify:**
- ✅ Docker build works correctly
- ✅ Container networking (MCP ↔ Actual Budget)
- ✅ Real tool execution (**all 56 tools — 100% coverage**)
- ✅ Session management and persistence
- ✅ Production-like deployment
- ✅ Error handling and validation (15+ error scenarios)
- ✅ Regression tests (strict validation, batch operations)

**Test Suites:**
- **docker.e2e.spec.ts**: Basic smoke tests (11 tests)
- **docker-all-tools.e2e.spec.ts**: Comprehensive all-tools test (56 tools, 80+ test cases)

### Individual Test Commands

```bash
# TypeScript compilation (includes type checking)
npm run build

# Adapter smoke tests
npm run test:adapter

# Unit tests
npm run test:unit-js

# Protocol E2E tests (no Docker required)
npm run test:e2e

# Docker integration tests (requires Docker)
npm run test:e2e:docker

# Test Actual connection
npm run dev -- --test-actual-connection

# Test all tools
npm run dev -- --test-actual-tools

# Test MCP client interaction
npm run test:mcp-client
```

---

## ✅ Testing Policy

### Mandatory Testing Policy

> ⚠️ **CRITICAL**: No code may be committed or pushed until **all** local tests pass.

### Pre-Commit Checklist

Before running `git commit`:

- [ ] `npm run build` — ✅ No TypeScript errors
- [ ] `npm run test:adapter` — ✅ All adapter tests pass
- [ ] `npm run test:unit-js` — ✅ All unit + schema tests pass (3 files, ~25 assertions)
- [ ] `npm audit --audit-level=moderate` — ✅ No moderate/high/critical vulnerabilities

### CI/CD Enforcement

GitHub Actions automatically runs:
- TypeScript compilation
- All test suites
- Security audit
- Docker build test
- Tool coverage verification

**If CI/CD fails:**
1. ❌ Pull request cannot be merged
2. ❌ No Docker images published
3. ❌ No GitHub releases created

---

## 🔬 Test Types

### 1. Unit Tests

**Purpose**: Test individual functions in isolation

**Location**: `tests/unit/*.js`

**Files**:
| File | What it tests |
|---|---|
| `transactions_create.test.js` | Zod schema — valid input accepted, empty input rejected |
| `generated_tools.smoke.test.js` | All 56 tools: stub adapter, call succeeds, response shape correct |
| `schema_validation.test.js` | Negative-path schemas: `rules_create`, `budget_updates_batch`, `budgets_transfer`, `budgets_setAmount` |

**Run**:
```bash
npm run test:unit-js   # runs all 3 files sequentially
```

**Coverage**: 53/56 tools schema-validated (offline, stub adapter). 23 negative-path assertions across the 4 highest-risk schemas.

### 2. Adapter Tests

**Purpose**: Verify Actual API integration

**Location**: `src/tests_adapter_runner.ts`

**What they test**:
- `withActualApi` wrapper lifecycle (init/shutdown)
- Retry logic: 3 attempts, exponential backoff, recovery from transient failures
- Concurrency queue: 5-session limit, overflow queuing
- 23 assertions total, no tool business logic

**Run**:
```bash
npm run test:adapter
```

### 3. End-to-End Tests

**Purpose**: Test full user workflows

**Location**: `test/e2e/` (Playwright)

**Framework**: Playwright ^1.56.0

**Scenarios**:
- MCP client connects to server
- LibreChat loads all 56 tools
- User performs complete workflow via chat

**Run**:
```bash
npm run test:e2e
```

**Status**: Fully operational. `docker-all-tools.e2e.spec.ts` covers all 56 tools end-to-end.

### 4. Connection Tests

**Purpose**: Verify Actual Budget connection

**Command**:
```bash
npm run dev -- --test-actual-connection
```

**What it tests**:
- Can connect to Actual Budget server
- Can authenticate with password
- Can download budget data
- Budget data is valid

**Use case**: Quickly verify environment configuration

### 5. Tool Tests (deprecated path — use unit tests instead)

**Purpose**: Smoke test all 56 tools

**Command**:
```bash
npm run dev -- --test-actual-tools
```

**What it tests**:
- All tools are registered
- All tools have valid schemas
- All tools can be called without errors (with stub data)

**Use case**: Verify tool coverage after changes

---

## 🛡️ Security Testing

### Dependency Auditing

**Command**:
```bash
npm audit
```

**Severity Levels**:
- **Critical**: Must fix immediately
- **High**: Fix before next release
- **Moderate**: Fix in next patch release
- **Low**: Track but not blocking

**Policy**:
- **Pre-Commit**: No moderate/high/critical vulnerabilities
- **CI/CD**: Fails on high/critical vulnerabilities
- **Regular**: Run `npm audit fix` monthly

### Manual Security Checks

```bash
# Check for exposed secrets
git grep -i "password\|token\|secret\|key" -- "*.ts" "*.js" "*.json"

# Verify .env not committed
git log --all --full-history -- .env

# Check Docker image vulnerabilities
docker scout cves actual-mcp-server:latest
```

### Security Testing Tools (Future)

Planned integrations:
- **Snyk**: Continuous security monitoring
- **Dependabot**: Automated dependency updates
- **CodeQL**: Static analysis security testing
- **OWASP ZAP**: Dynamic application security testing

---

## 📊 Test Coverage

### Current Coverage

- **Unit Tests**: 53/56 tools (stub smoke + shape assertions) + 23 negative-path assertions
- **Adapter Tests**: Infrastructure smoke (retry, concurrency, lifecycle) — not per-tool
- **Docker E2E**: 53/56 tools (100% tool coverage, real Actual Budget server)
- **Live Integration**: 51/56 tools called against real budget (5 delete-only tools in cleanup.js)

### Coverage Goals

| Test Type | Current | Target | Priority |
|-----------|---------|--------|----------|
| Unit Tests | 80% | 90% | High |
| Adapter Tests | 100% | 100% | Maintain |
| Integration Tests | 0% | 50% | Medium |
| E2E Tests | 0% | Basic workflows | Medium |

### Measuring Coverage

**Future Enhancement**: Add coverage reporting

```bash
# Planned - not yet implemented
npm run test:coverage

# Would output:
# File                 | % Stmts | % Branch | % Funcs | % Lines |
# ---------------------|---------|----------|---------|---------|
# src/tools/*.ts       |   85.2  |   78.5   |   92.1  |   86.7  |
# src/lib/*.ts         |   91.3  |   88.2   |   94.5  |   92.1  |
```

**Tool Options**:
- `c8` - Built-in V8 coverage
- `nyc` - Istanbul coverage
- `jest` - Full test framework (if migrating)

---

## 🔄 CI/CD Integration

### GitHub Actions Workflow

**File**: `.github/workflows/ci-cd.yml`

**Stages**:
1. **Lint & Type Check** (3 min)
   - `tsc` - TypeScript compilation
   - `npm run check:coverage` - Tool coverage verification
   - `npm audit` - Security audit (non-blocking)

2. **Test Suite** (3 min)
   - `npm run build` - Build project
   - `npm run test:adapter` - Adapter smoke tests
   - Upload test results

3. **E2E Tests** (5 min)
   - Playwright E2E test suite

4. **Build Artifacts** (3 min)
   - Build production distribution
   - Generate version info
   - Upload artifacts

5. **Docker Test Build** (2 min)
   - Build Docker image
   - Verify image starts
   - Test health endpoint

6. **Publish** (2 min)
   - Push to Docker Hub
   - Push to GitHub Container Registry
   - Create GitHub release

**Total Duration**: ~18 minutes

**Success Criteria**:
- All tests pass
- No TypeScript errors
- No high/critical vulnerabilities
- Docker build successful

### Local Pre-Push Testing

**Recommended**: Add pre-push hook

```bash
# .husky/pre-push (future enhancement)
#!/bin/sh
npm run build && npm run test:adapter && npm audit --audit-level=moderate
```

---

## 🐛 Debugging Failed Tests

### TypeScript Compilation Errors

```bash
# Full error details
npm run build

# Common fixes:
# - Missing type definitions: npm install -D @types/package-name
# - Type mismatch: Check function signatures
# - Import errors: Verify file paths and extensions
```

### Adapter Test Failures

```bash
# Run with debug logging
DEBUG=true npm run test:adapter

# Check Actual Budget connection
npm run dev -- --test-actual-connection

# Verify environment variables
cat .env | grep ACTUAL_
```

### E2E Test Failures

```bash
# Run Playwright with UI
npx playwright test --ui

# Run specific test
npx playwright test test/e2e/specific-test.spec.ts

# Debug mode
npx playwright test --debug

# View test report
npx playwright show-report
```

### Security Audit Failures

```bash
# View detailed audit
npm audit

# Attempt automatic fix
npm audit fix

# Force fix (may introduce breaking changes)
npm audit fix --force

# View affected packages
npm audit --json | jq '.vulnerabilities'
```

---

## 🔍 Test Writing Guidelines

### Unit Test Template

```javascript
// test/unit/my_feature.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { myFeature } from '../../dist/src/my-feature.js';

test('myFeature handles valid input', async () => {
  const result = await myFeature({ input: 'valid' });
  assert.strictEqual(result.success, true);
});

test('myFeature rejects invalid input', async () => {
  await assert.rejects(
    myFeature({ input: null }),
    /Input is required/
  );
});

test('myFeature handles edge cases', async () => {
  const result = await myFeature({ input: '' });
  assert.strictEqual(result.success, false);
});
```

### Best Practices

1. **Descriptive Names**: Test names explain what they verify
2. **Arrange-Act-Assert**: Clear test structure
3. **One Assertion**: Each test verifies one thing
4. **No External Dependencies**: Mock external services
5. **Fast Execution**: Unit tests run in milliseconds

---

## 📝 Test Maintenance

### When to Update Tests

- **Adding features**: Add tests for new functionality
- **Fixing bugs**: Add regression test
- **Refactoring**: Ensure tests still pass
- **Changing behavior**: Update expected results

### Test Debt

Track test improvements:
- Missing test coverage
- Flaky tests
- Slow tests
- Brittle tests

---

## 🎯 Reliability Strategy

### Preventing Failures

1. **Type Safety**: TypeScript catches errors at compile time
2. **Input Validation**: Zod schemas validate all inputs
3. **Error Handling**: Try/catch blocks with proper error messages
4. **Retry Logic**: Automatic retry for transient failures
5. **Graceful Degradation**: Fail gracefully, not catastrophically

### Monitoring Production

- **Health Checks**: `/health` endpoint for load balancers
- **Metrics**: `/metrics` endpoint for Prometheus
- **Logging**: Structured logs with Winston
- **Alerts**: (Future) Alert on repeated failures

---

## � Comprehensive Multi-Level Test Plan

### Test Pyramid Strategy

This project follows a comprehensive testing strategy with multiple levels, from unit tests to full E2E integration. Each level builds upon the previous, ensuring complete coverage of both success and failure scenarios.

```
                    🏔️ Test Pyramid
                         
                      /         \
                    /             \
                  /   Level 5:      \
                /   Full E2E Tests    \    ← All 56 tools + Error scenarios
              /     (Docker Stack)      \
            /                              \
          /        Level 4: Protocol E2E    \  ← MCP protocol compliance
        /       (mcp-client.playwright.spec)  \
      /                                          \
    /      Level 3: Live Integration Tests        \  ← Real Actual Budget
  /          (tests/manual/ — npm run test:integration:*)  \
/                                                      \
/              Level 2: Unit Tests                      \  ← Offline, stub adapter
\        (3 files: smoke, schema, negative-path)        /
  \                                                  /
    \          Level 1: Adapter Smoke Tests      /  ← Adapter infra (retry, pool)
      \              (src/tests_adapter_runner)  /
        \                                  /
          \____________________________/
```

### Level 1: Adapter Smoke Tests ⚡ (Fast: ~30s)

**Purpose:** Verify tool registration and basic functionality  
**Location:** `src/tests_adapter_runner.ts`  
**Command:** `npm run test:adapter`

**Coverage:**
- ✅ All 56 tools registered correctly
- ✅ Tool schemas valid (Zod validation)
- ✅ Tool descriptions present
- ✅ Basic tool invocation works

**Test Files:**
- `src/tests_adapter_runner.ts` - Main adapter test runner
- `src/tests/actualToolsTests.ts` - Individual tool smoke tests

**Success Criteria:**
- All tools found in registry
- All tools have valid input schemas
- No TypeScript compilation errors

**Error Scenarios Tested:**
- ❌ Missing tool registration
- ❌ Invalid schema definitions
- ❌ Tool metadata missing

---

### Level 2: Unit Tests ⚡ (Fast: ~3s)

**Purpose:** Test individual components in isolation — fully offline, no Actual Budget server needed  
**Location:** `tests/unit/`  
**Command:** `npm run test:unit-js`

**Test Files (3 active):**

| File | What it tests | Assertions |
|---|---|---|
| `transactions_create.test.js` | Zod schema for `transactions_create`: valid input accepted, empty rejected | 2 |
| `generated_tools.smoke.test.js` | All 56 tools: stub adapter, `call()` succeeds, response shape verified per-tool | 53 + shape checks |
| `schema_validation.test.js` | Negative-path schema + runtime guards for the 4 highest-risk tools | 23 |

**Coverage:**
- ✅ All 56 tools: stub invocation + response-shape assertion
- ✅ Schema parse rejection for empty/invalid inputs (4 tools, 16 cases)
- ✅ Runtime guard rejection: `amount ≤ 0`, `fromId === toId` in `budgets_transfer`
- ✅ Schema correctness — parse errors with provided examples surface as test failures

**Error Scenarios Tested:**
- ❌ Missing required fields (`conditions`, `operations`, `amount`, `month`, `categoryId`)
- ❌ Wrong types (string where number expected)
- ❌ Invalid format (month `2025-13`, `25-01`)
- ❌ Empty required strings
- ❌ Zero / negative amounts (runtime guard)
- ❌ Same source and target category (runtime guard)

---

### Level 3: Protocol E2E Tests ⚡ (Fast: ~10s)

**Purpose:** Verify MCP protocol compliance  
**Location:** `tests/e2e/mcp-client.playwright.spec.ts`  
**Command:** `npm run test:e2e`

**Coverage:**
- ✅ MCP initialization handshake
- ✅ tools/list request
- ✅ tools/call request
- ✅ Session management headers
- ✅ JSON-RPC 2.0 format

**Test Scenarios:**

| Test | Success Case | Error Case |
|------|-------------|------------|
| Initialize | ✅ Valid protocol version | ❌ Unsupported version |
| List Tools | ✅ Returns 56 tools | ❌ Timeout |
| Call Tool | ✅ Executes tool | ❌ Tool not found |
| Session Persistence | ✅ Same session across calls | ❌ Session expired |
| Health Check | ✅ Status: ok | ❌ Status: not-initialized |

**Success Criteria:**
- All MCP protocol methods work
- JSON-RPC 2.0 compliance verified
- Session headers managed correctly

**Error Scenarios Tested:**
- ❌ Invalid JSON-RPC format
- ❌ Missing protocol version
- ❌ Invalid tool names
- ❌ Missing required parameters
- ❌ Server not initialized

---

### Level 5: Full Docker E2E Tests 🐳 (Thorough: ~60-120s)

**Purpose:** Test complete production deployment  
**Location:** `tests/e2e/docker.e2e.spec.ts` (smoke), `tests/e2e/docker-all-tools.e2e.spec.ts` (comprehensive)  
**Command:** `npm run test:e2e:docker` OR `npx playwright test tests/e2e/docker-all-tools.e2e.spec.ts`

**Coverage:**
- ✅ Docker build correctness
- ✅ Container networking
- ✅ Real Actual Budget integration
- ✅ **ALL 56 tools execution (100% coverage)**
- ✅ Session management (including `actual_session_close`)
- ✅ Error handling (15+ error scenarios)
- ✅ Regression tests (strict validation, large batches, edge cases)

**Quick Smoke Tests (docker.e2e.spec.ts - 11 tests, ~20s):**

| # | Test Name | Success Scenario | Error Scenarios |
|---|-----------|-----------------|-----------------|
| 1 | Initialize MCP session | ✅ Session created | ❌ Auth failure, timeout |
| 2 | Verify services healthy | ✅ Status: ok | ❌ Not initialized, Actual unreachable |
| 3 | List all tools | ✅ 56 tools returned | ❌ Timeout, server error |
| 4 | Execute actual_server_info | ✅ Server version returned | ❌ Connection refused |
| 5 | List accounts | ✅ Account array returned | ❌ Database error |
| 6 | Create test account | ✅ Account ID returned | ❌ Duplicate name, validation error |
| 7 | Verify session persistence | ✅ 3 consecutive calls work | ❌ Session timeout |
| 8 | *(removed — SSE transport removed)* | N/A | N/A |
| 9 | Docker build verification | ✅ All files present | ❌ Missing dependencies |
| 10 | Handle invalid tool name | ✅ Error: Tool not found | ❌ Unexpected behavior |
| 11 | Handle invalid arguments | ✅ Validation error returned | ❌ Server crash |

**Comprehensive All-Tools Tests (docker-all-tools.e2e.spec.ts - 80+ tests, ~120s):**

| Category | Tools Tested | Success Tests | Error Tests |
|----------|--------------|---------------|-------------|
| **Server Info** | 1 | ✅ 1 | - |
| **Session Management** | 2 | ✅ 2 (incl. session_close) | - |
| **Accounts** | 7 | ✅ 5 | ❌ 2 (missing name, invalid fields) |
| **Category Groups** | 4 | ✅ 3 | - |
| **Categories** | 4 | ✅ 3 | ❌ 1 (missing group_id) |
| **Payees** | 5 | ✅ 5 | ❌ 1 (invalid fields) |
| **Payee Rules** | 1 | ✅ 1 | - |
| **Transactions** | 10 | ✅ 7 | ❌ 2 (invalid date/amount) |
| **Budgets** | 9 | ✅ 9 | - |
| **Rules** | 4 | ✅ 4 | - |
| **Advanced/Query** | 2 | ✅ 6 | ❌ 6 (invalid queries) |
| **Cleanup** | - | ✅ Auto-cleanup | - |
| **TOTAL** | **51** | **✅ 46** | **❌ 12** |

**Success Criteria:**
- All 56 tools execute successfully
- Error scenarios handled gracefully
- Docker containers healthy
- No data corruption
- Complete cleanup after tests

**Error Scenarios Tested:**
- ❌ Invalid tool name (Tool not found)
- ❌ Missing required arguments (name, group_id, date)
- ❌ Invalid argument types (date format, amount format)
- ❌ Invalid field names (strict validation)
- ❌ Invalid queries (non-existent tables, invalid fields)
- ❌ Invalid join paths (account.id - account is field not join)
- ❌ Multiple invalid fields in query
- ❌ Invalid fields in WHERE clause
- ❌ Server not initialized (Health check fails)
- ❌ Session timeout (Network error)

**Query Validation Tests (11 scenarios):**
- ✅ Valid: SELECT * FROM transactions
- ✅ Valid: Specific fields (id, date, amount, account)
- ✅ Valid: Join paths (payee.name, category.name)
- ✅ Valid: WHERE and ORDER BY clauses
- ❌ Invalid: payee_name field (should suggest payee)
- ❌ Invalid: category_name field (should suggest category.name)
- ❌ Invalid: table name (transaction vs transactions)
- ❌ Invalid: field in WHERE clause
- ❌ Invalid: multiple invalid fields
- ❌ Invalid: join path account.id (account is not a join)

**Regression Scenarios Verified:**
- ✅ Strict validation on accounts_update (reject invalid fields)
- ✅ Strict validation on payees_update (reject invalid fields)
- ✅ Large batch operations (35+ operations)
- ✅ Rules without 'op' field (defaults to 'set')
- ✅ Payee updates with category field
- ✅ Session persistence across multiple calls

---

### Level 6: Manual Integration Tests 🧪 (Comprehensive: ~60s)

**Purpose:** Test all 56 tools with real Actual Budget data  
**Location:** `tests/manual/index.js` (entry point), `tests/manual/tests/` (10 domain modules)  
**Command:** `npm run test:integration:full`

**Test Levels:**

#### SMOKE Level (3 tools)
- ✅ Initialize session
- ✅ List tools (51 expected)
- ✅ List accounts

**Error Scenarios:**
- ❌ MCP server not reachable
- ❌ Actual Budget not connected

#### NORMAL Level (7 tools)
- ✅ All SMOKE tests
- ✅ Create account
- ✅ Get account balance
- ✅ Update account
- ✅ Close account
- ✅ Reopen account
- ✅ Delete account (cleanup)

**Error Scenarios:**
- ❌ Invalid account ID (UUID validation)
- ❌ Update with no fields (validation error)
- ❌ Delete non-existent account
- ❌ Reopen already-open account

#### FULL Level (51 tools - 100% coverage)

**Account Tools (7):**
- ✅ All NORMAL account tests
- ❌ Create duplicate account name
- ❌ Update closed account

**Category Groups (4):**
- ✅ Get all groups
- ✅ Create group
- ✅ Update group
- ✅ Delete group
- ❌ Delete group with categories
- ❌ Create duplicate group

**Categories (4):**
- ✅ Get all categories
- ✅ Create category
- ✅ Update category
- ✅ Delete category
- ❌ Create without group_id
- ❌ Delete category with transactions

**Payees (5):**
- ✅ Get all payees
- ✅ Create payee
- ✅ Update payee (with category field)
- ✅ Merge payees
- ✅ Delete payee
- ❌ Merge non-existent payees
- ❌ Update with invalid category ID

**Payee Rules (1):**
- ✅ Get payee rules

**Transactions (6):**
- ✅ Create transaction
- ✅ Get transaction by ID
- ✅ Update transaction
- ✅ Filter transactions
- ✅ Import transactions
- ✅ Delete transaction
- ❌ Create with invalid account
- ❌ Create with invalid amount (not in cents)
- ❌ Create with invalid date format
- ❌ Update non-existent transaction

**Budgets (9):**
- ✅ Get all budgets
- ✅ Get month budget
- ✅ Get multiple months
- ✅ Set budget amount
- ✅ Set carryover
- ✅ Hold for next month
- ✅ Reset hold
- ✅ Transfer between categories
- ✅ Batch updates (35 operations)
- ❌ Set invalid month format
- ❌ Transfer more than available
- ❌ Batch with mixed valid/invalid ops (partial success)

**Rules (4):**
- ✅ Get all rules
- ✅ Create rule (with/without 'op' field)
- ✅ Update rule
- ✅ Delete rule
- ❌ Create rule with invalid field
- ❌ Create rule with invalid condition operator

**Advanced (2):**
- ✅ Bank sync (graceful failure if unavailable)
- ✅ Run ActualQL query
- ❌ Invalid SQL query syntax
- ❌ Query non-existent table

**Session Management (2):**
- ✅ List active sessions
- ✅ Close specific session
- ❌ Close invalid session ID

**Success Criteria:**
- All 56 tools execute successfully
- Error scenarios handled gracefully
- Test data cleaned up properly
- No data corruption

---

### Error Testing Matrix

**By Error Type:**

| Error Type | Tools Affected | Test Coverage | Status |
|------------|---------------|---------------|--------|
| **Validation Errors** | All tools | ✅ Unit tests | Complete |
| Invalid UUID format | accounts_*, categories_*, payees_* | ✅ Unit + Integration | Complete |
| Missing required fields | accounts_create, transactions_create | ✅ Unit + Integration | Complete |
| Invalid date format | transactions_create, budgets_* | ✅ Unit + Integration | Complete |
| Invalid amount (not cents) | transactions_create, budgets_* | ✅ Integration | Complete |
| Unrecognized fields | accounts_update, payees_update | ✅ Regression tests | Complete |
| **Connection Errors** | All tools | ✅ E2E tests | Complete |
| Server unavailable | All tools | ✅ Docker E2E | Complete |
| Network timeout | All tools | ✅ Retry tests | Complete |
| Session expired | All tools | ✅ Integration | Complete |
| **Business Logic Errors** | Specific tools | ✅ Integration | Complete |
| Duplicate account name | accounts_create | ⏳ TODO | Planned |
| Insufficient funds | budgets_transfer | ⏳ TODO | Planned |
| Delete with dependencies | categories_delete, payees_delete | ⏳ TODO | Planned |
| Invalid rule conditions | rules_create | ✅ Regression | Complete |
| **Database Errors** | All tools | ⏳ TODO | Planned |
| Constraint violations | Various | ⏳ TODO | Planned |
| Deadlock handling | Concurrent ops | ⏳ TODO | Planned |
| Data corruption | All tools | ⏳ TODO | Planned |

---

### Test Execution Strategy

**Pre-Commit (Required):**
```bash
npm run build                    # TypeScript compilation
npm run test:adapter             # Smoke tests (30s)
npm run test:unit-js             # Unit tests (5s)
npm audit --audit-level=moderate # Security check
```

**Pre-Merge (CI/CD):**
```bash
npm run test:all                 # All automated tests (90s)
# Includes: adapter + unit + Docker E2E
```

**Pre-Release (Manual):**
```bash
# Full manual integration test with all 51 tools
npm run test:integration:full

# Cleanup only (remove leftover MCP-* test data)
npm run test:integration:cleanup
```

---

### Test Coverage Goals

| Test Level | Current Coverage | Target Coverage | Priority |
|------------|-----------------|-----------------|----------|
| **Level 1:** Adapter Smoke | 100% (adapter infra) | 100% | ✅ Maintain |
| **Level 2:** Unit Tests | 51/51 tools (stub), 23 schema assertions | Maintain + grow | ✅ Good |
| **Level 3:** Live Integration | 46/51 tools called | 51/51 | 🟡 Medium |
| **Level 4:** Protocol E2E | 100% (MCP compliance) | 100% | ✅ Maintain |
| **Level 5:** Docker E2E | **51/51 tools** (100%) | 100% | ✅ Maintain |
| **Level 6:** Manual Full | 100% (51/51 tools) | 100% | ✅ Maintain |
| **Error Scenarios** | ~70% | 90% | 🟡 Medium |

---

### Next Testing Improvements

**High Priority:**
1. ✅ **Completed:** Docker E2E tests — 51/51 tools (added `actual_session_close`)
2. ✅ **Completed:** Unit test suite — 3 files, 51-tool smoke, 23 negative-path assertions
3. ⏳ **TODO:** Add business logic error tests (duplicate accounts, insufficient funds)
4. ⏳ **TODO:** Add concurrency tests (parallel tool execution)

**Medium Priority:**
5. ⏳ **TODO:** Add chaos testing (server failures, network issues)
6. ⏳ **TODO:** Add performance benchmarks (tool execution time)
7. ⏳ **TODO:** Add load testing (concurrent sessions)

**Low Priority:**
8. ⏳ **TODO:** Add mutation testing (verify test quality)
9. ⏳ **TODO:** Add contract testing (API compatibility)
10. ⏳ **TODO:** Add visual regression testing (Docker dashboard)

---

## 🔗 Related Documentation

- [AI Interaction Guide](./AI_INTERACTION_GUIDE.md) - Testing enforcement rules
- [Architecture](./ARCHITECTURE.md) - System design and components
- [Security & Privacy](./SECURITY_AND_PRIVACY.md) - Security testing policies
- [Roadmap](./ROADMAP.md) - Future testing improvements

---

## ✨ Summary

**Testing is mandatory, not optional.**

Before every commit:
```bash
npm run build && npm run test:adapter && npm audit --audit-level=moderate
```

If tests fail:
1. ❌ Do not commit
2. ✅ Fix the issue
3. ✅ Re-run tests
4. ✅ Commit only when all tests pass

**Remember**: Tests are your safety net. Maintaining them ensures long-term project health and enables confident development.
