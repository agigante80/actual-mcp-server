// src/lib/oidc-resource.ts
//
// #461: the OIDC resource identifier (OIDC_RESOURCE) validated and advised on, as PURE
// functions. This module imports no config and no logger, so every rule here is
// unit-testable without a server boot; the composition root (`httpServer.ts`) logs what
// `oidcResourceStartupWarnings` returns and does nothing else with it.
//
// WHY THE IDENTIFIER MUST BE A URL. `mcp-auth` derives the RFC 9728 well-known route
// from `new URL(resource).pathname` (a resource with a path such as `https://host/http`
// is served at `/.well-known/oauth-protected-resource/http`, RFC 9728 section 3.1) and
// echoes the configured string verbatim as the document's `resource` value (section 3.3
// requires it to be identical to what the client inserted the suffix into). A bare
// client id therefore throws inside the library at startup. Four of our own recipes
// recommended exactly that value; this validator turns the library's TypeError into a
// message that names the variable and the fix.
//
// WHY http: IS ACCEPTED WITH A WARNING, NOT REFUSED. Unlike OIDC_ISSUER (#244), where a
// plaintext issuer lets a network attacker swap the JWKS, the resource identifier is a
// label compared byte for byte against `aud` and published in metadata; the token in
// transit is protected by MCP_ENABLE_HTTPS or the reverse proxy. Refusing would break
// working LAN deployments to enforce nothing.
//
// WHY THE RAW STRING STILL REACHES mcp-auth. `url.href` appends a trailing slash to the
// origin form (`https://host` becomes `https://host/`), which would make the metadata
// `resource`, the `WWW-Authenticate` `resource_metadata` and the accepted-audience set
// three different strings. The validator returns the URL for checks and for log lines;
// callers keep passing the raw value on.

import { isLoopbackHost } from './oidc-discovery.js';

const VAR = 'OIDC_RESOURCE';

/** origin plus pathname: what every message prints, so a query or credentials never reach a log. */
function displayForm(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

/**
 * Validate OIDC_RESOURCE as an absolute http(s) URL with no embedded credentials, no
 * fragment and no surrounding whitespace. Throws a message that names the variable,
 * the requirement and the recommended form; never echoes a credentialed value.
 */
export function validateOidcResource(raw: string | undefined): URL {
  if (!raw) {
    throw new Error(`[OIDC] ${VAR} is not set. It must be the absolute URL of this MCP server, for example https://actual-mcp.example.com/http`);
  }
  if (raw !== raw.trim()) {
    throw new Error(
      `[OIDC] ${VAR} has surrounding whitespace. The value is published verbatim as the resource identifier, ` +
        'so it must be the absolute URL with no padding, for example https://actual-mcp.example.com/http',
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `[OIDC] ${VAR} must be an absolute URL, the canonical URL of this MCP server ` +
        '(for example https://actual-mcp.example.com/http), not a client id. ' +
        'The RFC 9728 metadata route and the expected token audience are both derived from it.',
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`[OIDC] ${VAR} must be an absolute http(s) URL (got scheme ${url.protocol}).`);
  }
  // URL.hostname strips credentials, so a credentialed value would pass every later check
  // and could leak into a log line. Do not echo the value.
  if (url.username || url.password) {
    throw new Error(`[OIDC] ${VAR} must not contain embedded credentials (user:pass@host).`);
  }
  // RFC 9728 section 2 and RFC 8707 section 2: no fragment.
  if (url.hash) {
    throw new Error(`[OIDC] ${VAR} must not contain a fragment (${displayForm(url)}#...).`);
  }
  return url;
}

/**
 * Advisories about an ACCEPTED identifier: plaintext scheme on a non-loopback host, and a
 * query component (RFC 8707 section 2 SHOULD NOT; mcp-auth publishes it verbatim and it
 * becomes part of the expected `aud`).
 */
export function resourceSchemeAdvisories(url: URL): string[] {
  const out: string[] = [];
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    out.push(
      `[OIDC] ${VAR} uses plaintext http on a non-loopback host (${displayForm(url)}). ` +
        'The identifier itself is only a label, but the token that carries it must travel over TLS: ' +
        'terminate TLS at a reverse proxy or set MCP_ENABLE_HTTPS=true.',
    );
  }
  if (url.search) {
    out.push(
      `[OIDC] ${VAR} carries a query component (${displayForm(url)}?...). It is published verbatim in the ` +
        'protected-resource metadata and forms part of the expected aud; never place a secret in it, and ' +
        'prefer the canonical form without a query.',
    );
  }
  return out;
}

/**
 * The path clients reach this server on, from the advertised URL when it parses, else
 * the listen path. `advertisedUrl` is assembled from raw env in index.ts and has never
 * been parsed before this module: a MCP_BRIDGE_HTTP_PATH without a leading slash yields
 * `http://host:3600mcp`, which `new URL` rejects, and that must stay an advisory rather
 * than becoming the first thing that refuses to start.
 */
export function advertisedPathFrom(
  advertisedUrl: string | undefined,
  httpPath: string,
): { path: string; warning: string | null } {
  if (advertisedUrl === undefined) return { path: httpPath, warning: null };
  try {
    return { path: new URL(advertisedUrl).pathname, warning: null };
  } catch {
    return {
      path: httpPath,
      warning:
        '[OIDC] The advertised MCP URL does not parse as a URL, so the resource-identifier check falls back to ' +
        `the listen path ${httpPath}. Check MCP_BRIDGE_HTTP_PATH (it needs a leading slash) and MCP_BRIDGE_PUBLIC_HOST.`,
    };
  }
}

/**
 * Null when the identifier's path equals the advertised MCP path (the form under which
 * mcp-auth serves the path-specific RFC 9728 document a strict client looks for);
 * otherwise one line that names the variable and recommends `<origin><advertisedPath>`.
 */
export function resourceMetadataWarning(opts: { resource: string; advertisedPath: string }): string | null {
  const url = new URL(opts.resource);
  const stripped = (p: string) => (p.endsWith('/') && p.length > 1 ? p.slice(0, -1) : p);
  // The canonical form has no trailing slash (MCP authorization spec, Canonical Server
  // URI), so the recommendation never carries one even when MCP_BRIDGE_HTTP_PATH does.
  const canonicalPath = stripped(opts.advertisedPath);
  if (url.pathname === opts.advertisedPath || url.pathname === canonicalPath) return null;
  const recommended = `${url.origin}${canonicalPath}`;
  const onlyTrailingSlash = stripped(url.pathname) === canonicalPath;
  // Express serves the metadata route with and without the slash, so the slash form is
  // not a discovery 404; the hazard is the audience: a client that canonicalises the
  // resource mints aud=${recommended}, which the closed allowlist then rejects.
  const detail = onlyTrailingSlash
    ? `The only difference is the trailing slash. A client that canonicalises the resource will request a token for ${recommended}, which is not in the accepted audience set, so use the form without the slash.`
    : (url.pathname === '/'
        ? `Protected-resource metadata is served at the root /.well-known/oauth-protected-resource only; a client that looks for the path-specific document under ${canonicalPath} and does not fall back to the root will fail discovery. `
        : `Protected-resource metadata is served at /.well-known/oauth-protected-resource${url.pathname} and the root /.well-known/oauth-protected-resource; a client that looks for the path-specific document under ${canonicalPath} will fail discovery. `) +
      `Switching changes the expected aud and stops serving the current document, so during the switch add OIDC_ACCEPTED_AUDIENCES=${url.origin}${url.pathname === '/' ? '' : url.pathname} to keep tokens minted for the old value valid.`;
  return (
    `[OIDC] ${VAR} is ${displayForm(url)} but the MCP endpoint is advertised at ${opts.advertisedPath}. ${detail} ` +
    `Recommended: ${VAR}=${recommended}`
  );
}

/**
 * Everything the composition root should warn about for an ACCEPTED identifier, in one
 * call. Throws only what `validateOidcResource` throws.
 */
export function oidcResourceStartupWarnings(opts: {
  resource: string | undefined;
  advertisedUrl: string | undefined;
  httpPath: string;
}): string[] {
  const url = validateOidcResource(opts.resource);
  const advertised = advertisedPathFrom(opts.advertisedUrl, opts.httpPath);
  const out: string[] = [];
  if (advertised.warning) out.push(advertised.warning);
  const pathWarning = resourceMetadataWarning({ resource: opts.resource as string, advertisedPath: advertised.path });
  if (pathWarning) out.push(pathWarning);
  out.push(...resourceSchemeAdvisories(url));
  return out;
}
