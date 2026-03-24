---
applyTo: "tests/e2e/*.spec.ts"
---

## Rules for Playwright E2E test files (`tests/e2e/`)

Read `tests/e2e/README.md` Technical Guidelines before editing any file here.

**These tests require a live Docker stack.** Run with `npm run test:e2e:docker:full` —
not `npm run test:e2e` (which expects Docker-internal hostnames from the host).
Only `npm run test:unit-js` and `npm run build` are appropriate in Copilot's default ephemeral environment.

Key rules:
- **Never hardcode** server URLs or credentials — always use `process.env.MCP_SERVER_URL`
- `EXPECTED_TOOL_COUNT` must be updated to the current total whenever a tool is added or removed
- **File-size target: ≤ 500 lines per spec file.** Files over 700 lines must be split by domain
- **Do not duplicate helpers** — import shared utilities from `tests/shared/e2e-helpers.ts`
  (and `tests/shared/mcp-protocol.js` for JS callers) instead of defining helpers locally in spec files
- These are **API-only** tests (HTTP JSON-RPC). Do not use `page.*` or any browser APIs
- Do NOT add `baseURL` interaction patterns — specs call `MCP_SERVER_URL` directly
- Retry logic (`retries: 2`) is configured in `playwright.config.ts` / `playwright.config.docker.ts` — don't add manual retry loops
- Every tool that performs a mutation **must** have a corresponding named delete/revert test
- `afterAll` is **fallback-only** — primary cleanup must be in named delete tests with list-absence assertions
- Every tool with a UUID parameter needs at least one **negative test** using `'00000000-0000-0000-0000-000000000000'`

### Config files
- Local testing: `playwright.config.ts`
- Docker CI stack: `playwright.config.docker.ts`
