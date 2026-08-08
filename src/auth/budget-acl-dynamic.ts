// src/auth/budget-acl-dynamic.ts
//
// #338: derive the budget ACL from the Actual server's own per-file access list
// instead of hand-maintained JSON, so revoking someone in Actual takes effect
// here without a config edit and a restart.
//
// WHAT THE ACL JOINS ON, and the mistake this replaced (#343).
//
// `getBudgets()` returns, per remote file:
//
//   "owner": "a6067f04-...",
//   "usersWithAccess": [
//     { "userId": "5311397e-...", "displayName": "Alice", "userName": "alice", "owner": false },
//     { "userId": "a6067f04-...", "displayName": "",      "userName": "",      "owner": true  }
//   ]
//
// v0.11.0 matched the OIDC `sub` against `userId`, on the reasoning that `sub` is
// the only claim OIDC guarantees stable and unique, and that a UUID cannot collide
// with the blank `userName` on the service-account row. Both halves of that are
// true and the conclusion was still wrong: `userId` is a UUID Actual mints for
// ITSELF at account creation (openid.ts) and corresponds to nothing any IdP
// issues. Nothing ever matched, and every user was denied every budget. It failed
// closed, so it locked people out rather than letting them in, but the feature was
// inert. Reported by the requester on #317, who supplied the token dump that made
// it obvious.
//
// The join is therefore on `userName`, resolved via Actual's own claim precedence
// (see ACTUAL_IDENTITY_PRECEDENCE below).
//
// THE BLANK-ROW GUARD IS WHAT MAKES NAME MATCHING SAFE. That second row above is
// this server's own password/service account: it owns every file the API creates
// and has no `userName`, because it is not an OpenID user. A principal whose claim
// resolved to empty would match it and inherit `owner: true` on every file. So a
// blank or missing claim yields null, never '', and the matcher skips blank
// candidates. Those two guards are load bearing; do not relax either.
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
 * Actual's OWN identity precedence, mirrored exactly (#343).
 *
 * From `packages/sync-server/src/accounts/openid.ts`:
 *
 *   const identity = userInfo.preferred_username ?? userInfo.login ??
 *                    userInfo.email ?? userInfo.id ?? userInfo.sub;
 *   userId = uuidv4();
 *   INSERT INTO users (id, user_name, ...) VALUES (userId, identity, ...)
 *
 * So `user_name` holds whichever of these the IdP supplied FIRST, and `userId`
 * is a UUID Actual generated for itself. This list is not a preference of ours;
 * it is the only sequence that reproduces the value Actual actually stored, and
 * the ORDER must track upstream's or the join silently stops matching.
 *
 * ONE DELIBERATE DIVERGENCE. Upstream uses `??`, which stops at the first
 * non-nullish value, including `''` and non-strings. We SKIP blank and non-string
 * entries and keep walking. That is deliberately safer here: an IdP that emits
 * `preferred_username: ""` makes Actual store `user_name = ''`, and stopping there
 * would hand us an empty principal, which is precisely the value that must never
 * be matched against the service account's blank `userName`. The cost is that in
 * that edge case our principal and Actual's `user_name` disagree, so the user is
 * DENIED rather than matched. Denial is the correct side to err on.
 *
 * SOURCE OF CLAIMS, and a real limitation. Upstream evaluates this over the
 * UserInfo endpoint response; we evaluate it over the verified ACCESS TOKEN
 * payload (`req.auth.claims`, set in httpServer.ts), because that is what this
 * server has. Those two sets are not always equal: several IdPs omit
 * `preferred_username` from access tokens unless a mapper is configured. If the
 * winning claim here differs from the one Actual used, the join fails and the user
 * is denied. That is why the no-match path logs WHICH claim won, and why the
 * documentation tells operators to ensure the claim is present in the access token.
 */
export const ACTUAL_IDENTITY_PRECEDENCE = ['preferred_username', 'login', 'email', 'id', 'sub'] as const;

/** Sentinel for AUTH_BUDGET_ACL_CLAIM meaning "walk the precedence above". */
export const AUTO_CLAIM = 'auto';

/**
 * Extract the identity value to match against Actual's `userName`.
 *
 * WHY THIS IS NOT `sub`, despite `sub` being the right answer in general.
 *
 * OIDC Core guarantees only `sub` is "locally unique and never reassigned";
 * `preferred_username` carries no such guarantee and is mutable at the IdP. Under
 * normal circumstances keying on `sub` is simply correct, and that is what this
 * shipped with in v0.11.0.
 *
 * It could never work. Actual does not store `sub` anywhere we can see: it
 * derives the identity by the precedence above and stores THAT, alongside a UUID
 * of its own invention. There is no field in `usersWithAccess` that a `sub` can
 * be compared against. Matching the best-practice identifier resolved every
 * principal to zero budgets and locked every user out (#343).
 *
 * So we mirror Actual. The security consequence is inherited, not introduced: an
 * IdP that lets a user set `preferred_username` (or an unverified `email`) to
 * another user's value can impersonate them HERE exactly as it can in Actual's own
 * login. An operator who wants a stronger guarantee should pin a single trusted
 * claim with AUTH_BUDGET_ACL_CLAIM and ensure their IdP populates Actual's
 * `user_name` from that same claim.
 *
 * Blank is deliberately null and not '': an empty string would compare equal to
 * the service account's blank `userName`, which carries `owner: true`. That guard
 * is what makes name matching safe, and it is why the precedence SKIPS blank
 * entries rather than stopping at the first one that merely exists.
 */
export function extractPrincipalValue(
  claims: Record<string, unknown>,
  subject: string | undefined,
  claimName: string,
): string | null {
  const read = (name: string): string | null => {
    // `sub` is normally surfaced as the token subject rather than a claim entry.
    const raw = name === 'sub' ? (subject ?? claims['sub']) : claims[name];
    if (typeof raw !== 'string') return null;
    // Blank-ONLY rejection. The value itself is returned UNTRIMMED, because
    // Actual's user_name uniqueness is exact: " alice" and "alice" are two
    // different accounts. Trimming here (and again on the candidate) would let a
    // user who can register " alice" at the IdP match the real alice's access
    // rows and read her budgets. Trim to decide emptiness, never to compare.
    return raw.trim().length > 0 ? raw : null;
  };

  if (claimName !== AUTO_CLAIM) return read(claimName);

  for (const name of ACTUAL_IDENTITY_PRECEDENCE) {
    const value = read(name);
    if (value !== null) return value;
  }
  return null;
}

/**
 * Which claim the precedence actually selected, for logging. Returns null when
 * nothing resolved. Kept separate so the hot path stays a plain string.
 */
export function resolvedClaimName(
  claims: Record<string, unknown>,
  subject: string | undefined,
  claimName: string,
): string | null {
  if (claimName !== AUTO_CLAIM) {
    return extractPrincipalValue(claims, subject, claimName) === null ? null : claimName;
  }
  for (const name of ACTUAL_IDENTITY_PRECEDENCE) {
    if (extractPrincipalValue(claims, subject, name) !== null) return name;
  }
  return null;
}

/**
 * Map a getBudgets() payload to the sync IDs the given principal may access.
 *
 * Pure, so the matching rules are unit-testable against the captured live
 * fixture without a server. Exported for that reason.
 */
export function matchAllowedFiles(files: unknown, principalValue: string): string[] {
  if (!Array.isArray(files)) return [];
  // An empty principal can never match. Belt and braces: extractPrincipalValue
  // already returns null for blank, but this function is exported and must not
  // depend on its callers for that guarantee.
  if (!principalValue) return [];

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
      //
      // ALWAYS `userName`, never `userId` (#343). `userId` is a UUID Actual
      // generates for itself at account creation and it corresponds to nothing
      // any IdP issues, so comparing a token value against it can only ever
      // return zero matches. `userName` is the field that holds the identity
      // Actual resolved from the token.
      const candidate = u.userName;
      if (typeof candidate !== 'string') continue;
      // Blank check trims; the COMPARISON does not. Actual's user_name uniqueness
      // is exact, so trimming both sides would collapse " alice" and "alice" into
      // one identity and hand the second one's budgets to the first.
      if (candidate.trim().length === 0) continue; // never match the blank service-account row
      if (candidate === principalValue) {
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
export async function resolveAllowedBudgetsFromActual(
  principalValue: string | null,
  lastResolvedClaim?: string | null,
): Promise<string[]> {
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

  const allowed = matchAllowedFiles(files, principalValue);

  if (allowed.length === 0) {
    // #343 was a TOTAL silent denial that survived two releases because the log
    // said nothing useful. Name the claim that actually won and the userNames on
    // offer, so the next mismatch is diagnosable from one log line instead of a
    // debugging session. The principal itself is not logged at warn level (it is
    // an identity); it is available at debug.
    const offered = Array.isArray(files)
      ? [...new Set((files as BudgetFileEntry[])
          .flatMap((f) => (Array.isArray(f?.usersWithAccess) ? f.usersWithAccess : []))
          .map((u) => u?.userName)
          .filter((n): n is string => typeof n === 'string' && n.trim().length > 0))]
      : [];
    log.warn('dynamic ACL: principal matched no budget file', {
      configuredClaim: config.AUTH_BUDGET_ACL_CLAIM,
      resolvedFromClaim: lastResolvedClaim ?? '(none)',
      fileCount: Array.isArray(files) ? files.length : 0,
      knownUserNames: offered,
      hint:
        'The value from the token did not equal any userName above. Actual derives userName from the ' +
        'UserInfo response; this server reads the ACCESS TOKEN. If they differ, add a claim mapper at your ' +
        'IdP or pin AUTH_BUDGET_ACL_CLAIM to a claim present in the access token.',
    });
    log.debug('dynamic ACL: unmatched principal', { principal: principalValue });
  }

  _cache.set(principalValue, { at: Date.now(), allowed });
  return allowed;
}
