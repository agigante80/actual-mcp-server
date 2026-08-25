# scripts/

Utility and build scripts. All are invoked via `package.json` scripts or from within the Docker stack: none need to be run directly during normal development.

## Deployment & maintenance

| Script | npm script | Purpose |
|---|---|---|
| `deploy-and-test.sh` | `npm run deploy:full` / `npm run deploy:smoke` | **Periodic maintenance script.** Syncs latest dev code → rebuilds MCP Docker image → pulls latest upstream images (Actual Budget, LibreChat, LobeChat) → independently restarts each service → waits for MCP health → runs the full integration test suite with auto-cleanup. Requires all four services to already be installed and running. See `$DOCKER_DIR/README.md` and sub-folder READMEs for setup instructions. |

### Running deploy-and-test.sh

**Basic usage:**
```bash
bash scripts/deploy-and-test.sh          # defaults to 'smoke' level (no writes)
bash scripts/deploy-and-test.sh full     # full CRUD + advanced tests
bash scripts/deploy-and-test.sh smoke    # read-only sanity checks
```

**With bank sync testing enabled:**
```bash
# Enable bank sync tests for accounts with GoCardless/SimpleFIN credentials
MCP_TEST_BANK_SYNC=true bash scripts/deploy-and-test.sh full

# Or export it first
export MCP_TEST_BANK_SYNC=true
bash scripts/deploy-and-test.sh full
```

**What happens when `MCP_TEST_BANK_SYNC=true`:**
- Negative path tests (non-existent UUID) always run
- Per-account iteration tests run (30-90s per bank-linked account)
- Local accounts: validates immediate rejection without provider call
- Bank-linked accounts: tests actual sync with GoCardless/SimpleFIN
- Rate limit/auth failures are logged but don't fail the test run

**Default behavior (`MCP_TEST_BANK_SYNC` unset or `false`):**
- Bank sync tests are skipped with message: `⏭ Bank sync skipped (set MCP_TEST_BANK_SYNC=true to enable)`
- Pre-check logic (local account detection, account validation) is still tested via E2E tests
- See [tests/manual/README.md](../tests/manual/README.md#bank-sync-testing-optional) for more details

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

## Direct Actual Budget connectivity testing

| Script | npm script | Purpose |
|---|---|---|
| `direct-sync/bank-sync-direct.mjs` | `npm run direct-sync` | Connect **directly** to Actual Budget (no MCP layer). Lists all accounts then runs bank sync per account. Use `-- --list` to skip sync, `-- --budget <name>` to target a specific budget, `-- --help` for all options. Reads the same `ACTUAL_*` / `BUDGET_n_*` env vars as the server; writes a timestamped JSON log to `logs/direct-sync-*.log`. Useful for diagnosing GoCardless/SimpleFIN issues and validating server connectivity independently of MCP. |

## Audit maintenance

| Script | npm script | Purpose |
|--------|-----------|---------|
| `check-write-effect-audit.mjs` | `npm run audit:write-effect` | Reports when `docs/audit/write-effect-audit.md` was taken against an older `@actual-app/api` than the one installed, and names the dispositions that depend on upstream continuing to throw. **Exits 0 in every path, deliberately.** It runs in the NON-BLOCKING `api-surface-drift` lane and must never gate a build: a check whose result changes with no commit is exactly what killed the release train in #321. |

## Versioning

| Script | npm script | Purpose |
|---|---|---|
| `version-bump.js` | `npm run release:patch/minor/major` | Bumps the `VERSION` file and syncs `package.json`. |
| `version-check.js` | `npm run version:check` | Asserts `VERSION` file matches `package.json` version. Used in CI. |
| `version-dev.js` | `npm run version:dev` | Prints a dev version string: `x.y.z-dev-<git-hash>`. |

## ACL end-to-end (#338 / #343)

| Script | Purpose |
|---|---|
| `acl-e2e.sh` | Builds a complete multi-user environment from nothing: an Actual server bootstrapped with a PASSWORD, restarted with OpenID against a mock IdP, two users, two budget files, per-user access grants, and a fixture at `.release/acl-e2e-fixture.json`. Direct-invoke, no npm wrapper. `--keep` leaves it running for inspection. The password-first ordering is load bearing: an OpenID-only Actual server refuses password login, which `@actual-app/api` is the only auth path for |
| `acl-e2e-verify.mjs` | Runs the ACL scenarios (positive and negative) against that environment, including real tokens fetched from the mock IdP. Invoked automatically at the end of `acl-e2e.sh`; can be re-run standalone against an existing fixture |

Why a script rather than compose: Actual mints user UUIDs at creation time, so the IdP cannot be configured with its claim mappings until after the users exist.
