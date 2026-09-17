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
| `playwright-version-drift.mjs` | `npm run playwright-version-drift` | #385: asserts every `mcr.microsoft.com/playwright:v<x>` reference (the compose file plus BOTH occurrences in `ci-cd.yml`) matches the `@playwright/test` version the LOCKFILE installs, since that is what actually runs inside the container. They had drifted five minor versions apart, invisibly, because no spec drives a browser: every spec uses the `request` fixture, so the browsers baked into the image are never launched. The first browser-touching spec would have failed with an opaque launch error instead. Fails when it finds NOTHING to check, so a renamed file cannot make it vacuous. |
| `verify-release-ticket-states.mjs` | direct invoke (the `release` skill runs it) | #405: after a release, proves no ticket was closed by ACCIDENT. Enumerates every issue reference in the released commit range, separates the ones the release INTENDED to close (a `(#N)` in a commit subject) from the ones merely mentioned in a body, and reports any mentioned-only ticket that GitHub closed by keyword. Fails CLOSED on a reference it cannot verify. The earlier checks used a timestamp window around the push and missed both #414 and #416: clock skew, queued workflows and a multi-minute release all make a window a guess, while a commit range is deterministic. |

## Leak guard (public repository hygiene)

| Script | Runs in | Purpose |
|---|---|---|
| `check-public-leaks.sh` | `.github/workflows/leak-guard.yml` on every push and PR (`--all --allow-file .leak-guard-allow`); local commit hook | The PUBLIC half: catches home paths, unlisted `~/` roots and reachable addresses by SHAPE, so it needs no list of private names and can run in the open. `.leak-guard-allow` (tracked, public) holds `root` / `prefix` / `email` / `skip` entries for placeholders and third parties, NEVER a private name. `--history` (opt-in, run by hand before publishing) scans every publishable ref and commit message. |
| `check-private-leaks.sh` | local hooks only, never CI | The PRIVATE half: project and folder NAMES that must not become public. The list lives OUTSIDE the repository at `~/.claude/forge-kit/private-names.txt`, because a committed denylist of the names being hidden is an index pointing at them. |

Both scanners fail closed (exit 2 with the file named) when something cannot be read. Findings are fixed in content, not allowed. The same policy is why `/CLAUDE.md`, `.claude/`, `.github/copilot-instructions.md` and the other assistant state and instruction files are gitignored by class (see the "leak-guard baseline" block in `.gitignore`): a fresh checkout never has them, so any guard that reads them must skip loudly when they are absent, and anything CI must be able to run lives at a tracked path.

## Local hooks that must stay testable

| Script | Registered in | Purpose |
|---|---|---|
| `hooks/block-closing-keyword.py` | `.claude/settings.local.json` (`PreToolUse` on `Bash`, local and untracked) | #405: blocks a commit whose message would make GitHub CLOSE a ticket its author is saying they did NOT fix. It lives here rather than under `.claude/hooks/` because `tests/unit/commit_message_closing_keyword.test.js` executes it, and `.claude/` is never checked out in CI. |

## ACL end-to-end (#338 / #343)

| Script | Purpose |
|---|---|
| `acl-e2e.sh` | Builds a complete multi-user environment from nothing: an Actual server bootstrapped with a PASSWORD, restarted with OpenID against a mock IdP, two users, two budget files, per-user access grants, and a fixture at `.release/acl-e2e-fixture.json`. Direct-invoke, no npm wrapper. `--keep` leaves it running for inspection. The password-first ordering is load bearing: an OpenID-only Actual server refuses password login, which `@actual-app/api` is the only auth path for |
| `acl-e2e-verify.mjs` | Runs the ACL scenarios (positive and negative) against that environment, including real tokens fetched from the mock IdP. Invoked automatically at the end of `acl-e2e.sh`; can be re-run standalone against an existing fixture |

Why a script rather than compose: Actual mints user UUIDs at creation time, so the IdP cannot be configured with its claim mappings until after the users exist.
