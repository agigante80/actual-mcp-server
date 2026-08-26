---
applyTo: "tests/e2e/*.spec.ts"
---

## Rules for Playwright E2E test files (`tests/e2e/`)

Read `tests/e2e/README.md` Technical Guidelines before editing any file here.

**These tests require a live Docker stack.** Run with `npm run test:e2e:docker:full`,
not `npm run test:e2e` (which expects Docker-internal hostnames from the host).
Run `npm run typecheck:e2e` after editing: Playwright transpiles specs without typechecking them.
Only `npm run test:unit-js` and `npm run build` are appropriate in Copilot's default ephemeral environment.

Key rules:
- **Never hardcode** server URLs or credentials — always use `process.env.MCP_SERVER_URL`
- `EXPECTED_TOOL_COUNT` must be updated to the current total whenever a tool is added or removed
- **File-size target: 500 lines per spec file.** Files over 700 lines must be evaluated for a
  split, EXCEPT `docker-all-tools.e2e.spec.ts`: #366 removed a per-domain split of exactly that
  file because nothing ever executed it
- **Do not duplicate helpers.** Import transport utilities from `tests/shared/e2e-helpers.ts`
  (and `tests/shared/mcp-protocol.js` for JS callers), and import `test` plus the make*
  factories from `tests/e2e/fixtures.ts`, instead of defining helpers locally in spec files
- These are **API-only** tests (HTTP JSON-RPC). Do not use `page.*` or any browser APIs
- Do NOT add `baseURL` interaction patterns — specs call `MCP_SERVER_URL` directly
- Retry logic (`retries: 2`) is configured in `playwright.config.ts` / `playwright.config.docker.ts` — don't add manual retry loops
- **Every test provisions its own data** (#375). Ask the fixtures in `tests/e2e/fixtures.ts`
  (`async ({ mcp, makeAccount }) => ...`); never read an id another test wrote, and never add a
  shared mutable context. A test must pass when run alone with `--grep`
- Everything a factory creates is torn down automatically. For anything no factory owns, call
  `cleanup.add(CLEANUP_ORDER.<kind>, label, fn)`, registering it BEFORE the work so a failed
  assertion still tears down. There is no `afterAll`
- Every tool that performs a mutation **must read the state back and assert it**, and a delete
  test must assert absence from the corresponding list
- Every tool with a UUID parameter needs at least one **negative test** using `'00000000-0000-0000-0000-000000000000'`

### Config files
- Local testing: `playwright.config.ts`
- Docker CI stack: `playwright.config.docker.ts`
