/**
 * OIDC accepted-audiences allowlist (#245).
 *
 * Build the strict, closed set of audiences a JWT's `aud` claim may match: the
 * required `OIDC_RESOURCE` plus any explicitly configured extras
 * (`OIDC_ACCEPTED_AUDIENCES`, comma-separated, e.g. an IdP like Authentik that
 * puts the client-id in `aud`). The list is trimmed, empties are removed, and
 * duplicates are collapsed. There is NO wildcard and NO accept-any: an `aud`
 * outside this set is rejected by jose, preserving the cross-relying-party replay
 * protection from #160. With no extras configured the set is exactly
 * `[OIDC_RESOURCE]`, so existing single-audience deployments are unchanged.
 *
 * Pure and side-effect-free so it is unit-testable without booting a server.
 */
export function buildAcceptedAudiences(
  resource: string | undefined,
  configured: string | undefined,
): string[] {
  const parts = [resource ?? '', ...(configured ?? '').split(',')];
  return Array.from(new Set(parts.map((a) => a.trim()).filter((a) => a.length > 0)));
}
