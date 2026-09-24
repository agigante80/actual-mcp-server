/**
 * OIDC scope parsing and discovery helpers (#472).
 *
 * Separates scopes advertised in discovery (RFC 9728 `scopes_supported`) from
 * scopes required (enforced) on incoming access tokens (`requiredScopes`).
 *
 * Some IdPs (such as Cloudflare Access for SaaS or Casdoor) issue JWTs without
 * a `scope` claim, while clients (such as Google Gemini) require `offline_access`
 * to be advertised in discovery in order to request and receive a refresh token.
 *
 * Pure and side-effect-free for hermetic unit testing.
 */

/**
 * Split a comma-separated scope string into trimmed, non-empty, de-duplicated tokens,
 * preserving first-seen order.
 *
 * Returns an empty array if `csv` is undefined, empty, or whitespace-only.
 */
export function parseScopeList(csv: string | undefined): string[] {
  if (!csv) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of csv.split(',')) {
    const trimmed = part.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

/**
 * Build the full list of scopes advertised in RFC 9728 `scopes_supported`.
 *
 * Advertised scopes (`OIDC_SCOPES_SUPPORTED`) come first, followed by any
 * required scopes (`OIDC_SCOPES`) not already present. A required scope is
 * always advertised so clients cannot fail to request a scope the server demands.
 * With `OIDC_SCOPES_SUPPORTED` unset, this matches `parseScopeList(requiredCsv)`.
 */
export function buildScopesSupported(
  advertisedCsv: string | undefined,
  requiredCsv: string | undefined,
): string[] {
  const advertised = parseScopeList(advertisedCsv);
  const required = parseScopeList(requiredCsv);
  const seen = new Set(advertised);
  const result = [...advertised];
  for (const s of required) {
    if (!seen.has(s)) {
      seen.add(s);
      result.push(s);
    }
  }
  return result;
}
