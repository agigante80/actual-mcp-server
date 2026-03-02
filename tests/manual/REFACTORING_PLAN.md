# Integration Test Refactoring Plan

## Current State

`actual-mcp-integration-test.js` is a single monolithic file (~1 430 lines) containing:

| Section | Lines (approx.) | Description |
|---|---|---|
| Header comment | 60 | Usage docs, level descriptions |
| Imports / config | 25 | `fetch`, `readline`, `dotenv`, CLI arg parsing |
| MCP client | 80 | `callMCP`, `initialize`, `listTools`, `callTool`, session + retry logic |
| Test groups | 900 | 12 functions: `sanityTests` → `fullTests` |
| Cleanup | 130 | `cleanupMcpTestAccounts` |
| Main runner | 160 | `run()` — argument parsing, level dispatch, cleanup prompt |

---

## File Size Guidelines

| Metric | Limit | Rationale |
|---|---|---|
| Lines per file | **≤ 400** | Fits in one editor viewport with context |
| Functions per file | **≤ 8** | Each file has a single clear responsibility |
| Nesting depth | **≤ 3** | Avoid callback pyramids inside test helpers |
| Exported symbols | **≤ 10** | Keep module API surface small |

Files approaching 300 lines should be evaluated for a split before they reach 400.

---

## Target Directory Layout

```
tests/manual/
├── REFACTORING_PLAN.md          ← this file
├── index.js                     ← entry point (replaces current script)
├── runner.js                    ← main run() orchestrator, level dispatch, cleanup prompt
├── mcp-client.js                ← MCP JSON-RPC transport, session + retry/reconnect logic
├── tests/
│   ├── sanity.js                ← sanityTests()
│   ├── smoke.js                 ← smokeTests() (imports sanity)
│   ├── account.js               ← accountTests()
│   ├── category-group.js        ← categoryGroupTests()
│   ├── category.js              ← categoryTests()
│   ├── payee.js                 ← payeeTests()
│   ├── transaction.js           ← transactionTests()
│   ├── budget.js                ← budgetTests()
│   ├── rules.js                 ← rulesTests()
│   └── advanced.js              ← advancedTests(), extendedTests(), fullTests()
└── cleanup.js                   ← cleanupMcpTestAccounts()
```

---

## Module Responsibilities

### `mcp-client.js`
- Exports: `callMCP`, `callTool`, `initialize`, `listTools`, `getSessionId`
- Owns: `sessionId` state, `requestId` counter, AbortController timeout, all reconnect/retry logic
- Does **not** know about test levels or Actual Budget semantics
- Estimated size: **~100 lines**

### `tests/sanity.js`
- Exports: `sanityTests(client)`
- Receives a `client` object (the exports of `mcp-client.js`) rather than using globals
- Estimated size: **~80 lines**

### `tests/smoke.js`
- Exports: `smokeTests(client)`
- Imports and calls `sanityTests` internally
- Estimated size: **~60 lines**

### `tests/account.js`
- Exports: `accountTests(client, context)`
- Populates `context.accountId`, `context.accountName`
- Estimated size: **~130 lines**

### `tests/category-group.js`
- Exports: `categoryGroupTests(client, context)`
- Populates `context.categoryGroupId`
- Estimated size: **~60 lines**

### `tests/category.js`
- Exports: `categoryTests(client, context)`
- Populates `context.categoryId`
- Estimated size: **~70 lines**

### `tests/payee.js`
- Exports: `payeeTests(client, context)`
- Populates `context.payeeId`, `context.payeeId2`
- Estimated size: **~100 lines**

### `tests/transaction.js`
- Exports: `transactionTests(client, context)`
- Populates `context.transactionId`
- Estimated size: **~90 lines**

### `tests/budget.js`
- Exports: `budgetTests(client, context)`
- Estimated size: **~120 lines**

### `tests/rules.js`
- Exports: `rulesTests(client, context)`
- Populates `context.ruleId`, `context.ruleWithoutOpId`
- Estimated size: **~90 lines**

### `tests/advanced.js`
- Exports: `advancedTests(client, context)`, `extendedTests(client, context)`, `fullTests(client, context)`
- The composite functions that chain the individual test modules
- Estimated size: **~50 lines**

### `cleanup.js`
- Exports: `cleanupMcpTestAccounts(client)`
- No dependency on `context` — standalone, safe to run any time
- Estimated size: **~140 lines**

### `runner.js`
- Exports: `run()`
- Imports all test modules and `cleanup.js`
- Owns: level dispatch switch, cleanup prompt logic, top-level `try/catch`
- Estimated size: **~120 lines**

### `index.js`
- Entry point only: `import { run } from './runner.js'; run();`
- **≤ 5 lines**

---

## Interface Contract

### Client object

`mcp-client.js` should export a plain object (not a class):

```js
// mcp-client.js
export function createClient({ url, token }) {
  let sessionId = null;
  let requestId = 1;
  // ...
  return { callMCP, callTool, initialize, listTools };
}
```

Each test module receives this client and calls `client.callTool(...)` instead of the current implicit global `callTool(...)`.

### Context object

The `context` object is a plain mutable object passed by reference through the test chain. Each module documents which keys it reads and which it writes:

```js
// context shape (all optional — modules skip gracefully if key is absent)
{
  accountId,       // written by account.js
  accountName,     // written by account.js
  categoryGroupId, // written by category-group.js
  categoryId,      // written by category.js
  payeeId,         // written by payee.js
  payeeId2,        // written by payee.js (cleared after merge)
  transactionId,   // written by transaction.js
  ruleId,          // written by rules.js
  ruleWithoutOpId, // written by rules.js
}
```

---

## Refactoring Steps (ordered)

> **Status: COMPLETE** — all 8 steps done, monolith deleted (`b92f18c`).

1. ✅ **Extract `mcp-client.js`** — `createClient({ url, rl })` owns all transport globals.
2. ✅ **Extract `cleanup.js`** — `cleanupMcpTestAccounts(client)`, no context dependency.
3. ✅ **Extract `tests/sanity.js`** — `sanityTests(client)`.
4. ✅ **Extract `tests/smoke.js`** — `smokeTests(client)`, imports sanity.
5. ✅ **Extract `tests/account.js` → `tests/advanced.js`** — one file per domain; composites in `advanced.js`.
6. ✅ **Extract `runner.js`** — orchestrates all modules; only file that calls `process.exit()`.
7. ✅ **`index.js`** created as 7-line entry point.
8. ✅ **Delete the monolith** — committed `b92f18c`.

### Actual file sizes (vs planned estimates)

| File | Estimated | Actual |
|---|---|---|
| `mcp-client.js` | ~100 | 180 |
| `cleanup.js` | ~140 | 161 |
| `runner.js` | ~120 | 208 |
| `index.js` | ≤5 | 7 |
| `tests/sanity.js` | ~80 | 73 |
| `tests/smoke.js` | ~60 | 62 |
| `tests/account.js` | ~130 | 123 |
| `tests/category-group.js` | ~60 | 62 |
| `tests/category.js` | ~70 | 69 |
| `tests/payee.js` | ~100 | 117 |
| `tests/transaction.js` | ~90 | 97 |
| `tests/budget.js` | ~120 | 146 |
| `tests/rules.js` | ~90 | 91 |
| `tests/advanced.js` | ~50 | 81 |

All files remain well under the 400-line limit.

---

## Coding Conventions for Split Modules

- Use **ES module syntax** (`import`/`export`) — the project already uses `"type": "module"`.
- Each module begins with a short JSDoc comment: what it tests, what context keys it reads/writes.
- Keep `console.log` calls inside the test functions (not in module scope).
- Prefer `async function` over arrow functions for top-level exports (easier to see in stack traces).
- No shared mutable state between modules — everything via `client` or `context`.
- Timestamps used for unique names must be generated **inside** the function that creates the entity, never passed in.

---

## npm Scripts (as implemented)

```jsonc
// package.json scripts (current state)
"test:integration":          "MCP_TEST_LEVEL=sanity node tests/manual/index.js",
"test:integration:sanity":   "MCP_TEST_LEVEL=sanity node tests/manual/index.js",
"test:integration:smoke":    "MCP_TEST_LEVEL=smoke node tests/manual/index.js",
"test:integration:normal":   "MCP_TEST_LEVEL=normal node tests/manual/index.js",
"test:integration:extended": "MCP_TEST_LEVEL=extended node tests/manual/index.js",
"test:integration:full":     "MCP_TEST_LEVEL=full node tests/manual/index.js",
"test:integration:cleanup":  "MCP_TEST_LEVEL=cleanup node tests/manual/index.js"
```

Additional runtime parameters (passed as positional args or env vars):
```
node tests/manual/index.js [MCP_URL] [TOKEN] [LEVEL] [CLEANUP]

MCP_SERVER_URL   MCP server URL
MCP_AUTH_TOKEN   Bearer token
MCP_TEST_LEVEL   Test level
```

---

## What Not to Do

- **Do not** split into a single file per test function — too many tiny files. One file per logical domain (accounts, categories, payees, …).
- **Do not** add a test framework (Jest, Mocha) at this stage — the current printf-style output is intentional and matches CI log requirements.
- **Do not** move cleanup logic into individual test modules — cleanup must remain runnable standalone without executing any tests.
- **Do not** use `process.exit()` inside test modules — only `runner.js` should terminate the process.
