# Testing & Reliability

**Project:** Actual MCP Server  
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
| **Playwright** | ^1.64.1 | End-to-end testing |
| **Custom Adapter Tests** | N/A | Smoke tests for Actual API |
| **npm audit** | Native | Security vulnerability scanning |

### Test Categories

```
tests/
├── unit/                    # Unit tests (fast, isolated, offline)
│   ├── transactions_create.test.js        # Zod schema validation (transactions_create)
│   ├── generated_tools.smoke.test.js      # All 85 tools: stub adapter + correctness assertions
│   ├── schema_validation.test.js          # Negative-path schema tests (11+ tool schemas)
│   ├── schema_json_openai_compat.test.js  # Published input and output schemas OpenAI/ECMA-262 regex-compatible (#293, #642)
│   └── schema_published_parity.test.js    # Zod and the SDK Ajv validator accept the same inputs; no regex flags (#588)
├── e2e/                     # End-to-end tests
│   ├── mcp-client.playwright.spec.ts      # Protocol tests (fast, no Docker)
│   ├── docker.e2e.spec.ts                 # Docker smoke integration (full stack)
│   ├── docker-all-tools.e2e.spec.ts       # All-tools Docker E2E (85 tools)
│   ├── compact-surface.e2e.spec.ts        # Compact-surface E2E (15 tools, project docker-e2e-compact-stdio, #681)
│   └── run-docker-e2e.sh                  # Docker test orchestrator
└── manual/                  # Live integration tests (real Actual Budget)
    ├── index.js              # Entry point, level-gated execution
    ├── cleanup.js            # Standalone MCP-* data cleanup
    └── tests/               # Per-domain test modules (14 files)
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
- ✅ Real tool execution (**all 85 tools at 100% coverage**)
- ✅ Session management and persistence
- ✅ Production-like deployment
- ✅ Error handling and validation (15+ error scenarios)
- ✅ Regression tests (strict validation, batch operations)

**Test Suites:**
- **docker.e2e.spec.ts**: Basic smoke tests (11 tests)
- **docker-all-tools.e2e.spec.ts**: Comprehensive all-tools test (85 tools, 80+ test cases)
- **compact-surface.e2e.spec.ts** (#681): the compact leg. Playwright project `docker-e2e-compact-stdio`, run as Step 6c of `run-docker-e2e.sh` over stdio with `MCP_E2E_TOOL_SURFACE=compact` (the stdio client passes it to the server as `MCP_TOOL_SURFACE`). It checks the published 15-tool list, the `get_context` version, a `manage_accounts` create with its `list_entities` read-back and delete, and the refusal of a direct legacy call. Per-action coverage of the compact tools is in `docker-all-tools.e2e.spec.ts`

### Multi-user ACL E2E (`scripts/acl-e2e.sh`)

Not part of `test:e2e:docker`. It stands up its own stack (an Actual server in
multi-user OpenID mode plus `navikt/mock-oauth2-server`) because the budget ACL is
the one behaviour whose correctness depends on an identifier produced by ANOTHER
system.

```bash
bash scripts/acl-e2e.sh          # build the environment + fixture, then verify
bash scripts/acl-e2e.sh --keep   # leave the containers up for debugging
node scripts/acl-e2e-verify.mjs  # re-run the scenarios against a kept environment
```

**Why it cannot be a Playwright suite.** It needs a password bootstrap FIRST and
OpenID enabled second (`@actual-app/api` authenticates with a password, and an
OpenID-only server rejects it), an IdP that is up before Actual reads discovery at
startup, and an IdP reconfiguration after the users exist. Compose cannot express
that ordering.

**The property it exists to protect (#344).** Alice and bob are created by driving
a REAL authorization-code login, so Actual runs its own precedence over the UserInfo
response and stores the result. The harness then READS BACK the `user_name` Actual
derived and writes it to `.release/acl-e2e-fixture.json` as `actualUserNames`; every
assertion uses that value. It never asserts what the name should be. The login
supplies `preferred_username` and `email` as deliberately different strings, so the
stored value also reveals which claim the precedence chose.

This matters because the harness previously created users with `POST /admin/users`
passing `userName: "alice"` and then configured the IdP to mint
`preferred_username: "alice"`: both sides of a cross-system join chosen twelve lines
apart in one file, which is internally consistent by construction and cannot fail
for the reason that matters. That shape hid #343 for two releases.

**What it covers for #346.** The mock IdP serves a genuine `/userinfo`, and it is the
same endpoint Actual itself calls to derive `user_name`, so the UserInfo identity
source is exercised end to end against a live IdP: a real token, a real discovery
document, a real response. That block deliberately passes NO token claims, so an
implementation that quietly read the access token instead would resolve to null and
fail. What it does NOT cover is the divergence case (a claim present in UserInfo but
absent from the access token), because mock-oauth2-server derives the UserInfo body
from the token's own claims and the two cannot disagree. That case needs the shim
described in #346, so this proves the mechanism rather than the motivating bug.

**Proving it is still not vacuous.** After a green run, rename the user inside
Actual so its `user_name` no longer matches the token identity, and re-run the
verifier. It must go red (3 assertions, verified 2026-08-10). The exact commands are
in the header of `scripts/acl-e2e.sh`. `tests/unit/acl_e2e_fixture_contract.test.js`
guards the same properties statically in CI, since a vacuous harness passes and so
running it proves nothing on its own.

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

# Test MCP client interaction (needs a live Actual server past initialize, and a free MCP_BRIDGE_PORT)
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
- Documentation checks (`Docs check` job, #602): `npm run docs:check` with lychee v0.24.2 installed, then the negative link fixture with `DOCS_CHECK_REQUIRE_LYCHEE=1`
- MCP Registry (#610): `MCP Registry Validate` stamps `server.json` and runs `mcp-publisher validate` on every push (the binary is cosign and sha256 verified). On a `v*` tag, `MCP Registry Publish` runs after `Verify Published Artifacts`, logs in with GitHub OIDC and publishes. Both are `continue-on-error` (the registry is a preview service, and both talk to it), so an outage ends in a warning annotation and a `failure` row in the Pipeline Summary rather than a red run; the release job does not wait on publish, the release skill checks the registry listing after each tag, and a failed publish is re-run from the Actions tab

**If CI/CD fails:**
1. ❌ Pull request cannot be merged
2. ❌ No Docker images published
3. ❌ No GitHub releases created

### Release gate: dual-transport evidence (#280)

**A promotion to `main` REQUIRES a passing full integration run over BOTH transports (`MCP_TEST_TRANSPORT=http` and `MCP_TEST_TRANSPORT=stdio`) with a green zero-residue assertion.** Run `bash scripts/deploy-and-test.sh full`; it writes `.release/dual-transport-report.json`, and the release procedure verifies that dual-transport evidence against the `develop` HEAD sha before anything is fast-forwarded. HTTP-only evidence is not sufficient: stdio is the transport half our Claude Desktop users run on, and it had no write-path coverage until #280.

This paragraph is load bearing: `tests/unit/dual_transport_gate.test.js` anchors on its first sentence and on the phrase "dual-transport evidence" plus the artifact path, and fails the build if either is weakened or removed. It lives here, in a tracked document, because the assistant instruction files that used to carry it (`CLAUDE.md`, `.claude/skills/release/SKILL.md`) are kept out of the repository by the leak guard and so are absent on a fresh checkout; the test still checks those copies wherever they are present locally.

**Step 9 cleans up after itself (#576).** `scripts/regression-270-stall.mjs` (and the `scripts/diag-270-http.mjs` diagnostic) run AFTER the runner's zero-residue assertion, so whatever they create was invisible to it. Each run names its objects `MCP-REG270-<label>-<run id>` (or `MCP-DIAG270-...`, the run id being a 13-digit `Date.now()`), a shape `TEST_OBJECT_RE` in `tests/manual/residue.js` already matches, and deletes exactly that run's categories and groups before exiting, also when the stalled op hung or SIGINT or SIGTERM was sent to the script's own pid. A terminal Ctrl-C signals the whole process group, which kills the stall script's `docker exec` stdio child too, so that run's objects are left to the next run's pre-run sweep. Every cleanup call is bounded and the first timeout ends the cleanup rather than queueing behind the stalled op; a crashed run's leftovers are removed by the next run's pre-run sweep. Then `scripts/assert-no-residue.mjs` re-asserts zero residue after step 9 (one settled re-check, exit 3 on a real leak), and only after that does the script write `.release/dual-transport-report.json`. The report is removed at the start of every run, so a run that fails at any step leaves no evidence behind.

**The stdio leg starts from a fresh test budget snapshot (#595).** Every stdio op downloads the test budget into an empty data dir and replays every sync message newer than the server's stored file, and nothing else refreshes that file, so the replay grew by about 800 messages per `full` run until a load crossed the 30 s op timeout (62,899 messages on 2026-10-26). Inside step 8 at `normal`, `extended` and `full`, right before the stdio runner, the script pipes `scripts/refresh-test-budget-snapshot.mjs` into the bearer container as `app`, under a 300 s `timeout`. It downloads the budget into a throwaway dir, checks the open budget is the designated one, re-uploads it with upstream `upload-budget` (same groupId, so `BEARER_BUDGET_SYNC_ID` and `MCP_TEST_BUDGET_SYNC_ID` stay valid; `sync-reset` would assign a new one and is never used), checks the server still lists the same file for that groupId, then downloads it cold once more and fails if that replay exceeds `REFRESH_MAX_REPLAY` (200). It writes to the server, so it refuses unless `MCP_TEST_BUDGET_SYNC_ID` is set and equals the loaded budget (exit 2), when the designation is a budget the OIDC instance serves (exit 3, the script passes those ids as `MCP_REFRESH_FORBIDDEN_SYNC_IDS`), or when its data dir would be inside `/app/data` (exit 4); it times out with exit 5. Any non-zero exit ends the run before the stdio leg. Run it by hand the same way: `docker exec -i -u app -w /app -e MCP_TEST_BUDGET_SYNC_ID=<id> actual-mcp-bearer-backend node --input-type=module - < scripts/refresh-test-budget-snapshot.mjs`.

**An unreadable listing is never "zero residue" (#583).** A listing is readable only when its tool returns the array under its own key (decided by shape, never by message text). Anything else (error text, `null`, another object, a thrown call) makes `findResidue` name that tool in `unreadable`, and `assertNoResidue` throws `ResidueUnreadableError` before counting, so a partly read budget is neither certified clean nor reported as a residue count. The runner exits 1 for it, after printing the failed-assertion ledger when there is one, and `scripts/assert-no-residue.mjs` exits 1 ("could not check"); exit 3 stays reserved for residue that was actually seen. The pre-run sweep stays best effort: it removes what it could read and names what it could not, without printing "budget already clean".

---

## 🔬 Test Types

### 1. Unit Tests

**Purpose**: Test individual functions in isolation

**Location**: `tests/unit/*.js`

**Files**:
| File | What it tests |
|---|---|
| `transactions_create.test.js` | Zod schema: valid input accepted, empty input rejected |
| `generated_tools.smoke.test.js` | All 85 tools: stub adapter, call succeeds, response shape correct |
| `schema_validation.test.js` | Negative-path schemas: `rules_create`, `budget_updates_batch`, `budgets_transfer`, `budgets_set_amount` |
| `budget_updates_batch.test.js` | `actual_budget_updates_batch` through the real tool and adapter with raw api stubs: per-item `succeeded`/`failed`, all-items-failing is a normal result, exact Zod messages, whole-call failure propagates, no raw import or `console.*` in the tool (#516) |
| `rules_create.test.js` | `actual_rules_create` characterisation (#485): the imperative rejections and their exact messages, what is deliberately not rejected, stubbing `adapter.createRule` at the tool boundary so it is unchanged by the schema extraction and the adapter guard |
| `adapter_rule_reference_guard.test.js` | The adapter guard that refuses a rule naming a missing category, payee or account (#485), driven through the real `adapter.createRule`: tombstoned payee, category group id, closed account, list values, one listing per kind, one drain; #522: the same guard on `updateRule`, `upsertRule` (both branches) and `updatePayee` category, new-references-only diff on update, op-aware extraction (`and`, text ops, template), `createRule` not retried, prototype-named fields |
| `rules_create_batch.test.js` | `actual_rules_create_batch` through the real tool and adapter (#485): one drain, per-item verdicts and original indices, no rollback, plain-object APIError text, rate limit per item, infrastructure abort, cooperative deadline, pre-write refusals; #522: batch refusal suffix, forced shutdown after an infrastructure abort on stdio |
| `adapter_set_budget_batch.test.js` | `adapter.setBudgetBatch`: one drain (write-cycle witness), guard reads before the first write, refused items never reach a raw write (category, month, income carryover), per-item catch, last write wins, cooperative deadline (#516); no `batchBudgetUpdates` bracket in `setBudgetBatch` or `transferBudgetAmount`, a detached-rejection tripwire stub plus a comment-stripped source guard, a rejected apply is a failed item, and the transfer's first-write and partial-transfer failures with infrastructure classification kept (#539) |
| `adapter_transaction_batch_abort.test.js` | `adapter.updateTransactionBatch` infrastructure abort (#521): legacy stdio forced shutdown, pooled keep or drop depending on the trailing sync, per-item rate limit and non-infrastructure rejection, applied/unknown/not-attempted counts, `cause` |
| `transactions_merge_adapter.test.js` | `adapter.mergeTransactions` (#514): typed pre-flight refusals (not found, split child, different accounts, different amounts) never reach the raw call; the happy path sends the plain string tuple once and derives `deletedId` for either kept order |
| `schema_json_openai_compat.test.js` | Every published tool schema is OpenAI/ECMA-262 regex-compatible: no `\p{...}` escape, each `pattern` compiles without the `u` flag (#293) |
| `schema_published_parity.test.js` | The published JSON Schema accepts exactly what the Zod schema accepts: every published UUID pattern takes the uppercase Income group id, no regex check in any tool schema carries a flag (`z.toJSONSchema()` drops them), and Zod and the MCP SDK's own Ajv validator agree on a shared fixture set for every regex leaf (#588) |
| `contributor_docs.test.js` | `AGENTS.md`, `CONTRIBUTING.md`, the PR template, `SUPPORT.md` and `CODE_OF_CONDUCT.md` name only real `npm run` scripts and link only TRACKED paths; the PR template stays at or under 40 lines (#609); `AGENTS.md` exists, is not ignored and stays at or under 150 lines; every `.github/instructions/*.instructions.md` defers to `AGENTS.md` and never cites the local-only `CLAUDE.md` (#496) |
| `oidc_bearer_middleware.test.js` | `src/auth/bearer.ts`, which replaced the `mcp-auth` package (#634), answers exactly as mcp-auth 0.2.0 did: every response captured from that version (`tests/unit/fixtures/mcp-auth-0.2.0-golden.json`, 30 middleware and 35 metadata cases) is replayed and compared on status, auth and CORS headers and body; plus the two deliberate departures (no console write, a pre-set `req.auth` replaced) |
| `toolsets.test.js` | #483: toolset partition, preset, `MCP_TOOLS`, strict `MCP_READ_ONLY`, the hard-coded `WRITE_CAPABLE` set guarded by the adapter call graph, the import-allowlist side-effect scan (#533), the single-dispatch check widened to `.call(`, `.apply(`, `.bind(`, bracket and `Reflect.apply` spellings plus a reviewed `getTool(` reader list (#533), the chat preset reference guard, hide-and-refuse dispatch, fail-closed before `initialize()` |
| `toolsets_entrypoint.test.js` | #483: the built entrypoint over stdio and the HTTP no-session list path: filtered `tools/list`, a hidden tool refused naming its setting, and exit 1 on a bad toolset, tool, `MCP_READ_ONLY` or a zero-tool configuration |
| `config_tool_surface.test.js` | #671: `MCP_TOOL_SURFACE` parsing (default, trim, case, rejected values) and the `compact` exclusion of `MCP_TOOLSETS` and `MCP_TOOLS`, through `configSchema.safeParse` |
| `compact_dispatch.test.js` | #671: the resolver per surface and the read-only rule for compact tools, the dispatcher (strict per-action schema, rename, wrap, default action, prototype-named actions), `callOperation`'s narrow bypass (only the hide `MCP_TOOL_SURFACE=compact` causes), re-initialize, the `src/compact/` import guard, and the metadata floor for compact tools |
| `compact_mapping_parity.test.js` | #671, #672, #673, #676, #677: every legacy tool is mapped (by a row or a route of exactly one compact tool, except `actual_notes_update`, which several tools may map only from the action `set_note`), out of scope or pending exactly once; built-in fixtures prove the check names a missing, twice-owned or stale tool, and that `entities_search` and `get_id_by_name` count once under `list_entities` |
| `compact_get_context.test.js` | #672: `get_context`: every topic and option routes to the exact legacy tool and arguments through a stubbed `callOperation`; refusals call nothing; flat schema has no `oneOf`/`anyOf` and no `outputSchema`; read-only publication |
| `prompt_registry.test.js` | #660: prompt registry: offer filter, the surface matrix through the real tool policy, name, required-tool and bounded-argument validators fed bad fixtures, `renderPrompt` |
| `prompt_handlers.test.js` | #660: `registerPromptHandlers` over an in-memory SDK client (list, get, `-32602` for unknown, hidden, malformed and missing arguments, name cleaning) and the wiring assertions for both transports and the three start calls |
| `prompts_entrypoint.test.js` | #660: the built entrypoint over stdio: `initialize` advertises prompts, `prompts/list` is `[]` on three configurations, `prompts/get` of an unknown name is `-32602` |
| `compact_list_entities.test.js` | #672: `list_entities`: every type default and every route (query, name, sort, payee_id, schedule_id, scope) with exact legacy name and arguments; mutual exclusion, required-with and not-valid-for-type refusals; the 4b rewrite keeps a `NotFoundRefusal` a `NotFoundRefusal` |
| `tdqs_capture_env.test.js` | #679: the TDQS harness `captureEnv`: `compact` and `legacy` always set the surface, `MCP_TOOLSETS=all`, empty `MCP_TOOLS` and `MCP_READ_ONLY=false` so a repo `.env` cannot leak into a capture; an unknown, `all` or missing surface throws naming `legacy` and `compact`; importing the module runs no CLI command; `capture --surface bogus` exits 2 with usage and writes no file |
| `compact_search_transactions.test.js` | #673: `search_transactions`: one positive per `by` row with exact legacy name and renamed arguments (no defaults sent); not-valid-for-row, bad date, month, amount, limit, offset and null refusals call nothing; flat schema, description, read-only annotation and the 4b rewrite |
| `compact_summarize_transactions.test.js` | #673: `summarize_transactions`: one positive per `report` row (string and array `group_by`, `account_id` sent as `id`); required-field, date-order, months-versus-start_date, UUID and not-valid-for-report refusals call nothing; flat schema, description, read-only annotation and the 4b rewrite |
| `compact_list_budget_months.test.js` | #674: `list_budget_months`: no month lists months, a month routes to the one-month tool; malformed month, null, number and unknown property refused; published schema, description, read-only annotation and the 4b rewrite |
| `compact_run_query.test.js` | #674: `run_query`: the query passes through unchanged; stacked-statement, GraphQL and validator refusals name `run_query` never `actual_query_run`, never reach the adapter, and keep query text out of the logs |
| `compact_manage_accounts.test.js` | #676: `manage_accounts`: each of the seven actions and both entity routes maps to the exact legacy name and arguments (entity never forwarded); per-entity required fields, `close` entity rule, empty update, transfer account equal to id, month id on set_note refused; read-only hides it; annotations are destructive and open-world |
| `compact_manage_categories.test.js` | #676: `manage_categories`: create, update, delete and set_note with both entity routes map to the exact legacy name and arguments; required `group_id` for a category, `hidden` only for a group, empty update and month id refusals; read-only hides it |
| `compact_manage_payees.test.js` | #676: `manage_payees`: five actions map to the exact legacy name and arguments; `category: null` forwarded, merge bounds and renames, empty update, month id refusals; read-only hides it |
| `compact_manage_tags.test.js` | #676: `manage_tags`: three actions map to the exact legacy name and arguments, flat update; empty update keeps the legacy refusal message, unknown fields, bad ids and empty tags refused; read-only hides it; not open-world |
| `compact_manage_rules.test.js` | #677: `manage_rules`: five actions map to the exact legacy name and arguments with no injected default; `conditions_op` renamed, camelCase kept inside batch items and a snake_case item key refused; update action without `op`, 51 rules, delete with conditions refused; a legacy validation error and the rewrite of a legacy name pass through; read-only hides all five |
| `compact_manage_schedules.test.js` | #677: `manage_schedules`: three actions map to the exact legacy name and arguments; `amount_op` and `reset_next_date` renamed, no default injected; bad date, isbetween without a range (the translated #527 text), null on create and on non-clearable keys, delete with extra keys refused; the published `type` arrays carry no `anyOf`; read-only hides all three |
| `compact_manage_budget_months.test.js` | #678: `manage_budget_months`: seven actions map to the exact legacy name and arguments, `set_note` builds `budget-<month>`; missing and foreign keys, decimal amounts, hold and transfer amount 0, month 2026-13, same-category transfer, batch item rules refused with nothing called; a legacy name in an error is rewritten; read-only hides all seven |
| `compact_manage_budget_files.test.js` | #678: `manage_budget_files`: three actions map to the exact legacy name and arguments, no default `type` injected; unsafe budget name, both or neither import source, bad base64, unsafe export filename, foreign keys refused with nothing called; the description states the destructive semantics; read-only hides all three |
| `compact_manage_transactions.test.js` | #675: `manage_transactions`: each of the seven actions maps to the exact legacy name and arguments; per-action required fields, null only for update, strict id, date and amount rules, batch bounds, merge ids and transfer refusals name `manage_transactions`; read-only hides it; annotations are destructive |
| `compact_mapping_parity.test.js` (ceiling pin) | #681: the compact registry holds at most 15 tools (decision 3 of the design record); a 16th tool fails the check naming the ceiling unless another compact tool left in the same change |
| `new_tool_completeness.test.js` | #681 (redefined): the surface guard iterates the compact registry. Every (tool, selector value) pair needs a compact E2E row with its negative, a `tests/manual/tests/*.js` call and a prompt line naming the tool and the value together; selector-less tools need only the tool name. A prompt naming a legacy `actual_*` tool fails, except the two session tools inside the block marked `[legacy or all surface only: skip on compact]`. Prompt and README tallies must sum |
| `e2e_uses_compact_names.test.js` | #681: the e2e specs, the manual modules, `scripts/stdio-smoke.mjs` and the manual prompts call compact tool names; a legacy `actual_*` name is allowed only in the 14-row legacy smoke block, for the two session tools, in the compact refusal row, in prompt 3's session block and in the deprecated alias row |
| `tests/e2e/compact-surface.e2e.spec.ts` | #681: the compact-surface E2E spec (Playwright project `docker-e2e-compact-stdio`, run by Step 6c of `run-docker-e2e.sh`): the published `tools/list` is the 15 compact tools, plus the version, an account round trip and the legacy refusal, over stdio with `MCP_E2E_TOOL_SURFACE=compact` |
| `startup_record.test.js` | #623: the pure `sys_startup` builder: keys exactly the allowlist on HTTP, stdio and OIDC; no secret, name, bind address or URL path; auth mode, posture, bearer and principal facts; `bindScope`; paths and logging fields; version and count parity with `actual_server_info` |
| `startup_record_child.test.js` | #623: the built entrypoint: the record on stderr at info under stdio with a clean stdout before the first frame, the real port on HTTP, and no record when the port is taken (exit 1, `sys_crash`) or a weak token refuses a non-loopback bind |
| `http_shutdown_handler.test.js` | #632: every branch of `createShutdownHandler` with injected effects: close, wait for in-flight requests and queued writes, cleanup, then exit 0; shutting-down state from the first signal (the 503 gate reads it); a second signal, a failing cleanup or listener close, in-flight work past its budget (the deadline minus 2 s, never under half) and the deadline each exit 1; a cleanup error logs only its class; two handlers share no state; the 503 gate refuses every route during shutdown, counts admitted requests but not the SSE GET, and is the first `app.use`; `awaitInFlight` waits for the request count, then for queued writes |
| `adapter_await_writes_idle.test.js` | #632: `awaitWritesIdle()` against the real write queue (api stubbed, one child per case) resolves at once when idle, and stays pending until a write in its debounce window has run or a write mid-drain has finished |
| `http_sigterm_exit_child.test.js` | #632: the built entrypoint on HTTP exits 0 within 5 s on SIGTERM and on SIGINT after the session cleanup, an idle keep-alive socket and an active connection with unfinished headers do not hold it open, a second SIGTERM never hangs (an exit 1 names it), and with no signal it keeps running |
| `http_compressed_body_refused.test.js` | #633: the built entrypoint on HTTP refuses a gzip, deflate, br or uppercase GZIP request body with 415 and our `-32600` envelope (also a gzip frame plus trailing bytes, after which `/health` still answers), while an uncompressed or identity body is parsed and `initialize` answers id 1 |
| `issue_templates_no_dashes.test.js` | #635: every `.github/ISSUE_TEMPLATE/*.yml` parses as YAML, carries no em or en dash (file and line named), and labels its scenarios placeholder **Positive:** and **Negative:**; negative cases prove each checker catches what it guards |
| `tool_description_checklist.test.js` | #650: the 24 tool descriptions rewritten for Glama's TDQS (#640, #650) each state a `Returns` sentence, name at least one other tool and only published ones, and carry none of the filler phrases `in Actual Budget.`, `Perfect for`, `Ideal for`; built-in fixtures prove each rule fails. Adding a tool to its lists is the deliberate step that holds it to this floor |
| `tools_list_size_budget.test.js` | #486: the full `tools/list` (all tools, built as the server builds it) stays under a committed total ceiling and a uniform per-tool ceiling; built-in fixtures prove a padded description and a total 1 byte too low are reported by name. Raising a ceiling is a deliberate edit with a comment stating why |
| `tool_param_descriptions.test.js` | #639: every input property every tool publishes in `tools/list` carries a description, at any depth (union branches, array items, `$ref` targets), with the checked tool count equal to the canonical count; in-file fixtures prove an undescribed top-level, union-branch and array-item field are each reported by full path, and two pins prove the descriptions added no validation |
| `tool_titles.test.js` | #641: every published tool carries a display title from `src/lib/tool-titles.ts`: the table covers exactly `IMPLEMENTED_TOOLS`, titles are unique, sentence case, 2 to 5 words, never start with "Actual", and start with a read verb exactly when the tool is read-only; the shared builder and `fetchCapabilities` publish the table title (no `title: tool.name` override); in-file fixtures prove each rule can fail |
| `tool_aliases.test.js` | #652: the six deprecated camelCase budget names resolve to their snake_case tools at the top of `callToolChecked`: same result as the new name, one warning per alias per process (tool, alias, removal date), a typo or `constructor` stays `Tool not found`, `getTool` does not resolve, every target is registered and no alias is listed |
| `tool_name_case.test.js` | #652: every `IMPLEMENTED_TOOLS` name is lower snake_case `actual_<domain>_<action>`; fixtures prove a camelCase, unprefixed or double-underscore name is reported |
| `tool_output_schema.test.js` | #642: `outputSchema` + `structuredContent` for exactly `actual_accounts_list` and `actual_accounts_get_balance`: `frameToolResult` (byte-identical without a verdict, `isError` and no `structuredContent` on a mismatch), `callToolChecked` verdicts and the `output_mismatch` log outcome (tool name and issue paths only, no values), unlisted upstream fields survive, an uncovered tool is unchanged, published schemas are root `type: "object"`, loose, non-empty, SDK `ListToolsResultSchema`-parsable (a `z.union` fixture built with `io: 'output'` fails it), and the real HTTP and stdio call handlers keep the verdict |
| `rules_update_schedules_schema.test.js` | #486: input schemas of `rules_update` (`op` required), `schedules_create` and `schedules_update` keep their Zod rejections (code and path) after the description trim; #527: the `{ num1, num2 }` range amount and its `amountOp` refusals; #478: monthly `patterns`, their refusals, the strict recur config and the optional `endMode`, on both tools and in `tools/list` |
| `schedules_update_amount_guard.test.js` | #527: `adapter.updateSchedule` reads the stored row in the same drain when only one of `amount` / `amountOp` is sent, and refuses a pair that cannot match before the write |
| `schedules_dead_conditions.test.js` | #547: `adapter.createSchedule` and `adapter.updateSchedule` drop a payee or account rule condition that can never match (omitted field stored as `"undefined"`, cleared one as `"null"`) inside the same drain as the schedule write, with a bounded rule poll; a schedule with both fields set triggers no rule read |
| `schedules_dates.test.js` | #479: `adapter.getScheduleDates` lists the schedules and expands the row's `date` field in ONE session (intruder witness, with a teeth case that goes red on two sessions); asks upstream for one date past the limit so `truncated` means more dates exist; caps at 366; typed refusals for an unknown id, `end` before `start` and a weekend skip without `weekendSolveMode`; other upstream errors pass through; Zod rejects a bad count, id or date |
| `source_text_helper.test.js` | #532: `helpers/source-text.js` comment strippers: `stripTsComments` keeps strings, templates (`${}` scanned as code) and regex literals (`/^http:\/\//i` is not a comment) intact, removes `//` and block comments, keeps CR/LF; `stripHashComments` for shell, YAML and `.env`; newline count preserved over every `src/**/*.ts`, `.sh`, workflow and `.env.example`; the C2 anchor check prints `skip:` when absent |
| `transport_onerror.test.js` | `server.onerror` is wired at both `new Server(` sites (HTTP and stdio) before `connect`; the logged record has a constant message and a sanitized `detail` (payload echoes cut, `%`, control, C1 and bidi characters stripped, 200 code point cap, no stack or cause); the handler chains a prior `onerror` and never throws; one per-process 50 per 60 s limiter spans all sessions and reports `suppressed`; under stdio the record goes to stderr and stdout stays empty (#504); #536: a window that ends with suppressed calls and no later allowed call reports the count once through a flush scheduled for the window end (delay clamped to one window so a backward clock step cannot overflow the timer; `unref`'d so it never holds the process open, so a shutdown inside the window drops the pending count; never reported twice; a throwing reporter or timer never escapes `take()` or the timer callback; the next suppression after a flush schedules a fresh one), the summary is logged outside the request context so it carries no `sessionId` or `requestId`, and under stdio it goes to stderr |
| `httpServer_batch_cap.test.js` | A JSON-RPC batch of more than 100 messages on a session-bearing HTTP POST is refused with 400/-32600 by `@modelcontextprotocol/sdk` 1.30.1, and exactly 100 is not; the POST paths still hand the SDK `req.body` and a session-less array is refused by our own handler, both checked on comment-stripped source with mutation fixtures proving each guard can fail (#503); installed and declared SDK are at least 1.30.1 (#500) |
| `httpErrorHandler.test.js` | The final Express error layer (#543): malformed JSON gives 400 (-32700 on the exact MCP path, plain `{error}` elsewhere, `/mcp-info` is not `/mcp`), oversize gives 413, other exposed body-parser 4xx keep their status (unsupported charset or encoding 415, corrupt gzip 400, logged at warn) while a status without `expose` stays 500, a thrown error gives a fixed 500 even under `NODE_ENV=development`; the request text never reaches the response or the logs; after headers are sent the socket is destroyed and `next` is never called. Positive and no-handler controls prove the capture can see the leak (the 5.3.0 control runs only on express >= 5.3.0) |
| `httpServer_error_handler_wiring.test.js` | The real `startHttpServer` (MCP path `/http`) answers a malformed JSON POST with 400 and JSON-RPC -32700 on the MCP path and a plain `{error}` on `/health`; a sentinel in the body never reaches a response or anything logged; `/metrics` keeps its pre-bump Content-Type; the last router layer is the 4-arity #543 handler and stdio does not import it (#543) |
| `httpServer_trust_proxy.test.js` | The real `startHttpServer` leaves `trust proxy` off, so a client `X-Forwarded-For` (including a v4-mapped v6 form) never changes `req.ip`, with a positive control that a trusting app does read it; and the installed `proxy-addr` is at least 2.0.8 (GHSA-jqcg-44mw-7w3h, fixed through express 5.3.0) (#543) |
| `dotenv_stdout_quiet.test.js` | The single `dotenv.config()` in `src/index.ts` pins `quiet`, `debug`, `override` and `path`, and with dotenv 18 those options leave stdout and stderr empty under every `DOTENV_*` knob, keep a preset secret over the file, and ignore `DOTENV_PATH`; two witnesses prove the harness sees dotenv output and that the debug hazard is real (#501); the load path is checked on comment-stripped source: dotenv is imported only in `src/index.ts`, with no `dotenv/config` subpath and no `configDotenv(`, one `dotenv.config({...})` object literal with no spread and all six options pinned, and the binding used nowhere else (#533). Also pins all six options at the two non-server callers (`tests/manual/runner.js`, `scripts/direct-sync/bank-sync-direct.mjs`) and runs the runner's call text under hostile `DOTENV_*` knobs, asserts the `DOTENV_CONFIG_QUIET` grep exits exactly 1, routes child launches through a 10 s timeout helper, and scrubs `NODE_OPTIONS` and `MCP_TEST_BUDGET_SYNC_ID` from the child env (#505) |
| `residue_pattern.test.js` + `harness_cleanup.test.js` | The residue contract (#280, #576): every `MCP-*` template the integration modules generate is visible to the sweep, and so is every `MCP-REG270-*`/`MCP-DIAG270-*` name the step 9 harness scripts generate (harvested from the scripts); human names such as `REG270 budget` and names without a 13-digit run id never match. Listings are read in the shapes the live tools return, so `{ groups }`, `{ rules }` and `{ schedules }` are counted and swept, each key only from its own tool (#584). `scripts/lib/harness-cleanup.mjs` deletes only the current run's objects, categories before groups, each call bounded, stopping at the first timeout |
| `harness_stdio_data_dir.test.js` | #575: a harness stdio server never runs on the live server's `/app/data`. Pins `scripts/lib/harness-stdio.mjs` (`-u app`, its own `MCP_BRIDGE_DATA_DIR`, `/app/data` itself refused, subdirectories allowed) and scans `scripts/*.mjs` and `tests/manual/*.js` so every `docker exec ... --stdio` site goes through it; `scripts/stdio-framing-check.mjs` is the named exclusion (its own `buildDockerArgs`) |
| `rules_stage342_cleanup.test.js` | #585: the integration module `tests/manual/tests/rules.js`, driven by a stub client over an in-memory rule store, deletes the #342 no-stage rule it creates (`MCP-Rule-stage-342`) and clears `context.ruleStage342Id`; a delete that does not take effect is recorded as a failure and leaves the id set for the runner's CLEANUP PHASE, which deletes it in its own try/catch |
| `manual_borrowed_category.test.js` | #590: the integration modules that borrow a PRE-EXISTING category when the budget has one (`rules.js`, `batch_uncategorized_rules_upsert.js`; `budget.js` no longer borrows since #591) record it through `tests/manual/context.js` (`borrowCategory`), and the runner's cleanup phase asks `isBorrowedCategory` before deleting `context.categoryId`. Drives `rules.js` with a stub client: a borrowed id is never deleted and the cleanup decision leaves it in place; a category the module CREATED is still deleted; static guards fail when a module assigns a listed category straight into `context.categoryId`, when the runner deletes without asking the helper, or (#591) when a module that writes budget amounts touches `context.categoryId` or calls `borrowCategory`. Before the fix every mutating run deleted one real category per transport leg, invisible to the residue sweep (which only sees additions) |
| `manual_budget_no_borrowed_writes.test.js` | #591: the integration module `tests/manual/tests/budget.js`, driven by a stub client over an in-memory budget whose category listing has the real flat shape, never writes a budget amount, carryover or transfer to a PRE-EXISTING category (neither when `context.categoryId` is null nor when it holds a borrowed id): every write targets a category in the module's own `MCP-BudgetTest-Group-*`, and the pre-existing category's budgeted and carryover for this month and next are unchanged. Negative rows: a call that throws mid-module still ends with the module's group and categories deleted (cleanup runs in a `finally`), and a pre-existing amount that changes by any path is reported by the module's own before/after snapshot of every category's budgeted and carryover, which is the check the live `full` run relies on (taken after the module's budget-switch steps, so the snapshot, writes and compare read one budget; an empty snapshot is itself a failure). Before the fix every `full` run left a real category at the suite's last written amount, invisible to the residue sweep |
| `refresh_test_budget_snapshot.test.js` | #595: `scripts/refresh-test-budget-snapshot.mjs` refuses before importing the api (exit 2 for an unset or mismatched designation, 3 for an OIDC sync id, 4 for a data dir inside `/app/data`); against a stub api module it sends `upload-budget` once, never sends it for another open budget, and fails on `{ error }`, a changed server file id, or a replay above the limit, without printing the password; `deploy-and-test.sh` runs it as `app` under a timeout before the stdio run and exits when it fails |
| `docs_check.test.js` | #602: the `npm run docs:check` orchestrator (`scripts/docs/check.mjs`) through its `run({ root, modules, env })` seam with stub modules (no lychee, no `PATH`, no real repo): an async module's problem is awaited and reported as `<module>: <problem>` with exit 1; a local skip prints `skip: links: lychee not installed`, exits 0, and the markers module after it still runs and its problem line still appears; with `CI` set the same skip exits 1 as `links: lychee required but not found`; a module that throws fails the run |
| `docs_tools.test.js` | #603: the `tools` docs module (`scripts/docs/tools.mjs`) renders the README tools-summary block (toolset table, `chat` sentence, read-only sentence) from the registry: stub-data render, scope-key reconciliation both ways, idempotent `generate()` (`['README.md']` then `[]`), a stale block, a missing or duplicate marker (README left unchanged), no dist (skip locally, `tools: dist required: ...` under `CI`, `generate()` throws), an inert import (`process.env` unchanged), and a real-registry case that the README block is current and matches no `TOTAL_PATTERNS` entry. The hand-typed-count guard lives in `readme_stats_sync.test.js` |
| `docs_readme_size.test.js` | #607: the `readme-size` docs module (`scripts/docs/readme-size.mjs`), which bounds the README as the Docker Hub long description. Against temp READMEs built to exact line and byte layouts: 23,900 bytes passes and 23,901 raw bytes plus one relative link (projected 24,001) fails; the first `<!-- runnable: <id> -->` fence on line 40 passes and on line 41 fails; an unmarked bash fence is not an install block; absolute, `mailto:` and same-page links are not counted; a missing README is a single problem; a reference-style link definition, a relative link inside any fence and `<details>` each fail with their line. Also the real README passes and the module is registered in `scripts/docs/check.mjs` |
| `docs_markers.test.js` | #602: `scripts/docs/markers.mjs` on temp trees reports `frozen marker: docs/guides/x.md:3` for a nested numeric Version marker and `frozen marker: scripts/README.md:5` for a numeric Tool Count marker, and reports nothing for a marker inside the `version-bump.js` set (`README.md`, top-level `docs/*.md`, `.github/copilot-instructions.md`) or for the bare token in prose; the walk skips `node_modules` and `.git`, and on the real repo the enumerator takes the `git ls-files` path |
| `docs_links_fixture.test.js` | #602: copies the negative fixture `tests/fixtures/lychee/` into a temp tree and asserts the links module reports its broken cross-file link, broken cross-file fragment and broken same-file fragment with file and line; a control run WITHOUT `--include-fragments` misses the cross-file fragment (the flag is load-bearing); the real run's `--exclude-path` hides the fixture. Without lychee it prints `skip: lychee not installed` and exits 0, unless `CI` is set AND `DOCS_CHECK_REQUIRE_LYCHEE=1` (the `Docs check` CI job), where it exits 1 |
| `client_examples.test.js` | #606: every file in `docs/guides/clients/examples/` exists (JSON files parse; the YAML and TOML files are checked line by line, without a parser), holds no em or en dash, and holds no literal secret: `ACTUAL_PASSWORD`, `Authorization` and token fields are references (`${VAR}`, `${env:VAR}`, `${input:id}`, `$VAR`) or placeholders, and no secret sits on a command line (`args`, a `#` recipe line). `gemini-settings.json` keeps `trust: false` and `codex-config.toml` forwards `ACTUAL_PASSWORD` by name (`env_vars`). Every page under `docs/guides/clients/` exists, carries the `Prerequisites`, `Configure`, `Verify`, `Troubleshooting` and `Where the secret lives` headings and links its example; its json, yaml, toml and shell blocks pass the same secret rules, any VS Code install link or Cursor deeplink is decoded and must carry no literal token, and the VS Code and Cursor pages state that no install link is offered |
| `mcp_server_json.test.js` | #610: MCP Registry metadata. `scripts/mcp-server-json.mjs` stamps the three `0.0.0` version slots of `server.json` and refuses an OCI identifier with no tag; `--expect-version` refuses a tag that disagrees with `VERSION` or `package.json`. `checkRegistryMetadata` accepts the committed `server.json`, `package.json` and `Dockerfile`, and names the problem for each negative: a description over 100 characters, a missing or different `mcpName`, a label missing from the final Dockerfile stage, a forbidden or unknown variable, a secret without `isSecret`, a dropped required variable, a missing Authorization header, an Authorization header without a required secret `token` variable (without it a client sends the literal `Bearer {token}`), a port not bound to 127.0.0.1. Every declared variable must be canonical in `config-registry.ts`. Also pins the workflow wiring: the publish job needs `verify-published-artifacts` and is not in `release.needs`, each job's whole permissions block is exactly `contents: read` (validate) or `contents: read` plus `id-token: write` (publish), and both jobs are `continue-on-error`. |
| `glama_json.test.js` | #644: Glama directory metadata. `checkGlamaJson` accepts the committed `glama.json` and names the problem for each negative: a wrong `$schema`, a missing or empty `maintainers`, a duplicate login (case-insensitive), an invalid GitHub login (bad character, leading, trailing or doubled hyphen, over 39 characters), and any key other than `$schema` and `maintainers` (stricter than Glama's schema, on purpose). `checkReadmeBadge` requires the Glama score badge in `README.md`, wrapped in a link to the listing; a missing, mislinked or unlinked badge each fails. |
| `residue_unreadable.test.js` | #583: an unreadable listing (error text, a thrown call, `null`, a foreign object or key) is named in `findResidue`'s `unreadable` without a throw, `assertNoResidue` throws `ResidueUnreadableError` before counting (a partly read budget holding residue is neither certified nor counted), each tool is readable under its own key, a readable empty budget still returns 0, and the sweep names an unreadable listing instead of "budget already clean" while still removing what it read |

**Run**:
```bash
npm run test:unit-js   # runs the full unit chain (~52 files) sequentially
```

**Coverage**: 85/85 tools smoke-validated (offline, stub adapter). 60+ negative-path assertions across 11+ tool schemas.

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

**Framework**: Playwright ^1.64.1

**Scenarios**:
- MCP client connects to server
- LibreChat loads all 85 tools
- User performs complete workflow via chat

**Run**:
```bash
npm run test:e2e
```

**Status**: Fully operational. `docker-all-tools.e2e.spec.ts` covers all 85 tools end-to-end.

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

**Purpose**: Smoke test all 85 tools

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

1. **The sync id does not cross the `docker exec` boundary.** `tests/e2e/compose.yaml` does not carry `ACTUAL_BUDGET_SYNC_ID` in its `environment:` block. The service entrypoint reads `/tmp/actual-sync-id.txt` and `export`s it, so it lives in PID 1's runtime environment, and `docker exec` builds a new process's environment from container **config**, not from PID 1. It arrives empty. The framing check reads the same file the entrypoint reads.
2. **The stdio data dir must be writable and must be neither `/tmp` nor `/app/data`.** `/tmp` is mounted `bootstrap-data:/tmp:ro`, so a `mkdir` there fails, and it fails inside a bare `catch {}` that resurfaces later as an ENOENT during adapter init. `/app/data` is the HTTP server's own directory, and #280 established that two `@actual-app/api` instances must never share one budget cache.

---

### Train liveness: detecting a train that never RAN (#327)

`report-train-failure.mjs` reports a train that **failed**. It cannot report one that **never ran**, because no run means no reporter job, which lands in the same found-by-eye state #325 was filed to fix.

Two verified causes:

- **GitHub disables scheduled workflows in PUBLIC repositories after 60 days of repository inactivity.** This repo is public, so it applies. Near-daily commits keep resetting the clock, so this is the lower-probability cause today.
- **Cron dispatches are delayed under load and dropped under sufficiently high load.** GitHub does not guarantee a scheduled run fires. This is the live cause, and it is why the train's cron moved off minute 0, the top-of-hour peak GitHub advises scheduling away from.

**Two signals, because they detect disjoint failures.** The workflow `state` field (`active`, `disabled_manually`, `disabled_inactivity`) is directly observable, immediate and threshold-free, and catches a disabled workflow. Recency of the newest `event=schedule` run catches a workflow that is `active` but not firing anyway. Recency alone was the original proposal and is the worse primary: it is a derived proxy that cannot fire until the threshold has elapsed.

Four query details are load bearing:

- **`event=schedule` is filtered.** `dependency-update.yml` also carries `workflow_dispatch`, and manually dispatching the train is the *first* diagnostic step when it looks dead. An unfiltered query would let that diagnostic reset the liveness clock while the cron stayed dead. Status is deliberately **not** filtered: a scheduled run that failed still proves the cron fired, and reporting that failure is #325's job.
- **`created_at`, not `run_started_at`.** `created_at` timestamps the dispatch, which is the property under test. `run_started_at` conflates dispatch with runner availability and would report a queued-but-dispatched run as a dead cron.
- **An affirmative windowed probe runs FIRST, and can only ever say ALIVE (#443).** Before reading the page, the check asks the API directly whether any `event=schedule` run exists with `created>=<now minus threshold>`. Verified against the live endpoint before it was written: the qualifier IS honoured, but a MALFORMED value returns zero rather than erroring. So a non-empty result is proof of life and is independent of both ordering and which window the API returned, while an empty result proves nothing and falls back to the page read. The worst a broken cutoff can do is degrade to the previous behaviour. On a healthy train it also SHORTENS the run, since the page read is skipped.
- **A PAGE is read and the newest run is selected by timestamp, never by position (#436).** The check used to read `per_page=1` and take `workflow_runs[0]`, which assumes newest-first ordering. That ordering is undocumented and cannot be requested: the endpoint accepts `actor`, `branch`, `check_suite_id`, `created`, `event`, `head_sha` and `status`, and has no `sort` or `direction` parameter. On 2026-09-04 a read placed a 292h-old run at the head while a 4.5h-old run existed, which failed the job, opened a false P2 (#434) and blocked releases until the job was re-run. It now reads `per_page=30` and selects `max(created_at)` via `selectNewestScheduledRun`. Because a read can also be incomplete rather than merely misordered, and no page size fixes an EMPTY page, a workflow the first pass calls stale gets exactly one confirming re-read after `CONFIRM_DELAY_MS`, and is reported only if both reads agree. That delay is paid only when the check is about to call a workflow dead, never on the healthy steady state. A read that FAILED yields an `inconclusive` finding, which suppresses the close branch: an unknown is not evidence of recovery, and closing on one would delete a valid alert and defeat the dedupe.

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
via the `knip` key of `package.json`:

```bash
npm run knip            # blocking since #237: exits nonzero on any dead code
```

- **CI/CD**: the `Check for dead code` step in the `Lint Code` job runs `npm run knip` in
  failing mode (#237): it exits nonzero on any unused file/export/type and FAILS the job, so
  new dead code cannot merge. `tests/unit/knip_config.test.js` guards that `scripts.knip`
  stays failing-mode (no `--no-exit-code`).
- **Guard tests** (in `test:unit-js`, fail CI on drift): `tests/unit/knip_config.test.js`
  (every `package.json#knip` entry root exists on disk) and `tests/unit/advertised_tools_sync.test.js`
  (every `actual_<domain>_<action>` tool name advertised in `README.md` resolves to
  `IMPLEMENTED_TOOLS`, catching documented-but-missing/renamed tools). These join the existing
  doc-to-code drift guards: `tool_count_sync`, `config_drift`, `port_alignment`,
  `dockerfile_data_dir_alignment`, `compose_profile_sync` (#600: also the compose security
  posture: production image namespace, optional `.env`, required token, loopback-only dev and
  test ports), `install_snippets` (#600: every `docker run` block in the README and guides uses
  `--env-file` and a registry image and puts no secret or container-side `localhost` on the
  command line; the marked runnable blocks run against stub tools),
  `workflow_release_guards` (#261: auto-release workflow invariants + lockfile agreement),
  `report_train_failure` (#325: the release-train failure notifier),
  `bot_target_branch` (#265: dependabot blocks and the inert renovate config target develop), and
  `node_version_drift` (#275: `engines.node` is canonical; the Dockerfile `FROM node:` tags,
  every workflow's Node pin, and the README must agree with it. Run standalone with
  `npm run node-version-drift`).
- **Install snippet startup smoke** (#600): after a successful E2E run, the `docker-e2e` job
  builds the image and runs `node scripts/install-snippets.mjs smoke --image actual-mcp-server:ci-smoke`,
  which creates `.env` with the README `env-token` block, starts the README `docker-run` block
  with dummy Actual settings, and requires `/health` to answer 200 within 30 seconds.
- **Write-queue wakeup guard** (#278): `tests/unit/adapter_write_queue_wakeup.test.js` pins the
  lost-wakeup regression in `src/lib/actual-adapter.ts`. A write enqueued while a previous batch
  was draining used to be stranded (never dispatched, promise never settled) until an unrelated
  later write drained the queue. `withOpTimeout` (#270) cannot catch that: it bounds execution,
  not queue residency. The test also pins the debounce COALESCING property (5 same-tick writes
  produce exactly ONE batch, via `_getWriteQueueBatchCountForTests()`), because a fix that drained
  on every enqueue would close the deadlock and silently multiply init/sync cycles. Cases that
  depend on `ACTUAL_OP_TIMEOUT_MS` run in child processes: `config.ts` reads `process.env` once at
  module load, so an in-process env override is silently ignored and the assertion becomes vacuous.
- **Tool content logging guard** (#556): `tests/unit/tool_content_logging.test.js` drives the
  real `callTool` and `createTool` path at `MCP_BRIDGE_LOG_LEVEL=debug` with sentinel values in
  the arguments and the result, captures every byte written to stdout and stderr, and asserts no
  sentinel appears on success, on a handler failure or on a validation failure, while the
  content-free `[TOOL RESULT]` record (`tool`, `durationMs`, `outcome`, `bytes`) does.
  Since #559 it also asserts an error MESSAGE (a quoted name, a custom validation message, a
  refused id) reaches the client but no log line.
- **Adapter error logging guard** (#559): `tests/unit/adapter_error_logging.test.js` drives the
  real adapter with raw api stubs at `debug` and asserts a failed category create and a rejected
  query keep their sentinel out of the write queue, retry and query error lines, which log
  `errorLogFields` (class, refusal kind, system error code, log-safe text) instead.
- **Server console guard** (#625): `tests/unit/server_no_console.test.js` strips comments from
  every `src/server/*.ts` and fails on any `console.` reference, so server code logs through
  `createModuleLogger`. It also pins the listen record: one `HTTP` module log line carrying `port`,
  `endpoint` and `health`, whose text still holds `MCP endpoint: <url>` for the E2E scrape.
- **Server instructions guard** (#560): `tests/unit/server_instructions.test.js` checks that the
  `initialize` instructions text, built from the published tools, names only published tools in
  every preset and toolset, in both read-only modes, and stays at most 512 characters. A
  comment-stripped scan of `src/` forbids the old "proxy any API call" text and any non-spec
  `serverInstructions` key, and a real HTTP `initialize` returns the passed string unchanged.
  The full-registry text over both transports is pinned in `docker-all-tools.e2e.spec.ts`.
- **Integration cleanup guard** (#519): `tests/unit/batch_uncategorized_cleanup.test.js` drives
  `tests/manual/tests/batch_uncategorized_rules_upsert.js` with a stub client. Since #517 a
  whole-call failure is a thrown tool error, so the module body runs in `try/finally` (no `catch`):
  the disposable category and group it created are removed, a failing cleanup is recorded via
  `fail()` without masking the original error, and a borrowed category is never deleted.
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

- **Unit Tests**: schema/shape smoke tests + 23 negative-path assertions across 85 tools
- **Adapter Tests**: Infrastructure smoke (retry, concurrency, lifecycle), not per-tool
- **Docker E2E**: 68/70 tools with named tests (real Actual Budget server); 2 tools excluded (`budgets_list_available` and `budgets_switch` require ≥2 budgets, and the CI stack has 1). All 6 delete tools are named tests with list-absence assertions; `afterAll` is a safety fallback only.
- **Live Integration**: 85/85 tools called against real budget (all delete tools are named tests in `tests/manual/tests/`)

### Coverage Goals

| Test Type | Current | Target | Priority |
|-----------|---------|--------|----------|
| Unit Tests | 80% | 90% | High |
| Adapter Tests | 100% | 100% | Maintain |
| Integration Tests | 85/85 tools (live) | Maintain | Medium |
| E2E Tests | All 85 tools (Docker) | Maintain | Medium |

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
                /   Full E2E Tests    \    ← All 85 tools + Error scenarios
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
- ✅ All 85 tools registered correctly
- ✅ Tool schemas valid (Zod validation)
- ✅ Tool descriptions present
- ✅ Basic tool invocation works

**Test Files:**
- `src/tests_adapter_runner.ts` - Main adapter test runner
- `tests/unit/generated_tools.smoke.test.js` - All 85 tools smoke validation

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
| `generated_tools.smoke.test.js` | All 85 tools: stub adapter, `call()` succeeds, response shape verified per-tool | 85 + shape checks |
| `schema_validation.test.js` | Negative-path schema + runtime guards for 11+ tool schemas | 60+ |
| `contributor_docs.test.js` | Contributor docs (AGENTS.md, CONTRIBUTING.md, PR template, SUPPORT.md, CODE_OF_CONDUCT.md): real scripts, tracked links, `AGENTS.md` required and short, PR template at most 40 lines, instructions files defer to it (#496, #609) | 20+ |
| `toolsets.test.js` | Toolset policy: partition, preset, read-only set and its call-graph guard, refusal, fail-closed (#483); alias policy (#652) | 58 |
| `toolsets_entrypoint.test.js` | Entrypoint spawn: filtered list over stdio and HTTP, refusal, startup failures (#483) | 10 |
| `config_tool_surface.test.js` | `MCP_TOOL_SURFACE` parsing and its exclusion of `MCP_TOOLSETS` and `MCP_TOOLS` under `compact` (#671) | 19 |
| `compact_dispatch.test.js` | Compact surface: resolver, dispatcher, routes, 4b rewrite, `callOperation` bypass, import guard, `build` hook (#671, #672, #678) | 61 |
| `compact_mapping_parity.test.js` | Every legacy tool mapped, out of scope or pending exactly once; routes counted under one compact tool, `notes_update` shared from `set_note`, PENDING empty (#671, #672, #676, #677, #678) | 12 |
| `compact_get_context.test.js` | Compact `get_context`: routing, refusals, schema shape (#672) | 19 |
| `prompt_registry.test.js` | Prompt registry offer filter, surface matrix, validators (#660) | 20 |
| `prompt_handlers.test.js` | `prompts/list` and `prompts/get` over an in-memory client, transport wiring guards (#660) | 13 |
| `prompts_entrypoint.test.js` | Built entrypoint over stdio: prompts capability, empty list, `-32602` (#660) | 8 |
| `compact_list_entities.test.js` | Compact `list_entities`: defaults, routes, refusals, 4b rewrite (#672) | 51 |
| `tdqs_capture_env.test.js` | TDQS harness capture env and `--surface` refusal (#679) | 7 |
| `compact_search_transactions.test.js` | Compact `search_transactions`: seven rows, refusals, schema shape, 4b rewrite (#673) | 30 |
| `compact_summarize_transactions.test.js` | Compact `summarize_transactions`: six reports, refusals, schema shape, 4b rewrite (#673) | 41 |
| `compact_list_budget_months.test.js` | Compact `list_budget_months`: month route, refusals, schema shape, 4b rewrite (#674) | 14 |
| `compact_run_query.test.js` | Compact `run_query`: pass-through, validator refusals name `run_query`, no query text in logs (#674) | 17 |
| `compact_manage_transactions.test.js` | Compact `manage_transactions`: seven actions, refusals, read-only, annotations (#675) | 42 |
| `compact_manage_accounts.test.js` | Compact `manage_accounts`: seven actions, entity routes, refusals, read-only, annotations (#676) | 34 |
| `compact_manage_categories.test.js` | Compact `manage_categories`: four actions, entity routes, refusals, read-only (#676) | 25 |
| `compact_manage_payees.test.js` | Compact `manage_payees`: five actions, refusals, null category, read-only (#676) | 25 |
| `compact_manage_tags.test.js` | Compact `manage_tags`: three actions, refusals, read-only, size, annotations (#676) | 19 |
| `compact_manage_rules.test.js` | Compact `manage_rules`: five actions, refusals, batch item keys, legacy passthrough, read-only (#677) | 34 |
| `compact_manage_schedules.test.js` | Compact `manage_schedules`: three actions, date and amount unions, refusals, read-only (#677) | 28 |
| `compact_manage_budget_months.test.js` | Compact `manage_budget_months`: seven actions, refusals, rewrite, read-only (#678) | 28 |
| `compact_manage_budget_files.test.js` | Compact `manage_budget_files`: three actions, refusals, destructive description, read-only (#678) | 21 |
| `startup_record.test.js` | `sys_startup` builder: allowlist, privacy, auth facts, `actual_server_info` parity (#623) | 19 |
| `startup_record_child.test.js` | Entrypoint spawn: record on stdio and HTTP, none on a taken port or a refused start (#623) | 5 |
| `http_shutdown_handler.test.js` | Shutdown factory and 503 gate: order, in-flight wait, state, second signal, failing cleanup and close, deadline, per-instance state, gate refusal and counting, mount order, drain wiring (#632) | 17 |
| `adapter_await_writes_idle.test.js` | Write queue idle wait: idle, debounce window, mid-drain (#632) | 3 |
| `http_sigterm_exit_child.test.js` | Entrypoint spawn: HTTP exits on SIGTERM and SIGINT, with an idle keep-alive socket or an open connection, on a second signal, and not without one (#632) | 7 |
| `http_compressed_body_refused.test.js` | Entrypoint spawn: compressed request bodies get 415 and never crash the server; plain and identity bodies parse (#633) | 7 |
| `issue_templates_no_dashes.test.js` | Issue templates: YAML parses, no dashes, bold scenario labels, plus checker negatives (#635) | 10 |
| `tool_description_checklist.test.js` | tool description checklist: Returns sentence, a named sibling, no filler, one fixture per rule (#650) | 8 |
| `tools_list_size_budget.test.js` | tools/list size budget: total and per-tool ceilings, padded-description and 1-byte-under fixtures (#486) | 5 |
| `tool_param_descriptions.test.js` | Every published input property is described at any depth; fixture self-test and no-validation-change pins (#639) | 10 |
| `tool_titles.test.js` | Every published tool has a unique, well-formed title that agrees with its read-only hint (#641) | 27 |
| `tool_aliases.test.js` | Deprecated camelCase budget aliases: same result, warn once, typo and inherited names refused, never listed (#652) | 8 |
| `tool_name_case.test.js` | Tool names are lower snake_case; camelCase, unprefixed and double-underscore fixtures fail (#652) | 4 |
| `tool_output_schema.test.js` | outputSchema and structuredContent for two tools: framing, verdict, log outcome, SDK parse, both transports (#642) | 23 |
| `rules_update_schedules_schema.test.js` | Schema rejections for `rules_update`, `schedules_create`, `schedules_update` (#486); range amounts and `amountOp` refusals (#527); recur `patterns` and strictness (#478) | 90+ |
| `schedules_update_amount_guard.test.js` | Adapter read-then-write guard for a one-field `amount` / `amountOp` schedule update (#527) | 38 |
| `schedules_dead_conditions.test.js` | Adapter strip of dead payee / account schedule rule conditions on create and clear, same drain, bounded poll (#547) | 35 |
| `schedules_dates.test.js` | `actual_schedules_dates`: one-session expansion, the 366 cap, `truncated`, typed refusals (#479) | 40 |
| `schema_json_openai_compat.test.js` | Walks all 71 published `z.toJSONSchema()` outputs; asserts no `\p{...}` escape and every `pattern` compiles without the `u` flag, so no tool schema is rejected by OpenAI's Responses validator (#293) | 71 schemas |
| `schema_published_parity.test.js` | Walks every tool's Zod schema down to its regex leaves; asserts every published UUID `pattern` accepts `2E1F5BDB-209B-43F9-AF2C-3CE28E380C00`, that no regex check carries a flag, and that the Zod verdict equals the `AjvJsonSchemaValidator` verdict on a shared fixture set, with negative fixtures proving each detector fires (#588) | 84 tools, 51 id sites |
| `unhandled-rejection.test.js` | Allow-list predicate for `process.on('unhandledRejection')`: production-shape secondary rejection swallowed; unrelated EACCES still exits; existing allow-list entries unchanged (#152) | 12 |
| `process_handlers.test.js` | Process handler factory with recording exit, stderr and logger: one gated `sys_crash` per fatal event, sentinel reasons never echoed, benign and bank sync survival, Node floor hint, throwing getters fall back, the `categorizeError` table and `httpStatus` gate, install order and no logger import (#622) | 41 |
| `process_handlers_child.test.js` | Installed handlers in a child under `MCP_STDIO_MODE=true`: a fatal rejection exits 1 with exactly one `sys_crash` line and no reason text, a bank sync throw is survived, stdout stays empty (#622) | 3 |
| `rejection-allowlist-purity.test.js` | Static analysis of `src/lib/rejection-allowlist.ts`: sentinel marker present; no static, dynamic, or CommonJS imports of non-node modules; no top-level side-effecting statements (#159) | 5 categories |
| `httpServer_bearer_auth.test.js` | Bearer auth path through the shared #572 matcher: SHA-256 digest compare with `timingSafeEqual`, no length short-circuit; forbids token-content log lines and any logger import in the auth modules (#157) | 14 |
| `static_tokens.test.js` | #572 rows S1 to S9: per-principal restore, first permitted budget in registry order, filtered listings, a denied switch keeps the active budget, the narrowed trusted-local skip, interleaved sessions; resolver and Zod config refusals (never naming a token value); the exact-match, every-entry constant-time matcher | 64 |
| `httpServer_static_tokens.test.js` | #572: the real HTTP server in a child process with two static principals plus the legacy token: per-token principal and `allowedBudgets`, session ownership across tokens, 401 on unknown and prefix tokens, the startup summary line with no token in output, the `MCP_ALLOW_UNAUTHENTICATED` run, and a startup refusal on an unknown budget | 25 |
| `session_ownership.test.js` | A session belongs to the principal that created it: `/health` state carries counts but no session id; `actual_session_list` and `actual_session_close` see and close only the caller's own sessions (run against the real pool seeded with two principals); source guards pin the POST and GET ownership check ahead of `touch` and `handleRequest` (with the same `tools/list` discovery reply an unknown id gets), and the owner record and eviction cleanup | 17 |
| `session_ownership_express.test.js` | #529: the POST and GET ownership checks exercised over Express in a child process running the real server in OIDC mode with two RS256 principals (discovery and JWKS from a fetch stub, verification through the server's own path; only `connectionPool.getConnection` is stubbed). A second principal using the first one's session id gets the unknown-id reply byte for byte (`tools/call` and `tools/list` over POST, the "Transport not ready" body over GET), its request never touches the idle clock, a session still initializing is refused the same way, and the owner is served with its clock touched. #550: a session whose init failed (the stub rejects with `ECONNREFUSED` before seeding) answers a non-owner with the unknown-id replies on all three routes while the initiator still gets the cause afterwards, and two further child runs, under a static bearer with no OIDC and with authentication disabled, show the cause reply unchanged for the single principal | 28 |
| `pool_orphan_sweep.test.js` | #530: a session whose pool entry was recycled without eviction is reaped after one idle window with no served request. Pool half in-process against the real sweep with a stepped clock (`registerSession`, `touch` stamping the registration, `beginRequest`/`endRequest` keeping a session with a request in flight off the sweep however long it runs (the end marker is `stream.finished`, with a Node witness that a `close` listener attached after a client abort never fires), the `max(entry, registration)` expiry, `forgetSession` and `shutdownAll` clearing it, `evicted` and `orphaned` listener reasons, nothing fired twice). Server half in a child process running the real server in OIDC mode: an orphaned session is torn down (its id gets the unknown-id reply, one `orphaned` log line), the owner's requests keep an entry-less session alive while another principal's do not, and source guards pin `registerSession` under `isConnectionPoolEnabled()` and the teardown body synchronous | 11 + 12 |
| `session_budget_state_cleanup.test.js` | #564: a session's selected budget is released on every session end, not only by `actual_session_close`. The real HTTP server runs in a child process with auth disabled; budgets are selected with the real `switchBudget` fast path and read back with `_getActiveBudgetConfigForTests`. Idle eviction and the #530 orphan reap release the selection, another session keeps its own, a switch keeps the new selection (negative), a selection committed after teardown (a switch in flight across it) is not recorded, the #189 preference restore is memoized into a live session but not a torn-down one, and a source check pins the map's single write site inside the liveness-checked helper | 9 |
| `http_session_delete.test.js` | #563: HTTP `DELETE` ends a session. Two child-process runs of the real HTTP server: pool on with a static bearer, and `USE_CONNECTION_POOL=false` with the api object stubbed. The owner's DELETE answers 200 and releases the transport, owner, registration, pool entry and budget selection (logged `closed`); a session whose pool entry was dropped is still torn down; negatives: missing id 400, unknown id 404 -32001 with a non-owner getting the same bytes, an unsupported protocol version 400, no bearer 401, each leaving the session alive; another session's call holding the api lock finishes before the pool shutdown, and the 200 arrives only once the slot is free; PUT and PATCH answer 405 with `Allow`; pool off releases the transport and selection; a queued write whose session ended before the drain, or while the drain awaited its preconditions, is refused and never runs, while a live session's queued write runs | 15 |
| `session_admission_race.test.js` | #581: `MAX_CONCURRENT_SESSIONS` is a hard bound at the HTTP route. Child-process runs of the real HTTP server with a delayed login: 6 parallel initializes at a cap of 2 admit exactly 2; a failed login, a throwing `server.connect`, a malformed initialize answered 400 by the SDK, a 401 and refused initializes all release their slot; sequential open, refuse, DELETE, reopen; a 503 while 2 logins are pending reports `pendingReservations` 2 and `availableSlots` 0, and `/health` carries the count with no session id; every row ends with `pendingReservations` 0 | 11 |
| `pool_admission_reservation.test.js` | #581: the pool reservation. Real `ActualConnectionPool.getConnection` with the login and `api` stubbed: 4 parallel `getConnection` at a cap of 2 admit 2; a slow-path budget switch keeps its slot while new sessions race into its shutdown window; reserve and release idempotence; a failed login releases its slot; refused, stdio and skip-init switches leave no reservation; pooling off always admits and records no admission. #577: `admitSession` checks the global cap before the principal cap, a refusal of either scope records nothing, a re-admit does not count itself, `forgetSession` and `releaseAdmission` drop the admission | 21 |
| `config_max_sessions_per_principal.test.js` | #577: `MAX_SESSIONS_PER_PRINCIPAL` parsing. Unset, empty and whitespace mean no cap; a positive integer is parsed; zero, negative, decimal and non-numeric values fail startup with a message naming the variable | 8 |
| `session_principal_cap.test.js` | #577: the per-principal cap at the HTTP route. Child-process runs of the real HTTP server: a named token at its cap gets a 503 with its own count while another principal still connects; parallel initializes cannot exceed the cap; a failed login, a DELETE and an idle eviction free the principal slot, while a pool drop without evict keeps the live session counted; the legacy token and no-auth requests are exempt; the global cap refuses first; unset keeps the old 503 body; OIDC subjects are capped by `sub` | 22 |
| `adapter_write_pool_cooperation.test.js` | Write path uses the pool branch when a pooled session is in context: `writeConnectionReuses` increments; legacy branch otherwise; `api.sync()` runs in both branches (#158) | 7 |
| `budget_acl_parse.test.js` | #551: an invalid `AUTH_BUDGET_ACL` refuses startup instead of silently opening every budget. Parser rows by value (invalid JSON, whitespace, array, scalar, null, non-array entry, non-string or empty element; `{}`, email, `sub`, `group:` and `["*"]` accepted; null-prototype map keeps `__proto__` as a key); error-text contract leak rows (no key, value, `cause` or JSON.parse echo in the thrown message, the safeParse issue, the child's stderr or the runtime log); layer 1 `configSchema.safeParse` refusal on path `AUTH_BUDGET_ACL` under OIDC, `AUTH_PROVIDER=none` and `AUTH_BUDGET_ACL_SOURCE=actual`, with unset, `''`, `{}`, `{"a":[]}` and a valid map as witnesses; layer 2 child process importing `dist/src/config.js` with an explicit env exits non-zero naming the variable on stderr with empty stdout; runtime deny state via `_setRawAclForTests` (matching, non-matching and unauthenticated principals all `[]`, `access denied` logged once, `_resetAclForTests` restores `['*']`); `constructor` and `toString` principals get `[]` without throwing | 58 |
| `budget_acl_enforcement.test.js` | Per-session active budget + ACL: stdio short-circuit; OIDC defence-in-depth refusal on missing allowedBudgets; allow on ACL match; warn-level structured denial log; `switchBudget` requires session, exact match only, releases pool entry before mutating session map (#156) | 15 |
| `workflow_release_guards.test.js` | Structural invariants of `dependency-update.yml` (#261): App-token-authenticated checkouts with credential persistence explicitly pinned on (#262: any `persist-credentials: false` spelling, or reliance on the upstream default, fails), no token-in-URL auth, lockfile resync inside the bump step, explicit sync control flow, Release gated behind the ci-cd watch guard, computed tool count; the behavioral lock-agreement check (package-lock.json version fields match package.json) that catches a stale-lock bump from any lane; and the #266 absence guard keeping the retired second auto-release lane retired (file gone, no tracked reference to its identifier under .claude/ or .github/, and no workflow_run trigger in any workflow) | 19 + 13 negative |
| `report_train_failure.test.js` | #325: the release-train failure notifier. Exercises the four pure decision functions of `scripts/report-train-failure.mjs` without network: outcome classification (the `TRAIN_OUTCOME` enum corroborated against the jobs API, unset and unrecognised failing toward notifying, an unattributed job cancel treated as a failure), full-semver validation gating the issue body sink rather than the notification, body construction from named fields only, and the total tracker state machine (open / update counter / converge duplicates / close / never reopen). Plus source-level invariants for the I/O layer: on-demand label creation, label-scoped close, no log endpoint is ever fetched, and the asymmetric error policy. Includes regression cases for four defects found in code review: a cancelled sibling job being attributed to the train, the reporter corroborating against its own job, a human triage note in the issue body being parsed as machine state, and `$` expansion corrupting the counter block. A second review pass added regressions for a sibling job with a failed step inverting a green train, a stale train-job name yielding no corroboration rather than wrong corroboration, and an unreadable version erasing a known-good one | 46 |
| `bot_target_branch.test.js` | #265: every dependabot update block carries target-branch develop and the inert renovate config's baseBranches includes develop with the activation warning; a bot PR against fast-forward-only main is structurally unmergeable | 2 + 2 negative |

**Coverage:**
- ✅ All 85 tools: stub invocation + response-shape assertion
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
| List Tools | ✅ Returns 85 tools | ❌ Timeout |
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
- ✅ **ALL 85 tools execution (100% coverage)**
- ✅ Session management (including `actual_session_close`)
- ✅ Error handling (15+ error scenarios)
- ✅ Regression tests (strict validation, large batches, edge cases)

**Quick Smoke Tests (docker.e2e.spec.ts - 11 tests, ~20s):**

| # | Test Name | Success Scenario | Error Scenarios |
|---|-----------|-----------------|-----------------|
| 1 | Initialize MCP session | ✅ Session created | ❌ Auth failure, timeout |
| 2 | Verify services healthy | ✅ Status: ok | ❌ Not initialized, Actual unreachable |
| 3 | List all tools | ✅ 85 tools returned | ❌ Timeout, server error |
| 4 | Execute actual_server_info | ✅ Server version returned | ❌ Connection refused |
| 5 | List accounts | ✅ Account array returned | ❌ Database error |
| 6 | Create test account | ✅ Account ID returned | ❌ Duplicate name, validation error |
| 7 | Verify session persistence | ✅ 3 consecutive calls work | ❌ Session timeout |
| 8 | *(removed: SSE transport removed)* | N/A | N/A |
| 9 | Docker build verification | ✅ All files present | ❌ Missing dependencies |
| 10 | Handle invalid tool name | ✅ Error: Tool not found | ❌ Unexpected behavior |
| 11 | Handle invalid arguments | ✅ Validation error returned | ❌ Server crash |

**Comprehensive All-Tools Tests (docker-all-tools.e2e.spec.ts - 80+ tests, ~120s):**

The authoritative per-domain breakdown lives in `tests/e2e/docker-all-tools.e2e.spec.ts` (describe block `Docker E2E - ALL 85 TOOLS`): it exercises all 85 tools plus error scenarios. The per-category counts are not duplicated here, because a hand-maintained copy drifts.

**Success Criteria:**
- All 85 tools execute successfully
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

**Purpose:** Test all 85 tools with real Actual Budget data  
**Location:** `tests/manual/index.js` (entry point), `tests/manual/tests/` (16 domain modules)  
**Command:** `npm run test:integration:full`

> **`tags.js` is self-contained (#451).** The four tags tools touch no account, category or
> transaction, so the module creates and deletes its own fixture and leaves no residue. Its name
> is timestamped because `actual_tags_create` is an UPSERT on the tag WORD: a fixed name would
> silently reuse a previous run's row and the create assertion would pass having created nothing.
> The delete is verified by ABSENCE from `actual_tags_list`, since it is a soft delete.

> **`roundtrip.js` runs LAST and only at the `full` level (#332/#334).** `actual_budgets_import` creates a budget on the Actual server AND loads it, so anything scheduled after it would silently target the imported copy. The module switches back to the original configured budget before returning, but running it last is the primary defence. Its destructive half additionally requires `MCP_TEST_BUDGET_SYNC_ID` to be set, because the budget it creates is residue this suite has no tool to delete. Without that marker only the read-only export half runs.

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

#### FULL Level (85 tools, 100% coverage)

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
- All 85 tools execute successfully
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
# Full manual integration test with all 85 tools
npm run test:integration:full

# Cleanup only (remove leftover MCP-* test data)
npm run test:integration:cleanup
```

---

### Test Coverage Goals

| Test Level | Current Coverage | Target Coverage | Priority |
|------------|-----------------|-----------------|----------|
| **Level 1:** Adapter Smoke | 100% (adapter infra) | 100% | ✅ Maintain |
| **Level 2:** Unit Tests | 85/85 tools (stub), 23 schema assertions | Maintain + grow | ✅ Good |
| **Level 3:** Live Integration | 85/85 tools called | 85/85 | ✅ Maintain |
| **Level 4:** Protocol E2E | 100% (MCP compliance) | 100% | ✅ Maintain |
| **Level 5:** Docker E2E | **68/70 tools** (100% named; 2 excluded for single-budget CI) | 100% | ✅ Maintain |
| **Level 6:** Manual Full | 100% (85/85 tools) | 100% | ✅ Maintain |
| **Error Scenarios** | ~70% | 90% | 🟡 Medium |

---

### Next Testing Improvements

**High Priority:**
1. ✅ **Completed:** Docker E2E tests with 68/70 tools named (2 excluded: `budgets_list_available`, `budgets_switch` due to single-budget CI constraint)
2. ✅ **Completed:** Unit test suite (~52 files), 85-tool smoke, 23 negative-path assertions
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

- [Architecture](../explanation/architecture.md) - System design and components
- [Security & Privacy](../explanation/security-and-privacy.md) - Security testing policies
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
