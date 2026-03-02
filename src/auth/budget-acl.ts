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
//     "alice@example.com"  — matched against token email claim
//     "some-sub-uuid"      — matched against token sub claim
//     "group:admin"        — matched against token groups/roles array
//
//   Value ["*"] grants access to all budgets (admin shorthand).
//
// When AUTH_BUDGET_ACL is unset, all authenticated users are allowed ("*").
//
// Usage in httpServer.ts:
//   app.use(httpPath, budgetAclMiddleware);   // after bearerAuth()
//
// Tools/adapters can read (req as any).allowedBudgets: string[] | undefined
// to filter results by permitted sync IDs (forward-looking multi-budget support).

import type { Request, Response, NextFunction } from 'express';
import config from '../config.js';
import logger from '../logger.js';

// ---------------------------------------------------------------------------
// ACL map (parsed once from env, cached)
// ---------------------------------------------------------------------------

let _aclMap: Record<string, string[]> | null = null;

function getAclMap(): Record<string, string[]> {
  if (_aclMap !== null) return _aclMap;

  if (!config.AUTH_BUDGET_ACL) {
    _aclMap = {};
    return _aclMap;
  }

  try {
    const parsed = JSON.parse(config.AUTH_BUDGET_ACL);
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('AUTH_BUDGET_ACL must be a JSON object');
    }
    _aclMap = parsed as Record<string, string[]>;
    logger.info(`[ACL] Budget ACL loaded: ${Object.keys(_aclMap).length} principal(s)`);
  } catch (err) {
    logger.error('[ACL] Invalid AUTH_BUDGET_ACL JSON — treating as empty (no budget restrictions):', err);
    _aclMap = {};
  }

  return _aclMap;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Returns the list of allowed budget sync-IDs for the currently authenticated
 * request principal.
 *
 * - Returns `['*']` when ACL is empty / unset (no restrictions).
 * - Returns `['*']` when any matched principal has wildcard access.
 * - Returns `[]` when the user is authenticated but not in the ACL at all.
 */
export function getAllowedBudgets(req: Request): string[] {
  const acl = getAclMap();

  // No ACL configured → allow everything
  if (Object.keys(acl).length === 0) return ['*'];

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
    if (acl[p]?.includes('*')) return ['*'];
  }

  // Collect all permitted sync-IDs
  const permitted = new Set<string>();
  for (const p of principals) {
    for (const id of acl[p] ?? []) permitted.add(id);
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
 * - Falls through immediately when AUTH_PROVIDER !== 'oidc' or AUTH_BUDGET_ACL
 *   is unset (no-op — keeps backward compatibility).
 * - Attaches `req.allowedBudgets` for downstream use (multi-budget tools).
 * - Returns HTTP 403 if the authenticated user has no permitted budgets.
 *
 * Must be mounted AFTER mcp-auth's `bearerAuth()` middleware so `req.auth`
 * is already populated.
 */
export function budgetAclMiddleware(req: Request, res: Response, next: NextFunction): void {
  // No-op unless OIDC + ACL configured
  if (config.AUTH_PROVIDER !== 'oidc') {
    next();
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

/** Reset cached state (test helper). */
export function _resetAclForTests(): void {
  _aclMap = null;
}

/** Directly set the ACL map (test helper — bypasses config/env). */
export function _setAclForTests(aclMap: Record<string, string[]>): void {
  _aclMap = aclMap;
}
