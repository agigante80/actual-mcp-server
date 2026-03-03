# New Tool Checklist

**Project:** Actual MCP Server  
**Purpose:** Step-by-step checklist for every new MCP tool added to the project  
**Last Updated:** 2026-03-03

Use this file every time a new tool is added. Print or open it alongside your editor and tick each box before committing. The checklist is ordered so that each step builds on the previous one.

---

## ⚡ Quick Reference (all checkboxes in one place)

### Implementation
- [ ] Tool file created: `src/tools/<domain>_<action>.ts`
- [ ] Exported from `src/tools/index.ts`
- [ ] Added to `IMPLEMENTED_TOOLS` in `src/actualToolsManager.ts`
- [ ] Adapter function(s) exist (or created) in `src/lib/actual-adapter.ts`
- [ ] `npm run build` passes with zero errors

### Unit Tests
- [ ] Happy-path coverage in `tests/unit/generated_tools.smoke.test.js`
- [ ] Negative-path / schema validation in `tests/unit/schema_validation.test.js` (if schema is complex)
- [ ] `EXPECTED_TOOL_COUNT` updated in `tests/unit/generated_tools.smoke.test.js`
- [ ] `npm run test:unit-js` passes

### Manual Integration Tests (JS scripts)
- [ ] Test block added to the appropriate `tests/manual/tests/*.js` module
- [ ] **Positive test**: call with valid input, assert expected shape of result
- [ ] **Negative test**: call with a name / ID that does not exist — assert error is returned AND that the response contains useful context (e.g., list of available values)
- [ ] `tests/manual/README.md` test-module table updated if a new file was added
- [ ] `npm run test:integration:full` passes against a real server

### AI / LLM Prompt Test
- [ ] New tool added to the correct prompt file in `tests/manual-prompt/` (see Step 6 for which file)
- [ ] Phase header tool count updated in that prompt file
- [ ] `tests/manual-prompt/README.md` Phase Overview table total updated
- [ ] Both a positive scenario and a not-found/negative scenario described in the prompt instructions

### E2E Tests
- [ ] `EXPECTED_TOOL_COUNT` constant updated in `tests/e2e/mcp-client.playwright.spec.ts`
- [ ] `EXPECTED_TOOL_COUNT` constant updated in `tests/e2e/docker-all-tools.e2e.spec.ts` (if present)
- [ ] `npm run test:e2e` passes

### Documentation
- [ ] `README.md` — tool count in badge/header, tool table in Available Tools section
- [ ] `docs/PROJECT_OVERVIEW.md` — tool count, API coverage %, tool listed in feature table
- [ ] `docs/ARCHITECTURE.md` — tool listed in domain section (if relevant)
- [ ] `docs/ROADMAP.md` — item marked ✅ IMPLEMENTED, version noted
- [ ] `docs/TESTING_AND_RELIABILITY.md` — test file entries updated if new test module added
- [ ] `docker/description/long.md` — tool count, feature bullet if significant
- [ ] `docker/description/short.md` — tool count

### Final Validation
- [ ] `npm run build` ✅
- [ ] `npm run test:adapter` ✅
- [ ] `npm run test:unit-js` ✅
- [ ] `npm run verify-tools` ✅ (confirms tool name matches registered name)
- [ ] `npm audit --audit-level=moderate` ✅
- [ ] Commit message uses `feat(tools): add <tool_name>` format

---

## 📋 Detailed Guide

### Step 1 — Create the tool file

**Location**: `src/tools/<domain>_<action>.ts`

**Naming convention**: `actual_{domain}_{action}` (snake_case). Use the exact same name for:
- The file name (`<domain>_<action>.ts`)
- The `name` field inside the tool definition
- The entry in `IMPLEMENTED_TOOLS`

**Template**:
```typescript
import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({
  // Use CommonSchemas for shared types: accountId, amountCents, date, etc.
  name: z.string().describe('Human-readable name to look up'),
  type: z.enum(['accounts', 'categories', 'payees']).describe('Entity type'),
});

const tool: ToolDefinition = {
  name: 'actual_example_tool',
  description: 'One-line description. Amount in cents (negative=expense). Dates: YYYY-MM-DD.',
  inputSchema: InputSchema,
  call: async (args: unknown) => {
    const input = InputSchema.parse(args);
    return await adapter.someMethod(input);
  },
};

export default tool;
```

**Checklist for the tool file**:
- Amounts always in **cents** (integer), never decimal dollars
- Dates always `YYYY-MM-DD`
- UUIDs validated with `UUID_PATTERN` from `src/lib/constants.ts` when needed
- Error messages are user-facing — make them actionable
- When a lookup returns no results, include a list of available values in the error response (see Negative Test section below)

---

### Step 2 — Register the tool

**Export** from `src/tools/index.ts`:
```typescript
export { default as example_tool } from './example_tool.js';
```

**Register** in `src/actualToolsManager.ts` — add the tool name to `IMPLEMENTED_TOOLS`:
```typescript
const IMPLEMENTED_TOOLS = [
  // ...existing tools...
  'actual_example_tool',  // ← add here, alphabetical within domain
];
```

Verify with:
```bash
npm run verify-tools
```

---

### Step 3 — Add or extend adapter methods

If the tool calls an Actual API method that is not yet wrapped in `src/lib/actual-adapter.ts`, add a new exported function following the `withActualApi` / `withConcurrency` / `retry` pattern:

```typescript
export async function exampleMethod(input: unknown): Promise<unknown> {
  return withActualApi(async () => {
    return withConcurrency(() =>
      retry(() => rawExampleMethod(input) as Promise<unknown>, { retries: 2, backoffMs: 200 })
    );
  });
}
```

Then export the function from the adapter's default export object at the bottom of `actual-adapter.ts`.

---

### Step 4 — Write unit tests

#### 4a. Smoke test in `tests/unit/generated_tools.smoke.test.js`

This file stubs the adapter and runs every registered tool with a minimal valid input to assert it does not throw and returns a plausible shape.

1. **Update `EXPECTED_TOOL_COUNT`** (top of file) to the new total.
2. Add a special-case input if the tool needs non-trivial required fields:
   ```javascript
   if (name.includes('example_tool')) {
     inputExample.name = 'SomeExistingName';
     inputExample.type = 'accounts';
   }
   ```
3. Add a specific assertion block if the return shape is noteworthy:
   ```javascript
   if (n === 'example_tool') {
     assert.ok(res?.id || res?.error, 'expected id or error in response');
   }
   ```

#### 4b. Negative / schema validation in `tests/unit/schema_validation.test.js`

Add negative-path tests for **any schema that has:**
- Enums (wrong value should fail)
- UUID fields (non-UUID string should fail)
- Numeric ranges (out-of-range should fail)
- Required fields (missing should fail)

```javascript
it('actual_example_tool rejects invalid type', () => {
  assert.throws(
    () => InputSchema.parse({ type: 'invalid', name: 'foo' }),
    /invalid_enum_value/,
  );
});
```

Run with:
```bash
npm run test:unit-js
```

---

### Step 5 — Write manual integration tests

Manual tests run against a **real, live Actual Budget instance** over HTTP. They live in `tests/manual/tests/`.

> **Code quality reminder**: Before writing or editing any file under `tests/manual/`, read the **Technical Guidelines** section in [`tests/manual/README.md`](../tests/manual/README.md). Key rules that are easy to miss:
> - Hard limit of **400 lines per file** (evaluate a split before reaching 300)
> - Each test file exports exactly **one primary function** `fooTests(client, context)`
> - Always use `client.callTool()` — never call `fetch()` directly
> - Wrap checks in `try/catch`; log `✓` / `❌` / `⚠` but only rethrow fatal errors
> - Re-fetch and assert after every create/update (**read-back verification**)
> - New entities must follow the `MCP-{Type}-{timestamp}` naming pattern so `cleanup` can find them
> - Never add shared mutable state outside the `context` object

Choose the right module based on the tool's domain:

| Domain | File |
|--------|------|
| Server info, version, SQL, sessions | `sanity.js` or `advanced.js` |
| Accounts | `account.js` |
| Categories / Category Groups | `category.js` / `category-group.js` |
| Payees | `payee.js` |
| Rules | `rules.js` |
| Transactions | `transaction.js` |
| Budgets | `budget.js` |
| Lookup helpers, bank sync, advanced queries | `advanced.js` |

#### 5a. Positive test

Call the tool with a **valid** input drawn from data already present in the budget (use `callTool` on a known entity first to get its name/id):

```javascript
// Positive: resolve an account by its real name
try {
  const accts = await callTool("actual_accounts_list", {});
  const first = Array.isArray(accts) && accts.length > 0 ? accts[0] : null;
  if (first?.name) {
    const res = await callTool("actual_example_tool", { type: 'accounts', name: first.name });
    if (res?.id === first.id) {
      console.log(`  ✓ example_tool [accounts]: "${first.name}" → ${res.id}`);
    } else {
      console.log(`  ❌ example_tool [accounts]: expected ${first.id}, got ${JSON.stringify(res).slice(0,120)}`);
    }
  } else {
    console.log("  ℹ example_tool: no accounts found — skipped");
  }
} catch (err) {
  console.log("  ❌ example_tool:", err.message);
}
```

#### 5b. Negative test (mandatory for lookup/search tools)

Call the tool with a **name or ID that is guaranteed not to exist**. Assert:
1. The tool returns an error (not a crash)
2. The error message (or response body) includes a list of **available** values — so the AI can self-correct

Use a sentinel name like `"__nonexistent_MCP_test_value__"` which can never collide with real data:

```javascript
// Negative: name that does not exist — response must include available list
try {
  const res = await callTool("actual_example_tool", {
    type: 'accounts',
    name: '__nonexistent_MCP_test_value__',
  });
  const text = JSON.stringify(res);
  if (text.includes('not found') || text.includes('available') || res?.error) {
    console.log(`  ✓ example_tool [negative]: correctly returned not-found (with context)`);
  } else {
    console.log(`  ❌ example_tool [negative]: non-existent name did not produce a useful error: ${text.slice(0,200)}`);
  }
} catch (err) {
  // If tool throws cleanly with a descriptive message, that also counts
  if (err.message.includes('not found') || err.message.includes('available')) {
    console.log(`  ✓ example_tool [negative]: threw with useful message`);
  } else {
    console.log(`  ❌ example_tool [negative]: error message not helpful: ${err.message}`);
  }
}
```

> **Design expectation**: Tools that look up by name (e.g., `actual_get_id_by_name`, `actual_categories_get`, `actual_payees_get`) should return a `not_found` response that lists available values. This allows an AI to immediately retry without needing a separate list call. Example response shape:
> ```json
> {
>   "error": "No account named '__nonexistent_MCP_test_value__' found.",
>   "available": ["Checking", "Savings", "Credit Card"]
> }
> ```

#### 5c. Update `tests/manual/README.md`

If you added a **new test module file**, add it to the "Directory Layout" table. If you added tests to an existing file, update its description comment.

---

### Step 6 — Update the AI prompt test

**Folder**: `tests/manual-prompt/` — three sequentially-pasted prompt files.
See [`tests/manual-prompt/README.md`](../tests/manual-prompt/README.md) for usage.

**Which file to edit** (based on domain):

| Domain | File |
|--------|------|
| Server info, read-only lists, `actual_get_id_by_name` | `prompt-1-smoke.txt` — Phase 1 |
| Accounts, Categories, Payees, Rules, Transactions, Schedules | `prompt-2-core.txt` — Phases 2–6b |
| Budgets, Summaries, Query, Session Management, Cleanup | `prompt-3-advanced.txt` — Phases 7–12 |

1. **Find the correct phase** in the right prompt file (by domain — see table above)
2. **Add a positive scenario** — describe what the AI should call and what constitutes a pass
3. **Add a negative scenario** — explicitly instruct the AI to test not-found / invalid inputs:
   ```
   - actual_example_tool — test positive + negative:
     * Positive: pick first account name from actual_accounts_list → call actual_example_tool
       with type='accounts' and that name → verify returned id matches account id (✓ pass)
     * Negative: call actual_example_tool with type='accounts' and
       name='__nonexistent_MCP_test_value__' → verify response contains 'not found' or
       an 'available' list (✓ pass); if response contains no error context → ✗ fail
   ```
4. **Update the phase header tool count** in the prompt file: `Phase N – Domain (X tools)` → `Phase N – Domain (X+1 tools)`
5. **Update `tests/manual-prompt/README.md`** — Phase Overview table: increment the count for the affected phase row and the Total row

---

### Step 7 — Update documentation files

Update every file below. The order does not matter but all must be done before the PR/commit.

#### `README.md`
- Tool count in the intro paragraph and any badge text: `51 MCP tools` → `54 MCP tools`
- Tool count in the "Available Tools" section header
- Add a row for the new tool in the appropriate table (tool name, description, key parameters)
- Update `API Coverage` percentage if it changed

#### `docs/PROJECT_OVERVIEW.md`
- Tool count (search for the current number and update all occurrences)
- API coverage percentage
- Add the tool to the feature list if it represents a new capability

#### `docs/ARCHITECTURE.md`
- Add the tool to the domain section table if the domain section lists tools explicitly
- Update any tool-count summaries

#### `docs/ROADMAP.md`
- If this tool was a planned roadmap item: mark it `✅ IMPLEMENTED in v0.X.Y`
- If it is a new capability not previously planned: add it to the "Implemented" history section

#### `docs/TESTING_AND_RELIABILITY.md`
- If you added a new test module file to `tests/manual/tests/`, add it to the test-file table
- Update any tool-count references (search for the old number)

#### `docker/description/long.md`
- Update tool count everywhere it appears
- Add a bullet point for the new tool if it represents significant new functionality

#### `docker/description/short.md`
- Update tool count (short description typically has just a number)

---

### Step 8 — Final validation

Run the full pre-commit suite:

```bash
npm run build                    # Zero TypeScript errors
npm run test:adapter             # Adapter smoke tests
npm run test:unit-js             # Unit tests (includes schema_validation)
npm run verify-tools             # All IMPLEMENTED_TOOLS resolve correctly
npm audit --audit-level=moderate # No new vulnerabilities
```

Optional (requires Docker + real Actual Budget):
```bash
npm run test:integration:full    # Full live integration test suite
npm run test:e2e                 # Playwright MCP protocol tests
```

---

### Step 9 — Commit

```bash
git add .
git commit -m "feat(tools): add actual_<tool_name>

- <one-line description of what the tool does>
- Adapter method: adapter.<methodName>()
- Tests: unit smoke + negative path in tests/unit/
- Manual tests: positive + negative in tests/manual/tests/<module>.js
- Prompt: tests/manual-prompt/prompt-{1|2|3}-*.txt Phase N updated + README total updated
- Docs: README, PROJECT_OVERVIEW, ARCHITECTURE, ROADMAP, docker/description all updated
- Total tools: N → N+1 (XX% API coverage)"
```

---

## 🔴 Negative Test Reference

The table below summarises the negative test patterns for existing tools that already implemented **available list** responses. Use these as reference when implementing the same pattern for new lookup/search tools.

| Tool | Not-Found Response Pattern |
|------|---------------------------|
| `actual_get_id_by_name` | `{ error: "No <type> named '<name>' found.", available: ["Name1", "Name2", ...] }` |
| `actual_accounts_get_balance` | `{ error: "Account '<id>' not found" }` |
| `actual_query_run` | `{ error: "Unknown field '<field>'" }` with field suggestions |

When implementing a new lookup tool, the `call` function should:
1. Try to find the entity by name/id
2. If not found, fetch the full list
3. Return `{ error: "Not found", available: list.map(e => e.name) }` — **never** just `null` or an empty object

---

## 📎 Files to Touch — Summary Table

| File | What to change |
|------|---------------|
| `src/tools/<domain>_<action>.ts` | **Create** — tool definition + Zod schema |
| `src/tools/index.ts` | **Add** export line |
| `src/actualToolsManager.ts` | **Add** tool name to `IMPLEMENTED_TOOLS` |
| `src/lib/actual-adapter.ts` | **Add** adapter method if new API call needed |
| `tests/unit/generated_tools.smoke.test.js` | **Update** `EXPECTED_TOOL_COUNT`; add input example |
| `tests/unit/schema_validation.test.js` | **Add** negative schema tests for complex schemas |
| `tests/e2e/mcp-client.playwright.spec.ts` | **Update** `EXPECTED_TOOL_COUNT` |
| `tests/e2e/docker-all-tools.e2e.spec.ts` | **Update** `EXPECTED_TOOL_COUNT` |
| `tests/manual/tests/<module>.js` | **Add** positive + negative test block |
| `tests/manual/README.md` | **Update** module table if new file added |
| `tests/manual-prompt/prompt-{1\|2\|3}-*.txt` | **Add** tool to the correct phase; update phase count |
| `tests/manual-prompt/README.md` | **Update** Phase Overview table total |
| `README.md` | **Update** tool count + tool table row |
| `docs/PROJECT_OVERVIEW.md` | **Update** tool count + coverage % |
| `docs/ARCHITECTURE.md` | **Update** domain table if applicable |
| `docs/ROADMAP.md` | **Mark** item implemented OR add new entry |
| `docs/TESTING_AND_RELIABILITY.md` | **Update** if new test module added |
| `docker/description/long.md` | **Update** tool count + feature bullet |
| `docker/description/short.md` | **Update** tool count |
