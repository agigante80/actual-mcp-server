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
├── mcp-client.playwright.spec.ts      ← MANUAL (#384, CI does not run it). Protocol:
│                                         initialize → tools/list →
│                                         tools/call → SSE streaming; spawns its own server
│                                         process (or reuses Docker via USE_DOCKER_MCP_SERVER)
├── docker.e2e.spec.ts                 ← MANUAL (#384, CI does not run it). Smoke checks
├── fixtures.ts                        ← Playwright fixtures: the `mcp` client plus the
│                                         make* factories that provision and tear down test
│                                         data. Import `test` from HERE, not @playwright/test
├── tsconfig.json                      ← typecheck project for this dir (npm run typecheck:e2e)
└── docker-all-tools.e2e.spec.ts      ← Comprehensive coverage of all 76 tools; the ONLY
                                        file that carries E2E assertions (see the #366 note)
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
| `EXPECTED_TOOL_COUNT` | `76` | Expected tool count (must match `actualToolsManager.ts`) |
| `USE_DOCKER_MCP_SERVER` | `true` | Set to `false` to spawn a local server (mcp-client spec only) |

---

## Spec Files

### What CI actually runs (#384, #383)

**Only `docker-all-tools.e2e.spec.ts`, and since #383 it runs TWICE**: once over HTTP inside the
runner container, then once over stdio from the HOST (`run-docker-e2e.sh` step 6b, reaching the
server by `docker exec`, because the runner container has no route to a stdio server). Four tests
are HTTP-only, each saying why at the test, so the stdio project skips exactly those four and
otherwise matches HTTP (read the totals from `npx playwright test --list`, do not pin them; they are
currently 105 collected, so 101 pass plus 4 skip over stdio). The two legs run in SEPARATE processes,
so the module-scoped pacer does not span them; the 75s cool-down in `run-docker-e2e.sh`
(`STDIO_COOLDOWN_S`) drains Actual's rate-limit window between them, and #419 (v0.16.13) is what
keeps each leg under the ceiling by logging a stdio process in once rather than per call.

The stdio leg is OPT-IN and OFF in CI until #423: step 6b runs only when `RUN_STDIO_E2E=true`, which
CI does not set. Two blockers are tracked in #423: a strict-Playwright startup error (the HTML report
nests inside `test-results`) and a rate-limit tail on the write-heavy block (a throttled `api.sync()`
closes the budget, forcing a re-download + re-login). Run it locally with `RUN_STDIO_E2E=true`
(ADVISORY unless `STDIO_E2E_GATING=true`); #423 fixes both, enables it in CI, and makes it gating.

Both workflows invoke `npm run test:e2e:docker:full`,
which selects the `docker-e2e-full` project, which collects that one file. Every other spec in this
directory is a MANUAL diagnostic, and that is a decision rather than an oversight.

That distinction matters because this repository has twice shipped tests that never ran (#366 and
#382), and the guard added after the second one asserted only that a spec was COLLECTED. Collected
is not run: `mcp-protocol-tests` and `docker-e2e-smoke` are both real projects that CI never
selects. `tests/unit/e2e_spec_collection.test.js` now follows the whole chain (workflow, then
`run-docker-e2e.sh`, then project, then `testMatch`) and fails on a spec that is collected but run
by no CI project, unless that spec is listed in its `DECLARED_MANUAL` map with a reason. So the
table below is enforced, not merely documented.

| Spec | Runs in CI? | Why |
|---|---|---|
| `docker-all-tools.e2e.spec.ts` | **yes, TWICE** | the gate, over HTTP (`docker-e2e-full`) and then stdio (`docker-e2e-full-stdio`, #383) |
| `mcp-client.playwright.spec.ts` | no, manual | round trip duplicated by docker-all-tools, session shim covered by `tests/unit/httpServer_session_not_found.test.js`; only the SSE connect is unique |
| `docker.e2e.spec.ts` | no, manual | the smoke level, for fast local feedback; its assertions are a subset of docker-all-tools |

### `mcp-client.playwright.spec.ts` (343 lines), MANUAL and not a gate

**Purpose:** MCP protocol compliance — verifying JSON-RPC envelope shapes, SSE
streaming, and session lifecycle.

- Can spawn its own server process or reuse Docker (controlled by `USE_DOCKER_MCP_SERVER`)
- Read-only; no budget mutations
- Tests: `initialize` handshake, `tools/list` shape, `tools/call` round-trip, streaming

### `docker.e2e.spec.ts` (452 lines), MANUAL and not a gate

**Purpose:** Smoke + integration checks against the production Docker stack.

- Reads `MCP_SERVER_URL` from environment — does not spawn a server
- Tests: `/health` endpoint, tool count, a handful of CRUD operations
- Verifies the Docker image works end-to-end with a real Actual Budget connection

### `docker-all-tools.e2e.spec.ts`

**Purpose:** Comprehensive named tests for all 76 tools: success paths plus error and negative paths.

- Every test is **self-provisioning** (#375): it asks `fixtures.ts` for what it needs, and
  everything it creates is removed in fixture teardown, which runs even when the test fails
- Any single test can be run alone. `npx playwright test --config playwright.config.docker.ts
  --grep 'actual_accounts_get_balance'` passes rather than skipping
- Tests share one MCP session per worker (cached in `fixtures.ts`), but no test depends on
  DATA another test created. The file documents its one exception: the export/import round
  trip changes the session's ACTIVE BUDGET, so it runs last and registers its switch-back as
  teardown
- `DELETE OPERATIONS` section: 6 named delete tests, each of which creates the object it
  deletes and then asserts its absence from the corresponding list
- There is no `afterAll`. It was fallback cleanup for the shared-context design, and the
  fixtures replaced it
- **#366:** `suites/` used to hold the same tests split into per-domain registration
  functions, extracted in 2026-03 "for incremental adoption". The adoption never happened:
  nothing ever imported `register*Tests` and no Playwright `testMatch` covered the
  directory, so none of it ever executed. Meanwhile CLAUDE.md, the tool checklist, the issue
  templates and two agent definitions all started naming it as the place to add E2E
  coverage, so tests written there were silently inert. The directory was removed and every
  pointer now names this spec. Add E2E coverage here, and confirm it is collected with
  `npx playwright test --list --config playwright.config.docker.ts`.

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

## Test Data (the fixtures)

Entities are created per test and removed in teardown. Ask for the factory you need:

```ts
import { test, expect, today, currentMonth, uniqueSuffix, CLEANUP_ORDER } from './fixtures.js';

test('actual_something - does the thing', async ({ mcp, makeAccount, makeCategory }) => {
  const account = await makeAccount();          // removed in teardown
  const category = await makeCategory();        // creates its own group too, both removed
  ...
});
```

| Fixture | Gives you | Notes |
|---------|-----------|-------|
| `mcp` | `call` (unwrapped result), `raw` (full envelope), `post` (arbitrary JSON-RPC) | `call` throws on a tool error, so negative tests use `rejects.toThrow` |
| `makeAccount({ name?, balance?, seedTransaction? })` | `{ id, name }` | Pass `seedTransaction: true` for any test that CLOSES the account: Actual deletes a zero-transaction account on close instead of closing it |
| `makeCategoryGroup({ name? })` | `{ id, name }` | |
| `makeCategory({ name?, group? })` | `{ id, name, groupId }` | Creates a group when none is passed |
| `makePayee({ name? })` | `{ id, name }` | |
| `makeTransaction({ account, amount?, date?, notes?, payee?, category? })` | `{ id, accountId, notes }` | |
| `makeRule({ categoryId, marker?, withoutOp? })` | `{ id }` | |
| `makeSchedule({ name?, date?, amount? })` | `{ id, name }` | |
| `cleanup` | `add(priority, label, fn)` | For anything no factory owns (a tag, a note). Use a `CLEANUP_ORDER` constant, never a bare number |

Deletes have a required order, so all factories share ONE registry sorted by `CLEANUP_ORDER`
(`note`, `transaction`, `tag`, `rule`, `schedule`, `payee`, `category`, `categoryGroup`,
`account`, then `activeBudget` last). Playwright's own teardown order follows the order the
TEST declared its fixtures, which is not the order referential integrity needs. That is why
the registry exists.

Every cleanup step swallows its own error: a delete test removes its object, and the matching
teardown step then correctly finds nothing to do.

---

## Technical Guidelines

These rules apply to everyone adding or modifying tests in this directory.

### File size

- **Soft target: 500 lines per spec file.** Files over 700 lines **must** be evaluated for a
  domain split.
- `docker-all-tools.e2e.spec.ts` is above this limit. #366 rejected a per-domain split
  (`suites/` was exactly that, and it never executed), and #375 removed the shared context
  that made the size dangerous, so the file is long but no longer coupled. Do not use it as a
  size reference for new files.

### Environment variables

- Always read the server URL from `process.env.MCP_SERVER_URL` — **never hardcode** a hostname
  or port.
- Update `EXPECTED_TOOL_COUNT` in every spec that asserts tool count whenever a tool is added
  or removed.

### Session management

- The `mcp` fixture caches one session per worker process. Do not create a session inside a
  test; ask for `mcp`.
- A session is not data a test can corrupt, which is why it is shared. DATA is not shared:
  provision it with a factory.
- Session lifecycle tests belong in `mcp-client.playwright.spec.ts`.

### Retry behaviour

- Do not add manual retry loops inside tests — Playwright's `retries: 2` (configured in both
  `playwright.config.ts` and `playwright.config.docker.ts`) handles transient flakiness.
- Use `retryRequest()` only for `fetch`/`request` calls, not for Playwright `test` assertions.

### Cleanup and read-back

- Provision through a factory so teardown is automatic. For anything no factory owns, call
  `cleanup.add(...)` with a `CLEANUP_ORDER` priority, and register it BEFORE the work, so a
  failed assertion still tears down.
- Every tool that performs a mutation **must read the state back and assert it**. Calling a
  write tool and asserting only that it returned is the #350 failure mode: it passes whether
  or not the write had any effect.
- Delete tests must verify absence: call the list tool after deletion and assert the ID is gone.

### Error path coverage

- Each tool test should include at least one **negative test**: call the tool with a sentinel
  UUID (`00000000-0000-0000-0000-000000000000`) and assert an error response.
- Prefer `await expect(mcp.call(...)).rejects.toThrow(/pattern/i)`. The `mcp.call` helper
  throws on a JSON-RPC error, so this reads directly. The older rule here said not to use
  `toThrow` because the raw HTTP call returns 200 with the error in the body. That is true of
  `request.post`, not of `mcp.call`.
- Use `mcp.post(...)` when the test needs to inspect the raw JSON-RPC error envelope itself.

### Adding a new tool test

1. Find or create the correct domain section in `docker-all-tools.e2e.spec.ts`, which is the
   only E2E file Playwright collects (#366).
2. Add a named `test(...)` for the happy path. Destructure the fixtures it needs
   (`async ({ mcp, makeAccount }) => ...`) rather than reaching for anything file-scoped, and
   include a read-back of the created or updated value.
3. Add a named `test(...)` for the negative path (sentinel UUID or missing required field).
4. If the tool creates an entity no factory covers, either add a factory to `fixtures.ts` or
   register `cleanup.add(...)` in the test itself.
5. Confirm the test is collected AND runs alone:
   `npx playwright test --list --config playwright.config.docker.ts`, then the same command
   with `--grep 'your test name'`. A test that skips when run alone has a hidden dependency.
6. Run `npm run typecheck:e2e`. Playwright transpiles specs without typechecking them.

### Do not

- Use `page.*` or any browser API — this is HTTP JSON-RPC only.
- Add `baseURL` interaction patterns — specs call `MCP_SERVER_URL` directly.
- Hardcode credentials, server hostnames, or port numbers.
- Skip the negative test for any tool that accepts a UUID parameter.
- Define helpers locally in spec files. Import transport helpers from
  `tests/shared/e2e-helpers.ts` and fixtures from `tests/e2e/fixtures.ts`.
- Read an id out of a variable another test wrote. That is the coupling #375 removed; every
  test provisions its own.

---

## Known Limitations

| Limitation | Detail |
|------------|--------|
| ~~4 skipped transaction tests~~ | Fixed in #375. `makeTransaction` resolves the id by filtering the account when `transactions_create` returns "ID not available", so these four run rather than skipping. The suite reports 0 skips. |
| `budgets_list_available` / `budgets_switch` excluded | Single-budget CI environment — these tools are covered only in the live manual integration suite. |
