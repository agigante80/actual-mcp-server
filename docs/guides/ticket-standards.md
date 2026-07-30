<!-- template-version: 4 -->

# Ticket standards (canonical)

This is the **single source of truth** for what a *ready* work ticket must contain for
actual-mcp-server. The four work issue-templates (`bug`, `feature_request`, `infrastructure`,
`security`) carry the form fields that collect this content; this document holds the **rules and
the rationale**. The `ticket-gate` agent enforces the rules, and
`scripts/check-template-lockstep.sh` keeps the templates and this doc on one shared
`template-version`, so the standard cannot silently drift apart from the forms that implement it.

## Why single-source

The requirement text used to be restated in each template, in `CLAUDE.md`, and in the gate.
Multiple copies drift: prose says one thing while a template says another, and nobody notices
until a ticket is gated against a stale rule. Keeping the rules here, referenced (not restated)
elsewhere, plus the lockstep guard, makes "the standard is the same everywhere" mechanically
true rather than a matter of discipline.

## The gate that enforces this

`/gate-ticket <N>` runs 6 core specialist agents (tool-author, qa, release-manager, actual-api,
security-auditor, architect-review); every agent must score 10/10. An agent whose domain the
ticket does not touch auto-scores 10 (N/A). Reporters are NOT expected to fill the
maintainer-rigor sections (acceptance, scenarios, unit_tests, e2e_tests): the gate synthesises
them from the report, and the fix is proved by reproducing the bug first (red), then re-running
after the fix (green). See the `implement-ticket` skill.

## Required sections

A ready work ticket must satisfy every rule below whose scope the ticket actually touches.
Applicability is decided by the gate from the ticket type and the areas it affects; a rule a
ticket does not touch is marked N/A with a one-line justification, never failed. A rule that
*does* apply and is absent fails the gate.

### 1. GWT scenarios (Given / When / Then)

At least one positive and one negative scenario per independent condition, written against
specific tool names (`actual_{domain}_{action}`), adapter methods, and file paths where the
ticket makes them evident. Vague restatements of the description do not count.

### 2. Unit test specs

Concrete cases: a specific test file path under `tests/unit/`, a concrete input value, and the
expected output or error (a ZodError or an error message substring). "Add unit tests" is not a
spec. **When a ticket creates or modifies an MCP tool** (the project's API surface), the tool
must be covered: a happy-path call, negative input rejected by the Zod schema, the smoke entry
in `tests/unit/generated_tools.smoke.test.js`, and, for any published-schema change, the
OpenAI/ECMA-262 compatibility guard (`tests/unit/schema_json_openai_compat.test.js`).
`npm run build && npm run test:unit-js` must be in the acceptance criteria.

### 3. E2E test specs

For any behaviour visible over the transports: a specific suite file under `tests/e2e/suites/`,
setup steps, the action, and the assertion, for both the happy and unhappy paths. A change to a
tool's write path must be exercised over BOTH transports via the dual-transport gate
(`MCP_TEST_TRANSPORT=http` and `stdio`). Pure-internal changes with no transport-visible surface
mark this N/A with justification rather than inventing a flow.

### 4. Financial-data / PII handling

This server manages personal financial data (accounts, transactions, payees, balances). Identify
every field the ticket exposes or stores, state where it is stored and how it is scoped, and
confirm the change preserves per-user budget isolation (`src/auth/budget-acl.ts`) so one user
can never read another's budget. There is no separate GDPR agent in this project's roster: the
`security-auditor` core agent owns data-exposure review. A ticket that touches no financial data
marks this N/A with that reason.

### 5. Security checklist

Authentication and authorization requirements (OIDC / bearer / budget ACL), input validation
schemas (Zod, via `CommonSchemas` where applicable), data-exposure review, SQL-injection review
when `actual_query_run` is touched (`src/lib/query-validator.ts`), and the relevant OWASP items
for the change. Secrets are never logged (the central `redactSecrets` format is the backstop, not
a licence).

### 6. Required reviews

The reviews the ticket must pass before it is considered done, checked off explicitly. This is
the ticket author's acknowledgement of the gate, not a substitute for it. A promotion to `main`
additionally requires a green full dual-transport integration run (`bash scripts/deploy-and-test.sh full`).

## Project hard rules every ticket inherits

- Amounts are always integer cents (`5000` = $50.00), never decimal dollars.
- Dates are `YYYY-MM-DD` strings, never `Date.now()`.
- Every Actual API operation is wrapped in `withActualApi()`; new tools use `createTool()`.
- No em dash or en dash anywhere (chat, commits, comments, code, docs). Restructure instead.
- Work lands on `develop`; `main` is release-only.

## The N/A rule (load-bearing)

A coverage or E2E requirement that a docs-only, research, infra-only, or internal-only ticket
cannot satisfy makes that ticket **un-passable**, which trains people to box-tick and rots the
whole gate. Every rule here is scoped: it applies only to tickets whose type and affected areas
bring it into play, and the gate derives that scope rather than asking the author to self-declare
it. When you add a new rule with a coverage-style requirement, give it an explicit
type-and-area scope here, or it will backfire.
