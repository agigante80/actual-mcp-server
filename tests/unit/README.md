# Unit Test Suite

Offline unit tests for the Actual Budget MCP server. Tests run against compiled
output in `dist/` with the Actual Budget adapter fully monkeypatched — **no live
server connection is required or attempted**.

```bash
npm run test:unit-js   # runs all four files in order
```

---

## Directory Layout

```
tests/unit/
├── README.md                          ← this file
├── generated_tools.smoke.test.js      ← smoke-tests all 62 tools: schema parse +
│                                         adapter call + shape assertion
├── schema_validation.test.js          ← negative-path Zod tests: wrong types,
│                                         missing required fields, bad enums/UUIDs
├── auth-acl.test.js                   ← budget ACL logic: principal matching,
│                                         allow/deny rules, group membership
└── transactions_create.test.js        ← deep unit test for transactions_create:
                                          amount handling, date validation, field mapping
```

---

## Prerequisites

All unit tests import from `dist/`. Run `npm run build` before running tests for
the first time, and again after any source change.

```bash
npm run build && npm run test:unit-js
```

---

## File-by-file Guide

### `generated_tools.smoke.test.js`

Iterates every exported tool and:
1. Stubs required env vars so the adapter module loads without a `.env` file.
2. Monkeypatches all adapter functions via a `stubResponses` map.
3. Provides a minimal `inputExample` for tools that require fields.
4. Calls `mod.inputSchema.parse(inputExample)` — verifies the schema accepts the example.
5. Calls `mod.call(inputExample)` — verifies the tool runs without throwing.
6. Runs a shape assertion to verify the return value structure.

**Three assertion patterns** (pick the right one for a new assertion):

| Pattern | When to use | Example |
|---------|------------|---------|
| Add to `resultWrappers[]` | Tool returns `{ result: ... }` | list/get tools |
| Add to `successTools[]` | Tool returns `{ success: true }` | mutate/delete tools |
| Add a `if (n === '...')` block with `shapeErr()` | Tool returns named fields | create tools returning `{ id }` |

**`shapeErr()` helper** — always use this for shape failures (it includes the tool
name and the first 120 chars of the actual response):

```javascript
if (typeof res?.id !== 'string') shapeErr('expected id string');
```

**Stub responses** — if the default `{}` stub doesn't satisfy the shape assertion,
add the tool's adapter function to `stubResponses`:

```javascript
const stubResponses = {
  // ...existing entries...
  myAdapterFn: { id: 'new-id-123' },   // ← add here
};
```

**Input examples** — add a `if (name.includes('my_tool'))` block in the
`inputExample` section to satisfy required Zod fields:

```javascript
if (name.includes('my_tool')) inputExample.requiredField = 'value';
```

---

### `schema_validation.test.js`

Tests negative paths that the Zod schema (or runtime guards) must reject. Each
tool has its own named section. Three helpers are available:

```javascript
// Assert Zod rejects the input (most common)
expectParseError(tool, { amount: 'fifty' }, 'non-integer amount');

// Assert Zod accepts the input (use to confirm a valid baseline)
expectParseOk(tool, { amount: 100, date: '2026-01-01' }, 'valid minimal input');

// Assert the tool.call() throws at runtime (for runtime guards, not Zod)
await expectCallError(tool, validInput, 'runtime guard label');
```

**Rules:**
- Import each tool individually from `dist/` using `import('...').then(m => m.default)`.
- One call to `expectParseError` / `expectParseOk` per scenario — keep them fine-grained so failures identify the exact scenario.
- Every `expectParseError` call must include a human-readable label so test output is self-explanatory without reading the source.
- Increment `failures` with `fail()` on any assertion that returns `false`.
- Exit code is `2` on any failure — do not swallow failures.

**What to cover** (scenarios per tool, in priority order):
1. Missing required field
2. Wrong type for a required field (string instead of number, etc.)
3. Invalid enum value
4. Non-UUID string where UUID is required
5. Invalid date format (e.g. `'2026/01/01'` instead of `'2026-01-01'`)
6. Valid minimal input accepted (one `expectParseOk` per tool as a baseline)

---

### `auth-acl.test.js`

Tests the budget ACL logic in `src/auth/budget-acl.ts` (principal matching, allow/deny
rules, group membership). This file uses the same printf-style output and `failures`
counter pattern as the other unit test files. No adapter or tool imports — pure logic.

---

### `transactions_create.test.js`

Deep unit tests for `transactions_create` specifically: amount sign handling, date
field validation, optional field mapping. Imports the tool from `dist/` and stubs
the adapter. Follows the same `failures` / exit-code-2 pattern.

---

## Technical Guidelines

### Do not add a test framework

All files use Node's built-in `assert` module and a `failures` counter. The
printf-style `✓` / `❌` output is intentional — it maps cleanly to CI logs and
avoids a dependency on Jest/Mocha/Vitest.

### Always import from `dist/`, never from `src/`

```javascript
// ✅ correct
const tool = await import('../../dist/src/tools/my_tool.js').then(m => m.default);

// ❌ wrong — TypeScript source, not runnable by node directly
const tool = await import('../../src/tools/my_tool.js');
```

### Stub env vars before any adapter import

Each file stubs the three required env vars at the very top, before any `import`:

```javascript
process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';
```

Real env vars (from a `.env` file) take precedence — `??` ensures they are never
overwritten, so unit tests are safe to run in a live dev environment.

### No live network calls

The adapter must be monkeypatched or the test must only exercise schema/logic
that never reaches the adapter. Any test that makes a live HTTP call or touches
the filesystem is in the wrong file — put it in `tests/manual/tests/`.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | All assertions passed |
| `1` | Unhandled exception (bug in test code itself) |
| `2` | One or more assertions failed |

Always call `process.exit(0)` or `process.exit(2)` explicitly at the end of the
`(async () => { ... })()` block — never rely on natural process exit.

### Adding tests to `schema_validation.test.js`

1. Add the tool to the `Promise.all([...])` import block at the top.
2. Add a clearly commented section below the existing sections.
3. Cover at minimum: one valid baseline (`expectParseOk`) and the key invalid
   scenarios (`expectParseError`) listed in the [What to cover](#what-to-cover-scenarios-per-tool-in-priority-order) list above.
4. Increment `failures` via `fail()` where the helper returns `false`.
5. Run `npm run test:unit-js` to confirm the new tests pass before committing.

### Adding shape assertions to `generated_tools.smoke.test.js`

1. If the tool's adapter function needs to return a specific value, add it to
   `stubResponses` keyed by the **adapter method name** (camelCase, e.g. `createPayee`).
2. If the tool needs required input, add an `if (name.includes('tool_name'))` block
   in the input-example section.
3. Add the shape assertion at the end of the correctness section using one of the
   three patterns (`resultWrappers[]`, `successTools[]`, or custom `if` block).
4. Never add duplicate entries to `resultWrappers[]` or `successTools[]`.
