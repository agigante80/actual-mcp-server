# Testing & Reliability

**Project:** Actual MCP Server  
**Version:** 0.9.5  
**Purpose:** Define testing philosophy, frameworks, and enforcement policies  
**Last Updated:** 2026-06-07

---

## 🎯 Testing Philosophy

### Core Principles

1. **Test Before Commit**: No code is committed without passing tests
2. **Test Pyramid**: Unit tests (most) → Integration tests → E2E tests (least)
3. **Fail Fast**: Tests catch issues early in development
4. **Continuous Testing**: CI/CD runs full test suite on every push
5. **Real-World Scenarios**: Tests reflect actual usage patterns

### Testing Goals

- **Prevent Regressions**: Catch breaking changes before they reach production
- **Document Behavior**: Tests serve as living documentation
- **Enable Refactoring**: High coverage enables confident code changes
- **Ensure Reliability**: Production code works as expected

---

## 🧪 Testing Frameworks & Tools

### Testing Stack

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js Built-in** | Native | Unit test runner |
| **TypeScript** | ^6.0.3 | Type checking (compile-time testing) |
| **Playwright** | ^1.60.0 | End-to-end testing |
| **Custom Adapter Tests** | N/A | Smoke tests for Actual API |
| **npm audit** | Native | Security vulnerability scanning |

### Test Categories

```
tests/
├── unit/                    # Unit tests (fast, isolated, offline)
│   ├── transactions_create.test.js        # Zod schema validation (transactions_create)
│   ├── generated_tools.smoke.test.js      # All 71 tools: stub adapter + correctness assertions
│   ├── schema_validation.test.js          # Negative-path schema tests (11+ tool schemas)
│   └── schema_json_openai_compat.test.js  # Published schemas OpenAI/ECMA-262 regex-compatible (#293)
├── e2e/                     # End-to-end tests
│   ├── mcp-client.playwright.spec.ts      # Protocol tests (fast, no Docker)
│   ├── docker.e2e.spec.ts                 # Docker smoke integration (full stack)
│   ├── docker-all-tools.e2e.spec.ts       # All-tools Docker E2E (71 tools)
│   └── run-docker-e2e.sh                  # Docker test orchestrator
└── manual/                  # Live integration tests (real Actual Budget)
    ├── index.js              # Entry point, level-gated execution
    ├── cleanup.js            # Standalone MCP-* data cleanup
    └── tests/               # Per-domain test modules (13 files)
```

**Docker-based E2E Tests**: Full stack integration testing with real Actual Budget server in Docker.

---

## 🏃 Running Tests

### Quick Start

```bash
# Run all tests (recommended)
npm run test:all

# Run protocol tests (fast, ~10s)
npm run test:e2e

# Run Docker integration tests (thorough, ~60s)
npm run test:e2e:docker
```

### Test Types

| Command | Type | Speed | Scope | When to Use |
|---------|------|-------|-------|-------------|
| `npm run test:adapter` | Smoke | ⚡ 30s | Adapter layer | Pre-commit |
| `npm run test:unit-js` | Unit | ⚡ 5s | Single unit | Development |
| `npm run test:e2e` | Protocol | ⚡ 10s | MCP protocol | Pre-commit |
| `npm run test:e2e:docker` | Integration | 🐢 60s | Full stack | Pre-merge |
| `npm run test:all` | All | 🐢 90s | Everything | Before release |

### Pre-Commit Tests (Essential)

```bash
# Essential tests before commit
npm run build                    # TypeScript compilation & type checking
npm run test:adapter             # Adapter smoke tests (30s)
npm run test:unit-js             # Unit + schema tests (3s)
npm audit --audit-level=moderate # Security check
```

### Full Test Suite

```bash
# Complete test suite
npm run test:all             # Runs: adapter + unit + Docker E2E (smoke)

# Or run individually:
npm run build                # Build TypeScript
npm run test:adapter         # Adapter tests
npm run test:unit-js         # Unit tests: schema, smoke, negative-path
npm run test:e2e             # Protocol tests (fast, no Docker)
npm run test:e2e:docker      # Docker integration smoke (thorough)
npm audit                    # Security audit
```

### Docker E2E Tests

**Full stack integration testing with real Actual Budget server:**

```bash
# Run Docker-based E2E tests (quick smoke tests)
npm run test:e2e:docker

# Run comprehensive ALL TOOLS test (50+ tests)
npx playwright test tests/e2e/docker-all-tools.e2e.spec.ts

# Advanced options
./tests/e2e/run-docker-e2e.sh --no-cleanup   # Leave containers for debugging
./tests/e2e/run-docker-e2e.sh --verbose      # Detailed output
./tests/e2e/run-docker-e2e.sh --build-only   # Just build, don't test
```

**What Docker E2E tests verify:**
- ✅ Docker build works correctly
- ✅ Container networking (MCP ↔ Actual Budget)
- ✅ Real tool execution (**all 71 tools at 100% coverage**)
- ✅ Session management and persistence
- ✅ Production-like deployment
- ✅ Error handling and validation (15+ error scenarios)
- ✅ Regression tests (strict validation, batch operations)

**Test Suites:**
- **docker.e2e.spec.ts**: Basic smoke tests (11 tests)
- **docker-all-tools.e2e.spec.ts**: Comprehensive all-tools test (71 tools, 80+ test cases)

### Individual Test Commands

```bash
# TypeScript compilation (includes type checking)
npm run build

# Adapter smoke tests
npm run test:adapter

# Unit tests
npm run test:unit-js

# Protocol E2E tests (no Docker required)
npm run test:e2e

# Docker integration tests (requires Docker)
npm run test:e2e:docker

# Test Actual connection
npm run dev -- --test-actual-connection

# Test MCP client interaction
npm run test:mcp-client
```

---

## ✅ Testing Policy

### Mandatory Testing Policy

> ⚠️ **CRITICAL**: No code may be committed or pushed until **all** local tests pass.

### Pre-Commit Checklist

Before running `git commit`:

- [ ] `npm run build`: ✅ No TypeScript errors
- [ ] `npm run test:adapter`: ✅ All adapter tests pass
- [ ] `npm run test:unit-js`: ✅ All unit + schema tests pass (~52 files)
- [ ] `npm audit --audit-level=moderate`: ✅ No moderate/high/critical vulnerabilities

### CI/CD Enforcement

GitHub Actions automatically runs:
- TypeScript compilation
- All test suites
- Security audit
- Docker build test
- Tool coverage verification

**If CI/CD fails:**
1. ❌ Pull request cannot be merged
2. ❌ No Docker images published
3. ❌ No GitHub releases created

---

## 🔬 Test Types

### 1. Unit Tests

**Purpose**: Test individual functions in isolation

**Location**: `tests/unit/*.js`

**Files**:
| File | What it tests |
|---|---|
| `transactions_create.test.js` | Zod schema: valid input accepted, empty input rejected |
| `generated_tools.smoke.test.js` | All 71 tools: stub adapter, call succeeds, response shape correct |
| `schema_validation.test.js` | Negative-path schemas: `rules_create`, `budget_updates_batch`, `budgets_transfer`, `budgets_setAmount` |
| `schema_json_openai_compat.test.js` | Every published tool schema is OpenAI/ECMA-262 regex-compatible: no `\p{...}` escape, each `pattern` compiles without the `u` flag (#293) |

**Run**:
```bash
npm run test:unit-js   # runs the full unit chain (~52 files) sequentially
```

**Coverage**: 71/71 tools smoke-validated (offline, stub adapter). 60+ negative-path assertions across 11+ tool schemas.

### 2. Adapter Tests

**Purpose**: Verify Actual API integration

**Location**: `src/tests_adapter_runner.ts`

**What they test**:
- `withActualApi` wrapper lifecycle (init/shutdown)
- Retry logic: 3 attempts, exponential backoff, recovery from transient failures
- Concurrency queue: 5-session limit, overflow queuing
- Adapter-infrastructure assertions only, no tool business logic

**Run**:
```bash
npm run test:adapter
```

### 3. End-to-End Tests

**Purpose**: Test full user workflows

**Location**: `tests/e2e/` (Playwright)

**Framework**: Playwright ^1.60.0

**Scenarios**:
- MCP client connects to server
- LibreChat loads all 71 tools
- User performs complete workflow via chat

**Run**:
```bash
npm run test:e2e
```

**Status**: Fully operational. `docker-all-tools.e2e.spec.ts` covers all 71 tools end-to-end.

### 4. Connection Tests

**Purpose**: Verify Actual Budget connection

**Command**:
```bash
npm run dev -- --test-actual-connection
```

**What it tests**:
- Can connect to Actual Budget server
- Can authenticate with password
- Can download budget data
- Budget data is valid

**Use case**: Quickly verify environment configuration

### 5. Tool Tests (deprecated path; use unit tests instead)

**Purpose**: Smoke test all 71 tools

**Command**:
```bash
npm run test:unit-js
```

**What it tests**:
- All tools are registered
- All tools have valid schemas
- All tools can be called without errors (with stub data)

**Use case**: Verify tool coverage after changes

---

### Hermetic unit suite and chain membership (#321)

Two rules protect every other guard in `tests/unit/`.

**1. No unit test may enumerate the live `@actual-app/api` surface.** A test whose result changes with no commit is not a unit test. `check_coverage.test.js` used to derive its method list from `await import('@actual-app/api')` and assert the genuine-gaps bucket was empty; 26.8.0 added three methods, the test went red, the auto-release train died for two consecutive nights, and security PR #319 was blocked behind the same failure because regenerating its lockfile floated the dependency to 26.8.0.

It now classifies against `FROZEN_API_SURFACE`, a hand-captured fixture that is never regenerated from `node_modules`. The one genuinely external claim, "are there uncovered methods on the live surface", moved out of the unit suite into the `api-surface-drift` lane, where a gap is REPORTED rather than blocking.

The rule is scoped to enumeration. Importing the package to monkeypatch it for mocking is correct and is what 20 unit tests do; an earlier draft of the rule banned the import outright and would have condemned all of them.

**2. Every `tests/unit/*.test.js` must appear in the `test:unit-js` chain.** That chain is a hand-maintained `node A && node B && ...` list with no glob, so an unlisted file never runs in CI or in the mandatory pre-commit sequence while still reading as coverage. `server_info.test.js` and `transfers_create.test.js` were already orphaned this way; both passed and were simply added. `tests/unit/unit_chain_membership.test.js` enforces membership, carries an allowlist that requires a non-empty reason per entry, and ships with that allowlist empty.

---

### Gate parity between CI and the release train (#322)

The release train could **tag what CI would reject.** ci-cd's Lint job ran `knip`, and the repo runs `node-version-drift`, and neither ran in the train, so a dependency bump introducing dead code or an inconsistent Node pin would publish while an ordinary PR carrying the same change was blocked.

**Deliberately not solved by extracting a reusable workflow.** `on: workflow_call` is a job-level construct: it runs on its own runner with its own checkout. The train gates a commit that exists only in the runner's local git (the working branch is pushed to origin *after* the gate) against a `node_modules` mutated in-job. A reusable workflow would gate the **pre-upgrade tree** and report green, which is the same defect class #322 was filed to fix.

The gate's CONTENT is already single-sourced, in `package.json` scripts. What was missing was PRESENCE. So the fix is two steps in the train plus an invariant, not a new abstraction:

| Check | ci-cd | Train | Note |
|---|---|---|---|
| `build` | yes | yes | runs twice in the train (own step plus the #297 re-verify) |
| `test:unit-js` | yes | yes | likewise |
| `knip` | yes | yes | added by #322 |
| `node-version-drift` | yes | yes | added by #322 |
| `actionlint` | yes | **no** | excluded permanently, see below |
| `check:coverage` | yes | **no** | excluded permanently by #321 |

**`actionlint` is excluded on purpose, and permanently (#328).** The reason first recorded here ("pin the installer, then add it") was wrong: #328 pinned the installer and the exclusion still stands. The real reason is **reachability**. The train's only file mutations are `sed -i` on `README.md` and `npm run version:bump`, which writes `README.md`, `docs/*.md` and `.github/copilot-instructions.md`. Nothing under `.github/workflows/` changes, so actionlint's entire input surface is outside the train's mutation set. #322's rationale was "the train could tag what CI would reject", which is a reachability test rather than a completeness checklist: `knip`, `build` and `test:unit-js` earn their place because the dependency bump changes what they inspect, and actionlint does not. It is also already covered on the published tree, since `ci-cd.yml` triggers on tags with no ref filter on its lint job and the train watches that run with `gh run watch --exit-status`.

**`check:coverage` is excluded permanently.** It enumerates the live `@actual-app/api` surface, which is exactly what killed the train (#321).

Invariant `(q1)` asserts set equality against `PARITY_CHECKS` so the two lanes cannot drift apart again, `(q2)` and `(q3)` pin the two exclusions along with their reasons, and the counter-fixture removes each check globally rather than once, because two of them run twice and a single-shot fixture would have proved nothing.

---

### The stdio framing gate (#323)

The release train runs `test:e2e:docker:full` against a live Actual Budget server, so **HTTP already has real integration coverage with real write paths**. stdio, the transport Claude Desktop users run, had none.

**The risk is narrower than it first appears.** The ticket was written around "a new `@actual-app/api` version that adds a `console.log` would silently break every Claude Desktop user". That is not true: `src/logger.ts` already replaces `console.log/info/warn/error/debug`, and `@actual-app/api` already calls `console.log` at 14 sites today while stdio works fine.

The genuinely uncovered failure mode is a direct **`process.stdout.write`**, which the console hijack does not intercept and which is patched nowhere in `src/`. A raw byte on fd 1 corrupts JSON-RPC framing for every stdio client.

**Tiered, deliberately.**

| Tier | What | Blocking? |
|---|---|---|
| 1 | `scripts/stdio-framing-check.mjs`: boots the server over stdio and asserts every stdout byte parses as newline-delimited JSON-RPC | **Yes**, in the train |
| 2 | The full dual-transport run (`scripts/deploy-and-test.sh`) | No. Remains the local main-promotion gate |

Tier 1 is under a minute and deterministic. The full run is 30 to 35 minutes against a job whose step caps already consume most of its budget, so making it blocking would need a cap near 130 and would materially raise the chance of a **job-level cancel**, the unattributable state #325 exists to prevent. It would also put the flakiest suite in the repo on the critical path of an unattended publisher.

It does **not** use the SDK's `StdioClientTransport`. That transport consumes stdout to parse frames, so it structurally cannot report a raw byte that never formed a frame, and that byte is the entire subject of the check.

**Two CI mechanics that are easy to get wrong, both encoded as tests:**

1. **The sync id does not cross the `docker exec` boundary.** `docker-compose.test.yaml` does not carry `ACTUAL_BUDGET_SYNC_ID` in its `environment:` block. The service entrypoint reads `/tmp/actual-sync-id.txt` and `export`s it, so it lives in PID 1's runtime environment, and `docker exec` builds a new process's environment from container **config**, not from PID 1. It arrives empty. The framing check reads the same file the entrypoint reads.
2. **The stdio data dir must be writable and must be neither `/tmp` nor `/app/data`.** `/tmp` is mounted `bootstrap-data:/tmp:ro`, so a `mkdir` there fails, and it fails inside a bare `catch {}` that resurfaces later as an ENOENT during adapter init. `/app/data` is the HTTP server's own directory, and #280 established that two `@actual-app/api` instances must never share one budget cache.

---

### Train liveness: detecting a train that never RAN (#327)

`report-train-failure.mjs` reports a train that **failed**. It cannot report one that **never ran**, because no run means no reporter job, which lands in the same found-by-eye state #325 was filed to fix.

Two verified causes:

- **GitHub disables scheduled workflows in PUBLIC repositories after 60 days of repository inactivity.** This repo is public, so it applies. Near-daily commits keep resetting the clock, so this is the lower-probability cause today.
- **Cron dispatches are delayed under load and dropped under sufficiently high load.** GitHub does not guarantee a scheduled run fires. This is the live cause, and it is why the train's cron moved off minute 0, the top-of-hour peak GitHub advises scheduling away from.

**Two signals, because they detect disjoint failures.** The workflow `state` field (`active`, `disabled_manually`, `disabled_inactivity`) is directly observable, immediate and threshold-free, and catches a disabled workflow. Recency of the newest `event=schedule` run catches a workflow that is `active` but not firing anyway. Recency alone was the original proposal and is the worse primary: it is a derived proxy that cannot fire until the threshold has elapsed.

Two query details are load bearing:

- **`event=schedule` is filtered.** `dependency-update.yml` also carries `workflow_dispatch`, and manually dispatching the train is the *first* diagnostic step when it looks dead. An unfiltered query would let that diagnostic reset the liveness clock while the cron stayed dead. Status is deliberately **not** filtered: a scheduled run that failed still proves the cron fired, and reporting that failure is #325's job.
- **`created_at`, not `run_started_at`.** `created_at` timestamps the dispatch, which is the property under test. `run_started_at` conflates dispatch with runner availability and would report a queued-but-dispatched run as a dead cron.

**Why this is a separate reporter rather than a `stale` member of `TRAIN_OUTCOME`.** Trace `classifyOutcome`'s gate order. Passing `stale` *without* adding it to `KNOWN_OUTCOMES` files a mislabelled "the release train failed" issue pointing at the wrong run. *Adding* it to `KNOWN_OUTCOMES` passes the unknown-value gate, fails the rest, and falls through to `{action:'ignore'}`: exit 0, green, nothing filed. That is the exact defect this ticket exists to eliminate, reproduced inside its own fix.

This is the **inverse** of the `noop_soaking` lesson, where omission from the set caused a false P1 nightly. There the fix was to add the member; here adding it is the silent branch. Two mitigations pulling in opposite directions is why the classifier is separate rather than a judgement call.

**Its own label, for the same reason.** Sharing #325's `train-failure` marker would mean this reporter's healthy path hits `decideTransition`'s `close_all` and closes every open train-failure issue with a comment falsely asserting recovery. Because `ci-cd.yml` runs on every push to `develop`, a genuine unresolved failure would be auto-closed within minutes of the next routine push. The liveness reporter uses `train-stale`, and its healthy steady state performs **zero** tracker writes.

**Accepted limitation:** the check lives in `ci-cd.yml` and so is itself conditional on pushes to `develop`. A genuinely dormant repository silences both it and the cron. That is the same 60-day dormancy that disables the schedule in the first place, so it is recorded as accepted rather than papered over.

---

### The API surface drift lane (#321)

The live `@actual-app/api` surface moves without a commit. That signal used to live inside a unit test, which is why an upstream release could turn the suite red with nobody touching the repo. The signal is real; it is not a unit test. It lives in `.github/workflows/api-surface-drift.yml`, on `schedule` plus `workflow_dispatch` only.

**Non-blocking is structural, not conventional.** Nothing in `ci-cd.yml` or `dependency-update.yml` declares `needs:` on either job, and there is no `pull_request` trigger, so a red run cannot gate a merge or the release train. Invariant (d6) enforces it.

| Job | Permissions | Does |
|---|---|---|
| `detect` | `contents: read` | `npm ci`, reads the live surface, classifies against the baseline, emits JSON as a job output. Holds no tracker-write token. |
| `report` | `issues: write`, `contents: read` | Consumes that JSON and files or dedupes issues. Runs no `npm ci` and never imports `@actual-app/api`. |

The split is mandatory for the same reason as #325's, with more force: reading the surface means `await import('@actual-app/api')`, which **executes upstream top-level module code in-process**. That must never share a process with a tracker-write token.

**Four conditions, not one:**

| # | Condition | Result |
|---|---|---|
| 1 | New uncovered method, not in `accepted` | Red, files one issue |
| 2 | Stale baseline entry: now covered, or no longer exported | Red, no filing |
| 3 | **Removed covered method**: `API_TO_TOOL` maps a method the surface no longer exports | Red, files a P1 |
| 4 | `accepted` larger than `maxAccepted` | Red, no filing |

Condition 3 is the dangerous direction and the one the original design missed. Additions are benign (a feature we lack); a removal means a shipped MCP tool calls a method that does not exist, failing at runtime in a user's budget. `mappingErrors` does not catch it: that only checks the mapped TOOL exists in `IMPLEMENTED_TOOLS`, never that the mapped METHOD still exists upstream.

**Redness and re-filing are separate mechanisms.** `docs/audit/api-coverage-baseline.json` is a committed file, so CI cannot write it; a baseline entry therefore suppresses REDNESS only. Re-filing is suppressed by a tracker query on the `api-coverage-gap` label for a `<!-- api-gap:METHOD -->` body sentinel, with `state=all` rather than `state=open`, because a maintainer closing a gap as wontfix has made a permanent decision. That query paginates to exhaustion; a single page would silently stop suppressing once 100 such issues exist.

Auto-committing the baseline from CI is rejected: an auto-written entry would carry an empty reason and no owning issue, letting the machine grant its own acceptance, and it would need `contents: write` on a job that must stay low-privilege.

Gap names come from `Object.keys()` over a third-party module namespace, so they are validated against a strict identifier pattern before reaching an issue title or body, and per-run filing volume is capped at 5 with the overflow reported.

---

### Release-train failure notification (#325)

The `@actual-app/api` auto-release train publishes unattended, so **the notification is its only human interface.** It was silently dead for two consecutive nights before anyone noticed by eye, which is what this contract exists to prevent.

**Governing principle: when in doubt, notify.** Every control fails toward reporting, never toward silence. A control that fails quiet reproduces the original defect. Two drafts of the design got this backwards (a strict semver check that refused to file, and a `!cancelled()` guard blind to job timeouts) before review caught it.

`dependency-update.yml` publishes a closed `TRAIN_OUTCOME` enum as a job output; the separate `report-train-failure` job switches on it:

| `TRAIN_OUTCOME` | Reporter action |
|---|---|
| `success` | Close any open failure issue |
| `noop_up_to_date` | Nothing. Not a success, not a failure |
| `noop_denied`, `noop_not_forward` | Nothing. Working as intended (both added by #324, whose pre-flight work owns the denylist and the `sort -V` direction check) |
| `failure` | Open or update the failure issue |
| unset or unrecognised | Treated as `failure` |

Four properties are load bearing:

1. **The enum is corroborated, not trusted.** It is single-sourced and written mid-job, so if it reports any non-`failure` value while a step concluded `failure`, the observed conclusion wins and the disagreement is stated in the issue.
2. **The reporter is a separate job.** The main job runs `npm install @actual-app/api@^$LATEST`, executing registry postinstall code, and holds the App installation token that `actions/checkout` persists into `.git/config`. Granting it `issues: write` would put a tracker-write token in that process. The reporter instead holds only `issues: write` plus `actions: read` and checks out with `persist-credentials: false` and `ref: github.sha`.
3. **No log scraping, ever.** The failing step name comes from the Actions jobs API, which makes "no credential material in the issue body" structural rather than conventional. `::add-mask::` redacts logs, not an API payload.
4. **Errors are asymmetric.** A reporting error on a real failure leaves the run red. A reporting error on a healthy run degrades to a warning annotation, so a tracker blip cannot manufacture a phantom train failure.

Dedupe is on the `train-failure` marker label rather than the version, because `@actual-app/api` has shipped same-day double bumps; a version-scoped issue would be orphaned when the train fails on one and recovers on the next. Recurrences update a counter block in the issue body in place, so an unattended nightly stays readable on night thirty.

There is deliberately **no `concurrency:` group** on the reporter: `cancel-in-progress: false` still evicts a queued run, so a success/failure/success overlap would drop the failure report. Converging duplicate issues onto the oldest is noisy but never silent.

---

## 🛡️ Security Testing

### Dependency Auditing

**Command**:
```bash
npm audit
```

**Severity Levels**:
- **Critical**: Must fix immediately
- **High**: Fix before next release
- **Moderate**: Fix in next patch release
- **Low**: Track but not blocking

**Policy**:
- **Pre-Commit**: No moderate/high/critical vulnerabilities
- **CI/CD**: Fails on high/critical vulnerabilities
- **Regular**: Run `npm audit fix` monthly

### Code Health & Dead-Code Detection (#234)

Dead/unused code (unused files, exports, types, orphaned modules) is detected by **Knip**
via the committed `knip.json`:

```bash
npm run knip            # blocking since #237: exits nonzero on any dead code
```

- **CI/CD**: the `Check for dead code` step in the `Lint Code` job runs `npm run knip` in
  failing mode (#237): it exits nonzero on any unused file/export/type and FAILS the job, so
  new dead code cannot merge. `tests/unit/knip_config.test.js` guards that `scripts.knip`
  stays failing-mode (no `--no-exit-code`).
- **Guard tests** (in `test:unit-js`, fail CI on drift): `tests/unit/knip_config.test.js`
  (every `knip.json` entry root exists on disk) and `tests/unit/advertised_tools_sync.test.js`
  (every `actual_<domain>_<action>` tool name advertised in `README.md` resolves to
  `IMPLEMENTED_TOOLS`, catching documented-but-missing/renamed tools). These join the existing
  doc-to-code drift guards: `tool_count_sync`, `config_drift`, `port_alignment`,
  `dockerfile_data_dir_alignment`, `compose_profile_sync`,
  `workflow_release_guards` (#261: auto-release workflow invariants + lockfile agreement),
  `report_train_failure` (#325: the release-train failure notifier),
  `bot_target_branch` (#265: dependabot blocks and the inert renovate config target develop), and
  `node_version_drift` (#275: `engines.node` is canonical; the Dockerfile `FROM node:` tags,
  every workflow's Node pin, and the README must agree with it. Run standalone with
  `npm run node-version-drift`).
- **Write-queue wakeup guard** (#278): `tests/unit/adapter_write_queue_wakeup.test.js` pins the
  lost-wakeup regression in `src/lib/actual-adapter.ts`. A write enqueued while a previous batch
  was draining used to be stranded (never dispatched, promise never settled) until an unrelated
  later write drained the queue. `withOpTimeout` (#270) cannot catch that: it bounds execution,
  not queue residency. The test also pins the debounce COALESCING property (5 same-tick writes
  produce exactly ONE batch, via `_getWriteQueueBatchCountForTests()`), because a fix that drained
  on every enqueue would close the deadlock and silently multiply init/sync cycles. Cases that
  depend on `ACTUAL_OP_TIMEOUT_MS` run in child processes: `config.ts` reads `process.env` once at
  module load, so an in-process env override is silently ignored and the assertion becomes vacuous.
- **Node floor guard** (#275): `tests/unit/node_version_guard.test.js` covers
  `src/lib/node-version-guard.ts`, which rejects an unsupported interpreter at startup rather
  than letting it die later with a cryptic `ERR_IMPORT_ASSERTION_TYPE_MISSING`. The unit test
  pins the comparator truth table, the fail-open behaviour on an unparseable range, that the
  floor is read from the ROOT `package.json` and not the stale `dist/package.json` mirror, and
  that the module stays dependency-free and stdout-clean. The `Node Floor Guard` CI job proves
  the guard actually fires by running both entry points on a real below-floor Node.
  The same file also covers #277: `--version`, the `--help` banner, and `actual_server_info`
  must all report the ROOT version, asserted on observable process output against a planted
  hostile `dist/package.json`, not by comparing resolver functions to each other. Removing the
  JSON imports from `src/index.ts` also stops `tsc` emitting that mirror in the first place.
- **Periodic deep sweep**: the manual `/code-health-auditor` skill runs Knip plus the drift
  guards, triages against the allowlist, and opens gate-ready tickets for genuine findings
  (cache-first via `docs/audit/deadcode-audit-cache.json`). Run on demand; not scheduled.
  It owns SOURCE dead code; `/dep-auditor` owns DEPENDENCY health.

### Manual Security Checks

```bash
# Check for exposed secrets
git grep -i "password\|token\|secret\|key" -- "*.ts" "*.js" "*.json"

# Verify .env not committed
git log --all --full-history -- .env

# Check Docker image vulnerabilities
docker scout cves actual-mcp-server:latest
```

### Security Testing Tools (Future)

Planned integrations:
- **Snyk**: Continuous security monitoring
- **Dependabot**: Automated dependency updates
- **CodeQL**: Static analysis security testing
- **OWASP ZAP**: Dynamic application security testing

---

## 📊 Test Coverage

### Current Coverage

- **Unit Tests**: schema/shape smoke tests + 23 negative-path assertions across 71 tools
- **Adapter Tests**: Infrastructure smoke (retry, concurrency, lifecycle), not per-tool
- **Docker E2E**: 68/70 tools with named tests (real Actual Budget server); 2 tools excluded (`budgets_list_available` and `budgets_switch` require ≥2 budgets, and the CI stack has 1). All 6 delete tools are named tests with list-absence assertions; `afterAll` is a safety fallback only.
- **Live Integration**: 71/71 tools called against real budget (all delete tools are named tests in `tests/manual/tests/`)

### Coverage Goals

| Test Type | Current | Target | Priority |
|-----------|---------|--------|----------|
| Unit Tests | 80% | 90% | High |
| Adapter Tests | 100% | 100% | Maintain |
| Integration Tests | 71/71 tools (live) | Maintain | Medium |
| E2E Tests | All 71 tools (Docker) | Maintain | Medium |

### Measuring Coverage

**Future Enhancement**: Add coverage reporting

```bash
# Planned - not yet implemented
npm run test:coverage

# Would output:
# File                 | % Stmts | % Branch | % Funcs | % Lines |
# ---------------------|---------|----------|---------|---------|
# src/tools/*.ts       |   85.2  |   78.5   |   92.1  |   86.7  |
# src/lib/*.ts         |   91.3  |   88.2   |   94.5  |   92.1  |
```

**Tool Options**:
- `c8` - Built-in V8 coverage
- `nyc` - Istanbul coverage
- `jest` - Full test framework (if migrating)

---

## 🔄 CI/CD Integration

### GitHub Actions Workflow

**File**: `.github/workflows/ci-cd.yml`

**Stages**:
1. **Lint & Type Check** (3 min)
   - `tsc` - TypeScript compilation
   - `npm run check:coverage` - API coverage auditor: classifies every @actual-app/api method as covered (mapped to a tool), intentionally internal (lifecycle), or a genuine gap, sourcing the tool set from IMPLEMENTED_TOOLS so it cannot drift. Guarded by `tests/unit/check_coverage.test.js` (#187).
   - `npm audit` - Security audit (non-blocking)

2. **Test Suite** (3 min)
   - `npm run build` - Build project
   - `npm run test:adapter` - Adapter smoke tests
   - Upload test results

3. **E2E Tests** (5 min)
   - Playwright E2E test suite

4. **Build Artifacts** (3 min)
   - Build production distribution
   - Generate version info
   - Upload artifacts

5. **Docker Test Build** (2 min)
   - Build Docker image
   - Verify image starts
   - Test health endpoint

6. **Publish** (2 min)
   - Push to Docker Hub
   - Push to GitHub Container Registry
   - Create GitHub release

**Total Duration**: ~18 minutes

**Success Criteria**:
- All tests pass
- No TypeScript errors
- No high/critical vulnerabilities
- Docker build successful

### Local Pre-Push Testing

**Recommended**: Add pre-push hook

```bash
# .husky/pre-push (future enhancement)
#!/bin/sh
npm run build && npm run test:adapter && npm audit --audit-level=moderate
```

---

## 🐛 Debugging Failed Tests

### TypeScript Compilation Errors

```bash
# Full error details
npm run build

# Common fixes:
# - Missing type definitions: npm install -D @types/package-name
# - Type mismatch: Check function signatures
# - Import errors: Verify file paths and extensions
```

### Adapter Test Failures

```bash
# Run with debug logging
DEBUG=true npm run test:adapter

# Check Actual Budget connection
npm run dev -- --test-actual-connection

# Verify environment variables
cat .env | grep ACTUAL_
```

### E2E Test Failures

```bash
# Run Playwright with UI
npx playwright test --ui

# Run specific test
npx playwright test tests/e2e/specific-test.spec.ts

# Debug mode
npx playwright test --debug

# View test report
npx playwright show-report
```

### Security Audit Failures

```bash
# View detailed audit
npm audit

# Attempt automatic fix
npm audit fix

# Force fix (may introduce breaking changes)
npm audit fix --force

# View affected packages
npm audit --json | jq '.vulnerabilities'
```

---

## 🔍 Test Writing Guidelines

### Unit Test Template

```javascript
// tests/unit/my_feature.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { myFeature } from '../../dist/src/my-feature.js';

test('myFeature handles valid input', async () => {
  const result = await myFeature({ input: 'valid' });
  assert.strictEqual(result.success, true);
});

test('myFeature rejects invalid input', async () => {
  await assert.rejects(
    myFeature({ input: null }),
    /Input is required/
  );
});

test('myFeature handles edge cases', async () => {
  const result = await myFeature({ input: '' });
  assert.strictEqual(result.success, false);
});
```

### Best Practices

1. **Descriptive Names**: Test names explain what they verify
2. **Arrange-Act-Assert**: Clear test structure
3. **One Assertion**: Each test verifies one thing
4. **No External Dependencies**: Mock external services
5. **Fast Execution**: Unit tests run in milliseconds

---

## 📝 Test Maintenance

### When to Update Tests

- **Adding features**: Add tests for new functionality
- **Fixing bugs**: Add regression test
- **Refactoring**: Ensure tests still pass
- **Changing behavior**: Update expected results

### Test Debt

Track test improvements:
- Missing test coverage
- Flaky tests
- Slow tests
- Brittle tests

---

## 🎯 Reliability Strategy

### Preventing Failures

1. **Type Safety**: TypeScript catches errors at compile time
2. **Input Validation**: Zod schemas validate all inputs
3. **Error Handling**: Try/catch blocks with proper error messages
4. **Retry Logic**: Automatic retry for transient failures
5. **Graceful Degradation**: Fail gracefully, not catastrophically

### Monitoring Production

- **Health Checks**: `/health` endpoint for load balancers
- **Metrics**: `/metrics` endpoint for Prometheus
- **Logging**: Structured logs with Winston
- **Alerts**: (Future) Alert on repeated failures

---

## Comprehensive Multi-Level Test Plan
### Test Pyramid Strategy

This project follows a comprehensive testing strategy with multiple levels, from unit tests to full E2E integration. Each level builds upon the previous, ensuring complete coverage of both success and failure scenarios.

```
                    🏔️ Test Pyramid
                         
                      /         \
                    /             \
                  /   Level 5:      \
                /   Full E2E Tests    \    ← All 71 tools + Error scenarios
              /     (Docker Stack)      \
            /                              \
          /        Level 4: Protocol E2E    \  ← MCP protocol compliance
        /       (mcp-client.playwright.spec)  \
      /                                          \
    /      Level 3: Live Integration Tests        \  ← Real Actual Budget
  /          (tests/manual/, npm run test:integration:*)  \
/                                                      \
/              Level 2: Unit Tests                      \  ← Offline, stub adapter
\        (3 files: smoke, schema, negative-path)        /
  \                                                  /
    \          Level 1: Adapter Smoke Tests      /  ← Adapter infra (retry, pool)
      \              (src/tests_adapter_runner)  /
        \                                  /
          \____________________________/
```

### Level 1: Adapter Smoke Tests ⚡ (Fast: ~30s)

**Purpose:** Verify tool registration and basic functionality  
**Location:** `src/tests_adapter_runner.ts`  
**Command:** `npm run test:adapter`

**Coverage:**
- ✅ All 71 tools registered correctly
- ✅ Tool schemas valid (Zod validation)
- ✅ Tool descriptions present
- ✅ Basic tool invocation works

**Test Files:**
- `src/tests_adapter_runner.ts` - Main adapter test runner
- `tests/unit/generated_tools.smoke.test.js` - All 71 tools smoke validation

**Success Criteria:**
- All tools found in registry
- All tools have valid input schemas
- No TypeScript compilation errors

**Error Scenarios Tested:**
- ❌ Missing tool registration
- ❌ Invalid schema definitions
- ❌ Tool metadata missing

---

### Level 2: Unit Tests ⚡ (Fast: ~3s)

**Purpose:** Test individual components in isolation, fully offline, no Actual Budget server needed  
**Location:** `tests/unit/`  
**Command:** `npm run test:unit-js`

**Representative test files (the `test:unit-js` chain runs ~52):**

| File | What it tests | Assertions |
|---|---|---|
| `transactions_create.test.js` | Zod schema for `transactions_create`: valid input accepted, empty rejected | 2 |
| `generated_tools.smoke.test.js` | All 71 tools: stub adapter, `call()` succeeds, response shape verified per-tool | 71 + shape checks |
| `schema_validation.test.js` | Negative-path schema + runtime guards for 11+ tool schemas | 60+ |
| `schema_json_openai_compat.test.js` | Walks all 71 published `z.toJSONSchema()` outputs; asserts no `\p{...}` escape and every `pattern` compiles without the `u` flag, so no tool schema is rejected by OpenAI's Responses validator (#293) | 71 schemas |
| `unhandled-rejection.test.js` | Allow-list predicate for `process.on('unhandledRejection')`: production-shape secondary rejection swallowed; unrelated EACCES still exits; existing allow-list entries unchanged (#152) | 12 |
| `rejection-allowlist-purity.test.js` | Static analysis of `src/lib/rejection-allowlist.ts`: sentinel marker present; no static, dynamic, or CommonJS imports of non-node modules; no top-level side-effecting statements (#159) | 5 categories |
| `httpServer_bearer_auth.test.js` | Hardened bearer auth path: `timingSafeEqual` comparison with length-equality short-circuit; forbids re-introduction of token-content debug log lines (#157) | 12 |
| `adapter_write_pool_cooperation.test.js` | Write path uses the pool branch when a pooled session is in context: `writeConnectionReuses` increments; legacy branch otherwise; `api.sync()` runs in both branches (#158) | 7 |
| `budget_acl_enforcement.test.js` | Per-session active budget + ACL: stdio short-circuit; OIDC defence-in-depth refusal on missing allowedBudgets; allow on ACL match; warn-level structured denial log; `switchBudget` requires session, exact match only, releases pool entry before mutating session map (#156) | 15 |
| `workflow_release_guards.test.js` | Structural invariants of `dependency-update.yml` (#261): App-token-authenticated checkouts with credential persistence explicitly pinned on (#262: any `persist-credentials: false` spelling, or reliance on the upstream default, fails), no token-in-URL auth, lockfile resync inside the bump step, explicit sync control flow, Release gated behind the ci-cd watch guard, computed tool count; the behavioral lock-agreement check (package-lock.json version fields match package.json) that catches a stale-lock bump from any lane; and the #266 absence guard keeping the retired second auto-release lane retired (file gone, no tracked reference to its identifier under .claude/ or .github/, and no workflow_run trigger in any workflow) | 19 + 13 negative |
| `report_train_failure.test.js` | #325: the release-train failure notifier. Exercises the four pure decision functions of `scripts/report-train-failure.mjs` without network: outcome classification (the `TRAIN_OUTCOME` enum corroborated against the jobs API, unset and unrecognised failing toward notifying, an unattributed job cancel treated as a failure), full-semver validation gating the issue body sink rather than the notification, body construction from named fields only, and the total tracker state machine (open / update counter / converge duplicates / close / never reopen). Plus source-level invariants for the I/O layer: on-demand label creation, label-scoped close, no log endpoint is ever fetched, and the asymmetric error policy. Includes regression cases for four defects found in code review: a cancelled sibling job being attributed to the train, the reporter corroborating against its own job, a human triage note in the issue body being parsed as machine state, and `$` expansion corrupting the counter block. A second review pass added regressions for a sibling job with a failed step inverting a green train, a stale train-job name yielding no corroboration rather than wrong corroboration, and an unreadable version erasing a known-good one | 46 |
| `bot_target_branch.test.js` | #265: every dependabot update block carries target-branch develop and the inert renovate config's baseBranches includes develop with the activation warning; a bot PR against fast-forward-only main is structurally unmergeable | 2 + 2 negative |

**Coverage:**
- ✅ All 71 tools: stub invocation + response-shape assertion
- ✅ Schema parse rejection for empty/invalid inputs (11+ tools, 60+ cases)
- ✅ Runtime guard rejection: `amount ≤ 0`, `fromId === toId` in `budgets_transfer`
- ✅ Schema correctness: parse errors with provided examples surface as test failures

**Error Scenarios Tested:**
- ❌ Missing required fields (`conditions`, `operations`, `amount`, `month`, `categoryId`)
- ❌ Wrong types (string where number expected)
- ❌ Invalid format (month `2025-13`, `25-01`)
- ❌ Empty required strings
- ❌ Zero / negative amounts (runtime guard)
- ❌ Same source and target category (runtime guard)

---

### Level 3: Protocol E2E Tests ⚡ (Fast: ~10s)

**Purpose:** Verify MCP protocol compliance  
**Location:** `tests/e2e/mcp-client.playwright.spec.ts`  
**Command:** `npm run test:e2e`

**Coverage:**
- ✅ MCP initialization handshake
- ✅ tools/list request
- ✅ tools/call request
- ✅ Session management headers
- ✅ JSON-RPC 2.0 format

**Test Scenarios:**

| Test | Success Case | Error Case |
|------|-------------|------------|
| Initialize | ✅ Valid protocol version | ❌ Unsupported version |
| List Tools | ✅ Returns 71 tools | ❌ Timeout |
| Call Tool | ✅ Executes tool | ❌ Tool not found |
| Session Persistence | ✅ Same session across calls | ❌ Session expired |
| Health Check | ✅ Status: ok | ❌ Status: not-initialized |

**Success Criteria:**
- All MCP protocol methods work
- JSON-RPC 2.0 compliance verified
- Session headers managed correctly

**Error Scenarios Tested:**
- ❌ Invalid JSON-RPC format
- ❌ Missing protocol version
- ❌ Invalid tool names
- ❌ Missing required parameters
- ❌ Server not initialized

---

### Level 5: Full Docker E2E Tests 🐳 (Thorough: ~60-120s)

**Purpose:** Test complete production deployment  
**Location:** `tests/e2e/docker.e2e.spec.ts` (smoke), `tests/e2e/docker-all-tools.e2e.spec.ts` (comprehensive)  
**Command:** `npm run test:e2e:docker` OR `npx playwright test tests/e2e/docker-all-tools.e2e.spec.ts`

**Coverage:**
- ✅ Docker build correctness
- ✅ Container networking
- ✅ Real Actual Budget integration
- ✅ **ALL 71 tools execution (100% coverage)**
- ✅ Session management (including `actual_session_close`)
- ✅ Error handling (15+ error scenarios)
- ✅ Regression tests (strict validation, large batches, edge cases)

**Quick Smoke Tests (docker.e2e.spec.ts - 11 tests, ~20s):**

| # | Test Name | Success Scenario | Error Scenarios |
|---|-----------|-----------------|-----------------|
| 1 | Initialize MCP session | ✅ Session created | ❌ Auth failure, timeout |
| 2 | Verify services healthy | ✅ Status: ok | ❌ Not initialized, Actual unreachable |
| 3 | List all tools | ✅ 71 tools returned | ❌ Timeout, server error |
| 4 | Execute actual_server_info | ✅ Server version returned | ❌ Connection refused |
| 5 | List accounts | ✅ Account array returned | ❌ Database error |
| 6 | Create test account | ✅ Account ID returned | ❌ Duplicate name, validation error |
| 7 | Verify session persistence | ✅ 3 consecutive calls work | ❌ Session timeout |
| 8 | *(removed: SSE transport removed)* | N/A | N/A |
| 9 | Docker build verification | ✅ All files present | ❌ Missing dependencies |
| 10 | Handle invalid tool name | ✅ Error: Tool not found | ❌ Unexpected behavior |
| 11 | Handle invalid arguments | ✅ Validation error returned | ❌ Server crash |

**Comprehensive All-Tools Tests (docker-all-tools.e2e.spec.ts - 80+ tests, ~120s):**

The authoritative per-domain breakdown lives in `tests/e2e/docker-all-tools.e2e.spec.ts` (describe block `Docker E2E - ALL 71 TOOLS`): it exercises all 71 tools plus error scenarios. The per-category counts are not duplicated here, because a hand-maintained copy drifts.

**Success Criteria:**
- All 71 tools execute successfully
- Error scenarios handled gracefully
- Docker containers healthy
- No data corruption
- Complete cleanup after tests

**Error Scenarios Tested:**
- ❌ Invalid tool name (Tool not found)
- ❌ Missing required arguments (name, group_id, date)
- ❌ Invalid argument types (date format, amount format)
- ❌ Invalid field names (strict validation)
- ❌ Invalid queries (non-existent tables, invalid fields)
- ❌ Invalid join paths (account.id - account is field not join)
- ❌ Multiple invalid fields in query
- ❌ Invalid fields in WHERE clause
- ❌ Server not initialized (Health check fails)
- ❌ Session timeout (Network error)

**Query Validation Tests (11 scenarios):**
- ✅ Valid: SELECT * FROM transactions
- ✅ Valid: Specific fields (id, date, amount, account)
- ✅ Valid: Join paths (payee.name, category.name)
- ✅ Valid: WHERE and ORDER BY clauses
- ❌ Invalid: payee_name field (should suggest payee)
- ❌ Invalid: category_name field (should suggest category.name)
- ❌ Invalid: table name (transaction vs transactions)
- ❌ Invalid: field in WHERE clause
- ❌ Invalid: multiple invalid fields
- ❌ Invalid: join path account.id (account is not a join)

**Regression Scenarios Verified:**
- ✅ Strict validation on accounts_update (reject invalid fields)
- ✅ Strict validation on payees_update (reject invalid fields)
- ✅ Large batch operations (35+ operations)
- ✅ Rules without 'op' field (defaults to 'set')
- ✅ Payee updates with category field
- ✅ Session persistence across multiple calls

---

### Level 6: Manual Integration Tests 🧪 (Comprehensive: ~60s)

**Purpose:** Test all 71 tools with real Actual Budget data  
**Location:** `tests/manual/index.js` (entry point), `tests/manual/tests/` (13 domain modules)  
**Command:** `npm run test:integration:full`

**Test Levels:**

#### SMOKE Level (3 tools)
- ✅ Initialize session
- ✅ List tools (70 expected, via EXPECTED_TOOL_COUNT)
- ✅ List accounts

**Error Scenarios:**
- ❌ MCP server not reachable
- ❌ Actual Budget not connected

#### NORMAL Level (7 tools)
- ✅ All SMOKE tests
- ✅ Create account
- ✅ Get account balance
- ✅ Update account
- ✅ Close account
- ✅ Reopen account
- ✅ Delete account (cleanup)

**Error Scenarios:**
- ❌ Invalid account ID (UUID validation)
- ❌ Update with no fields (validation error)
- ❌ Delete non-existent account
- ❌ Reopen already-open account

#### FULL Level (71 tools, 100% coverage)

**Account Tools (7):**
- ✅ All NORMAL account tests
- ❌ Create duplicate account name
- ❌ Update closed account

**Category Groups (4):**
- ✅ Get all groups
- ✅ Create group
- ✅ Update group
- ✅ Delete group
- ❌ Delete group with categories
- ❌ Create duplicate group

**Categories (4):**
- ✅ Get all categories
- ✅ Create category
- ✅ Update category
- ✅ Delete category
- ❌ Create without group_id
- ❌ Delete category with transactions

**Payees (5):**
- ✅ Get all payees
- ✅ Create payee
- ✅ Update payee (with category field)
- ✅ Merge payees
- ✅ Delete payee
- ❌ Merge non-existent payees
- ❌ Update with invalid category ID

**Payee Rules (1):**
- ✅ Get payee rules

**Transactions (6):**
- ✅ Create transaction
- ✅ Get transaction by ID
- ✅ Update transaction
- ✅ Filter transactions
- ✅ Import transactions
- ✅ Delete transaction
- ❌ Create with invalid account
- ❌ Create with invalid amount (not in cents)
- ❌ Create with invalid date format
- ❌ Update non-existent transaction

**Budgets (9):**
- ✅ Get all budgets
- ✅ Get month budget
- ✅ Get multiple months
- ✅ Set budget amount
- ✅ Set carryover
- ✅ Hold for next month
- ✅ Reset hold
- ✅ Transfer between categories
- ✅ Batch updates (35 operations)
- ❌ Set invalid month format
- ❌ Transfer more than available
- ❌ Batch with mixed valid/invalid ops (partial success)

**Rules (4):**
- ✅ Get all rules
- ✅ Create rule (with/without 'op' field)
- ✅ Update rule
- ✅ Delete rule
- ❌ Create rule with invalid field
- ❌ Create rule with invalid condition operator

**Advanced (2):**
- ✅ Bank sync (graceful failure if unavailable)
- ✅ Run ActualQL query
- ❌ Invalid SQL query syntax
- ❌ Query non-existent table

**Session Management (2):**
- ✅ List active sessions
- ✅ Close specific session
- ❌ Close invalid session ID

**Success Criteria:**
- All 71 tools execute successfully
- Error scenarios handled gracefully
- Test data cleaned up properly
- No data corruption

---

### Error Testing Matrix

**By Error Type:**

| Error Type | Tools Affected | Test Coverage | Status |
|------------|---------------|---------------|--------|
| **Validation Errors** | All tools | ✅ Unit tests | Complete |
| Invalid UUID format | accounts_*, categories_*, payees_* | ✅ Unit + Integration | Complete |
| Missing required fields | accounts_create, transactions_create | ✅ Unit + Integration | Complete |
| Invalid date format | transactions_create, budgets_* | ✅ Unit + Integration | Complete |
| Invalid amount (not cents) | transactions_create, budgets_* | ✅ Integration | Complete |
| Unrecognized fields | accounts_update, payees_update | ✅ Regression tests | Complete |
| **Connection Errors** | All tools | ✅ E2E tests | Complete |
| Server unavailable | All tools | ✅ Docker E2E | Complete |
| Network timeout | All tools | ✅ Retry tests | Complete |
| Session expired | All tools | ✅ Integration | Complete |
| **Business Logic Errors** | Specific tools | ✅ Integration | Complete |
| Duplicate account name | accounts_create | ⏳ TODO | Planned |
| Insufficient funds | budgets_transfer | ⏳ TODO | Planned |
| Delete with dependencies | categories_delete, payees_delete | ⏳ TODO | Planned |
| Invalid rule conditions | rules_create | ✅ Regression | Complete |
| **Database Errors** | All tools | ⏳ TODO | Planned |
| Constraint violations | Various | ⏳ TODO | Planned |
| Deadlock handling | Concurrent ops | ⏳ TODO | Planned |
| Data corruption | All tools | ⏳ TODO | Planned |

---

### Test Execution Strategy

**Pre-Commit (Required):**
```bash
npm run build                    # TypeScript compilation
npm run test:adapter             # Smoke tests (30s)
npm run test:unit-js             # Unit tests (5s)
npm audit --audit-level=moderate # Security check
```

**Pre-Merge (CI/CD):**
```bash
npm run test:all                 # All automated tests (90s)
# Includes: adapter + unit + Docker E2E
```

**Pre-Release (Manual):**
```bash
# Full manual integration test with all 71 tools
npm run test:integration:full

# Cleanup only (remove leftover MCP-* test data)
npm run test:integration:cleanup
```

---

### Test Coverage Goals

| Test Level | Current Coverage | Target Coverage | Priority |
|------------|-----------------|-----------------|----------|
| **Level 1:** Adapter Smoke | 100% (adapter infra) | 100% | ✅ Maintain |
| **Level 2:** Unit Tests | 71/71 tools (stub), 23 schema assertions | Maintain + grow | ✅ Good |
| **Level 3:** Live Integration | 71/71 tools called | 71/71 | ✅ Maintain |
| **Level 4:** Protocol E2E | 100% (MCP compliance) | 100% | ✅ Maintain |
| **Level 5:** Docker E2E | **68/70 tools** (100% named; 2 excluded for single-budget CI) | 100% | ✅ Maintain |
| **Level 6:** Manual Full | 100% (71/71 tools) | 100% | ✅ Maintain |
| **Error Scenarios** | ~70% | 90% | 🟡 Medium |

---

### Next Testing Improvements

**High Priority:**
1. ✅ **Completed:** Docker E2E tests with 68/70 tools named (2 excluded: `budgets_list_available`, `budgets_switch` due to single-budget CI constraint)
2. ✅ **Completed:** Unit test suite (~52 files), 71-tool smoke, 23 negative-path assertions
3. ✅ **Completed:** All 6 delete tools promoted to named E2E tests with list-absence assertions; `afterAll` is now fallback-only
4. ✅ **Completed:** Shared `tests/shared/mcp-protocol.js` utility (MCP envelope parsing, reused across E2E and integration tests)
5. ⏳ **TODO:** Add business logic error tests (duplicate accounts, insufficient funds)
6. ⏳ **TODO:** Add concurrency tests (parallel tool execution)

**Medium Priority:**
5. ⏳ **TODO:** Add chaos testing (server failures, network issues)
6. ⏳ **TODO:** Add performance benchmarks (tool execution time)
7. ⏳ **TODO:** Add load testing (concurrent sessions)

**Low Priority:**
8. ⏳ **TODO:** Add mutation testing (verify test quality)
9. ⏳ **TODO:** Add contract testing (API compatibility)
10. ⏳ **TODO:** Add visual regression testing (Docker dashboard)

---

## 🔗 Related Documentation

- [Architecture](./ARCHITECTURE.md) - System design and components
- [Security & Privacy](./SECURITY_AND_PRIVACY.md) - Security testing policies
- Planned and future work: tracked as [GitHub issues](https://github.com/agigante80/actual-mcp-server/issues)

---

## ✨ Summary

**Testing is mandatory, not optional.**

Before every commit:
```bash
npm run build && npm run test:adapter && npm audit --audit-level=moderate
```

If tests fail:
1. ❌ Do not commit
2. ✅ Fix the issue
3. ✅ Re-run tests
4. ✅ Commit only when all tests pass

**Remember**: Tests are your safety net. Maintaining them ensures long-term project health and enables confident development.
