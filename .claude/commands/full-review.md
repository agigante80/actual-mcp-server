---
description: "Orchestrate comprehensive multi-dimensional code review using specialized review agents across architecture, security, performance, testing, and best practices"
argument-hint: "<target path or description> [--security-focus] [--performance-critical] [--strict-mode]"
---

# Comprehensive Code Review Orchestrator

## CRITICAL BEHAVIORAL RULES

You MUST follow these rules exactly. Violating any of them is a failure.

1. **Execute phases in order.** Do NOT skip ahead, reorder, or merge phases.
2. **Write output files.** Each phase MUST produce its output file in `.full-review/` before the next phase begins. Read from prior phase files -- do NOT rely on context window memory.
3. **Stop at checkpoints.** When you reach a `PHASE CHECKPOINT`, you MUST stop and wait for explicit user approval before continuing. Use the AskUserQuestion tool with clear options.
4. **Halt on failure.** If any step fails (agent error, missing files, access issues), STOP immediately. Present the error and ask the user how to proceed. Do NOT silently continue.
5. **Use only local agents.** All `subagent_type` references use agents bundled in `.claude/agents/`. No cross-plugin dependencies.
6. **Never enter plan mode autonomously.** Do NOT use EnterPlanMode. This command IS the plan -- execute it.

## Pre-flight Checks

### 1. Check for existing session

Check if `.full-review/state.json` exists:

- If it exists and `status` is `"in_progress"`: Read it, display the current phase, and ask the user:

  ```
  Found an in-progress review session:
  Target: [target from state]
  Current phase: [phase from state]

  1. Resume from where we left off
  2. Start fresh (archives existing session)
  ```

- If it exists and `status` is `"complete"`: Ask whether to archive and start fresh.

### 2. Initialize state

Create `.full-review/` directory and `state.json`:

```json
{
  "target": "$ARGUMENTS",
  "status": "in_progress",
  "flags": {
    "security_focus": false,
    "performance_critical": false,
    "strict_mode": false
  },
  "current_step": 1,
  "current_phase": 1,
  "completed_steps": [],
  "files_created": [],
  "started_at": "ISO_TIMESTAMP",
  "last_updated": "ISO_TIMESTAMP"
}
```

Parse `$ARGUMENTS` for `--security-focus`, `--performance-critical`, `--strict-mode` flags.

### 3. Identify review target

Determine what code to review from `$ARGUMENTS`. List the files that will be reviewed and confirm with the user.

Also read `CLAUDE.md` to understand the file safety tier of the target — files in "Modify with caution" or "Do not modify without explicit permission" tiers warrant stricter review standards.

**Output file:** `.full-review/00-scope.md`

```markdown
# Review Scope

## Target
[Description of what is being reviewed]

## Files
[List of files/directories included in the review]

## File safety tier
[Safe / Modify with caution / Explicit permission required — from CLAUDE.md]

## Flags
- Security Focus: [yes/no]
- Performance Critical: [yes/no]
- Strict Mode: [yes/no]

## Review Phases
1. Code Quality & Architecture
2. Security & Performance
3. Testing & Documentation
4. Best Practices & Standards
5. Consolidated Report
```

---

## Phase 1: Code Quality & Architecture Review (Steps 1A-1B)

Run both agents in parallel using multiple Task tool calls in a single response.

### Step 1A: Code Quality Analysis

```
Task:
  subagent_type: "code-reviewer"
  description: "Code quality analysis for $ARGUMENTS"
  prompt: |
    Perform a comprehensive code quality review for actual-mcp-server.

    ## Review Scope
    [Insert contents of .full-review/00-scope.md]

    ## Project-specific invariants to check
    - Every Actual API operation wrapped in withActualApi() — calls outside it silently fail (tombstone issue)
    - New tools use createTool() from src/lib/toolFactory.ts (not the legacy ToolDefinition pattern)
    - Amounts are integer cents — no float math, no decimal dollars
    - Dates are YYYY-MM-DD strings — never Date.now() (produces a number)
    - Pre-commit sequence must pass: npm run build && npm run verify-tools && npm run test:unit-js && npm audit --audit-level=moderate

    ## Instructions
    Analyze for:
    1. **Code complexity**: Cyclomatic complexity, deeply nested logic
    2. **Maintainability**: Naming conventions, function length, cohesion
    3. **Code duplication**: Missed abstraction opportunities
    4. **Error handling**: Missing error handling, unclear error messages
    5. **MCP protocol correctness**: Tool return format, Zod schema coverage
    6. **Technical debt**: Areas that will become costly to change

    For each finding: Severity (Critical/High/Medium/Low), file and line, description, fix recommendation.
```

### Step 1B: Architecture & Design Review

```
Task:
  subagent_type: "architect-review"
  description: "Architecture review for $ARGUMENTS"
  prompt: |
    Review the architectural design of the target code for actual-mcp-server.

    ## Review Scope
    [Insert contents of .full-review/00-scope.md]

    ## Instructions
    Evaluate for:
    1. **withActualApi lifecycle**: Is every Actual API call properly wrapped?
    2. **Concurrency gate**: Does the change respect the 5-concurrent-op limit?
    3. **Transport separation**: Are HTTP and stdio concerns properly isolated?
    4. **Multi-budget ACL**: Does the change prevent cross-budget access?
    5. **Component boundaries**: Proper separation of concerns, module cohesion
    6. **Architectural consistency**: Does it follow patterns in CLAUDE.md?

    For each finding: Severity, architectural impact, improvement recommendation.
```

After both complete, consolidate into `.full-review/01-quality-architecture.md`.

---

## Phase 2: Security & Performance Review (Steps 2A-2B)

Read `.full-review/01-quality-architecture.md` for context from Phase 1.

Run both agents in parallel.

### Step 2A: Security Vulnerability Assessment

```
Task:
  subagent_type: "security-auditor"
  description: "Security audit for $ARGUMENTS"
  prompt: |
    Execute a comprehensive security audit for actual-mcp-server.

    ## Review Scope
    [Insert contents of .full-review/00-scope.md]

    ## Phase 1 Context
    [Insert "Critical Issues for Phase 2 Context" from .full-review/01-quality-architecture.md]

    ## Project security surface
    - Bearer token (MCP_SSE_AUTHORIZATION) and OIDC/JWKS (AUTH_PROVIDER=oidc) auth
    - Per-user budget ACL in src/auth/budget-acl.ts
    - Raw SQL via actual_query_run — injection boundary at src/lib/query-validator.ts
    - Financial PII in all 63 tools (transactions, budgets, accounts)
    - Multi-tenant isolation via BUDGET_N_* env vars

    ## Instructions
    Analyze for:
    1. **Auth bypass**: Can the change be reached without valid Bearer/OIDC token?
    2. **ACL bypass**: Can a user access another user's budget data?
    3. **Injection**: Any new SQL or command injection surfaces?
    4. **Input validation**: Zod schemas cover all inputs? Max lengths? Format checks?
    5. **Data exposure**: Does the response leak sensitive financial fields?
    6. **Dependency vulnerabilities**: npm audit --audit-level=moderate clean?

    For each finding: Severity with CVSS score, CWE reference, location, attack scenario, remediation.
```

### Step 2B: Performance & Scalability Analysis

```
Task:
  subagent_type: "performance-engineer"
  description: "Performance analysis for $ARGUMENTS"
  prompt: |
    Conduct a performance and scalability analysis for actual-mcp-server.

    ## Review Scope
    [Insert contents of .full-review/00-scope.md]

    ## Phase 1 Context
    [Insert "Critical Issues for Phase 2 Context" from .full-review/01-quality-architecture.md]

    ## Key performance constraints
    - withActualApi concurrency gate: max 5 concurrent Actual API ops
    - Connection pool: max 15 sessions with idle timeouts
    - Retry logic: 3 attempts, 200ms base — non-retriable errors should fail fast
    - actual_query_run: unbounded result sets load fully into memory, no timeout
    - MCP JSON-RPC response payload serialised to JSON over HTTP or stdout

    ## Instructions
    Analyze for:
    1. **Concurrency gate saturation**: Does the change queue multiple withActualApi calls?
    2. **Memory**: Unbounded result sets, large payloads, missing pagination
    3. **Retry efficiency**: Are non-retriable errors wrapped in retry logic?
    4. **Query performance**: Unoptimized ActualQL SQL, missing WHERE clauses
    5. **Payload size**: Tool responses too large for efficient transport

    For each finding: Severity, estimated latency/memory impact, fix with code example.
```

After both complete, consolidate into `.full-review/02-security-performance.md`.

---

## PHASE CHECKPOINT 1 -- User Approval Required

Display a summary of findings from Phase 1 and Phase 2 and ask:

```
Phases 1-2 complete: Code Quality, Architecture, Security, and Performance reviews done.

Summary:
- Code Quality: [X critical, Y high, Z medium findings]
- Architecture: [X critical, Y high, Z medium findings]
- Security: [X critical, Y high, Z medium findings]
- Performance: [X critical, Y high, Z medium findings]

Please review:
- .full-review/01-quality-architecture.md
- .full-review/02-security-performance.md

1. Continue -- proceed to Testing & Documentation review
2. Fix critical issues first -- I'll address findings before continuing
3. Pause -- save progress and stop here
```

If `--strict-mode` flag is set and there are Critical findings, recommend option 2.

Do NOT proceed to Phase 3 until the user approves.

---

## Phase 3: Testing & Documentation Review (Steps 3A-3B)

Read `.full-review/01-quality-architecture.md` and `.full-review/02-security-performance.md` for context.

Run both agents in parallel.

### Step 3A: Test Coverage & Quality Analysis

```
Task:
  subagent_type: "general-purpose"
  description: "Test coverage analysis for $ARGUMENTS"
  prompt: |
    You are a test automation engineer for actual-mcp-server. Evaluate testing strategy and coverage.

    ## Review Scope
    [Insert contents of .full-review/00-scope.md]

    ## Test stack
    - Unit: tests/unit/*.test.js (plain Node.js, run with node xxx.test.js)
    - Adapter: src/tests_adapter_runner.ts (withActualApi lifecycle tests)
    - E2E: tests/e2e/*.spec.ts (Playwright TypeScript, requires Docker)
    - Integration: tests/manual/ (requires live server, do not run in CI)

    ## Security/performance context
    [Insert relevant findings from .full-review/02-security-performance.md]

    ## Instructions
    Analyze:
    1. **Unit test coverage**: Zod schema rejection cases, valid input paths, edge amounts/dates
    2. **Adapter test coverage**: withActualApi retry and concurrency gate tests
    3. **E2E coverage**: happy-path and error-path MCP tool invocations
    4. **generated_tools.smoke.test.js**: new tool entries present?
    5. **Test data quality**: amounts in cents, dates YYYY-MM-DD, real UUIDs
    6. **Regression risk**: could this change break existing tool tests?

    For each finding: Severity, what is untested, specific test recommendation with example.
```

### Step 3B: Documentation & API Review

```
Task:
  subagent_type: "general-purpose"
  description: "Documentation review for $ARGUMENTS"
  prompt: |
    Review documentation completeness for actual-mcp-server changes.

    ## Review Scope
    [Insert contents of .full-review/00-scope.md]

    ## Instructions
    Evaluate:
    1. **CLAUDE.md sync**: Does any change require updating CLAUDE.md conventions?
    2. **Documentation sync table**: Which docs from CLAUDE.md "Documentation Sync" table need updating?
       (README.md tool count, docs/ARCHITECTURE.md, .env.example, docs/NEW_TOOL_CHECKLIST.md etc.)
    3. **Inline comments**: Are non-obvious invariants documented (withActualApi usage, amounts-in-cents)?
    4. **Changelog/PR**: Are breaking changes noted for release-manager?
    5. **NEW_TOOL_CHECKLIST.md**: Is the 9-step checklist complete for new tools?

    For each finding: Severity, what is missing or inaccurate, specific documentation recommendation.
```

After both complete, consolidate into `.full-review/03-testing-documentation.md`.

---

## Phase 4: Best Practices & Standards (Steps 4A-4B)

Read all previous `.full-review/*.md` files for full context. Run both agents in parallel.

### Step 4A: Framework & Language Best Practices

```
Task:
  subagent_type: "general-purpose"
  description: "Framework best practices review for $ARGUMENTS"
  prompt: |
    Verify adherence to TypeScript/Node.js/MCP best practices for actual-mcp-server.

    ## Review Scope
    [Insert contents of .full-review/00-scope.md]

    ## Stack: TypeScript 5, Node.js 20+ ESM (NodeNext), Express 5, Zod v4, @actual-app/api v26

    ## Instructions
    Check for:
    1. **ESM imports**: .js extensions on relative imports (NodeNext requires them)
    2. **Zod v4 idioms**: Use z.object(), CommonSchemas from src/lib/schemas/common.ts
    3. **createTool() vs legacy pattern**: New tools should use createTool()
    4. **TypeScript strictness**: No `any` types, proper type narrowing
    5. **Deprecated APIs**: Any deprecated @actual-app/api v26 methods used?
    6. **Build configuration**: tsconfig.json integrity, NodeNext module resolution

    For each finding: Severity, current pattern vs recommended, migration recommendation.
```

### Step 4B: CI/CD & DevOps Practices Review

```
Task:
  subagent_type: "general-purpose"
  description: "CI/CD and DevOps practices review for $ARGUMENTS"
  prompt: |
    Review CI/CD and operational practices for actual-mcp-server.

    ## Review Scope
    [Insert contents of .full-review/00-scope.md]

    ## Instructions
    Evaluate:
    1. **Pre-commit sequence**: npm run build && npm run verify-tools && npm run test:unit-js && npm audit --audit-level=moderate
    2. **Git workflow**: Changes target develop branch (never main directly)
    3. **Docker**: docker-compose.yaml changes backward-compatible with dev/production/fullstack profiles?
    4. **Environment variables**: New env vars added to .env.example with documentation?
    5. **Version bump**: Does the change warrant a version bump? (tool additions do)
    6. **Dependency safety**: No npm overrides except for CVE-level security fixes?

    For each finding: Severity, operational risk, specific improvement recommendation.
```

After both complete, consolidate into `.full-review/04-best-practices.md`.

---

## Phase 5: Consolidated Report (Step 5)

Read all `.full-review/*.md` files. Generate the final consolidated report.

**Output file:** `.full-review/05-final-report.md`

```markdown
# Comprehensive Code Review Report — actual-mcp-server

## Review Target
[From 00-scope.md — include file safety tier]

## Executive Summary
[2-3 sentence overview of overall code health and key concerns]

## Findings by Priority

### Critical Issues (P0 — Must Fix Immediately)
[All Critical findings from all phases]
- withActualApi lifecycle violations
- Auth/ACL bypass vulnerabilities
- Data loss or corruption risks

### High Priority (P1 — Fix Before Merging to develop)
[All High findings from all phases]

### Medium Priority (P2 — Plan for Next Sprint)
[All Medium findings from all phases]

### Low Priority (P3 — Track in Backlog)
[All Low findings from all phases]

## Findings by Category
- **Code Quality**: [count] findings ([breakdown by severity])
- **Architecture**: [count] findings ([breakdown by severity])
- **Security**: [count] findings ([breakdown by severity])
- **Performance**: [count] findings ([breakdown by severity])
- **Testing**: [count] findings ([breakdown by severity])
- **Documentation**: [count] findings ([breakdown by severity])
- **Best Practices**: [count] findings ([breakdown by severity])
- **CI/CD**: [count] findings ([breakdown by severity])

## Recommended Action Plan
1. [Ordered list of recommended actions, starting with critical/high items]
2. [Group related fixes where possible]
3. [Estimate relative effort: small/medium/large]

## Pre-merge checklist
- [ ] npm run build — TypeScript compiles cleanly
- [ ] npm run verify-tools — all tools registered (expected count)
- [ ] npm run test:unit-js — unit + schema tests pass
- [ ] npm audit --audit-level=moderate — no new vulnerabilities

## Review Metadata
- Review date: [timestamp]
- Phases completed: [list]
- Flags applied: [list active flags]
```

Update `state.json`: set `status` to `"complete"`.

---

## Completion

Present the final summary and remind the user to run the pre-merge checklist before pushing to `origin/develop`.
