---
name: owasp-api-security
description: OWASP API Security Top 10 testing patterns, injection payloads, auth bypass vectors, and security test generation for the actual-mcp-server MCP API. Use when writing security tests, reviewing tools or HTTP endpoints for vulnerabilities, or auditing input validation and authorization.
---

<!-- owasp-api-security-version: 1 -->

# OWASP API Security Testing (actual-mcp-server)

Security testing knowledge base for this MCP server, aligned with OWASP API Security Top 10:2023 and OWASP ASVS 5.0, mapped onto the project's concrete surface.

## Project surface (what is actually exposed)

- **Transports:** Express 5 HTTP transport (`StreamableHTTP`) mounted at `/http` (entry `src/server/httpServer.ts`), plus a stdio transport (`src/server/stdioServer.ts`, local single-user). The two are mutually exclusive, selected by CLI flag.
- **The API is the tool surface:** there are no REST resource routes with `:id` params. The attack surface is the set of MCP tools (`actual_{domain}_{action}`, currently around 70+ tools registered in `IMPLEMENTED_TOOLS` in `src/actualToolsManager.ts`), dispatched through Zod validation, plus the HTTP plumbing routes.
- **HTTP routes:** `/http` (authenticated MCP), `/.well-known/oauth-protected-resource/http` (OIDC discovery), `/health` and `/metrics` (intentionally unauthenticated, must never leak budget data or secrets).
- **Auth (two modes):**
  - **OIDC** (`AUTH_PROVIDER=oidc`): JWT Bearer verified via `mcp-auth` (jose JWKS/JWT) with JWKS discovery and an audience allowlist (#160/#163/#244/#245). Empty/whitespace-only allowlist fails closed (#245). Configured in `src/auth/setup.ts`.
  - **Static bearer** (`MCP_SSE_AUTHORIZATION`): the raw token only (no `Bearer ` prefix). Compared directly in `src/server/httpServer.ts`. When unset, requests are allowed (the unauthenticated-by-default footgun, see API8 / #242).
- **Authorization:** per-user budget ACL in `src/auth/budget-acl.ts`. Principals are token `sub`, `email`, and `group:<role>`; `getAllowedBudgets()` / `canAccessBudget()` / `budgetAclMiddleware()` gate which budget sync IDs a caller may touch. This is the project's BOLA boundary.
- **Data:** financial data (Actual Budget). Amounts are always integer cents. Inputs validated by Zod v4 via `CommonSchemas` (`src/lib/schemas/common.ts`). Raw SQL only via the validated ActualQL path (`src/lib/query-validator.ts`, schema source of truth `src/lib/actual-schema.ts`).

## When to Use This Skill

- Writing security tests for tools or HTTP endpoints
- Reviewing a new tool or endpoint for OWASP API risks
- Generating injection/fuzzing payloads for test suites
- Auditing OIDC / static-bearer auth and the budget ACL
- Validating Zod input schemas and SQL query validation
- Assessing resource-exhaustion and inventory-drift protections

## Phase order (run in this sequence)

1. **Inventory** the surface: list HTTP routes and the tools in `IMPLEMENTED_TOOLS`. Note which routes are intentionally unauthenticated (`/health`, `/metrics`).
2. **Authentication** (API2): unauthenticated, malformed, expired, wrong-audience, wrong-issuer.
3. **Authorization** (API1 BOLA, API5): budget ACL bypass across principals.
4. **Input validation** (API3, injection): Zod gaps, mass assignment, SQL/ActualQL bypass.
5. **Resource consumption** (API4, API6): oversized payloads, batch abuse, sensitive flows.
6. **Misconfiguration** (API8): the unauthenticated-by-default footgun, error/stack leakage, secret redaction.
7. **Inventory drift** (API9): tool-count drift, shadow tools, advertised-but-unregistered tools.
8. **Upstream** (API7, API10): SSRF via bank-sync/server URLs, trusting `@actual-app/api` responses.
9. **Score** with the checklist at the end. A risk whose surface the change does not touch scores N/A (full marks).

## OWASP API Security Top 10:2023 (mapped)

### API1 - Broken Object Level Authorization (BOLA)

**Here:** a caller reaching another user's budget by passing a budget sync ID they are not granted. The boundary is `canAccessBudget(req, budgetSyncId)` / `budgetAclMiddleware` in `src/auth/budget-acl.ts`.

**Test patterns:**
```typescript
// Principal alice@example.com is granted only budget "sync-A".
// A request carrying alice's identity must be denied budget "sync-B".
_setAclForTests({ 'alice@example.com': ['sync-A'] });
const reqAsAlice = makeReqWithClaims({ email: 'alice@example.com' });
expect(canAccessBudget(reqAsAlice, 'sync-B')).toBe(false);
expect(canAccessBudget(reqAsAlice, 'sync-A')).toBe(true);

// Wildcard principal sees everything; a non-wildcard one never does.
_setAclForTests({ 'group:admin': ['*'] });
const reqAdmin = makeReqWithClaims({ groups: ['admin'] });
expect(getAllowedBudgets(reqAdmin)).toEqual(['*']);
```

**Checklist:**
- [ ] Every budget-scoped tool path resolves the budget through the ACL, not from raw caller input
- [ ] `sub`, `email`, and `group:<role>` principals all enforced, not just one
- [ ] No principal silently inherits `['*']`; wildcard must be explicit in the ACL map
- [ ] Multi-budget selection (`BUDGET_N_*`) cannot be redirected to an unauthorized sync ID

### API2 - Broken Authentication

**Here:** OIDC JWT verification (JWKS, audience allowlist, issuer, expiry) and the static-bearer comparison.

**Test patterns:**
```typescript
// No auth header on the authenticated MCP route.
const res = await request(app).post('/http').send(initBody);
expect(res.status).toBe(401);

// Malformed Authorization header.
const res2 = await request(app)
  .post('/http')
  .set('Authorization', 'Bearer <script>alert(1)</script>')
  .send(initBody);
expect(res2.status).toBe(401);

// Static-bearer: wrong token rejected, correct token accepted.
// (MCP_SSE_AUTHORIZATION is the RAW token, no "Bearer " prefix.)
```

**OIDC-specific checks (#160/#163/#244/#245):**
- [ ] Token with an audience not in the allowlist is rejected
- [ ] Token from an issuer other than `OIDC_ISSUER` is rejected
- [ ] Expired token rejected (expiry honored by jose)
- [ ] Empty or whitespace-only audience allowlist fails closed, not open (#245)
- [ ] JWKS fetch failure does not fall through to allow

### API3 - Broken Object Property Level Authorization

**Here:** Zod schema gaps let extra fields through, or sensitive fields leak in responses.

**Test patterns:**
- Mass assignment: send fields not declared in the tool's Zod schema. Zod v4 with the project's schemas should strip or reject them; assert the persisted record is unchanged.
- Response filtering: tool output must never include server secrets or another budget's data.
```typescript
// Extra/unknown fields must not be honored.
const res = await callTool('actual_transactions_update', {
  id: 'uuid', amount: -5000, internal_admin_flag: true,
});
// Assert internal_admin_flag had no effect on the stored row.
```

**Checklist:**
- [ ] Tool schemas use `CommonSchemas` and reject unexpected properties
- [ ] Amounts validated as integer cents (no float-dollar coercion)
- [ ] No tool echoes back `MCP_SSE_AUTHORIZATION`, passwords, or encryption keys

### API4 - Unrestricted Resource Consumption

**Test patterns:**
- Oversized payloads (very long strings, deeply nested objects)
- Batch-tool abuse (huge arrays in batch upsert tools)
- SQL/ActualQL that forces full-table scans
```typescript
const res = await callTool('actual_transactions_create', {
  account: 'uuid', amount: 100, date: '2024-01-15',
  notes: 'x'.repeat(2_000_000),
});
// Expect a validation failure, not a 500 or an OOM.
```

**Checklist:**
- [ ] Long-string and large-array inputs fail validation cleanly
- [ ] The adapter concurrency limit (5) and pool cap (15 sessions) hold under burst
- [ ] No single tool call can exhaust memory or wedge the connection pool

### API5 - Broken Function Level Authorization

**Here:** session-management tools (`actual_session_list`, `actual_session_close`) bypass `withActualApi` by design because they manage the pool, not budget data. Confirm they cannot be used to enumerate or close another caller's session.

**Checklist:**
- [ ] Session tools cannot list/close sessions belonging to other principals
- [ ] No tool offers an admin capability without an authorization check

### API6 - Unrestricted Access to Sensitive Business Flows

**Here:** financial mutations and bank sync.

**Checklist:**
- [ ] Bulk create/update/delete and batch upsert tools cannot be looped to mass-mutate without back-pressure
- [ ] Bank-sync triggering cannot be abused to hammer the upstream Actual server

### API7 - Server-Side Request Forgery (SSRF)

**Here:** server URLs are operator-configured (`ACTUAL_SERVER_URL`, `BUDGET_N_SERVER_URL`), not caller-supplied per request. Risk appears if any tool input is ever used to build an outbound URL.

**Checklist:**
- [ ] No tool accepts a URL/host parameter that the server then fetches
- [ ] Server/sync URLs come only from validated config, never from tool input

### API8 - Security Misconfiguration

**Here:** the unauthenticated-by-default footgun (#242). When neither OIDC nor `MCP_SSE_AUTHORIZATION` is set, the static-bearer path allows all requests. The HTTP server can fail closed when unauthenticated on a non-loopback bind (#242). Also covers error/stack leakage and secret redaction.

**Test patterns:**
```typescript
// Binding to a non-loopback host with no auth configured must fail closed (#242).

// Error responses must not leak stack traces or internal paths.
const res = await request(app).post('/http').send(malformedBody);
const body = res.body;
expect(body).not.toHaveProperty('stack');
expect(body).toHaveProperty('error');
```

**Checklist:**
- [ ] No auth configured on a non-loopback bind triggers fail-closed (#242)
- [ ] Secrets redacted in logs (the `redactSecrets` winston format, `src/logger.ts`)
- [ ] `/health` and `/metrics` stay unauthenticated AND leak no budget data or secrets
- [ ] Error bodies carry no stack traces, file paths, or upstream details

### API9 - Improper Inventory Management

**Here:** tool-inventory drift. `npm run tool-count` (#193) and `npm run verify-tools` keep the registered count consistent across docs/tests; `tests/unit/advertised_tools_sync.test.js` enforces that any README-advertised tool exists in `IMPLEMENTED_TOOLS`.

**Checklist:**
- [ ] Every tool in `IMPLEMENTED_TOOLS` is documented and has unit + E2E coverage
- [ ] No shadow/debug tool ships in production
- [ ] No tool advertised in docs is missing from `IMPLEMENTED_TOOLS` (or vice versa)
- [ ] `verify-tools` and `tool-count` are green

### API10 - Unsafe Consumption of APIs

**Here:** trusting `@actual-app/api` and the upstream Actual server. Responses flow back to the caller through tools.

**Checklist:**
- [ ] Upstream responses are not echoed raw if they could contain another budget's data
- [ ] Infrastructure errors from upstream drop the pool session (`_shouldDropPoolOnError`) rather than reusing a broken connection

## Injection Payload Library

### SQL / ActualQL bypass attempts
The validated path is `src/lib/query-validator.ts` (`validateQuery`, `validateQueryShape`) checked against `src/lib/actual-schema.ts`. Feed these to any raw-SQL tool and assert validation rejects them (never a 500):
```typescript
const sqlPayloads = [
  "' OR '1'='1",
  "'; DROP TABLE transactions; --",
  "1; SELECT * FROM accounts --",
  "' UNION SELECT null,null,null --",
  "admin'--",
  "1' AND 1=1 --",
  "' OR 1=1 LIMIT 1 --",
];
```

### XSS payloads (stored, via note/name fields)
Financial notes/names can be rendered by downstream AI clients, so stored XSS still matters:
```typescript
const xssPayloads = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  'javascript:alert(1)',
  '<svg onload=alert(1)>',
  '"><script>alert(document.cookie)</script>',
  "'-alert(1)-'",
  '<iframe src="javascript:alert(1)">',
];
```

### Command injection
```typescript
const cmdPayloads = [
  '; ls -la',
  '| cat /etc/passwd',
  '$(whoami)',
  '`id`',
  '& ping -c 1 attacker.com',
  '\n/bin/sh',
];
```

### Path traversal (config/file fields)
```typescript
const pathPayloads = [
  '../../../etc/passwd',
  '..\\..\\..\\windows\\system32',
  '%2e%2e%2f%2e%2e%2f',
  '....//....//....//etc/passwd',
];
```

## Security Test Template

Project tests are plain Node test files run via `npm run test:unit-js` (unit) and Playwright for E2E (`tests/e2e/`). HTTP-level checks use `supertest` against the Express app; tool-level checks call through the dispatcher. Adapt the shape below.

```typescript
// tests/unit/<tool>_security.test.js style (Node test runner)
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('rejects unauthenticated MCP requests', async () => {
  // build app with MCP_SSE_AUTHORIZATION set, send no Authorization header
  // assert HTTP 401
});

test('BOLA: caller cannot reach an unauthorized budget', async () => {
  // _setAclForTests({ 'alice@example.com': ['sync-A'] })
  // assert canAccessBudget(reqAsAlice, 'sync-B') === false
});

test('input validation: injection payloads never 500', async () => {
  for (const payload of sqlPayloads) {
    // call the raw-SQL tool with payload
    // assert validation error (not a thrown 500 / crash)
  }
});

test('error responses carry no stack traces', async () => {
  // send a malformed body, assert body has `error`, lacks `stack`/`stackTrace`
});
```

## Scoring checklist (per change)

Score each risk 1 to 10 (10 = covered or genuinely N/A for this change). A change is ready when no risk it touches scores below 10.

- [ ] API1 BOLA: budget ACL enforced across `sub`/`email`/`group` principals
- [ ] API2 Auth: OIDC audience/issuer/expiry + static-bearer comparison sound; fail-closed on empty allowlist
- [ ] API3 Properties: Zod schemas reject unknown fields; no sensitive output leakage
- [ ] API4 Consumption: oversized/batch inputs rejected; concurrency and pool caps hold
- [ ] API5 Function-level: session/admin tools authorized; no privilege gap
- [ ] API6 Business flows: bulk mutations and bank sync back-pressured
- [ ] API7 SSRF: no caller-supplied outbound URLs
- [ ] API8 Misconfig: no unauthenticated non-loopback bind (#242); secrets redacted; clean errors; `/health` and `/metrics` safe
- [ ] API9 Inventory: `verify-tools` and `tool-count` green; no shadow or undocumented tools
- [ ] API10 Upstream: upstream responses validated; broken pool sessions dropped

Repository: agigante80/actual-mcp-server
