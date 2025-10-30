# Implementation Plan (Copilot-friendly)

This file lists prioritized, actionable tasks written so GitHub Copilot can implement them directly. Each task includes: goal, branch name, files to edit/create, exact commands to run locally, acceptance tests, and PR metadata (title + description template).

---

PREREQUISITES
- Node >= 18, npm installed
- Run: npm ci
- Optional: install openapi-tools if generating client (openapi-typescript, openapi-generator-cli)

---

P0 — Foundation (do these first)

1) Consolidate MCP connection implementation
- Goal: Ensure a single TypeScript MCP connection exists and remove duplicate JS file.
- Branch: refactor/consolidate-mcp-connection
- Files:
  - modify: src/lib/ActualMCPConnection.ts
  - delete: src/lib/ActualMCPConnection.js
- Commands:
  - git checkout -b refactor/consolidate-mcp-connection
  - edit files as needed
  - npm run build
  - git add -A && git commit -m "refactor(actual): consolidate MCP connection into TypeScript"
  - git push -u origin refactor/consolidate-mcp-connection
- Acceptance:
  - npm run build succeeds
  - grep -R "ActualMCPConnection.js" returns no results
  - Server starts and returns capabilities: run `node dist/index.js --http` and probe `/.well-known/oauth-protected-resource`
- PR title: "refactor: consolidate ActualMCPConnection into TypeScript"
- PR description template: short summary, run `npm run build`, confirm `/.well-known/oauth-protected-resource` returns capabilities.

2) Centralize & validate config
- Goal: Add typed config loader and validate env vars at startup.
- Branch: chore/config-validation
- Files:
  - add: src/config.ts
  - modify: src/actualConnection.ts, src/index.ts (replace direct process.env reads)
- Commands:
  - git checkout -b chore/config-validation
  - npm i zod
  - implement src/config.ts using zod
  - npm run build
- Acceptance:
  - Running without ACTUAL_SERVER_URL/ACTUAL_PASSWORD/ACTUAL_BUDGET_SYNC_ID exits with clear error and non-zero code
  - With env vars present, app boots normally
- PR title: "chore: add env validation and typed config"
- PR description template: describe validated env vars and show example error message when missing.

3) Actual lifecycle & health endpoint
- Goal: Export connect()/shutdown()/getConnectionState() and add /health endpoint.
- Branch: feat/actual-lifecycle-health
- Files:
  - modify: src/actualConnection.ts (export lifecycle functions and state getters)
  - modify/create: src/server/httpServer.ts, src/server/sseServer.ts (add GET /health)
- Commands:
  - git checkout -b feat/actual-lifecycle-health
  - implement changes, npm run build
- Acceptance:
  - GET /health returns { status: 'ok', actualConnected: true } after connect
  - Docker healthcheck can use this endpoint
- PR title: "feat: expose Actual lifecycle API and add health endpoint"

---

P1 — Full Actual API coverage (automation)

4) Generate typed client from OpenAPI (or hand-authored spec)
- Goal: Create TypeScript types and a thin client wrapper for Actual API endpoints.
- Branch: feat/generate-client
- Files:
  - add: scripts/openapi/actual-openapi.json (or .yaml)
  - add: scripts/generate-client.sh or scripts/generate-client.ts
  - add: generated/actual-types.ts and generated/actual-client.ts (optional to commit)
- Commands (example using openapi-typescript):
  - npm i -D openapi-typescript
  - npx openapi-typescript scripts/openapi/actual-openapi.json --output generated/actual-types.ts
  - (optional) run openapi-generator to create axios client
- Acceptance:
  - generated types compile with tsc
  - basic typed calls like actualClient.accounts.list() are available
- PR title: "feat(api): generate typed Actual API client"

5) Tool module generator (one tool file per API operation)
- Goal: Create scripts/generate-tools.ts that converts OpenAPI operations into src/tools/*.ts modules importing the typed client.
- Branch: feat/generate-tools
- Files:
  - add: scripts/generate-tools.ts
  - add: src/tools/ (generated files)
  - add: src/tools/index.ts (re-exports all tools)
- Tool module contract (exact):
  - default export: {
      name: string, // e.g., actual.accounts.list
      description: string,
      inputSchema: zod schema,
      call: async (args: any) => Promise<any>
    }
- Commands:
  - git checkout -b feat/generate-tools
  - node scripts/generate-tools.ts
- Acceptance:
  - src/tools contains tool files for operations in the OpenAPI
  - actualToolsManager.initialize() registers those tools
- PR title: "feat: generate MCP tools from OpenAPI"

6) Dynamic registration of tools
- Goal: actualToolsManager imports src/tools/index.ts and registers each tool module automatically.
- Branch: feat/dynamic-tools-registration
- Files:
  - modify: src/actualToolsManager.ts
  - add: src/tools/index.ts (generated or hand-maintained)
- Commands:
  - git checkout -b feat/dynamic-tools-registration
  - implement dynamic registration pattern (import all default exports and call register)
- Acceptance:
  - actualToolsManager.getToolNames() returns tools from src/tools
- PR title: "refactor: dynamic tool registration from src/tools"

---

P2 — LibreChat UX & behavior

7) Capability payload fidelity for LibreChat
- Goal: Ensure each tool exposes title, description, JSON Schema input, and examples to LibreChat.
- Branch: feat/librechat-capabilities
- Files:
  - modify: src/lib/ActualMCPConnection.ts (fetchCapabilities should use actualToolsManager metadata)
  - ensure: each src/tools/*.ts exports inputSchema and optional examples
- Commands:
  - git checkout -b feat/librechat-capabilities
  - npm run build
- Acceptance:
  - LibreChat can discover and render forms based on published inputSchema
- PR title: "feat: include detailed tool metadata for LibreChat"

8) Progress notifications for long-running tasks
- Goal: Support progressToken in executeTool and have tools call server.notification for progress updates.
- Branch: feat/progress-support
- Files:
  - modify: src/lib/ActualMCPConnection.ts (executeTool signature extended to accept meta and send notifications)
  - modify tools that are long-running (e.g., downloadBudget) to accept progressToken
- Commands:
  - git checkout -b feat/progress-support
- Acceptance:
  - Long-running tool emits progress notifications and client receives them
- PR title: "feat: support progress notifications for long-running tools"

---

P3 — Tests, CI, and observability

9) Add unit tests & CI
- Goal: Add Vitest/Jest tests and GitHub Actions CI pipeline.
- Branch: chore/testing-ci
- Files:
  - add: vitest config or jest config
  - add: src/__tests__/config.test.ts, actualToolsManager.test.ts, actualConnection.test.ts
  - add: .github/workflows/ci.yml
- Commands:
  - git checkout -b chore/testing-ci
  - npm i -D vitest @types/node
  - npm run test
- Acceptance:
  - Tests pass locally and in CI
- PR title: "test: add unit tests and CI"

10) Observability and rate limiting
- Goal: Add simple Prometheus metrics and a concurrency adapter (bottleneck/p-queue) for Actual API calls.
- Branch: feat/observability-rate-limit
- Files:
  - add: src/observability.ts, src/lib/actual-adapter.ts
  - modify: actualToolsManager to use adapter
- Commands:
  - git checkout -b feat/observability-rate-limit
- Acceptance:
  - /metrics endpoint exposes call_count and error_count
  - Concurrency limit enforced under simulated load
- PR title: "feat: add metrics and rate limiting"

---

P4 — Production

11) Docker & k8s polish
- Goal: Finalize Dockerfile and production compose/k8s manifests using secrets and volumes.
- Branch: chore/docker-production
- Files:
  - modify/create: Dockerfile, docker-compose.prod.yml, k8s manifests (optional)
- Commands:
  - docker compose -f docker-compose.prod.yml up -d --build
- Acceptance:
  - Container runs as non-root, reads secrets from /run/secrets, mounts MCP_BRIDGE_DATA_DIR to a volume
- PR title: "chore: production Docker and k8s manifests"

12) API coverage completeness
- Goal: Iterate generator and tools until all operations in Actual API reference are covered.
- Branch: feat/full-api-coverage
- Files:
  - update: scripts/openapi/actual-openapi.json
  - run: node scripts/generate-tools.ts repeatedly until all operations are represented
- Acceptance:
  - For every path in Actual API reference there's a corresponding src/tools module
- PR title: "feat(api): full Actual API coverage (generated tools)"

---

HOW TO USE THIS PLAN WITH COPILOT
- For each task, open the branch, create the minimal files specified, run the commands above, and push the branch.
- Use the exact branch names and PR titles so CI and reviewers can follow incremental changes.
- Keep PRs small and focused: one major intent per PR.

---

Contact & next step
I created this plan to be directly actionable by Copilot and developers. I will now write this file into docs/plan.md on the main branch.