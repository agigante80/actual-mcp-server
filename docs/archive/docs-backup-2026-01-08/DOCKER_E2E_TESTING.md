# Docker-Based E2E Testing

## Overview

This project includes two types of E2E tests:

1. **Protocol Tests** (`test:e2e`) - Fast, lightweight tests that verify MCP protocol compliance
2. **Docker Integration Tests** (`test:e2e:docker`) - Full-stack tests with real Actual Budget server

## Docker E2E Tests

### What They Test

The Docker E2E tests verify:
- ✅ Docker build works correctly
- ✅ Container networking (MCP ↔ Actual Budget)
- ✅ Real tool execution against actual Actual Budget server
- ✅ Session management and persistence
- ✅ Production-like deployment
- ✅ All 51 tools work end-to-end
- ✅ Error handling and validation

### Architecture

```
┌─────────────────────┐
│  e2e-test-runner    │ ← Playwright tests run here
│  (Node + Playwright)│
└──────────┬──────────┘
           │
           │ HTTP calls
           ↓
┌─────────────────────┐
│  mcp-server-test    │ ← Your MCP server (built from source)
│  (Docker build)     │
└──────────┬──────────┘
           │
           │ API calls
           ↓
┌─────────────────────┐
│ actual-budget-test  │ ← Real Actual Budget server
│ (actualbudget/      │
│  actual-server)     │
└─────────────────────┘
```

All services run in isolated Docker network (`e2e-test-network`).

## Quick Start

### Prerequisites

- Docker and Docker Compose installed
- ~2GB free disk space (for images and volumes)

### Running Tests

```bash
# Run full Docker E2E test suite
npm run test:e2e:docker

# Run all tests (adapter + unit + Docker E2E)
npm run test:all

# Run just protocol tests (fast, no Docker)
npm run test:e2e
```

### Advanced Usage

```bash
# Build image but don't run tests
./tests/e2e/run-docker-e2e.sh --build-only

# Run tests and leave containers running for debugging
./tests/e2e/run-docker-e2e.sh --no-cleanup

# Show detailed output
./tests/e2e/run-docker-e2e.sh --verbose
```

## Test Execution Flow

1. **Build** - Builds MCP server Docker image from current source
2. **Start Services** - Spins up Actual Budget + MCP server containers
3. **Wait for Health** - Polls health checks until services are ready
4. **Run Tests** - Executes Playwright tests against the stack
5. **Cleanup** - Tears down containers and volumes

Typical execution time: **60-90 seconds**

## Configuration

### Docker Compose File

`docker-compose.test.yaml` defines the test stack:

```yaml
services:
  actual-budget-test:   # Port 5007 (avoids conflicts)
  mcp-server-test:      # Port 3602 (built from source)
  e2e-test-runner:      # Playwright container
```

### Playwright Config

`playwright.config.docker.ts` configures Docker-specific tests:
- Longer timeouts (60s for Docker overhead)
- Traces captured on failure
- Tests only files matching `docker.e2e.spec.ts`

### Environment Variables

Test containers use these variables:

```bash
# MCP Server
ACTUAL_SERVER_URL=http://actual-budget-test:5006
ACTUAL_PASSWORD=test-e2e-password
ACTUAL_BUDGET_SYNC_ID=test-sync-id-e2e
MCP_BRIDGE_PORT=3600
LOG_LEVEL=info
NODE_ENV=test

# Test Runner
MCP_SERVER_URL=http://mcp-server-test:3600
ACTUAL_SERVER_URL=http://actual-budget-test:5006
CI=true
```

## Writing Docker E2E Tests

Tests are in `tests/e2e/docker.e2e.spec.ts`.

### Example Test

```typescript
test('should create account and verify', async ({ request }) => {
  // 1. Initialize session
  const initRes = await request.post(`${MCP_SERVER_URL}/http`, {
    data: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { /* ... */ }
    }),
    headers: { 'Content-Type': 'application/json' }
  });
  
  const sessionId = initRes.headers()['mcp-session-id'];
  
  // 2. Call tool
  const callRes = await request.post(`${MCP_SERVER_URL}/http`, {
    data: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'actual_accounts_create',
        arguments: { name: 'Test Account' }
      }
    }),
    headers: {
      'Content-Type': 'application/json',
      'mcp-session-id': sessionId
    }
  });
  
  // 3. Verify result
  const result = await callRes.json();
  expect(result.error).toBeUndefined();
  expect(result.result).toBeTruthy();
});
```

### Best Practices

1. **Use unique names** - Add timestamps to test data names to avoid conflicts
2. **Check for errors** - Always verify `callJson.error` is undefined
3. **Test real workflows** - Create → Read → Update → Delete sequences
4. **Verify data persistence** - Make multiple calls, check data survives
5. **Test error cases** - Invalid inputs, missing parameters, etc.

## Debugging Failed Tests

### Check Service Logs

```bash
# After test failure (with --no-cleanup)
docker-compose -f docker-compose.test.yaml logs mcp-server-test
docker-compose -f docker-compose.test.yaml logs actual-budget-test
```

### Access Services Directly

```bash
# While containers are running
curl http://localhost:3602/health
curl http://localhost:5007
```

### Inspect Containers

```bash
# Run with --no-cleanup flag
./tests/e2e/run-docker-e2e.sh --no-cleanup

# Then inspect
docker exec -it mcp-server-e2e-test sh
docker exec -it actual-budget-e2e-test sh

# View test results
docker cp e2e-test-runner:/workspace/test-results ./local-test-results
```

### Common Issues

**Issue**: "Services failed to become healthy"
- **Cause**: Port conflicts or insufficient resources
- **Fix**: Stop other instances, ensure Docker has 2GB+ memory

**Issue**: "Tool calls return authentication errors"
- **Cause**: Actual Budget not initialized
- **Fix**: Check Actual Budget logs, verify ACTUAL_BUDGET_SYNC_ID

**Issue**: "Tests timeout"
- **Cause**: Slow Docker on your machine
- **Fix**: Increase timeout in `playwright.config.docker.ts`

**Issue**: "Cannot connect to mcp-server-test"
- **Cause**: Build failed or port mapping wrong
- **Fix**: Run `--build-only` to check build, verify port 3602 is free

## CI/CD Integration

### GitHub Actions Example

```yaml
name: E2E Tests (Docker)

on: [push, pull_request]

jobs:
  e2e-docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run Docker E2E Tests
        run: npm run test:e2e:docker
      
      - name: Upload test results
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-docker-results
          path: test-results/
```

## Comparison: Protocol vs Docker E2E

| Aspect | Protocol Tests (`test:e2e`) | Docker Tests (`test:e2e:docker`) |
|--------|----------------------------|----------------------------------|
| **Speed** | ⚡ Fast (~10s) | 🐢 Slower (~60s) |
| **Scope** | MCP protocol only | Full stack integration |
| **Actual Budget** | ❌ Not required | ✅ Real server |
| **Tools tested** | Protocol structure | Full execution |
| **Best for** | Fast feedback, development | Pre-merge, production validation |
| **When to run** | Every commit | PRs, before releases |

## Maintenance

### Updating Actual Budget Version

Edit `docker-compose.test.yaml`:

```yaml
actual-budget-test:
  image: actualbudget/actual-server:24.12.0  # Update this version
```

### Adding New Test Scenarios

1. Add test to `tests/e2e/docker.e2e.spec.ts`
2. Use descriptive test names: `test('should handle X when Y')`
3. Include both success and error cases
4. Run locally: `npm run test:e2e:docker`

### Cleanup Old Test Data

```bash
# Remove all test volumes and containers
docker-compose -f docker-compose.test.yaml down -v --remove-orphans

# Remove dangling volumes
docker volume prune
```

## Performance Optimization

### Reduce Test Time

1. **Parallel tests** - Update `playwright.config.docker.ts` workers to 2-3
2. **Reuse sessions** - Initialize once in `beforeAll`, use in all tests
3. **Skip non-critical tests** - Use `.skip()` for slow tests during development
4. **Cache Docker layers** - Ensure Dockerfile uses layer caching effectively

### Resource Requirements

- **CPU**: 2+ cores recommended
- **Memory**: 2GB minimum, 4GB ideal
- **Disk**: 2GB for images + 500MB for test volumes

## Troubleshooting

### Reset Everything

```bash
# Nuclear option - removes all test resources
docker-compose -f docker-compose.test.yaml down -v --rmi all --remove-orphans
docker system prune -a -f --volumes
```

### Verify Docker Setup

```bash
# Check Docker is working
docker run hello-world

# Check Docker Compose version (need v2.0+)
docker-compose version

# Check available resources
docker system df
```

### Get Help

1. Check logs: `docker-compose -f docker-compose.test.yaml logs`
2. Review test output: `/tmp/e2e-docker-test-output.log`
3. Run with `--verbose` flag for detailed output
4. Check GitHub issues for similar problems

---

**Next Steps**:
1. Run your first Docker E2E test: `npm run test:e2e:docker`
2. Check test results in `test-results/docker-e2e-report/`
3. Add custom tests for your workflows in `docker.e2e.spec.ts`

**See Also**:
- [E2E Test Fix](./E2E_TEST_FIX.md) - Protocol test improvements
- [Testing and Reliability](./TESTING_AND_RELIABILITY.md) - Overall testing strategy
- [Architecture](./ARCHITECTURE.md) - System design and components
