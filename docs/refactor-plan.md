# Refactor & Delivery Plan — Actual MCP Bridge (machine-actionable)

This document is a concise, actionable, and automatable refactor plan that maps directly to this repository's layout. Each step includes the files to change, commands to run, tests to add, and an acceptance criterion so steps can be run and verified by CI.

Principles
- Small changes, one concern per branch/PR.
- Make steps scriptable and idempotent; prefer generator scripts where possible.
- Each change must include at least one automated test (unit or integration) and a CI entry so the PR cannot be merged without passing checks.

Repository conventions (current)
- TypeScript project: `tsconfig.json`, `npm run build` -> `tsc`.
- Generated client lives under `generated/actual-client` and `scripts/generate-tools.ts` produces `src/tools/*` and `src/tools/index.ts`.
- Tool contract: see `src/tools/*` examples (`accounts_list.ts`, `transactions_create.ts`).
- Actual connection helpers: `src/actualConnection.ts`.

High-level pillars (short)
1. Safety & foundation (config, connection lifecycle, health).  
2. Tool generation & registration (OpenAPI -> generated types -> src/tools).  
3. LibreChat UX (capabilities shaping, JSON Schema, progress).  
4. Tests & CI (unit + integration + e2e smoke).  
5. Production readiness (Docker, secrets, rate limiting, observability).

Current status (Oct 30, 2025)
- Generator: `scripts/generate-tools-node.js` / `scripts/generate-tools.ts` is present and used to produce `src/tools/*.ts`. The OpenAPI fragment used for generation lives at `scripts/openapi/actual-openapi.yaml` and was expanded to cover common endpoints (accounts, transactions, categories, payees, budgets).
- Tool modules: generator produced multiple stubs and several are implemented to call the adapter; tool index (`src/tools/index.ts`) is auto-generated.
- Adapter: `src/lib/actual-adapter.ts` now contains thin wrappers for many Actual API methods (getAccounts, addTransactions, importTransactions, getTransactions, getCategories, createCategory, getPayees, createPayee, budgets methods, account create/update/balance). Wrappers include concurrency limiter, retry/backoff, and observability increments.
- Tests: a new smoke test `tests/unit/generated_tools.smoke.test.js` exercises all generated tools with a monkeypatched adapter. Existing smoke tests remain in `tests/unit/`.
- CI: `.github/workflows/ci.yml` runs build, unit smoke tests, the generated tools smoke test, and Playwright e2e smoke on PRs to `develop`/`main`.

What this file is for now
- Use this document as the authoritative checklist for incremental PRs. Each section below is still applicable; the document now records current status and next PR-level actions to finish coverage.

Automatable steps (ordered, each maps to branch/PR)

Step 0 — housekeeping (preconditions)
- Files to check: `package.json`, `tsconfig.json`, `.github/workflows/*` (if any).  
- Command(s):
  - npm ci
  - npm run build
- Acceptance: `npm run build` exits 0 locally and in CI.

Step 1 — Consolidate MCP connection implementation (P0.1)
- Why: remove duplicate JS artifact and ensure canonical TS implementation used by server.  
- Files:
  - canonical: `src/lib/ActualMCPConnection.ts` (confirm it exports the required methods)
  - delete: `src/lib/ActualMCPConnection.js` (if left-over, delete and update imports to `.ts`/`.js` extension as project uses ESM)
- Commands:
  - git checkout -b refactor/consolidate-mcp-connection
  - npm run build
  - npm test (unit tests)
- Tests: add a unit test that imports the connection and calls `fetchCapabilities()` against a mocked tools manager.
- Acceptance:
  - build passes and no runtime import resolves to `.js` file for ActualMCPConnection (grep for `ActualMCPConnection.js` returns nothing).

Step 2 — Centralized typed config and fail-fast validation (P0.2)
- Why: avoid scattered process.env usage and fail early when deployment is misconfigured.
- Files to add/change:
  - add: `src/config.ts` (zod-based config schema)
  - replace direct process.env reads in: `src/index.ts`, `src/actualConnection.ts`, `server/*` with imports from `src/config.ts`
- Commands:
  - git checkout -b chore/config-validation
  - npm i zod --save
  - npm run build
- Tests: unit tests that run `node dist/index.js` with no required env vars and assert non-zero exit (use a small child_process harness in test).
- Acceptance: server exits with helpful message when required envs missing; with vars present server boots.

Step 3 — Explicit Actual connection lifecycle & health (P0.3)
- Why: deterministic connect/shutdown and health endpoints for k8s and CI.
- Files:
  - `src/actualConnection.ts` (ensure it exports: connect(), shutdown(), getConnectionState()) — _this file exists; ensure API semantics match contract_
  - `src/server/httpServer.ts` and `src/server/sseServer.ts` — add GET `/health` that returns connection state.
- Commands:
  - git checkout -b feat/actual-lifecycle-health
  - npm run build
  - npm test
- Tests: integration test that stubs the `@actual-app/api` client, calls `/health`, asserts JSON shape and appropriate status codes.
- Acceptance: `/health` returns 200 + JSON including { initialized: true } after connect called in startup path.

Step 4 — Tool generation & dynamic registration (P1.*)
- Why: programmatically expose Actual API as MCP tools.
- Files to review/update:
  - `scripts/openapi/actual-openapi.yaml` (ensure it contains the ops you want)
  - `scripts/generate-tools.ts` (idempotent generator)
  - `generated/actual-client` (openapi-types and/or client adapter)
  - `src/tools/index.ts` (auto-generated index)
  - `src/actualToolsManager.ts` (dynamically imports `./tools/index.js` and registers tools)
- Commands:
  - node scripts/generate-tools.ts
  - node scripts/generate-tools-node.js
  - npm run build
  - npm run build
- Tests: test that the tools index exports the generated names; unit test invoking `actualToolsManager.initialize()` in a mocked env and asserting getToolNames() includes expected names.
- Acceptance: running generator produces `src/tools/*.ts` and `src/tools/index.ts`, `actualToolsManager.initialize()` loads all tools without runtime errors.

Progress note: generator has been run locally and produced multiple tool stubs. Some of the generated stubs were patched to call the adapter directly (see `src/tools/*` files). The generator is idempotent and will skip hand-edited files.

Step 5 — Capability shaping & LibreChat UX (P2.*)
- Why: LibreChat needs friendly tool metadata + JSON Schema to render forms.
- Files:
  - `src/lib/ActualMCPConnection.ts` (fetchCapabilities implementation)
  - `src/tools/*` (ensure each tool exports `inputSchema: z.ZodType` where possible)
  - `src/types/tool.d.ts` (tool contract)
- Commands:
  - npm run build
  - run a quick script that imports `ActualMCPConnection` and calls `fetchCapabilities()` and writes the JSON to a temp file for inspection.
- Tests: unit test for `fetchCapabilities()` that asserts schema & example presence for a representative tool.
- Acceptance: capabilities JSON conforms to MCP expectations and contains `tools[*].inputSchema` (JSON Schema converted from zod).

Step 6 — Progress & long-running ops (P2.2)
- Why: handle budget downloads & bulk imports with progress notifications.
- Files:
  - `src/lib/ActualMCPConnection.ts` (support for progress tokens and notifications on executeTool)
  - tools implementing long operations should accept `_meta.progressToken` and return progress via an injected notifier.
- Tests: simulated long-running tool that emits progress events; assert executeTool returns final result and that notifications would have been emitted.
- Acceptance: long tool can be exercised in an integration test and the server-side notification hook was invoked.

Step 7 — Tests & CI (P3)
- Why: gate merges and ensure regressions are caught early.
- Files:
  - add `.github/workflows/ci.yml` (if not present) to run: npm ci, npm run build, npm test, npm run test:e2e (or a smoke test matrix)
  - ensure `package.json` has scripts for CI (`test`, `test:e2e`, `lint`) — `test:e2e` already exists as Playwright-based.
- Commands:
  - git checkout -b ci/add-ci
  - git add .github/workflows/ci.yml
  - git commit -m "ci: add CI workflow"
- Acceptance: PR shows CI checks and they must pass before merge.

Progress note: CI now runs the generated tools smoke test (`tests/unit/generated_tools.smoke.test.js`) in addition to existing smoke tests and Playwright e2e. Ensure any further generated tools include smoke tests to be picked up by CI.

Step 8 — Production readiness (P4)
- Why: make the service deployable and safe in production.
- Files:
  - Add `Dockerfile` (multi-stage build), `docker-compose.prod.yml` (for local integration), and documentation in `docs/deploy.md`.
  - Add `src/observability.ts` for pino and Prometheus metrics and a `/metrics` endpoint (or integrate a small prom-client collector).
  - Add `src/lib/actual-adapter.ts` to centralize rate limiting (bottleneck/p-queue).  
- Commands:
  - Build image locally: docker build -t actual-mcp-server:local .
  - Run a container with secrets mounted as files under `/run/secrets/`.
- Tests: local integration runs with a real or mocked Actual server against the container; load test to confirm rate limiting.
- Acceptance: container starts, responds to `/health` and `/metrics`, and honors rate limits under a load test.

CI-assisted automation for PR merge (how to achieve the behaviour you requested)
- Local code cannot watch or merge PRs on GitHub without network access and credentials. To approximate the "watch CI and merge PR when green" behaviour, add a GitHub Action that auto-merges PRs when checks are green and required approvals satisfied. Example approach:
  - Use `pull_request_target` workflow triggered on `pull_request` events that runs checks, then uses `github-script` with a repository token scoped to merge PRs when all checks pass and `labels`/`approvals` rules satisfied.
  - Alternatively use `actions-merge` or `peter-evans/enable-pull-request-automerge` with proper branch protection.

What this doc does NOT do (and why)
- It does not perform remote GitHub merges nor monitor remote CI logs (network access required).  
- It does provide file paths, branch names, commands, and tests so an automated agent with repo write + GitHub permissions can execute these steps incrementally.

Next immediate action (automatable)
1. Run generator smoke: `node scripts/generate-tools.ts` and run `npm run build` to ensure generated code compiles.  
2. Create the branch `refactor/consolidate-mcp-connection` and make any minimal changes required to remove duplicate `.js` file, then open a small PR with unit tests.

Notes for implementer automation
- All scripts should exit non-zero on failure. Tests must be added/updated to reflect new behaviors.  
- Prefer adding tests under `tests/` matching repo conventions (see `tests/mcp-client.playwright.spec.ts` as an example for Playwright usage).

-----
Generated: automated refactor plan (machine-friendly). Use this doc as the single source of truth to create small PRs for each step. Each PR should link to its step above.
