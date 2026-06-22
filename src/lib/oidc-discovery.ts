import { createModuleLogger } from './loggerFactory.js';

/**
 * OIDC JWKS discovery (#244, #254).
 *
 * Background: the OIDC verifier used to build its key set from a hardcoded
 * `${OIDC_ISSUER}/.well-known/jwks`, which is wrong for most identity providers
 * (their real `jwks_uri` comes from the discovery document and often lives on a
 * different path). The fetch then 404s and every token is rejected. This module
 * resolves the real `jwks_uri` from the issuer's OpenID discovery document, with
 * the hardening the security review required:
 *   - the issuer must be https (a plaintext issuer lets a network attacker swap
 *     the JWKS and forge tokens), except an explicit loopback host for local dev;
 *   - the discovery fetch must not follow cross-origin redirects (fail closed);
 *   - the resolved `jwks_uri` must be https and on the SAME host as the issuer, so
 *     a tampered or misconfigured discovery document cannot point key fetching at
 *     an attacker-controlled host. Cross-host issuers (for example Google, which
 *     serves keys from googleapis.com) are intentionally not auto-trusted; they
 *     require the operator to explicitly set OIDC_JWKS_TRUSTED_HOSTS (#254).
 *
 * The pure helpers (assertSecureIssuer, resolveJwksUri) are unit-tested without a
 * network; discoverJwksUri wraps them around a single startup fetch and fails
 * closed on any problem.
 */

const logger = createModuleLogger('OIDC_DISCOVERY');

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Bound the startup discovery fetch so a hung IdP cannot hang startup forever. */
const DISCOVERY_TIMEOUT_MS = 10_000;

export function isLoopbackHost(host: string | undefined): boolean {
  return host ? LOOPBACK_HOSTS.has(host.toLowerCase()) : false;
}

/**
 * Parse and validate the issuer URL. Throws unless it is https, or an explicit
 * loopback host (local dev). Returns the parsed URL.
 */
export function assertSecureIssuer(issuer: string | undefined, allowInsecure = false): URL {
  if (!issuer) throw new Error('OIDC_ISSUER is not set');
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    throw new Error(`OIDC_ISSUER is not a valid URL: ${issuer}`);
  }
  // https is required unless the host is loopback (local dev) or the operator has
  // explicitly opted into a plaintext issuer on a trusted network (#244).
  if (url.protocol !== 'https:' && !isLoopbackHost(url.hostname) && !allowInsecure) {
    throw new Error(
      `OIDC_ISSUER must use https (got ${url.protocol}//${url.hostname}). A plaintext issuer ` +
        'lets a network attacker swap the JWKS and forge tokens. Use https, a loopback host for ' +
        'local dev, or set OIDC_ALLOW_INSECURE_ISSUER=true only on a trusted network.',
    );
  }
  // Reject embedded credentials (user:pass@host): URL.hostname strips them, so a
  // credentialed issuer could slip past the same-origin check and leak secrets to logs.
  if (url.username || url.password) {
    throw new Error('OIDC_ISSUER must not contain embedded credentials (user:pass@host)');
  }
  // A real issuer has no query or fragment; reject them so the discovery URL
  // built from the issuer cannot be malformed or misdirected.
  if (url.search || url.hash) {
    throw new Error('OIDC_ISSUER must not contain a query string or fragment');
  }
  return url;
}

/**
 * Pure: resolve and validate the `jwks_uri` from a parsed discovery document
 * against the issuer. Throws (fail closed) if it is missing, not https, carries
 * embedded credentials, or is not same-origin (scheme + host + port) with the
 * issuer -- unless the JWKS hostname is in `trustedHosts` (#254).
 */
export function resolveJwksUri(
  discoveryDoc: { jwks_uri?: unknown } | null | undefined,
  issuer: string | undefined,
  allowInsecure = false,
  trustedHosts: string[] = [],
): string {
  const issuerUrl = assertSecureIssuer(issuer, allowInsecure);
  if (!discoveryDoc || typeof discoveryDoc !== 'object') {
    throw new Error('OIDC discovery document is empty or not an object');
  }
  const jwksUri = (discoveryDoc as { jwks_uri?: unknown }).jwks_uri;
  if (typeof jwksUri !== 'string' || jwksUri.length === 0) {
    throw new Error('OIDC discovery document has no usable "jwks_uri"');
  }
  let jwks: URL;
  try {
    jwks = new URL(jwksUri);
  } catch {
    throw new Error(`OIDC "jwks_uri" is not a valid URL: ${jwksUri}`);
  }
  if (jwks.protocol !== 'https:' && !isLoopbackHost(jwks.hostname) && !allowInsecure) {
    throw new Error(`OIDC "jwks_uri" must use https (got ${jwks.protocol}); refusing to fetch keys over plaintext`);
  }
  if (jwks.username || jwks.password) {
    throw new Error('OIDC "jwks_uri" must not contain embedded credentials (user:pass@host)');
  }
  // Same ORIGIN (scheme + host + port), not just hostname: a different port on the
  // same host is a different service, so comparing origins keeps the guarantee the
  // security review asked for. Both are https here, so this is effectively host+port.
  if (jwks.origin.toLowerCase() !== issuerUrl.origin.toLowerCase()) {
    const jwksHostname = jwks.hostname.toLowerCase();
    if (!trustedHosts.includes(jwksHostname)) {
      throw new Error(
        `OIDC "jwks_uri" origin (${jwks.origin}) does not match the issuer origin (${issuerUrl.origin}); ` +
          'refusing a cross-origin key fetch. A cross-host issuer (e.g. Google) needs an explicit trusted-host allowlist (#254).',
      );
    }
    logger.info(
      `[OIDC] Cross-host JWKS fetch allowed for ${jwksUri} (host "${jwksHostname}" in OIDC_JWKS_TRUSTED_HOSTS)`,
    );
  }
  return jwks.toString();
}

/**
 * Fetch the issuer's OpenID discovery document and return a validated `jwks_uri`.
 * Fails closed on any problem (non-https issuer, redirect, non-200, bad JSON,
 * missing/invalid/cross-host jwks_uri). `fetchImpl` is injectable for testing.
 */
export async function discoverJwksUri(
  issuer: string | undefined,
  allowInsecure = false,
  trustedHosts: string[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  assertSecureIssuer(issuer, allowInsecure);
  const base = issuer!.endsWith('/') ? issuer!.slice(0, -1) : issuer!;
  const discoveryUrl = `${base}/.well-known/openid-configuration`;

  let res: Response;
  try {
    // redirect: 'error' fails the fetch on ANY redirect, so a 30x to another
    // origin can never silently redirect key discovery to an attacker host. The
    // timeout keeps a hung IdP from hanging startup forever (it fails closed).
    res = await fetchImpl(discoveryUrl, { redirect: 'error', signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) });
  } catch (err) {
    throw new Error(`OIDC discovery fetch failed for ${discoveryUrl}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`OIDC discovery fetch returned HTTP ${res.status} for ${discoveryUrl}`);
  }
  let doc: unknown;
  try {
    doc = await res.json();
  } catch {
    throw new Error(`OIDC discovery document at ${discoveryUrl} is not valid JSON`);
  }
  const jwksUri = resolveJwksUri(doc as { jwks_uri?: unknown }, issuer, allowInsecure, trustedHosts);
  logger.info('Resolved JWKS URI from OIDC discovery', { jwksUri });
  return jwksUri;
}
