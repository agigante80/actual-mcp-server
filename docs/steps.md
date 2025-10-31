# Implementation Steps for actual-mcp-server (detailed)

This document contains the detailed, actionable steps referenced from `docs/plan.md`.

Sections
--------
- P0 Foundation
- P1 Tool generation pipeline
- P2 Core tool coverage
- P3 Adapter hardening
- P4 Capabilities & UX
- P5 CI & Tests
- P6 Production readiness

P0 Foundation
-------------
See `src/` for the TypeScript sources and `tsconfig.json`.

- Verify: `npm ci && npm run build` passes locally.
- Health endpoints: `/health` implemented in `src/server/httpServer.ts`.

P1 Tool generation pipeline
---------------------------
- Generator scripts: `scripts/generate-tools.ts` and `scripts/generate-tools-node.js`.
- Generated types: `generated/actual-client/types.ts`.
- Run generator: `node scripts/generate-tools-node.js`.

P2 Core tool coverage
---------------------
- Tools live in `src/tools/`.
- Each tool should export a `ToolDefinition` with `inputSchema` and `call()`.

P3 Adapter hardening
--------------------
- Adapter: `src/lib/actual-adapter.ts` (normalization, concurrency, retries).
- Tests: `npm run test:adapter`.

P4 Capabilities & UX
--------------------
- `fetchCapabilities` implemented in `src/actualToolsManager.ts`.

P5 CI & Tests
-------------
- Quick checks: `npm run build` and `node tests/unit/generated_tools.smoke.test.js`.
- Full e2e: `npm run test:e2e` (Playwright).

P6 Production readiness
----------------------
- Add Dockerfile, secrets handling docs, `/metrics`, and k8s manifests.


If you want me to open small PRs for P0/P2/P3, tell me which one to start with.
