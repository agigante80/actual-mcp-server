import { createModuleLogger } from './loggerFactory.js';

/**
 * OIDC JWKS discovery (#244).
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
 *     serves keys from googleapis.com) are never auto-trusted; the operator can
 *     allowlist specific cross-origin JWKS hosts via OIDC_JWKS_TRUSTED_HOSTS
 *     (#254, opt-in, exact host:port match, https required unconditionally).
 *
 * The helpers (assertSecureIssuer, buildTrustedJwksHosts, resolveJwksUri) are
 * network-free and unit-tested directly (resolveJwksUri logs on the allowlist
 * accept path, otherwise side-effect free); discoverJwksUri wraps them around a
 * single startup fetch and fails closed on any problem.
 */

const logger = createModuleLogger('OIDC_DISCOVERY');

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Bound the startup discovery fetch so a hung IdP cannot hang startup forever. */
const DISCOVERY_TIMEOUT_MS = 10_000;

export function isLoopbackHost(host: string | undefined): boolean {
  return host ? LOOPBACK_HOSTS.has(host.toLowerCase()) : false;
}

/**
 * Parse OIDC_JWKS_TRUSTED_HOSTS (comma-separated `host` or `host:port`
 * entries) into a normalized, deduplicated allowlist (#254). Mirrors the #245
 * buildAcceptedAudiences pattern: config stays a raw string, parsing happens
 * here, and the result is threaded as a parameter. Entries are trimmed,
 * lowercased, and empties dropped, then validated by a URL round-trip: an
 * entry must equal `new URL('https://' + entry).host`, which rejects in one
 * rule everything that could never match a real jwks_uri host: schemes,
 * paths, credentials, wildcards, whitespace, empty or non-numeric ports,
 * default-port `:443` suffixes (URL.host elides them, so such an entry would
 * be silently inert), raw-unicode IDN (URL.host is punycode), and unbracketed
 * IPv6. THROWS on the first invalid entry so a misconfigured allowlist fails
 * fast at startup instead of silently failing closed at the first
 * cross-origin issuer.
 */
export function buildTrustedJwksHosts(configured: string | undefined): string[] {
  if (!configured) return [];
  const entries = configured
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  for (const entry of entries) {
    let canonical: string | undefined;
    try {
      canonical = new URL(`https://${entry}`).host;
    } catch {
      canonical = undefined;
    }
    // WHATWG URL does not forbid "*" in a hostname, so the round-trip alone
    // would let a wildcard through; there is deliberately no wildcard matching.
    if (entry.includes('*') || canonical !== entry) {
      throw new Error(
        `OIDC_JWKS_TRUSTED_HOSTS entry is invalid: "${entry}". Entries must be canonical URL ` +
          'hosts: a bare lowercase hostname, optionally with a NON-default port (host:port; ' +
          '":443" is elided by URL parsing and would never match), no scheme, path, ' +
          'credentials, or wildcards; IDN as punycode; IPv6 in brackets.',
      );
    }
  }
  return Array.from(new Set(entries));
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
 * Network-free: resolve and validate the `jwks_uri` from a parsed discovery
 * document against the issuer. Throws (fail closed) if it is missing, not
 * https, carries embedded credentials, or is not same-origin (scheme + host +
 * port) with the issuer, UNLESS the jwks host is explicitly listed in
 * `trustedHosts` (#254): an allowlisted cross-origin jwks_uri is accepted,
 * must still be https (no OIDC_ALLOW_INSECURE_ISSUER or loopback exemption on
 * the cross-origin path), and the acceptance is audit-logged (the one side
 * effect of this function).
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
    // #254: opt-in escape hatch for legitimately cross-host IdPs (Google serves
    // JWKS from www.googleapis.com). Matching is on URL.host (hostname PLUS any
    // non-default port), exact and lowercased: a bare-host entry does not trust
    // odd ports on that host, preserving this file's origin-level strictness.
    // Empty allowlist (the default) makes this branch behave exactly as before.
    const jwksHost = jwks.host.toLowerCase();
    if (!trustedHosts.includes(jwksHost)) {
      throw new Error(
        `OIDC "jwks_uri" origin (${jwks.origin}) does not match the issuer origin (${issuerUrl.origin}); ` +
          `refusing a cross-origin key fetch. Checked host "${jwksHost}" against ` +
          `OIDC_JWKS_TRUSTED_HOSTS [${trustedHosts.join(', ')}]; matching is exact on host:port ` +
          '(#254). A cross-host issuer (e.g. Google) needs its JWKS host explicitly allowlisted.',
      );
    }
    // An allowlisted CROSS-ORIGIN fetch must be https, with no exemption: not
    // for OIDC_ALLOW_INSECURE_ISSUER (the #244 opt-out covers a same-origin LAN
    // issuer, never third-party key hosts) and not for loopback (a shared-host
    // process could bind the port). Without this, combining the two opt-ins
    // would newly permit a plaintext cross-origin key fetch that pre-#254 code
    // always refused.
    if (jwks.protocol !== 'https:') {
      throw new Error(
        `OIDC cross-origin "jwks_uri" allowed by OIDC_JWKS_TRUSTED_HOSTS must use https (got ${jwks.protocol}); ` +
          'the OIDC_ALLOW_INSECURE_ISSUER opt-out never extends to cross-origin key fetches (#254).',
      );
    }
    // Audit trail: a normally-rejected cross-origin trust was relaxed by operator config.
    logger.info('cross-origin JWKS host allowed by OIDC_JWKS_TRUSTED_HOSTS', {
      issuerOrigin: issuerUrl.origin,
      jwksHost,
      jwksUri: jwks.toString(),
    });
  }
  return jwks.toString();
}

/**
 * Fetch the issuer's OpenID discovery document ONCE and return both the raw
 * document and its validated `jwks_uri` (#285). Fails closed on any problem
 * (non-https issuer, redirect, non-200, bad JSON, missing/invalid/cross-host
 * jwks_uri). `fetchImpl` is injectable for testing.
 *
 * The returned `metadata` is the IdP's own public discovery document. Its
 * intended second use (beyond resolving the JWKS URI) is to be re-served
 * verbatim at `/.well-known/oauth-authorization-server` as RFC 8414 Authorization
 * Server Metadata, so a client that resolves that well-known path against this
 * resource server (as mcp-remote and Claude.ai do) can find the IdP's
 * `token_endpoint`. Because this fetch happens ONCE at startup and the document
 * is served from memory, no request ever triggers an outbound fetch (no
 * request-path SSRF surface).
 */
export async function discoverOidcMetadata(
  issuer: string | undefined,
  allowInsecure = false,
  trustedHosts: string[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<{ jwksUri: string; metadata: Record<string, unknown> }> {
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
  // resolveJwksUri validates that `doc` is an object AND resolves/validates the
  // jwks_uri (https, same-origin or explicitly allowlisted). It throws (fail
  // closed) on any problem, so reaching past it guarantees a usable object with a
  // trusted jwks_uri before the document is exposed.
  const jwksUri = resolveJwksUri(doc as { jwks_uri?: unknown }, issuer, allowInsecure, trustedHosts);
  logger.info('Resolved JWKS URI from OIDC discovery', { jwksUri });
  return { jwksUri, metadata: doc as Record<string, unknown> };
}

/**
 * Back-compat convenience: resolve only the validated `jwks_uri`. Delegates to
 * discoverOidcMetadata so the single hardened fetch and every fail-closed check
 * are shared. Retained for callers (and their tests) that only need the key set.
 */
export async function discoverJwksUri(
  issuer: string | undefined,
  allowInsecure = false,
  trustedHosts: string[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const { jwksUri } = await discoverOidcMetadata(issuer, allowInsecure, trustedHosts, fetchImpl);
  return jwksUri;
}
