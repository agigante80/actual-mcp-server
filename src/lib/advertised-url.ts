import { isIPv6 } from 'node:net';

/**
 * #777: the address /mcp-info advertises.
 *
 * Unless the operator named a public host (MCP_BRIDGE_PUBLIC_HOST), the startup URL carries the
 * detected local address and the internal listen port, which behind a published port is the
 * container's internal address: unreachable for the caller and a disclosure of the network layout.
 * So the host and port come from the Host header of the request instead, which is the address the
 * caller used by definition.
 *
 * The Host header is attacker controlled. It is matched against a strict pattern (a host name,
 * an IPv4 address or a bracketed IPv6 literal, with an optional port) and the result is built
 * only from the matched text plus a scheme and path taken from our own startup URL. Anything
 * else (userinfo, path, query, whitespace, control characters, an oversized value, a missing
 * header) yields undefined and the caller leaves the field out: an invalid value is never
 * echoed and the internal address is never the fallback. Forwarded headers are not read: there
 * is no trust proxy setting in this server.
 */

const HOST_PATTERN = /^(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:[0-9]{1,5})?$/;
const MAX_HOST_HEADER_LENGTH = 261;

export interface AdvertisedUrlOptions {
  /** MCP_BRIDGE_PUBLIC_HOST is set (trimmed, non-empty). */
  publicHostConfigured: boolean;
  /** The advertisedUrl startHttpServer received, if any. */
  startupUrl: string | undefined;
  /** req.headers.host, unvalidated. */
  hostHeader: string | undefined;
  fallbackScheme: 'http' | 'https';
  httpPath: string;
  /** The value used when a public host is configured and startupUrl is undefined. */
  configuredFallbackUrl: string;
}

/** The validated, lowercased host[:port], or undefined. */
export function validatedHost(hostHeader: string | undefined): string | undefined {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0 || hostHeader.length > MAX_HOST_HEADER_LENGTH) return undefined;
  const host = hostHeader.toLowerCase();
  if (!HOST_PATTERN.test(host)) return undefined;
  // A bracketed literal must be a real IPv6 address, not merely brackets around allowed characters.
  if (host.startsWith('[') && !isIPv6(host.slice(1, host.indexOf(']')))) return undefined;
  const colon = host.lastIndexOf(':');
  if (colon > host.lastIndexOf(']')) {
    const port = Number(host.slice(colon + 1));
    if (!(port >= 1 && port <= 65535)) return undefined;
  }
  return host;
}

export function advertisedUrlFor(opts: AdvertisedUrlOptions): string | undefined {
  if (opts.publicHostConfigured) return opts.startupUrl || opts.configuredFallbackUrl;
  const host = validatedHost(opts.hostHeader);
  if (!host) return undefined;
  let scheme: string = opts.fallbackScheme;
  let path = opts.httpPath;
  if (opts.startupUrl) {
    try {
      const u = new URL(opts.startupUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') scheme = u.protocol.slice(0, -1);
      path = u.pathname;
    } catch { /* keep the fallbacks */ }
  }
  return `${scheme}://${host}${path}`;
}
