# E2E Test Suite

Playwright-based end-to-end tests for the Actual Budget MCP server. Tests
communicate with a live MCP server over HTTP JSON-RPC directly — no browser
automation, no mocking. Results are reported by Playwright's test runner.

---

## Directory Layout

```
tests/e2e/
├── README.md                          ← this file
├── run-docker-e2e.sh                  ← Docker orchestrator: bootstrap 4-container stack,
│                                         run Playwright inside Docker network, then tear down
├── mcp-client.playwright.spec.ts      ← Protocol compliance: initialize → tools/list →
│                                         tools/call → SSE streaming; spawns its own server
│                                         process (or reuses Docker via USE_DOCKER_MCP_SERVER)
├── docker.e2e.spec.ts                 ← Smoke + health checks against Docker stack
├── docker-all-tools.e2e.spec.ts      ← Comprehensive coverage of all 62 tools (~80 named tests)
└── suites/                            ← Domain suite files (registration functions)
    ├── shared-context.ts              ← SharedState / TestContext types + createSharedState()
    ├── server.ts                      ← server_info, server_get_version, session_*
    ├── accounts.ts                    ← accounts_* (7 tools)
    ├── categories.ts                  ← category_groups_* + categories_* (8 tools)
    ├── payees.ts                      ← payees_* + payee_rules_* (6 tools)
    ├── transactions.ts                ← transactions_* (13 tools)
    ├── budgets.ts                     ← budgets_* + budget_updates_batch (11 tools)
    ├── rules.ts                       ← rules_* (4 tools)
    ├── schedules.ts                   ← schedules_* (4 tools)
    ├── advanced.ts                    ← bank_sync, query_run, get_id_by_name
    └── deletes.ts                     ← all delete operations (ordered by dependency)
```

Also see:
- `tests/shared/e2e-helpers.ts` — shared HTTP/MCP helpers (`waitForMCPHealth`, `retryRequest`,
  `callTool`, `extractResult`) imported by all spec files. Canonical source for `extractResult`.
- `tests/shared/mcp-protocol.js` — JS mirror of `extractResult` for plain-JS manual test suites.

---

## How to Run

### Recommended: full Docker stack (CI-equivalent)

```bash
# Bootstrap Docker stack, run all tests, tear down
npm run test:e2e:docker:full        # ~80 tests, ~2 minutes

# Smoke only (faster)
npm run test:e2e:docker:smoke       # ~11 tests, ~20 seconds

# Leave containers running for debugging
./tests/e2e/run-docker-e2e.sh full --no-cleanup
```

> **Do not use `npm run test:e2e` unless the Docker stack is already running.**
> That command runs Playwright directly from the host and expects Docker-internal
> hostnames (`mcp-server-test:3600`) to resolve — they won't from the host.

### Config files

| Context | Config file |
|---------|------------|
| Inside Docker network (CI) | `playwright.config.docker.ts` |
| Host machine (rare, manual) | `playwright.config.ts` |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_SERVER_URL` | `http://mcp-server-test:3600` | MCP server URL |
| `EXPECTED_TOOL_COUNT` | `62` | Expected tool count (must match `actualToolsManager.ts`) |
| `USE_DOCKER_MCP_SERVER` | `true` | Set to `false` to spawn a local server (mcp-client spec only) |

---

## Spec Files

### `mcp-client.playwright.spec.ts` (343 lines)

**Purpose:** MCP protocol compliance — verifying JSON-RPC envelope shapes, SSE
streaming, and session lifecycle.

- Can spawn its own server process or reuse Docker (controlled by `USE_DOCKER_MCP_SERVER`)
- Read-only; no budget mutations
- Tests: `initialize` handshake, `tools/list` shape, `tools/call` round-trip, streaming

### `docker.e2e.spec.ts` (452 lines)

**Purpose:** Smoke + integration checks against the production Docker stack.

- Reads `MCP_SERVER_URL` from environment — does not spawn a server
- Tests: `/health` endpoint, tool count, a handful of CRUD operations
- Verifies the Docker image works end-to-end with a real Actual Budget connection

### `docker-all-tools.e2e.spec.ts` (~1430 lines)

**Purpose:** Comprehensive named tests for all 62 tools — success paths + error/negative paths.

- All tests share a single MCP session (`sessionId`) initialized in `beforeAll`
- Tests run sequentially within a `test.describe` block; each **create** test stores
  an ID in `testContext`, which later **update**, **delete**, and **list-absence** tests consume
- `DELETE OPERATIONS` section: 6 named delete tests that both verify correctness and
  clean up test data
- `afterAll` is **fallback cleanup only** — it fires only if a delete test was skipped or failed
- Domain suite files in `suites/` contain the same tests broken into registration functions
  for incremental adoption; currently the spec runs tests inline for simplicity and proven stability

---

## Shared Helpers

All helpers are defined once in `tests/shared/e2e-helpers.ts` and imported by every spec file.

| Helper | Purpose | Exported from |
|--------|---------|---------------|
| `waitForMCPHealth(request, url, maxRetries?)` | Poll `/health` until `status: ok` | `e2e-helpers.ts` |
| `retryRequest<T>(requestFn, maxRetries?, delayMs?)` | Exponential-backoff HTTP retry | `e2e-helpers.ts` |
| `callTool(request, sessionId, toolName, args?)` | Send `tools/call` JSON-RPC, assert ok | `e2e-helpers.ts` |
| `extractResult(mcpResponse)` | Parse MCP content envelope → typed value | `e2e-helpers.ts` |
| `DEFAULT_MCP_SERVER_URL` | Reads `process.env.MCP_SERVER_URL` | `e2e-helpers.ts` |
| `HTTP_PATH` | `/http` — MCP HTTP transport mount point | `e2e-helpers.ts` |

The TypeScript `extractResult` is canonical. The JS edition in `tests/shared/mcp-protocol.js`
mirrors this logic for plain-JS callers in `tests/manual/`. If the MCP envelope changes, update both.

---

## Test Data

Entities created by E2E tests are ephemeral and cleaned up by named delete tests.
The `testContext` object in `docker-all-tools.e2e.spec.ts` accumulates IDs:

```
testContext shape:
  accountId        ← written by actual_accounts_create
  accountName      ← written by actual_accounts_create
  categoryGroupId  ← written by actual_category_groups_create
  categoryId       ← written by actual_categories_create
  payeeId          ← written by actual_payees_create
  payeeId2         ← written by actual_payees_create (second payee; cleared after merge test)
  transactionId    ← written by actual_transactions_create (may be unavailable in CI budget)
  ruleId           ← written by actual_rules_create
  ruleWithoutOpId  ← written by actual_rules_create (no-op variant)
  rulesUpsertId    ← written by actual_rules_create_or_update (idempotency test)
  scheduleOneOffId ← written by actual_schedules_create (one-off variant)
  scheduleRecurId  ← reserved for recurring schedule (populated in suites/schedules.ts)
```

---

## Technical Guidelines

These rules apply to everyone adding or modifying tests in this directory.

### File size

- **Soft target: 500 lines per spec file.** Files over 700 lines **must** be evaluated for a
  domain split.
- `docker-all-tools.e2e.spec.ts` is currently above this limit and is explicitly tracked for
  refactoring. Do not use it as a size reference for new files.

### Environment variables

- Always read the server URL from `process.env.MCP_SERVER_URL` — **never hardcode** a hostname
  or port.
- Update `EXPECTED_TOOL_COUNT` in every spec that asserts tool count whenever a tool is added
  or removed.

### Session management

- Tests in `docker-all-tools.e2e.spec.ts` share a single `sessionId` from `beforeAll`. Do not
  create a new session inside an individual test.
- Session lifecycle tests belong in `mcp-client.playwright.spec.ts`.

### Retry behaviour

- Do not add manual retry loops inside tests — Playwright's `retries: 2` (configured in both
  `playwright.config.ts` and `playwright.config.docker.ts`) handles transient flakiness.
- Use `retryRequest()` only for `fetch`/`request` calls, not for Playwright `test` assertions.

### Named assertions vs. `afterAll` cleanup

- Every tool that performs a mutation **must** have a corresponding named delete/revert test.
- `afterAll` is **fallback-only** — it verifies nothing. Don't rely on it as the primary cleanup.
- Delete tests must verify absence: call the list tool after deletion and assert the ID is gone.

### Error path coverage

- Each tool test should include at least one **negative test**: call the tool with a sentinel
  UUID (`00000000-0000-0000-0000-000000000000`) and assert an error response.
- Negative tests use `try/catch` and log `console.log('✓ Error correctly returned...')`.
- Do not use `expect().toThrow()` for MCP tool calls — the tool call itself succeeds (HTTP 200);
  the error is in the JSON-RPC response body.

### Adding a new tool test

1. Find or create the correct domain section in `docker-all-tools.e2e.spec.ts` (ordered by
   domain, alphabetical within domain). Add the same test to the corresponding suite file
   under `tests/e2e/suites/` for future reference.
2. Add a named `test(...)` for the happy path, including read-back of the created/updated value.
3. Add a named `test(...)` for the negative path (sentinel UUID or missing required field).
4. If the tool creates an entity: store the returned ID in `testContext`, add a corresponding
   delete test in the `DELETE OPERATIONS` section with a list-absence assertion.
5. Update `EXPECTED_TOOL_COUNT` in every spec that checks tool count if you added a new tool.

### Do not

- Use `page.*` or any browser API — this is HTTP JSON-RPC only.
- Add `baseURL` interaction patterns — specs call `MCP_SERVER_URL` directly.
- Hardcode credentials, server hostnames, or port numbers.
- Skip the negative test for any tool that accepts a UUID parameter.
- Define helpers locally in spec or suite files — always import from `tests/shared/e2e-helpers.ts`.

---

## Known Limitations

| Limitation | Detail |
|------------|--------|
| 4 skipped transaction tests | `actual_transactions_get/update/update_batch/delete` depend on `testContext.transactionId` which `actual_transactions_create` can't capture in the CI test budget (budget returns "ID not available"). Pre-existing; not a regression. |
| `budgets_list_available` / `budgets_switch` excluded | Single-budget CI environment — these tools are covered only in the live manual integration suite. |
