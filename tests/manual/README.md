# Manual Integration Tests

These are **heavy integration tests** that require Docker and external services.
They are **NOT run in CI** due to their resource requirements and complexity.

## Tests in This Directory

### Docker Actual Budget Tests
- `docker-actual-test.sh` - Full Actual Budget server integration test
- `docker-actual-automated.sh` - Automated Docker test with fake data
- `docker-actual-verify.sh` - Verify Docker Actual setup
- `docker-actual-test/` - Docker test infrastructure
- `docker-actual-README.md` - Documentation for Docker tests

### LibreChat Integration Tests
- `run-librechat-docker-test.sh` - Full LibreChat Docker integration
- `librechat-docker-compose.yml` - Docker Compose for LibreChat
- `librechat-docker.test.ts` - LibreChat Docker test suite
- `librechat-config.yaml` - LibreChat configuration

### Full Stack Tests
- `e2e-full-stack.sh` - Complete end-to-end integration test
- `integration-verify.sh` - Integration verification script

## When to Run These Tests

**Run manually when:**
- Testing integration with real Actual Budget server
- Testing LibreChat integration end-to-end
- Validating production-like environment
- Debugging complex integration issues

**Prerequisites:**
- Docker and docker-compose installed
- Available ports (5006, 5007, 3000, etc.)
- Sufficient disk space and memory
- Network connectivity

## Running Manual Tests

```bash
# Actual Budget integration test
cd test/manual
./docker-actual-test.sh

# LibreChat integration test
./run-librechat-docker-test.sh

# Full stack test
./e2e-full-stack.sh
```

## CI Tests (Automated)

For fast CI tests, see:
- `tests/mcp-client.playwright.spec.ts` - MCP protocol tests (Playwright)
- `tests/unit/*` - Unit tests for tools
- `test/integration/mcp-http.test.ts` - HTTP endpoint tests

These run automatically on every push/PR and don't require Docker.
