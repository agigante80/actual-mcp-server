# scripts/

Utility and build scripts. All are invoked via `package.json` scripts or from within the Docker stack — none need to be run directly during normal development.

## Tool verification

| Script | npm script | Purpose |
|---|---|---|
| `verify-tools.js` | `npm run verify-tools` | Loads every tool from `dist/src/tools/` and cross-checks that each is listed in `IMPLEMENTED_TOOLS` in `actualToolsManager.ts`. Exits non-zero on mismatch. |
| `list-actual-api-methods.mjs` | `npm run check:coverage` | Introspects `@actual-app/api` and prints all available methods, useful for spotting uncovered API surface. |

## Runtime helpers

| Script | npm script | Purpose |
|---|---|---|
| `register-tsconfig-paths.js` | (internal) | Registers `tsconfig.json` path aliases for the compiled `dist/` directory before the server starts. Used by `npm run dev` and `npm run test:mcp-client`. |

## Docker / CI bootstrap

| Script | Called by | Purpose |
|---|---|---|
| `bootstrap-and-init.sh` | `docker-compose.test.yaml` | Waits for the Actual Budget server to be healthy, bootstraps the password via HTTP, then calls `import-test-budget.sh`. |
| `import-test-budget.sh` | `bootstrap-and-init.sh` | POSTs `test-data/2026-01-08-Test Budget.zip` (or a custom path via `$1`) to the Actual server's import endpoint. |

## Versioning

| Script | npm script | Purpose |
|---|---|---|
| `version-bump.js` | `npm run release:patch/minor/major` | Bumps the `VERSION` file and syncs `package.json`. |
| `version-check.js` | `npm run version:check` | Asserts `VERSION` file matches `package.json` version. Used in CI. |
| `version-dev.js` | `npm run version:dev` | Prints a dev version string: `x.y.z-dev-<git-hash>`. |

