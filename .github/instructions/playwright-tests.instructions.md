---
applyTo: "tests/e2e/*.spec.ts"
---

## Rules for Playwright E2E test files (`tests/e2e/`)

- These are **API-only** tests (no browser UI). Do not use `page.*` or browser APIs.
- All specs communicate with the MCP server via HTTP JSON-RPC directly.
- Server URL comes from `process.env.MCP_SERVER_URL` — never hardcode `localhost:3601`
- `EXPECTED_TOOL_COUNT` must be updated to the current total whenever a tool is added or removed
- Tests run with `npm run test:e2e` (requires live MCP server + Actual Budget server)
- For Copilot's default ephemeral environment: only `npm run test:unit-js` and `npm run build` are appropriate
- Do NOT add `baseURL` interaction patterns — specs call `MCP_SERVER_URL` directly
- Retry logic (`retries: 2`) is configured in `playwright.config.ts` — don't add manual retry loops

### Config files
- Local testing: `playwright.config.ts`
- Docker CI stack: `playwright.config.docker.ts`
