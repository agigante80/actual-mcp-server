# Integration Test Suite

Manual integration tests for the Actual Budget MCP server. Tests connect to a
**running** MCP server over HTTP and exercise the full JSON-RPC protocol — no
mocking. Results are printed to stdout.

---

## Directory Layout

```
tests/manual/
├── README.md                  ← this file
├── index.js                   ← entry point (7 lines)
├── runner.js                  ← orchestrator: CLI parsing, level dispatch,
│                                 end-of-test cleanup prompt, process.exit()
├── mcp-client.js              ← MCP transport: createClient(), session lifecycle,
│                                 AbortController timeout, auto-reconnect/retry
├── cleanup.js                 ← standalone cleanup: finds and removes all
│                                 MCP-Test-* / MCP-Cat-* / MCP-Group-* / MCP-Payee-*
│                                 / MCP-Rule-* data left by test runs
└── tests/
    ├── sanity.js              ← read-only protocol checks (tool count, server version, SQL, etc.)
    ├── smoke.js               ← sanity + account balances, categories, recent txns
    ├── account.js             ← account lifecycle: create → update → close → reopen
    ├── category-group.js      ← category group: create, update
    ├── category.js            ← category: create, update (requires categoryGroupId)
    ├── payee.js               ← payee: create, update, merge, payee rules
    ├── transaction.js         ← transaction: create, get, update, filter, import
    ├── budget.js              ← budget: amounts, carryover, hold, transfer, batch
    ├── rules.js               ← rules: create (with/without op), update
    ├── schedule.js            ← schedules: get, create (one-off + recurring), update, delete, negative UUID test
    └── advanced.js            ← composite functions: extendedTests, fullTests,
                                  advancedTests (bank sync, raw SQL)
```

---

## Test Levels

| Level | Writes? | What runs |
|---|---|---|
| `sanity` | No | Protocol checks: tool count, server info, Actual Budget server version, SQL validation, GraphQL rejection |
| `smoke` | No | Sanity + account balances, category/group listing, last 3 transactions |
| `normal` | Yes | Smoke + full account lifecycle (create → update → close → reopen) |
| `extended` | Yes | Normal + category groups, categories, payees, transactions |
| `full` | Yes | Extended + budgets, rules, advanced queries |
| `cleanup` | Yes | Standalone: finds and deletes all MCP-Test-* / MCP-Cat-* / MCP-Group-* / MCP-Payee-* / MCP-Rule-* data |

Tests cascade upward — `extended` always includes `normal` which includes `smoke`.

---

## Usage

### npm scripts (recommended)

```bash
npm run test:integration              # sanity (default)
npm run test:integration:sanity
npm run test:integration:smoke
npm run test:integration:normal
npm run test:integration:extended
npm run test:integration:full
npm run test:integration:cleanup
```

### Direct invocation

```bash
node tests/manual/index.js [MCP_URL] [TOKEN] [LEVEL] [CLEANUP]
```

| Argument | Default | Description |
|---|---|---|
| `MCP_URL` | `http://localhost:3601/http` | MCP server URL — bearer instance (port 3601) |
| `TOKEN` | `MCP-BEARER-LOCAL-a9f3k2p8q7x1m4n6` | Bearer token (without the `Bearer ` prefix) |
| `LEVEL` | *(prompt)* | `sanity` \| `smoke` \| `normal` \| `extended` \| `full` \| `cleanup` |
| `CLEANUP` | *(10s prompt)* | `yes`/`y` auto-delete · `no`/`n` preserve · omit for interactive |

> **Two MCP instances are running:**
> - Port **3600** `actual-mcp-server-backend` — OIDC/Casdoor auth (for LibreChat/LobeChat human users)
> - Port **3601** `actual-mcp-bearer-backend` — static bearer auth ← **default for automated tests**

### Environment variables

| Variable | Description |
|---|---|
| `MCP_SERVER_URL` | MCP server URL |
| `MCP_AUTH_TOKEN` | Bearer token |
| `MCP_TEST_LEVEL` | Test level |
| `ACTUAL_SERVER_URL` | Shown in cleanup prompt (default `http://localhost:5006`) |
| `EXPECTED_TOOL_COUNT` | Expected registered tool count (default `60`) |

Variables are loaded from the project root `.env` automatically.

### Examples

```bash
# Quickest — sanity only, no writes (bearer instance, default)
BEARER="MCP-BEARER-LOCAL-a9f3k2p8q7x1m4n6"
node tests/manual/index.js http://localhost:3601/http "$BEARER" sanity

# Extended CRUD, preserve data for inspection afterwards
node tests/manual/index.js http://localhost:3601/http "$BEARER" extended no

# Full test run, auto-delete on completion
node tests/manual/index.js http://localhost:3601/http "$BEARER" full yes

# Clean up leftover test data from interrupted runs
node tests/manual/index.js http://localhost:3601/http "$BEARER" cleanup

# Or rely on runner.js defaults (no args needed when running locally)
node tests/manual/index.js
```

---

## Test Data Naming

All entities created by tests use timestamped names so they can be identified and
cleaned up safely even after a partial or failed run.

| Entity | Name pattern |
|---|---|
| Account | `MCP-Test-{ISO-timestamp}` |
| Category group | `MCP-Group-{ISO-timestamp}` |
| Category | `MCP-Cat-{ISO-timestamp}` |
| Payee | `MCP-Payee-{ISO-timestamp}` |
| Rule condition value | `MCP-Rule-{description}` |
| Transaction notes | `MCP-Transaction-{ISO-timestamp}` |

The `cleanup` level matches on these prefixes and is safe to run repeatedly.

---

## Architecture

### Client object

`mcp-client.js` exports `createClient({ url, rl })`. It returns a plain object:

```js
const client = createClient({ url: MCP_URL, rl });
client.setToken('Bearer abc123');
await client.initialize();
const accounts = await client.callTool('actual_accounts_list', {});
```

The client owns all transport state (`sessionId`, `requestId`) as closure variables.
It handles:
- 30-second `AbortController` timeout on every request
- Auto-reconnect on session expiry, socket hang up, or timeout

### Context object

Test functions pass a shared mutable `context` object to accumulate IDs created
during a run. Each module documents which keys it reads and writes.

```
context shape:
  accountId        ← written by account.js
  accountName      ← written by account.js
  categoryGroupId  ← written by category-group.js
  categoryId       ← written by category.js
  payeeId          ← written by payee.js
  payeeId2         ← written by payee.js (null'd after merge)
  transactionId    ← written by transaction.js
  ruleId           ← written by rules.js
  ruleWithoutOpId  ← written by rules.js
```

Each test module gracefully skips if a required context key is missing, so test
levels compose without errors even when earlier modules were skipped.

---

## Technical Guidelines

These rules apply to everyone adding or modifying tests in this directory.

### File size
- **Hard limit: 400 lines per file.** Files approaching 300 lines should be
  evaluated for a split before they reach 400.
- **Max 8 exported functions per file.** One clear responsibility per module.

### Module structure
- Each test file exports exactly one primary function: `fooTests(client, context)`.
- Composite functions (`extendedTests`, `fullTests`) live in `advanced.js`.
- Cleanup logic lives exclusively in `cleanup.js` — never inline it inside test modules.
- `index.js` must remain a thin entry point (imports + one `run()` call).
- Only `runner.js` may call `process.exit()`.

### Client usage
- Always use `client.callTool(name, args)` — never call `fetch()` directly.
- Use `client.callMCP(method, params, maxRetries)` when you need to control retry
  behaviour (e.g. bank sync, which passes `maxRetries=1` to avoid an infinite
  reconnect loop on `ECONNRESET`).
- Never import `mcp-client.js` from inside `tests/*.js` — the client is injected
  by the caller. Test modules are pure functions of `(client, context)`.

### Naming conventions
- New test entities must follow the `MCP-{Type}-{timestamp}` prefix pattern so
  the cleanup level can find and delete them.
- Timestamps are generated **inside** the function that creates the entity —
  never passed in from outside.
- Tool names follow the `actual_{domain}_{action}` convention of the MCP server.

### Error handling
- Use `try/catch` around regression tests and known-failing checks; log `✓`, `❌`,
  or `⚠` but don't rethrow unless the failure is fatal.
- Fatal errors (unexpected throws outside regression blocks) should propagate to
  `runner.js` where they are caught and printed before `process.exit(1)`.
- Never swallow errors silently — always log them.

### Read-back verification
- After every create or update operation, re-fetch the entity and assert the
  expected field value. Log `✓ Verify {action}: field=value` or `❌ Verify {action}: ...`.

### Adding a new test module
1. Create `tests/manual/tests/my-domain.js` following the pattern of existing modules.
2. Export `async function myDomainTests(client, context)`.
3. Add it to the appropriate composite (`extendedTests` or `fullTests`) in `advanced.js`.
4. If it creates named entities, add the prefix to `cleanup.js`.
5. Document context keys read/written at the top of the file.
6. Keep the file under 400 lines.

### Do not
- Add a test framework (Jest, Mocha, etc.) — the printf-style output is intentional
  and maps cleanly to CI logs.
- Add shared mutable state between modules outside of the `context` object.
- Use `console.log` at module scope — only inside exported functions.
- Check in test data or credentials.
