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
