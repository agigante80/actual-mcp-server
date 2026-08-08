// src/auth/budget-acl-dynamic.ts
//
// #338: derive the budget ACL from the Actual server's own per-file access list
// instead of hand-maintained JSON, so revoking someone in Actual takes effect
// here without a config edit and a restart.
//
// WHY userId AND NOT userName, verified against a live multi-user server.
//
// `getBudgets()` returns, per remote file:
//
//   "owner": "a6067f04-...",
//   "usersWithAccess": [
//     { "userId": "5311397e-...", "displayName": "Alice", "userName": "alice", "owner": false },
//     { "userId": "a6067f04-...", "displayName": "",      "userName": "",      "owner": true  }
//   ]
//
// That second row is THIS SERVER'S OWN service account. `@actual-app/api`
// authenticates with a password, that password identity owns every file the API
// creates, and it has no userName because it is not an OpenID user. So a blank
// `userName` is present in every file's access list on every deployment.
//
// A name-based match therefore has a live escalation path: a principal whose
// configured claim is missing or empty would match the blank row, which carries
// `owner: true`, and be granted access to every file on the server. Matching
// UUIDs makes that unrepresentable, because no IdP subject equals the service
// account's UUID. AUTH_BUDGET_ACL_CLAIM still allows name matching for
// deployments that need it, and the empty-principal guard below is what keeps
// that option from reintroducing the hole.
//
// WHY THE RESOLUTION RUNS UNDER AN EXPLICIT WILDCARD CONTEXT.
//
// Resolving the ACL requires `adapter.getBudgets()`, and every adapter entry
// point runs `_enforceBudgetAcl`, which refuses when the request context has no
// allowedBudgets. Resolving the ACL would therefore be blocked by the ACL it is
// trying to compute. We break that circularity by running ONLY this one call
// inside `requestContext.run({ allowedBudgets: ['*'] }, ...)`.
//
// That is sound rather than a loophole: `getBudgets()` lists budget FILES
// (name, id, who may access them). It reads no budget CONTENTS: no accounts, no
// transactions, no balances. The wildcard is scoped to this single listing call
// and never leaks into the caller's context, because AsyncLocalStorage restores
// the previous store when the callback returns.

import config from '../config.js';
import adapter from '../lib/actual-adapter.js';
import { requestContext } from '../lib/requestContext.js';
import { createModuleLogger } from '../lib/loggerFactory.js';

const log = createModuleLogger('ACL');

/** One entry of a remote file's access list, as returned by getBudgets(). */
interface UserWithAccess {
  userId?: string;
  userName?: string;
  displayName?: string;
  owner?: boolean;
}

/**
 * The subset of a getBudgets() entry this module reads.
 *
 * WHICH IDENTIFIER THE ACL SPEAKS IN, and why it is NOT the obvious one.
 *
 * A remote file carries both `cloudFileId` and `groupId`, and they are different
 * UUIDs. The ACL must be expressed in `groupId`, because that is what Actual calls
 * the "Sync ID": it is the value `ACTUAL_BUDGET_SYNC_ID` holds, the value
 * `getActiveBudgetConfig().syncId` returns, and therefore the value
 * `_enforceBudgetAcl` compares against.
 *
 * Verified against the API source rather than inferred. `api/download-budget`
 * resolves the budget with `files.find(f => f.groupId === syncId)`, and a live
 * check confirms `downloadBudget(cloudFileId)` throws "not found" while
 * `downloadBudget(groupId)` succeeds.
 *
 * Getting this wrong is silent and total: the resolver would return a set of
 * cloudFileIds, nothing would ever match the active syncId, and EVERY user would
 * be denied with no indication that the identifiers were simply of different
 * kinds. That is exactly what the first implementation did.
 */
interface BudgetFileEntry {
  /** Actual's "Sync ID". This is what the ACL is expressed in. */
  groupId?: string;
  /** NOT the sync id. Present on the entry but deliberately unused here. */
  cloudFileId?: string;
  usersWithAccess?: UserWithAccess[];
}

/**
 * Cache of principal to allowed sync IDs.
 *
 * Bounded by TTL rather than size: the key space is the set of authenticated
 * principals, which is small and operator-controlled. A short TTL is what makes
 * a revocation in Actual take effect here promptly; without it this feature
 * would reintroduce exactly the staleness it exists to remove.
 */
const CACHE_TTL_MS = 60_000;
const _cache = new Map<string, { at: number; allowed: string[] }>();

/** Clear the resolver cache (test helper, and used when config is re-read). */
export function _resetDynamicAclCache(): void {
  _cache.clear();
}

/**
 * Extract the identity value to match on, from the claim named by
 * AUTH_BUDGET_ACL_CLAIM. Returns null when the claim is absent or blank.
 *
 * Blank is deliberately null and not '': an empty string would compare equal to
 * the service account's empty userName. See the header note.
 */
export function extractPrincipalValue(
  claims: Record<string, unknown>,
  subject: string | undefined,
  claimName: string,
): string | null {
  const raw = claimName === 'sub' ? (subject ?? claims['sub']) : claims[claimName];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Map a getBudgets() payload to the sync IDs the given principal may access.
 *
 * Pure, so the matching rules are unit-testable against the captured live
 * fixture without a server. Exported for that reason.
 */
export function matchAllowedFiles(
  files: unknown,
  principalValue: string,
  claimName: string,
): string[] {
  if (!Array.isArray(files)) return [];
  // An empty principal can never match. Belt and braces: extractPrincipalValue
  // already returns null for blank, but this function is exported and must not
  // depend on its callers for that guarantee.
  if (!principalValue) return [];

  const matchesName = claimName !== 'sub';
  const allowed = new Set<string>();

  for (const entry of files as BudgetFileEntry[]) {
    if (!entry || typeof entry !== 'object') continue;
    // groupId, NOT cloudFileId. See the BudgetFileEntry note: groupId is the
    // "Sync ID" that _enforceBudgetAcl compares against.
    const syncId = entry.groupId;
    const access = entry.usersWithAccess;
    if (!syncId || !Array.isArray(access)) continue;

    for (const u of access) {
      if (!u || typeof u !== 'object') continue;
      // Read the whole list, not only `owner: true`. A file shared with a
      // household member appears with owner: false, and that is exactly the
      // case this feature exists to honour.
      const candidate = matchesName ? u.userName : u.userId;
      if (typeof candidate !== 'string') continue;
      const trimmed = candidate.trim();
      if (trimmed.length === 0) continue; // never match the blank service-account row
      if (trimmed === principalValue) {
        allowed.add(syncId);
        break;
      }
    }
  }

  return [...allowed];
}

/**
 * Resolve the allowed sync IDs for a principal from the Actual server.
 *
 * FAILS CLOSED. Every error path returns [] (no access) rather than ['*'].
 * An authorization source that opens up when the thing it queries is unreachable
 * is worse than no authorization source at all.
 */
export async function resolveAllowedBudgetsFromActual(principalValue: string | null): Promise<string[]> {
  if (!principalValue) {
    log.warn('dynamic ACL: no usable principal value; denying', { claim: config.AUTH_BUDGET_ACL_CLAIM });
    return [];
  }

  const cached = _cache.get(principalValue);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.allowed;

  let files: unknown;
  try {
    // The scoped wildcard described in the header. Nothing outside this call
    // observes it.
    files = await requestContext.run({ allowedBudgets: ['*'] }, () => adapter.getBudgets());
  } catch (err) {
    log.error('dynamic ACL: could not read the budget list; denying access', err as Error);
    return [];
  }

  const allowed = matchAllowedFiles(files, principalValue, config.AUTH_BUDGET_ACL_CLAIM);

  if (allowed.length === 0) {
    log.warn('dynamic ACL: principal matched no budget file', {
      claim: config.AUTH_BUDGET_ACL_CLAIM,
      fileCount: Array.isArray(files) ? files.length : 0,
    });
  }

  _cache.set(principalValue, { at: Date.now(), allowed });
  return allowed;
}
