# Testing & Reliability

**Project:** Actual MCP Server  
**Version:** 0.4.7  
**Purpose:** Define testing philosophy, frameworks, and enforcement policies  
**Last Updated:** 2026-01-08

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
├── unit/                    # Unit tests (fast, isolated)
│   └── transactions_create.test.js
├── integration/             # Integration tests (real dependencies)
│   ├── (migrated from root)
│   └── actual-mcp-integration-test.js
├── e2e/                     # End-to-end tests
│   ├── mcp-client.playwright.spec.ts      # Protocol tests (fast)
│   ├── docker.e2e.spec.ts                 # Docker integration (full stack)
│   └── run-docker-e2e.sh                  # Docker test orchestrator
└── manual/                  # Manual test scripts
    └── (migrated from root)
```

**New: Docker-based E2E Tests** - See [DOCKER_E2E_TESTING.md](./DOCKER_E2E_TESTING.md) for full documentation.

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
npm run build                # TypeScript compilation & type checking
npm run test:adapter         # Adapter smoke tests (30s)
npm audit --audit-level=moderate  # Security check
```

### Full Test Suite

```bash
# Complete test suite
npm run test:all             # Runs: adapter + unit + Docker E2E

# Or run individually:
npm run build                # Build TypeScript
npm run test:adapter         # Adapter tests
npm run test:unit-js         # Unit test (transactions_create)
npm run test:e2e             # Protocol tests (fast)
npm run test:e2e:docker      # Docker integration (thorough)
npm audit                    # Security audit
```

### Docker E2E Tests

**Full stack integration testing with real Actual Budget server:**

```bash
# Run Docker-based E2E tests
npm run test:e2e:docker

# Advanced options
./tests/e2e/run-docker-e2e.sh --no-cleanup   # Leave containers for debugging
./tests/e2e/run-docker-e2e.sh --verbose      # Detailed output
./tests/e2e/run-docker-e2e.sh --build-only   # Just build, don't test
```

**What Docker E2E tests verify:**
- ✅ Docker build works correctly
- ✅ Container networking (MCP ↔ Actual Budget)
- ✅ Real tool execution (all 51 tools)
- ✅ Session management and persistence
- ✅ Production-like deployment
- ✅ Error handling and validation

See [DOCKER_E2E_TESTING.md](./DOCKER_E2E_TESTING.md) for complete documentation.

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

- [ ] `npm run build` - ✅ No TypeScript errors
- [ ] `npm run test:adapter` - ✅ All adapter tests pass
- [ ] `npm run test:unit-js` - ✅ All unit tests pass
- [ ] `npm audit --audit-level=moderate` - ✅ No moderate/high/critical vulnerabilities

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

**Location**: `test/unit/*.test.js`

**Example**:
```javascript
// test/unit/transactions_create.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { transactionsCreate } from '../../dist/src/tools/transactions_create.js';

test('transactionsCreate validates required fields', async () => {
  await assert.rejects(
    transactionsCreate({ accountId: null }),
    /accountId is required/
  );
});
```

**Run**:
```bash
npm run test:unit-js
```

**Coverage Target**: >80% (current), aiming for 90%

### 2. Adapter Tests

**Purpose**: Verify Actual API integration

**Location**: `src/tests/actualToolsTests.ts`

**What they test**:
- All 51 tools can be called
- Tool registration works correctly
- Basic smoke tests for each tool
- Error handling for invalid inputs

**Run**:
```bash
npm run test:adapter
```

**Example**:
```typescript
// Test tool exists
const tools = manager.listTools();
assert(tools.some(t => t.name === 'actual_accounts_list'));

// Test tool can be called
const result = await manager.callTool('actual_accounts_list', {});
assert(result.success === true);
```

### 3. Integration Tests

**Purpose**: Test multiple components together

**Location**: `test/integration/` (planned)

**Scenarios**:
- Create account → Add transaction → Verify balance
- Create category → Create transaction → Filter by category
- Create payee → Create rule → Verify rule applied

**Status**: Planned for future implementation

### 4. End-to-End Tests

**Purpose**: Test full user workflows

**Location**: `test/e2e/` (Playwright)

**Framework**: Playwright ^1.56.0

**Scenarios**:
- MCP client connects to server
- LibreChat loads all 51 tools
- User performs complete workflow via chat

**Run**:
```bash
npm run test:e2e
```

**Status**: Framework installed, tests in development

### 5. Connection Tests

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

### 6. Tool Tests

**Purpose**: Smoke test all 51 tools

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

- **Unit Tests**: ~80% coverage
- **Adapter Tests**: 100% of tools have smoke tests
- **Integration Tests**: Planned
- **E2E Tests**: In development

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

Track test improvements in [REFACTORING_PLAN.md](./REFACTORING_PLAN.md):
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
                /   Full E2E Tests    \    ← All 51 tools + Error scenarios
              /     (Docker Stack)      \
            /                              \
          /        Level 4: E2E             \  ← Protocol compliance
        /       (MCP Protocol Tests)          \
      /                                          \
    /            Level 3: Integration            \  ← Component interactions
  /          (Manual Integration Tests)            \
/                                                      \
/              Level 2: Unit Tests                      \  ← Individual functions
\            (Schema validation & mocks)                /
  \                                                  /
    \          Level 1: Adapter Smoke Tests      /  ← Tool registration
      \              (51 tools)                /
        \                                  /
          \____________________________/
```

### Level 1: Adapter Smoke Tests ⚡ (Fast: ~30s)

**Purpose:** Verify tool registration and basic functionality  
**Location:** `src/tests_adapter_runner.ts`  
**Command:** `npm run test:adapter`

**Coverage:**
- ✅ All 51 tools registered correctly
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

### Level 2: Unit Tests ⚡ (Fast: ~5s)

**Purpose:** Test individual components in isolation  
**Location:** `tests/unit/*.test.js`  
**Command:** `npm run test:unit-js`

**Coverage:**
- ✅ Schema validation for each tool
- ✅ Input parameter parsing
- ✅ Mocked adapter responses
- ✅ Error handling for invalid inputs

**Test Files (18 existing):**

| Test File | Tool Under Test | Success Tests | Error Tests |
|-----------|----------------|---------------|-------------|
| `accounts_create.test.js` | accounts_create | ✅ Valid account creation | ❌ Missing name, invalid UUID |
| `accounts_update.test.js` | accounts_update | ✅ Field updates | ❌ No fields provided, invalid fields |
| `accounts_list.test.js` | accounts_list | ✅ List accounts | ❌ N/A (no params) |
| `accounts_get_balance.test.js` | accounts_get_balance | ✅ Balance retrieval | ❌ Invalid account ID |
| `transactions_create.test.js` | transactions_create | ✅ Transaction creation | ❌ Missing required fields |
| `transactions_get.test.js` | transactions_get | ✅ Get by account | ❌ Invalid account ID |
| `transactions_filter.test.js` | transactions_filter | ✅ Filter with criteria | ❌ Invalid date format |
| `transactions_import.test.js` | transactions_import | ✅ Bulk import | ❌ Duplicate detection |
| `categories_create.test.js` | categories_create | ✅ Category creation | ❌ Missing group_id |
| `payees_create.test.js` | payees_create | ✅ Payee creation | ❌ Missing name |
| `budgets_setAmount.test.js` | budgets_setAmount | ✅ Set budget | ❌ Invalid month format |
| `budgets_transfer.test.js` | budgets_transfer | ✅ Transfer funds | ❌ Insufficient funds |
| `retry.test.js` | Retry mechanism | ✅ Retry on failure | ❌ Max retries exceeded |
| `adapter_normalization.test.ts` | Data normalization | ✅ Format conversion | ❌ Invalid data types |
| `observability.test.js` | Metrics collection | ✅ Metrics captured | ❌ N/A |
| `notification_forward.test.js` | Notifications | ✅ Forward events | ❌ N/A |
| `generated_tools.smoke.test.js` | Tool generation | ✅ All tools present | ❌ Missing tools |
| `transactions_create.test.ts` | transactions_create | ✅ TypeScript types | ❌ Type mismatches |

**Success Criteria:**
- All schema validations pass
- Mocked responses handled correctly
- Type checking passes

**Error Scenarios Tested:**
- ❌ Invalid input types (string vs number)
- ❌ Missing required fields
- ❌ Malformed UUIDs
- ❌ Invalid date formats (YYYY-MM-DD)
- ❌ Out-of-range amounts
- ❌ Empty strings for required fields
- ❌ Unrecognized fields (strict validation)

---

### Level 3: Integration Tests 🔄 (Medium: ~30s)

**Purpose:** Test component interactions and real API behavior  
**Location:** `tests/integration/`  
**Command:** `npm run test:integration` (planned)

**Coverage:**
- ✅ Multiple tools working together
- ✅ Session state management
- ✅ Connection pooling behavior
- ✅ Real Actual Budget API responses

**Test Files (8 existing):**

| Test File | Integration Scenario | Success Tests | Error Tests |
|-----------|---------------------|---------------|-------------|
| `test-account-validation.cjs` | Account field validation | ✅ Valid fields accepted | ❌ Invalid fields rejected |
| `test-account-filtering.cjs` | Account filtering logic | ✅ Filter by criteria | ❌ Invalid filter params |
| `test-amount-search-scenarios.cjs` | Transaction amount search | ✅ Range queries | ❌ Invalid amounts |
| `test-search-tools-direct.cjs` | ActualQL search tools | ✅ Query execution | ❌ Malformed queries |
| `e2e-smoke.test.ts` | Basic E2E flow | ✅ Initialize → Call tool | ❌ Connection failures |
| `librechat-probe.test.ts` | LibreChat compatibility | ✅ Tool loading | ❌ Schema incompatibility |
| `mcp-http.test.ts` | HTTP transport | ✅ Request/response | ❌ Malformed JSON-RPC |
| `mock-actual-server.ts` | Mock server setup | ✅ Mock responses | ❌ N/A |

**Success Criteria:**
- Multi-tool workflows complete successfully
- Session IDs persist across calls
- Connection pool manages sessions correctly

**Error Scenarios Tested:**
- ❌ Session timeout handling
- ❌ Connection pool exhaustion
- ❌ Actual Budget server unavailable
- ❌ Network timeout errors
- ❌ Invalid session IDs
- ❌ Concurrent request conflicts

---

### Level 4: Protocol E2E Tests ⚡ (Fast: ~10s)

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
| List Tools | ✅ Returns 51 tools | ❌ Timeout |
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

### Level 5: Full Docker E2E Tests 🐳 (Thorough: ~60s)

**Purpose:** Test complete production deployment  
**Location:** `tests/e2e/docker.e2e.spec.ts`  
**Command:** `npm run test:e2e:docker`

**Coverage:**
- ✅ Docker build correctness
- ✅ Container networking
- ✅ Real Actual Budget integration
- ✅ All 51 tools execution
- ✅ Session management
- ✅ Error handling

**Test Scenarios (11 tests):**

| # | Test Name | Success Scenario | Error Scenarios |
|---|-----------|-----------------|-----------------|
| 1 | Initialize MCP session | ✅ Session created | ❌ Auth failure, timeout |
| 2 | Verify services healthy | ✅ Status: ok | ❌ Not initialized, Actual unreachable |
| 3 | List all tools | ✅ 51 tools returned | ❌ Timeout, server error |
| 4 | Execute actual_server_info | ✅ Server version returned | ❌ Connection refused |
| 5 | List accounts | ✅ Account array returned | ❌ Database error |
| 6 | Create test account | ✅ Account ID returned | ❌ Duplicate name, validation error |
| 7 | Verify session persistence | ✅ 3 consecutive calls work | ❌ Session timeout |
| 8 | SSE endpoint | ⏭️ SKIPPED (HTTP mode) | ❌ (N/A) |
| 9 | Docker build verification | ✅ All files present | ❌ Missing dependencies |
| 10 | Handle invalid tool name | ✅ Error: Tool not found | ❌ Unexpected behavior |
| 11 | Handle invalid arguments | ✅ Validation error returned | ❌ Server crash |

**Success Criteria:**
- All tool executions complete
- Docker containers healthy
- No data corruption
- Clean shutdown

**Error Scenarios Tested:**
- ❌ Invalid tool name (Tool not found)
- ❌ Missing required arguments (Validation error)
- ❌ Invalid argument types (Type mismatch)
- ❌ Server not initialized (Health check fails)
- ❌ Connection timeout (Network error)
- ❌ Database corruption (Graceful degradation)

---

### Level 6: Manual Integration Tests 🧪 (Comprehensive: ~60s)

**Purpose:** Test all 51 tools with real Actual Budget data  
**Location:** `tests/manual/actual-mcp-integration-test.js`  
**Command:** `node tests/manual/actual-mcp-integration-test.js http://localhost:3600/http TOKEN full`

**Test Levels:**

#### SMOKE Level (3 tools)
- ✅ Initialize session
- ✅ List tools (51 expected)
- ✅ List accounts

**Error Scenarios:**
- ❌ No auth token provided
- ❌ Invalid MCP URL
- ❌ Server not running

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
- All 51 tools execute successfully
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
node tests/manual/actual-mcp-integration-test.js \
  http://localhost:3600/http TOKEN full yes
```

---

### Test Coverage Goals

| Test Level | Current Coverage | Target Coverage | Priority |
|------------|-----------------|-----------------|----------|
| **Level 1:** Adapter Smoke | 100% (51/51 tools) | 100% | ✅ Maintain |
| **Level 2:** Unit Tests | ~80% | 90% | 🔴 High |
| **Level 3:** Integration | ~30% | 70% | 🟡 Medium |
| **Level 4:** Protocol E2E | 100% (MCP compliance) | 100% | ✅ Maintain |
| **Level 5:** Docker E2E | 100% (11/11 tests) | 100% | ✅ Maintain |
| **Level 6:** Manual Full | 100% (51/51 tools) | 100% | ✅ Maintain |
| **Error Scenarios** | ~60% | 90% | 🔴 High |

---

### Next Testing Improvements

**High Priority:**
1. ✅ **Completed:** Docker E2E tests (11 tests, 10 passing, 1 skipped)
2. ⏳ **TODO:** Add unit tests for remaining tools (18/51 covered)
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
- [Refactoring Plan](./REFACTORING_PLAN.md) - Test improvement tasks
- [Architecture](./ARCHITECTURE.md) - System design and components
- [Security & Privacy](./SECURITY_AND_PRIVACY.md) - Security testing policies
- [Docker E2E Testing](./DOCKER_E2E_TESTING.md) - Complete Docker E2E test documentation
- [Regression Testing](./REGRESSION_TESTING.md) - Fixed tools regression tests
- [Manual Test Coverage](../tests/manual/TEST_COVERAGE.md) - Manual integration test details

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
