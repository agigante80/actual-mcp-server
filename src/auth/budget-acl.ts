// src/auth/budget-acl.ts
//
// Per-user budget ACL enforcement (CF-5: OIDC multi-user auth).
//
// When AUTH_PROVIDER=oidc and AUTH_BUDGET_ACL is set, this module restricts
// which Actual Budget sync-IDs each authenticated user may access.
//
// ACL map format (AUTH_BUDGET_ACL env var, JSON):
//   { "<principal>": ["<syncId1>", "<syncId2>"] }
//
//   Principal keys:
//     "alice@example.com"  matched against the token email claim
//     "some-sub-uuid"      matched against the token sub claim
//     "group:admin"        matched against the token groups/roles array
//
//   Value ["*"] grants access to all budgets (admin shorthand).
//
// Three states, classified once from the raw value and cached (#551):
//   open  (AUTH_BUDGET_ACL unset, '' or '{}'): every authenticated user is
//         allowed ("*"), as documented.
//   map   (a valid non-empty object): the per-principal lookup below.
//   deny  (a value that does not parse): every principal gets [] and a 403.
//         config.ts refuses startup on such a value, so this state is a
//         defence in depth for any caller that reaches the parser another way.
//         Before #551 a parse failure degraded to an EMPTY map, which read as
//         "open": a typo in the ACL granted every budget to every user.
//
// Usage in httpServer.ts:
//   app.use(httpPath, budgetAclMiddleware);   // after bearerAuth()
//
// Tools/adapters can read (req as any).allowedBudgets: string[] | undefined
// to filter results by permitted sync IDs (forward-looking multi-budget support).

import type { Request, Response, NextFunction } from 'express';
import config from '../config.js';
import logger from '../logger.js';
import { parseBudgetAcl, type BudgetAclMap } from './budget-acl-parse.js';
import { resolveAllowedBudgetsFromActual, resolvePrincipalAsync } from './budget-acl-dynamic.js';

// ---------------------------------------------------------------------------
// ACL state (classified once from env, cached)
// ---------------------------------------------------------------------------

// One explicit state rather than an empty map plus a separate marker: a writer
// that forgot the marker would silently restore the fail-open path.
type AclState = { kind: 'open' } | { kind: 'map'; map: BudgetAclMap } | { kind: 'deny' };

let _aclState: AclState | null = null;
// Test seam (#551): when set, classify this raw value instead of config.AUTH_BUDGET_ACL.
let _rawOverride: { raw: string | undefined } | null = null;

function classify(raw: string | undefined): AclState {
  if (raw === undefined || raw === '') return { kind: 'open' };

  let map: BudgetAclMap;
  try {
    map = parseBudgetAcl(raw);
  } catch (err) {
    // Only the parser's message, which is safe by contract (it never names a key
    // or a value); never the raw error object, whose cause or stack could.
    const reason = err instanceof Error ? err.message : 'AUTH_BUDGET_ACL: unparseable';
    logger.error(`[ACL] Invalid AUTH_BUDGET_ACL: access denied to every principal until it is fixed (${reason})`);
    return { kind: 'deny' };
  }

  const count = Object.keys(map).length;
  if (count === 0) return { kind: 'open' };
  logger.info(`[ACL] Budget ACL loaded: ${count} principal(s)`);
  return { kind: 'map', map };
}

function getAclState(): AclState {
  if (_aclState === null) {
    _aclState = classify(_rawOverride !== null ? _rawOverride.raw : config.AUTH_BUDGET_ACL);
  }
  return _aclState;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Returns the list of allowed budget sync-IDs for the currently authenticated
 * request principal.
 *
 * - Returns `['*']` in the open state (ACL unset, empty, or `{}`).
 * - Returns `['*']` when any matched principal has wildcard access.
 * - Returns `[]` when the user is authenticated but not in the ACL at all.
 * - Returns `[]` for every principal in the deny state (the ACL value does not
 *   parse), never `['*']`.
 *
 * Lookups use Object.hasOwn so a principal named like an Object.prototype member
 * (`constructor`, `toString`) is simply absent instead of matching the inherited
 * function (which used to throw and surface as a 500).
 */
export function getAllowedBudgets(req: Request): string[] {
  const state = getAclState();
  if (state.kind === 'open') return ['*'];
  if (state.kind === 'deny') return [];
  const acl = state.map;

  const auth = (req as Request & { auth?: Record<string, unknown> }).auth;
  if (!auth) return [];

  const claims = (auth.claims ?? {}) as Record<string, unknown>;
  const sub = auth.subject as string | undefined;
  const email = claims['email'] as string | undefined;
  const rawGroups = claims['groups'] ?? claims['roles'] ?? [];
  const groups: string[] = Array.isArray(rawGroups) ? rawGroups as string[] : [];

  // Build the list of principal identities for this request
  const principals: string[] = [];
  if (sub) principals.push(sub);
  if (email) principals.push(email);
  for (const g of groups) principals.push(`group:${g}`);

  // Check for wildcard admin access first
  for (const p of principals) {
    if (Object.hasOwn(acl, p) && acl[p].includes('*')) return ['*'];
  }

  // Collect all permitted sync-IDs
  const permitted = new Set<string>();
  for (const p of principals) {
    if (!Object.hasOwn(acl, p)) continue;
    for (const id of acl[p]) permitted.add(id);
  }

  return [...permitted];
}

/**
 * Returns true if the authenticated user can access the given budget sync-ID.
 */
export function canAccessBudget(req: Request, budgetSyncId: string): boolean {
  const allowed = getAllowedBudgets(req);
  return allowed.includes('*') || allowed.includes(budgetSyncId);
}

// ---------------------------------------------------------------------------
// Express middleware
// ---------------------------------------------------------------------------

/**
 * Express middleware that enforces the budget ACL when OIDC auth is active.
 *
 * - Falls through immediately when AUTH_PROVIDER !== 'oidc' (no-op, keeps
 *   backward compatibility). With OIDC and the ACL unset it attaches `['*']`.
 * - Attaches `req.allowedBudgets` for downstream use (multi-budget tools).
 * - Returns HTTP 403 if the authenticated user has no permitted budgets.
 *
 * Must be mounted AFTER the bearer middleware (`bearerAuth()`, src/auth/bearer.ts) so `req.auth`
 * is already populated.
 */
export function budgetAclMiddleware(req: Request, res: Response, next: NextFunction): void {
  // No-op unless OIDC + ACL configured
  if (config.AUTH_PROVIDER !== 'oidc') {
    next();
    return;
  }

  // #338: dynamic source. Deliberately a separate branch so the static path
  // below is unreachable-by-default and byte-for-byte what it was before.
  if (config.AUTH_BUDGET_ACL_SOURCE === 'actual') {
    void resolveDynamicAcl(req, res, next);
    return;
  }

  const allowed = getAllowedBudgets(req);

  if (allowed.includes('*') || allowed.length > 0) {
    // Expose allowed budgets for use in tools
    (req as Request & { allowedBudgets?: string[] }).allowedBudgets = allowed;
    next();
    return;
  }

  const auth = (req as Request & { auth?: Record<string, unknown> }).auth;
  const identity = (auth?.subject as string | undefined) ?? 'unknown';
  logger.warn(`[ACL] Access denied for '${identity}': no permitted budgets in ACL`);
  res.status(403).json({ error: 'Forbidden: no budget access configured for this user' });
}

/**
 * #338: the async half of the middleware, for AUTH_BUDGET_ACL_SOURCE=actual.
 *
 * Split out rather than making budgetAclMiddleware itself async, because an
 * async Express handler that rejects before Express 5's error plumbing sees it
 * would hang the request. Here every path either calls next() or sends a
 * response, and the catch is exhaustive, so a rejection cannot escape.
 *
 * The upstream read is cached per principal inside the resolver, so this is not
 * an Actual API call per request.
 */
async function resolveDynamicAcl(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = (req as Request & { auth?: Record<string, unknown> }).auth;
  const claims = (auth?.claims ?? {}) as Record<string, unknown>;
  const subject = auth?.subject as string | undefined;

  try {
    // #345/#346: the map is consulted first and is authoritative when this sub is
    // bound; otherwise the identity comes from the UserInfo endpoint or the access
    // token, per AUTH_BUDGET_ACL_IDENTITY_SOURCE. An unmapped deployment on the
    // default source behaves exactly as it did before both tickets.
    const token = auth?.token as string | undefined;
    const { value: principalValue, source } = await resolvePrincipalAsync(claims, subject, token);
    const allowed = await resolveAllowedBudgetsFromActual(principalValue, source);

    if (allowed.length > 0) {
      (req as Request & { allowedBudgets?: string[] }).allowedBudgets = allowed;
      next();
      return;
    }

    logger.warn(`[ACL] Access denied for '${subject ?? 'unknown'}': no budget files grant this principal access`);
    res.status(403).json({ error: 'Forbidden: no budget access configured for this user' });
  } catch (err) {
    // Fail closed. A resolver fault must never fall through to the static path
    // or to an unrestricted context.
    logger.error('[ACL] Dynamic ACL resolution failed; denying access', err as Error);
    res.status(403).json({ error: 'Forbidden: budget access could not be determined' });
  }
}

/** Reset cached state and the raw override (test helper). */
export function _resetAclForTests(): void {
  _aclState = null;
  _rawOverride = null;
}

/**
 * Directly set the ACL map (test helper; bypasses config/env). `{}` is the open
 * state, exactly as an unset variable is.
 */
export function _setAclForTests(aclMap: Record<string, string[]>): void {
  _aclState = Object.keys(aclMap).length === 0 ? { kind: 'open' } : { kind: 'map', map: aclMap };
}

/**
 * #551 test seam: classify `raw` as if it were the AUTH_BUDGET_ACL value, through
 * the same parser and logging as the real path. Cleared by _resetAclForTests.
 */
export function _setRawAclForTests(raw: string | undefined): void {
  _rawOverride = { raw };
  _aclState = null;
}
