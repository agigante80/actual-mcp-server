# GitHub Copilot Coding Agent Setup

**Project:** Actual MCP Server  
**Last Updated:** 2026-03-03  
**Status:** 🚧 TEMPORARY WORKING DOCUMENT — delete once all actions are executed

> This is a task list for setting up the Copilot coding agent environment. Each section describes one discrete action to perform. Work through them in priority order, check off completed items, and delete this file when the Summary Table is fully done.

---

## Current State

| File | Status | Notes |
|------|--------|-------|
| `.github/copilot-instructions.md` | ✅ Exists | Comprehensive; recently audited and corrected |
| `.github/workflows/copilot-setup-steps.yml` | ❌ Missing | **Highest-impact gap** — Copilot must discover deps by trial-and-error without this |
| `.github/instructions/` (path-specific) | ❌ Missing | Would give Copilot file-type-specific rules |
| `.github/ISSUE_TEMPLATE/copilot-task.yml` | ❌ Missing | Well-scoped issue templates cut back-and-forth |
| `AGENTS.md` | — | Not needed — `copilot-instructions.md` covers the same role |

---

## Priority 1 — Create `copilot-setup-steps.yml` (CRITICAL)

**Why:** Without this, Copilot's ephemeral environment must install `node_modules` by trial and error every time it works on an issue. With it, deps are pre-installed and it hits the ground running.

**File to create:** `.github/workflows/copilot-setup-steps.yml`

```yaml
# Pre-installs dependencies into Copilot coding agent's ephemeral environment.
# The job MUST be named 'copilot-setup-steps' — Copilot looks for this exact name.
# Reference: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment

on:
  workflow_dispatch:
  push:
    paths:
      - .github/workflows/copilot-setup-steps.yml
  pull_request:
    paths:
      - .github/workflows/copilot-setup-steps.yml

jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build project (validates TypeScript)
        run: npm run build

      - name: Install Playwright browsers (for E2E tests)
        run: npx playwright install --with-deps chromium
```

**What this enables:**
- `npm run build` — TypeScript compilation works immediately
- `npm run test:unit-js` — unit tests runnable without setup
- `npm run verify-tools` — tool registry check works
- `npm run test:e2e` — Playwright specs runnable (Chromium only to save time)

**Note:** Do NOT include Docker setup here — Docker E2E tests require a real Actual Budget server and are not appropriate for Copilot's ephemeral environment. Copilot should use `npm run test:unit-js` and `npm run build` to validate its changes.

### Test Type Taxonomy — What Copilot Can and Cannot Run

This project has four distinct test layers. Copilot must **maintain all of them** when making changes, but can only **execute** unit tests in its ephemeral environment (no live server, no Docker, no browser UI):

| Test Type | npm script | Copilot must update? | Copilot can execute? |
|-----------|-----------|----------------------|----------------------|
| **Unit Tests** | `npm run test:unit-js` | ✅ Yes — always | ✅ Yes — always |
| **E2E (Playwright)** | `npm run test:e2e` | ✅ Yes — update `EXPECTED_TOOL_COUNT` when tool count changes | ✅ Yes — if directed to an environment with live MCP + Actual Budget server |
| **Manual Integration** | `npm run test:integration:*` | ✅ Yes — add/update test blocks in `tests/manual/tests/` | ✅ Yes — if directed to an environment with live MCP server at localhost:3601 |
| **AI / LLM Prompt Tests** | `tests/manual-prompt/` (copy-paste) | ❌ No — human responsibility only | ❌ Never — requires manually pasting into a LibreChat/LobeChat chat session |

**Copilot's default validation loop** (ephemeral env): `npm run build` → `npm run verify-tools` → `npm run test:unit-js`.

**With a live environment:** Copilot can additionally run `npm run test:e2e` and `npm run test:integration:full` when the issue specifies a target server URL.

---

## Priority 2 — Add Path-Specific Instruction Files

**Why:** GitHub Copilot supports `.github/instructions/**/*.instructions.md` files with a `applyTo` glob. These give Copilot file-type-specific rules without bloating the main `copilot-instructions.md`.

Create the directory `.github/instructions/` and add the following files:

---

### `.github/instructions/tool-files.instructions.md`

```markdown
---
applyTo: "src/tools/*.ts"
---

## Rules for MCP tool files (`src/tools/*.ts`)

- Tool name MUST follow `actual_{domain}_{action}` snake_case convention
- File name MUST match the tool name (e.g. `accounts_create.ts` for `actual_accounts_create`)
- InputSchema MUST use `z.object({...})` from Zod
- Use types from `CommonSchemas` in `src/lib/schemas/common.ts` for shared fields:
  - Dates → `CommonSchemas.date` (validates YYYY-MM-DD)
  - Account UUIDs → `CommonSchemas.accountId`
  - Amounts → `CommonSchemas.amountCents` (integer cents, never decimal dollars)
- The `call` function MUST `InputSchema.parse(args)` before any other logic
- All Actual API calls MUST go through `adapter.*` methods — never import `@actual-app/api` directly
- `adapter.*` methods already use `withActualApi` — do NOT add a second wrapper
- Error messages must be actionable: include entity type, ID, and a suggested next tool
- After creating a tool file, you MUST:
  1. Export it from `src/tools/index.ts`
  2. Add the name to `IMPLEMENTED_TOOLS` in `src/actualToolsManager.ts`
  3. Run `npm run build` first (verify-tools reads from `dist/`, not `src/`)
  4. Run `npm run verify-tools` to confirm registration
- To check uncovered Actual API surface before implementing: `npm run check:coverage`
  (prints all `@actual-app/api` methods vs current tool list — read-only, safe to run)
```

---

### `.github/instructions/unit-tests.instructions.md`

```markdown
---
applyTo: "tests/unit/*.{js,ts}"
---

## Rules for unit test files (`tests/unit/`)

### `generated_tools.smoke.test.js`
- Update `EXPECTED_TOOL_COUNT` at the top whenever a tool is added or removed
- Add a special-case input block if the new tool needs non-trivial required fields
- The adapter is stubbed — do NOT make live network calls

### `schema_validation.test.js`
- Add one `it()` block per Zod-layer error scenario (wrong date, missing field, bad enum, etc.)
- Assert BOTH that an error is thrown AND that its message is actionable:
  ```javascript
  const err = assert.throws(() => InputSchema.parse({...}));
  assert.match(err.message, /YYYY-MM-DD/); // not just assert.throws(...)
  ```
- See the 10-scenario table in `docs/feature/IMPROVED_ERROR_MESSAGES.md` for guidance on which scenarios to cover

### General
- Run all unit tests with: `npm run test:unit-js`
- Tests must pass with zero live server connections
```

---

### `.github/instructions/playwright-tests.instructions.md`

```markdown
---
applyTo: "tests/e2e/*.spec.ts"
---

## Rules for Playwright E2E test files (`tests/e2e/`)

- These are **API-only** tests (no browser UI). Do not use `page.*` or browser APIs.
- All specs communicate with the MCP server via HTTP JSON-RPC directly.
- Server URL comes from `process.env.MCP_SERVER_URL` — never hardcode `localhost:3601`
- `EXPECTED_TOOL_COUNT` must be updated to the current total whenever a tool is added or removed
- Tests run with `npm run test:e2e` (requires live MCP server + Actual Budget server)
- For Copilot's ephemeral environment: only `npm run test:unit-js` and `npm run build` are appropriate
- Do NOT add `baseURL` interaction patterns — specs call `MCP_SERVER_URL` directly
- Retry logic (`retries: 2`) is configured in `playwright.config.ts` — don't add manual retry loops

### Config files
- Local testing: `playwright.config.ts`
- Docker CI stack: `playwright.config.docker.ts`
```

---

### `.github/instructions/integration-tests.instructions.md`

```markdown
---
applyTo: "tests/manual/tests/*.js"
---

## Rules for manual integration test files (`tests/manual/tests/`)

Read `tests/manual/README.md` Technical Guidelines before editing any file here.

**These tests require a live MCP server at `http://localhost:3601/http`.**  
They cannot run in Copilot's default ephemeral environment, but CAN run if the issue specifies a live target environment.

Test levels (cascade upward): `sanity` → `smoke` → `normal` → `extended` → `full` → `cleanup`

Key rules:
- Hard limit: **400 lines per file** — evaluate splitting before hitting 300
- Each file exports exactly **one** primary function: `fooTests(client, context)`
- Always use `client.callTool('tool_name', {...})` — never call `fetch()` directly
- Wrap every check in `try/catch`; log `✓` / `❌` / `⚠` but only rethrow fatal errors
- **Read-back verification**: after every create/update, re-fetch and assert the change is visible
- Test data naming: `MCP-{Type}-{TS}` (e.g. `MCP-Account-2026-03-03T14-30-22-456Z`)
- Every tool that accepts a UUID must have a negative test using `'00000000-0000-0000-0000-000000000000'`
- Error messages must be actionable — see `docs/feature/IMPROVED_ERROR_MESSAGES.md` scenario table
- Never add shared mutable state outside the `context` object
- Cleanup is automatic: test runner prompts for cleanup at end, or pass `yes` as 4th argument
```

---

### Note on AI / LLM Prompt Tests (`tests/manual-prompt/`)

These are **not instruction-file candidates** — they are human-operated copy-paste prompts for LibreChat/LobeChat. They cannot be automated or run by Copilot. No `.instructions.md` file is needed for this folder.

If Copilot adds a new tool, note in the issue **Out of Scope**: "Do not update prompt files — human will update `tests/manual-prompt/prompt-2-core.txt` or `prompt-3-advanced.txt` manually."

---

## Priority 3 — Add a Copilot-Optimised Issue Template

**Why:** Copilot coding agent uses the issue description as its primary prompt. A structured template ensures issues contain the acceptance criteria and file pointers Copilot needs.

**File to create:** `.github/ISSUE_TEMPLATE/copilot-task.yml`

```yaml
name: Copilot Task
description: A well-scoped task suitable for assignment to GitHub Copilot coding agent
title: "[Copilot] "
labels: ["copilot", "enhancement"]
body:
  - type: markdown
    attributes:
      value: |
        Use this template for tasks you intend to assign to Copilot coding agent.
        A good Copilot task is **specific, bounded, and testable**.
        See [best practices](https://docs.github.com/en/copilot/tutorials/coding-agent/get-the-best-results#making-sure-your-issues-are-well-scoped).

  - type: textarea
    id: problem
    attributes:
      label: Problem / Background
      description: What is wrong or missing? Why does it matter?
    validations:
      required: true

  - type: textarea
    id: acceptance-criteria
    attributes:
      label: Acceptance Criteria
      description: |
        List every condition that must be true for this issue to be considered done.
        Include test expectations.
      placeholder: |
        - [ ] Tool `actual_foo_bar` exists in `src/tools/foo_bar.ts`
        - [ ] Tool is registered in `IMPLEMENTED_TOOLS` and passes `npm run verify-tools`
        - [ ] `npm run build` passes with zero TypeScript errors
        - [ ] Unit smoke test added to `tests/unit/generated_tools.smoke.test.js`
        - [ ] Schema validation test added (negative path) in `tests/unit/schema_validation.test.js`
        - [ ] `npm run test:unit-js` passes
    validations:
      required: true

  - type: textarea
    id: files
    attributes:
      label: Files to Add / Modify
      description: List specific files Copilot should touch (helps it scope the work correctly).
      placeholder: |
        - **Create** `src/tools/foo_bar.ts` — tool definition
        - **Edit** `src/tools/index.ts` — add export
        - **Edit** `src/actualToolsManager.ts` — add to IMPLEMENTED_TOOLS
        - **Edit** `src/lib/actual-adapter.ts` — add adapter method if needed
        - **Edit** `tests/unit/generated_tools.smoke.test.js` — update EXPECTED_TOOL_COUNT
        - **Edit** `tests/unit/schema_validation.test.js` — add negative paths
    validations:
      required: true

  - type: textarea
    id: not-in-scope
    attributes:
      label: Out of Scope (optional)
      description: Explicitly list anything Copilot should NOT change, to prevent scope creep.
      placeholder: |
        - Do not update README.md or doc files (handled separately)
        - Do not change other existing tools

  - type: dropdown
    id: complexity
    attributes:
      label: Estimated Complexity
      description: How complex is this task?
      options:
        - Small (≤ 2 files, straightforward logic)
        - Medium (3–6 files, some domain knowledge needed)
        - Large (7+ files — consider splitting into sub-issues)
    validations:
      required: true
```

---

## Priority 4 — Improve `.github/copilot-instructions.md`

The file is already comprehensive. The following targeted additions would make it more useful for Copilot coding agent specifically (as opposed to human developers using Copilot Chat):

### Add an explicit "Validation Commands" section near the top

Insert after the "Build & Run Commands" section:

```markdown
### Copilot Agent Validation Sequence

When Copilot coding agent validates its own changes, it should run these commands in order:

```bash
npm run build                    # Step 1: TypeScript must compile cleanly
npm run verify-tools             # Step 2: All tools registered correctly (reads from dist/ — requires build first)
npm run test:unit-js             # Step 3: Unit + schema tests pass
npm audit --audit-level=moderate # Step 4: No new vulnerabilities
```

**Do NOT run in Copilot's default ephemeral environment:**
- `npm run test:e2e` — requires live MCP + Actual Budget server (OK if issue provides a live environment)
- `npm run test:integration:*` — requires live MCP server at localhost:3601 (OK if issue provides a live environment)
- `tests/manual-prompt/` — **never** — requires manually pasting into a LibreChat/LobeChat chat session
- `npm run dev` / `npm run start` — requires .env with real credentials
- `docker compose up` — not available in ephemeral environment
- `npm run release:*` / `npm run docs:sync` — version bumping is human responsibility; never run in Copilot
- `npm run deploy:*` — deployment scripts; require live Docker environment
```

### Add a "Danger Zones" section

```markdown
## ⚠️ Danger Zones (Copilot must NOT do these)

| Action | Why it's dangerous |
|--------|-------------------|
| Call `@actual-app/api` directly (skipping adapter) | Data won't persist — Tombstone issue |
| Add a tool without updating `IMPLEMENTED_TOOLS` | Tool silently missing from 60-tool count |
| Use decimal dollars (e.g. `50.00`) instead of cents (`5000`) | Creates wrong transaction amounts |
| Use `Date.now()` for a date field | Produces a number, not YYYY-MM-DD string |
| Delete `withActualApi` wrapper from adapter | Breaks data persistence for all callers |
| Change `ACTUAL_BUDGET_SYNC_ID` in any source file | Ties code to a specific budget instance |
```

### Add a "Documentation Hygiene" section

```markdown
## 📄 Documentation Hygiene — Delete, Don't Archive

> **Prefer deletion over archiving.** Git history is the archive.

Rules:
- When a feature is fully implemented: **delete** its `docs/feature/*.md` spec file and remove its row from `docs/ROADMAP.md`
- When a document's content is merged elsewhere: **delete** the source file and remove all references to it
- Do NOT move files to an `archive/` or `deprecated/` folder — that is just clutter with extra steps
- Do NOT leave `<!-- TODO -->` or `[PLANNED]` markers in files describing live behaviour
- Do NOT keep stale "planned" sections in docs once the code ships

When in doubt: if the information is already captured in code, tests, or another doc — delete the redundant file.
```

---

## Priority 5 — Merge and Delete `docs/AI_INTERACTION_GUIDE.md`

**Why:** The file contains agent-relevant rules (safe/forbidden file categories, common pitfalls, the full doc-sync matrix) that Copilot coding agent will never see because it lives in `docs/` rather than `.github/`. All unique content should be folded into `copilot-instructions.md`, the file deleted, and all references updated — eliminating drift between two overlapping sources of truth.

**Unique sections to extract from `AI_INTERACTION_GUIDE.md` and add to `copilot-instructions.md`:**

1. **File modification rules** — the three-tier table (SAFE / MODIFY WITH CAUTION / DO NOT MODIFY WITHOUT PERMISSION). Condense into the existing "Key Files to Review" section or add a new "File Safety Tiers" subsection.

2. **Full doc-sync matrix** — the eight-row table mapping code changes to required doc updates. The matrix currently exists in abbreviated form in `copilot-instructions.md`; replace with the full table.

3. **Common Pitfalls** — the DO/DON'T patterns (committing without testing, hardcoding secrets, using `any`, skipping docs). Add as a compact list under the existing "Danger Zones" block (Priority 4 above).

**Do NOT migrate to `copilot-instructions.md`:**
- Example AI prompts section (tool-specific illustration; already covered by `NEW_TOOL_CHECKLIST.md`)
- "Continuous Learning" section (meta-guidance, not actionable rules)
- Docker commands (already present in copilot-instructions.md)

**References to update after deletion (6 locations):**

| File | Line | Change |
|------|------|--------|
| `.github/copilot-instructions.md` | ~116 | Remove `(from docs/AI_INTERACTION_GUIDE.md)` attribution |
| `.github/copilot-instructions.md` | ~292 | Remove `(from docs/AI_INTERACTION_GUIDE.md)` attribution |
| `.github/copilot-instructions.md` | ~304 | Remove `AI_INTERACTION_GUIDE.md` from Documentation Location list |
| `docs/ARCHITECTURE.md` | ~746 | Remove `[AI Interaction Guide](./AI_INTERACTION_GUIDE.md)` link |
| `docs/SECURITY_AND_PRIVACY.md` | ~739 | Remove `[AI Interaction Guide](./AI_INTERACTION_GUIDE.md)` link |
| `docs/TESTING_AND_RELIABILITY.md` | ~1000 | Remove `[AI Interaction Guide](./AI_INTERACTION_GUIDE.md)` link |

**Steps:**
```
1. Extract the three unique sections (file tiers, doc-sync matrix, pitfalls)
2. Integrate into .github/copilot-instructions.md (Priority 4 additions)
3. Update the 6 reference locations above
4. git rm docs/AI_INTERACTION_GUIDE.md
5. Verify no remaining references: grep -r AI_INTERACTION_GUIDE .
6. npm run docs:sync  (updates **Version:** and **Tool Count:** markers)
7. Commit: docs: merge AI_INTERACTION_GUIDE into copilot-instructions; delete source file
```

---

## Summary Table

| Status | Action | File | Priority | Est. Effort |
|--------|--------|------|----------|-------------|
| ✅ | Create pre-install workflow | `.github/workflows/copilot-setup-steps.yml` | 🔴 Critical | 15 min |
| ✅ | Create tool file instructions | `.github/instructions/tool-files.instructions.md` | 🟠 High | 10 min |
| ✅ | Create unit test instructions | `.github/instructions/unit-tests.instructions.md` | 🟠 High | 10 min |
| ✅ | Create integration test instructions | `.github/instructions/integration-tests.instructions.md` | 🟡 Medium | 10 min |
| ✅ | Create Playwright instructions | `.github/instructions/playwright-tests.instructions.md` | 🟡 Medium | 10 min |
| ✅ | Create Copilot issue template | `.github/ISSUE_TEMPLATE/copilot-task.yml` | 🟡 Medium | 15 min |
| ✅ | Improve `copilot-instructions.md` | `.github/copilot-instructions.md` | 🟢 Low | 20 min |
| ✅ | Merge & delete `AI_INTERACTION_GUIDE.md` | `.github/copilot-instructions.md` + 6 reference files + `git rm` | 🟢 Low | 30 min |

**Legend:** ⏳ Pending · 🔄 In Progress · ✅ Done

---

## References

- [GitHub Docs — Improve a project with Copilot coding agent](https://docs.github.com/en/copilot/tutorials/coding-agent/improve-a-project)
- [GitHub Docs — Get the best results from Copilot coding agent](https://docs.github.com/en/copilot/tutorials/coding-agent/get-the-best-results)
- [GitHub Docs — Pilot Copilot coding agent in your organization](https://docs.github.com/en/copilot/tutorials/coding-agent/pilot-coding-agent)
- [GitHub Docs — Customize the agent environment](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment)
- [GitHub Docs — Path-specific custom instructions](https://docs.github.com/en/copilot/tutorials/coding-agent/get-the-best-results#path-specific-instructions)
