// src/auth/userinfo-identity.ts
//
// #346: resolve the ACL principal from the IdP's UserInfo endpoint, which is the
// SAME document Actual derives `user_name` from.
//
// THE MISMATCH THIS REMOVES. Actual's login path is:
//
//   const userInfo = await client.userinfo(tokenSet.access_token);   // openid.ts
//   const identity = userInfo.preferred_username ?? userInfo.login ??
//                    userInfo.email ?? userInfo.id ?? userInfo.sub;
//   INSERT INTO users (id, user_name, ...) VALUES (uuidv4(), identity, ...)
//
// This server reads the verified ACCESS TOKEN payload instead. Those are two
// different documents, and several IdPs (Authentik and Keycloak among them) return
// `preferred_username` from UserInfo while omitting it from the access token unless
// a property mapping is configured. When that happens every principal resolves to a
// value Actual never stored, and the result is a total, silent denial. Reading the
// same document Actual read removes the whole class rather than one instance of it.
//
// WHY IT IS OPT-IN AND OFF BY DEFAULT. It trades a correctness bug for an
// availability dependency: the IdP becomes a hard dependency of authorization, and
// it needs the access token to carry the `openid` scope, which this server does not
// require (OIDC_SCOPES is optional). #345's offline identity map is the right
// default answer; this is for deployments that want the join to be automatic.

import config from '../config.js';
import { createModuleLogger } from '../lib/loggerFactory.js';
import { discoverOidcMetadata, resolveUserInfoUri } from '../lib/oidc-discovery.js';

const log = createModuleLogger('ACL');

/** Why a UserInfo resolution failed. Each maps to a different operator fix. */
export type UserInfoFailure =
  | 'token-refused'   // 401/403: the token was not accepted (usually a missing openid scope)
  | 'subject-mismatch' // the response described a DIFFERENT principal
  | 'no-identity'      // 2xx, but nothing in the precedence
  | 'unavailable';     // timeout, transport error, bad body, bad status

export interface UserInfoResult {
  /** The identity string, or null on any failure. */
  value: string | null;
  /** Which precedence claim won, for logging. */
  claim: string | null;
  /** Set when value is null. */
  failure: UserInfoFailure | null;
}

/**
 * Identity cache, keyed on the verified `sub`.
 *
 * Keyed on `sub` rather than on the resolved identity because the identity is not
 * known until AFTER the request that this cache exists to avoid. `sub` is always
 * present and verified, so it is available before the call.
 *
 * SUCCESSES ONLY. Caching a failure would keep a transient IdP blip in force for
 * the whole TTL; the timeout below is what bounds the cost of an unhealthy endpoint,
 * not a negative cache. The TTL matches the ACL's own budget cache, so enabling this
 * does not widen the revocation window that already exists.
 */
const CACHE_TTL_MS = 60_000;
const _cache = new Map<string, { at: number; value: string; claim: string | null }>();

export function _resetUserInfoCache(): void {
  _cache.clear();
}

/** Test seam: how many outbound UserInfo requests have been made. */
let _fetchCount = 0;
export function _userInfoFetchCount(): number {
  return _fetchCount;
}

/**
 * Read a precedence claim out of an untrusted UserInfo body.
 *
 * NON-STRINGS ARE ABSENT, NOT COERCED. A hostile or broken IdP returning
 * `preferred_username: {}` must not become the string "[object Object]", and
 * `email: 42` must not become "42". Coercion here would invent an identity that
 * the operator never configured and Actual never stored. Blank is absent too, for
 * the same reason it is in extractPrincipalValue: the service-account row that owns
 * every budget file has a blank `userName`.
 */
function readClaim(body: Record<string, unknown>, name: string): string | null {
  const raw = body[name];
  if (typeof raw !== 'string') return null;
  return raw.trim().length > 0 ? raw : null;
}

/**
 * Resolve the identity for `subject` by calling the IdP's UserInfo endpoint with
 * the caller's own access token.
 *
 * FAILS CLOSED on every path. `precedence` is passed in rather than imported so
 * this module cannot drift from the single definition of Actual's ordering.
 */
export async function resolveIdentityFromUserInfo(
  accessToken: string,
  subject: string,
  precedence: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<UserInfoResult> {
  const cached = _cache.get(subject);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { value: cached.value, claim: cached.claim, failure: null };
  }

  let endpoint: string;
  try {
    const { metadata } = await discoverOidcMetadata(
      config.OIDC_ISSUER,
      config.OIDC_ALLOW_INSECURE_ISSUER === true,
    );
    endpoint = resolveUserInfoUri(
      metadata as { userinfo_endpoint?: unknown },
      config.OIDC_ISSUER,
      config.OIDC_ALLOW_INSECURE_ISSUER === true,
    );
  } catch (err) {
    log.error('dynamic ACL: could not resolve the UserInfo endpoint; denying', err as Error);
    return { value: null, claim: null, failure: 'unavailable' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.AUTH_BUDGET_ACL_USERINFO_TIMEOUT_MS);
  let res: Response;
  try {
    _fetchCount += 1;
    res = await fetchImpl(endpoint, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: controller.signal,
      redirect: 'error',
    });
  } catch (err) {
    // Timeout or transport failure. Deliberately a DIFFERENT disposition from a
    // 401: this one says the IdP is unreachable, which is an availability problem
    // rather than a configuration one, and the two have different fixes.
    log.warn('dynamic ACL: UserInfo request failed; denying', {
      reason: err instanceof Error ? err.message : String(err),
      timeoutMs: config.AUTH_BUDGET_ACL_USERINFO_TIMEOUT_MS,
      hint: 'The IdP was unreachable or too slow. This is an availability failure, not a claim mismatch.',
    });
    return { value: null, claim: null, failure: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    log.warn('dynamic ACL: the IdP refused the access token at UserInfo; denying', {
      status: res.status,
      hint:
        'UserInfo requires a token issued with the "openid" scope. This server does not require that scope ' +
        '(OIDC_SCOPES is optional), so the client may not have requested it. Add "openid" to the client scopes, ' +
        'or use AUTH_BUDGET_ACL_IDENTITY_SOURCE=token with AUTH_BUDGET_ACL_IDENTITY_MAP instead.',
    });
    return { value: null, claim: null, failure: 'token-refused' };
  }

  if (!res.ok) {
    log.warn('dynamic ACL: UserInfo returned an unexpected status; denying', { status: res.status });
    return { value: null, claim: null, failure: 'unavailable' };
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await res.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('UserInfo body is not a JSON object');
    }
    body = parsed as Record<string, unknown>;
  } catch (err) {
    // Covers an HTML error page, a truncated body, and a signed (application/jwt)
    // response. A JWT response is NOT parsed here: verifying it needs the JWKS and
    // the same audience rules as the access token, and accepting it unverified
    // would let anything that can answer this URL choose the caller's identity.
    log.warn('dynamic ACL: UserInfo body was not usable JSON; denying', {
      reason: err instanceof Error ? err.message : String(err),
      contentType: res.headers?.get?.('content-type') ?? '(unknown)',
      hint:
        'A signed (application/jwt) UserInfo response is not supported yet and is refused rather than ' +
        'trusted unverified. Configure the IdP to return application/json.',
    });
    return { value: null, claim: null, failure: 'unavailable' };
  }

  // OIDC Core 5.3.2: the client MUST verify that the `sub` in the UserInfo response
  // matches the `sub` it already holds. This is not defensive polish; without it,
  // anything able to answer as the userinfo_endpoint (a compromised IdP, a
  // misconfigured proxy, a hijacked DNS entry) could return ANOTHER user's
  // preferred_username and hand that user's budgets to this caller. A mismatch is a
  // hard deny, and it must never fall back to the token claims: falling back would
  // turn a detected attack into a silent downgrade.
  const responseSub = body['sub'];
  if (typeof responseSub !== 'string' || responseSub !== subject) {
    log.error('dynamic ACL: UserInfo subject mismatch; denying', undefined, {
      hint:
        'The UserInfo response described a different principal than the access token (OIDC Core 5.3.2). ' +
        'This is refused outright and is never retried against the token claims. If it persists, treat the ' +
        'UserInfo endpoint as untrusted.',
      responseSubType: typeof responseSub,
    });
    return { value: null, claim: null, failure: 'subject-mismatch' };
  }

  for (const name of precedence) {
    const value = readClaim(body, name);
    if (value !== null) {
      _cache.set(subject, { at: Date.now(), value, claim: name });
      return { value, claim: name, failure: null };
    }
  }

  log.warn('dynamic ACL: UserInfo carried no usable identity claim; denying', {
    precedence: [...precedence],
    hint: 'The response was valid but contained none of the claims Actual derives user_name from.',
  });
  return { value: null, claim: null, failure: 'no-identity' };
}
