# AGENTS.md

Guidance for coding agents (and the humans driving them) working on this repository. It follows the [agents.md](https://agents.md/) format. It is a map: the rules an agent would otherwise get wrong, plus links to the docs that hold the detail. Humans should also read [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md).

## Project

Actual MCP Server exposes [Actual Budget](https://actualbudget.org/) to AI assistants over the Model Context Protocol. TypeScript (ESM, NodeNext) on Node.js 22+, `@actual-app/api`, `@modelcontextprotocol/sdk`, Express 5, Zod v4, Playwright. Two transports: HTTP (`--http`, multi-user) and stdio (`--stdio`, Claude Desktop and similar).

Request path: transport (`src/server/httpServer.ts` or `src/server/stdioServer.ts`) to `src/lib/ActualMCPConnection.ts` to `src/actualToolsManager.ts` (tool registry, Zod dispatch) to `src/lib/actual-adapter.ts` (every Actual call) to `@actual-app/api`. Tools live in `src/tools/`. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Setup

```bash
npm ci
cp .env.example .env   # only needed to run against a real Actual server
npm run build
```

Every config variable is documented in [docs/CONFIGURATION.md](docs/CONFIGURATION.md) and [.env.example](.env.example).

## Validate before you commit

Run these in order; all must pass. None needs a live Actual server.

```bash
npm run build                    # TypeScript; unused locals and parameters are errors
npm run verify-tools             # every tool registered (reads dist/, so build first)
npm run test:adapter
npm run test:unit-js
npm run typecheck:e2e
npm run knip                     # dead code is a CI failure
npm run tool-count
npm audit --audit-level=moderate
```

There is no `lint` or `format` script. If `test:adapter` or `test:unit-js` complains about missing Actual settings, export the dummy values CI uses: `ACTUAL_SERVER_URL=http://localhost:5006`, `ACTUAL_PASSWORD=dummy`, `ACTUAL_BUDGET_SYNC_ID=00000000-0000-0000-0000-000000000000`.

## Rules that break things when missed

- **Every Actual API call goes through the adapter** (`withActualApi` and the `adapter.*` methods in `src/lib/actual-adapter.ts`). A raw `@actual-app/api` call outside it does not persist and bypasses the session pool.
- **Never nest one adapter session inside another.** The api lock is not reentrant: a tool must not wrap an `adapter.*` call in a session of its own. The symptom is a 30 second stall ending in `Actual API operation timed out`.
- **Only one tool imports `@actual-app/api` directly**: `src/tools/budget_updates_batch.ts`, which runs raw writes inside a single `adapter.batchBudgetUpdates(...)` session because calling back through `adapter.*` from there would nest. Anywhere else, call `adapter.*`.
- **A read-then-write guard belongs in the adapter**, inside one `queueWriteOperation`, never in the tool.
- **Amounts are integer cents** (`5000` is $50.00, negative is an outflow). **Dates are `YYYY-MM-DD` strings.**
- **Refusals are typed.** Throw `NotFoundRefusal` or `OutOfRangeRefusal` and test with `isPreflightRefusal` (`src/lib/errors.ts`); never decide by matching message text.
- **Never write to stdout** in server code, and never call `console.*`. Under stdio, stdout is the JSON-RPC channel. Use `createModuleLogger('MODULE')` from `src/lib/loggerFactory.ts` with structured metadata.
- **Config is validated in one place**: add a variable to `src/config.ts` (or `RAW_ENV_ALLOWLIST` in `src/lib/config-registry.ts`), `.env.example` and the README env table together; `npm run config-drift` checks all three.
- **Tool annotations are hints**, never an authorisation or safety decision. Nothing in `src/` may branch on them.

## Adding or changing a tool

Follow [docs/NEW_TOOL_CHECKLIST.md](docs/NEW_TOOL_CHECKLIST.md) end to end. New tools use `createTool()` from `src/lib/toolFactory.ts`, are named `actual_<domain>_<action>`, take ids from `CommonSchemas` (`src/lib/schemas/common.ts`), and are added to `IMPLEMENTED_TOOLS` and `src/tools/index.ts`. Path-scoped conventions live in [.github/instructions/](.github/instructions/).

## Tests

- **Unit** tests are `tests/unit/*.test.js`, plain Node scripts. A new file must be appended to the `test:unit-js` chain in `package.json`; there is no glob, so an unlisted file never runs (a unit test fails the build if one is missing).
- **E2E** coverage of the tool surface goes in `tests/e2e/docker-all-tools.e2e.spec.ts`, written against the provisioning fixtures in `tests/e2e/fixtures.ts`. It runs over HTTP and stdio. A new spec file is not collected unless a Playwright project matches it.
- **Integration** modules live in `tests/manual/tests/` and need a live server.
- Include a negative case for every positive one. Details: [docs/TESTING_AND_RELIABILITY.md](docs/TESTING_AND_RELIABILITY.md) and [tests/e2e/README.md](tests/e2e/README.md).

## Contributing a change

- Target the **`develop`** branch. `main` only moves in a release.
- An external PR may be reimplemented on `develop` by the maintainer and closed as superseded rather than merged; the author is kept as co-author on the commit and credited in the release notes.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) and reference the issue: `feat(tools): add actual_x_y (#123)`.
- Tickets follow [docs/guides/ticket-standards.md](docs/guides/ticket-standards.md).
- Do not use em or en dash characters in docs, comments or commit messages; restructure with a colon, comma or parentheses.

## Do not edit

- `VERSION`, `scripts/version-bump.js`, and the `**Version:**` / `**Tool Count:**` markers in docs: the release tooling owns them.
- `types/*.d.ts` and `generated/`. The `@actual-app/core` type stub in `types/` is load bearing.
- `package.json` `overrides`: a last resort for a security advisory only, with the reason recorded.

## Security

- Never commit `.env`, tokens, passwords or budget data.
- Never commit paths from your own machine (home directories and similar); the `Leak guard` CI job rejects them.
- Security reports go through [.github/SECURITY.md](.github/SECURITY.md), not public issues. The threat model is in [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md).

## Precedence

When two sources disagree, the higher one wins:

1. The code and the checks CI enforces.
2. The tracked doc this file links as canonical for a topic (for example [docs/CONFIGURATION.md](docs/CONFIGURATION.md), [docs/TESTING_AND_RELIABILITY.md](docs/TESTING_AND_RELIABILITY.md), [docs/NEW_TOOL_CHECKLIST.md](docs/NEW_TOOL_CHECKLIST.md)).
3. This file.
4. The path-scoped files in [.github/instructions/](.github/instructions/), which add detail for their `applyTo` glob and must not contradict the three above.

If you find a disagreement, fix the lower source or open an issue; do not follow it.

## More documentation

| Topic | Where |
|-------|-------|
| Components, transports, data flow | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Configuration inventory | [docs/CONFIGURATION.md](docs/CONFIGURATION.md) |
| Testing layers and test-file inventory | [docs/TESTING_AND_RELIABILITY.md](docs/TESTING_AND_RELIABILITY.md) |
| Adding a tool | [docs/NEW_TOOL_CHECKLIST.md](docs/NEW_TOOL_CHECKLIST.md) |
| Deployment and Docker | [docs/guides/DEPLOYMENT.md](docs/guides/DEPLOYMENT.md) |
| Client setup (LibreChat, Claude Desktop and others) | [docs/guides/AI_CLIENT_SETUP.md](docs/guides/AI_CLIENT_SETUP.md), [docs/guides/MCP_CLIENTS_SETUP.md](docs/guides/MCP_CLIENTS_SETUP.md) |
| Scripts | [scripts/README.md](scripts/README.md) |
