# Testing & Reliability

**Project:** Actual MCP Server  
**Version:** 0.1.0  
**Purpose:** Define testing philosophy, frameworks, and enforcement policies  
**Last Updated:** 2025-11-11

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
test/
├── unit/                    # Unit tests (fast, isolated)
│   └── transactions_create.test.js
├── integration/             # Integration tests (real dependencies)
│   └── (planned)
├── e2e/                     # End-to-end tests (full stack)
│   └── (Playwright tests)
└── docker-actual-test/      # Docker environment tests
```

---

## 🏃 Running Tests

**⚠️ NOTE:** Test infrastructure is currently being consolidated. A unified `npm test` command is planned but not yet implemented. Use individual test commands below.

### Quick Test Suite (Pre-Commit)

```bash
# Essential tests before commit
npm run build                # TypeScript compilation & type checking
npm run test:adapter         # Adapter smoke tests (30s)
npm audit --audit-level=moderate  # Security check
```

### Full Test Suite (Manual Execution)

```bash
# Complete test suite - must run individually
npm run build                # Build TypeScript
npm run test:adapter         # Adapter tests
npm run test:unit-js         # Individual unit test (transactions_create)
npm run test:e2e             # End-to-end tests (Playwright)
npm audit                    # Full security audit

# Note: More comprehensive test runner coming soon
```

### Individual Test Commands

```bash
# TypeScript compilation (includes type checking)
npm run build

# Adapter smoke tests
npm run test:adapter

# Unit tests
npm run test:unit-js

# End-to-end tests
npm run test:e2e

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
- All 49 tools can be called
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
- LibreChat loads all 49 tools
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

**Purpose**: Smoke test all 49 tools

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

## 🔗 Related Documentation

- [AI Interaction Guide](./AI_INTERACTION_GUIDE.md) - Testing enforcement rules
- [Refactoring Plan](./REFACTORING_PLAN.md) - Test improvement tasks
- [Architecture](./ARCHITECTURE.md) - System design and components
- [Security & Privacy](./SECURITY_AND_PRIVACY.md) - Security testing policies

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
