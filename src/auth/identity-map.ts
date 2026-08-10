// src/auth/identity-map.ts
//
// #345: explicit `sub` to Actual `userName` bindings for the dynamic budget ACL.
//
// WHY THIS EXISTS. The dynamic ACL joins a token claim to Actual's `user_name`,
// and two properties of Actual make that join incomplete no matter how good the
// claim heuristic is:
//
//   1. Actual derives `user_name` from the USERINFO RESPONSE
//      (`packages/sync-server/src/accounts/openid.ts`:
//      `const userInfo = await client.userinfo(tokenSet.access_token)`), while this
//      server reads the verified ACCESS TOKEN payload. An IdP that returns
//      `preferred_username` from UserInfo but omits it from the access token
//      produces a total, silent denial. (#346 addresses that axis directly.)
//   2. `user_name` is FROZEN at first login. The INSERT sets it once; the
//      returning-user branch updates only `display_name`. So an IdP-side rename
//      breaks the join permanently, and no claim-based scheme can repair it.
//
// An explicit operator-authored binding answers both, because it depends on
// neither the claim set nor the current value of any mutable IdP attribute.
//
// WHY IT IS KEYED ON `sub`. `sub` is the one claim we already require to be
// present and verified (httpServer.ts rejects a token whose `sub` is not a
// non-empty string), OIDC Core guarantees it is locally unique and never
// reassigned, and it is unaffected by a rename at either end. Keying on the
// CONFIGURED claim instead would be circular: the whole reason this exists is
// that the configured claim may be absent from the access token.
//
// WHY THIS MODULE HAS NO IMPORTS. `config.ts` validates the raw env value at
// startup by calling parseIdentityMap, and `budget-acl-dynamic.ts` consumes the
// parsed result. If the parser lived in the latter, config would import a module
// that imports config, and the cycle would leave one of them half-initialised at
// module-evaluation time. Keeping it dependency-free is what makes validation at
// config-parse time possible at all.

/** Parsed bindings: verified OIDC `sub` to the exact Actual `userName`. */
export type IdentityMap = Map<string, string>;

/**
 * Parse `AUTH_BUDGET_ACL_IDENTITY_MAP`.
 *
 * Format: `<sub>=<actual userName>[,<sub>=<userName>...]`
 *
 * Throws on any malformed entry rather than skipping it. A silently dropped
 * binding is an authorization change the operator did not ask for and would have
 * no way to notice: they would see a 403 and no reason for it. Startup is the
 * cheapest possible moment to surface it.
 *
 * TRIMMING, and why it differs from the token side. Both halves are trimmed
 * here. On the token side `extractPrincipalValue` deliberately does NOT trim the
 * value it compares, because a user who can register `" alice"` at the IdP would
 * otherwise match the real `alice`. That reasoning does not apply to this file:
 * the values are operator-authored, not attacker-supplied, and `KEY = value`
 * spacing in an env file is ordinary. The cost is that an Actual `userName` with
 * genuine leading or trailing whitespace cannot be expressed here; it would fail
 * to match and the principal would be denied, which is the correct direction.
 */
export function parseIdentityMap(raw: string | undefined | null): IdentityMap {
  const map: IdentityMap = new Map();
  if (raw === undefined || raw === null) return map;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return map;

  for (const rawEntry of trimmed.split(',')) {
    const entry = rawEntry.trim();
    if (entry.length === 0) continue; // tolerate a trailing comma

    const eq = entry.indexOf('=');
    if (eq === -1) {
      throw new Error(`entry "${entry}" is not "<sub>=<userName>" (no "=" found)`);
    }
    if (entry.indexOf('=', eq + 1) !== -1) {
      throw new Error(`entry "${entry}" contains more than one "="; a sub or userName containing "=" cannot be expressed here`);
    }

    const sub = entry.slice(0, eq).trim();
    const userName = entry.slice(eq + 1).trim();

    if (sub.length === 0) {
      throw new Error(`entry "${entry}" has a blank sub on the left of "="`);
    }
    // A BLANK TARGET IS THE DANGEROUS ONE, and it is rejected here rather than
    // left to the matcher. This server's own service account appears in EVERY
    // file's usersWithAccess with `owner: true` and a blank `userName`, so a
    // binding to '' would resolve its principal to owner access on every budget
    // in the deployment. matchAllowedFiles already skips blank candidates; this
    // is the second, explicit guard, and it fails at startup instead of granting
    // nothing quietly at request time.
    if (userName.length === 0) {
      throw new Error(`entry "${entry}" has a blank userName; a blank target would match the service-account row that owns every file`);
    }

    if (map.has(sub)) {
      // Last-wins would be a silent authorization change decided by ordering.
      throw new Error(`duplicate sub "${sub}"; each sub may appear at most once`);
    }

    map.set(sub, userName);
  }

  return map;
}
