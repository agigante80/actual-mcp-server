// src/auth/setup.ts
//
// Factory for the OIDC bearer auth pieces (CF-5: OIDC multi-user auth).
// Returns null when AUTH_PROVIDER !== 'oidc'; the existing static Bearer token
// auth (MCP_SSE_AUTHORIZATION) is then used unchanged.
//
// #634: the middleware and the metadata router are built in (src/auth/bearer.ts) since
// mcp-auth was removed; this factory keeps the shape httpServer.ts already used.

import type express from 'express';
import { bearerAuthMiddleware, resourceMetadataRouter } from './bearer.js';
import type { BearerAuthOptions, VerifyAccessToken } from './bearer.js';
import config from '../config.js';
import logger from '../logger.js';
import { validateOidcResource } from '../lib/oidc-resource.js';
import { parseScopeList, buildScopesSupported } from '../lib/oidc-scopes.js';

export interface OidcAuth {
  bearerAuth(verify: VerifyAccessToken, opts: Omit<BearerAuthOptions, 'issuers'>): express.RequestHandler;
  protectedResourceMetadataRouter(): express.Router;
}

let _instance: OidcAuth | null = null;

/**
 * Returns the bearer auth configured for this server's OIDC settings,
 * or null if AUTH_PROVIDER is not 'oidc'.
 *
 * The instance is a singleton, safe to call multiple times.
 *
 * @throws If AUTH_PROVIDER=oidc but OIDC_ISSUER or OIDC_RESOURCE are unset, or if
 *   OIDC_RESOURCE is not an absolute http(s) URL (#461: the RFC 9728 well-known route is
 *   derived from it, and a bare client id would otherwise fail with a bare TypeError).
 */
export function createMcpAuth(): OidcAuth | null {
  if (config.AUTH_PROVIDER !== 'oidc') {
    return null;
  }

  if (!config.OIDC_ISSUER) {
    throw new Error(
      '[OIDC] AUTH_PROVIDER=oidc requires OIDC_ISSUER to be set. ' +
      'Example: OIDC_ISSUER=https://auth.example.com/realms/myrealm'
    );
  }

  if (!config.OIDC_RESOURCE) {
    throw new Error(
      '[OIDC] AUTH_PROVIDER=oidc requires OIDC_RESOURCE to be set. ' +
      'Example: OIDC_RESOURCE=https://actual-mcp.example.com/http'
    );
  }

  // #461: validate the shape first. The parsed URL is used only for checks and for the
  // log line below (origin plus pathname, so an accepted query component never reaches
  // a log); the RAW string is what the router and middleware receive, because
  // url.href would append a trailing slash to the origin form and split the metadata
  // `resource`, the WWW-Authenticate value and the accepted audience into three strings.
  const resourceUrl = validateOidcResource(config.OIDC_RESOURCE);

  if (_instance) return _instance;

  const requiredScopes = parseScopeList(config.OIDC_SCOPES);
  const scopesSupported = buildScopesSupported(config.OIDC_SCOPES_SUPPORTED, config.OIDC_SCOPES);

  logger.info(`[OIDC] Configuring bearer auth, issuer: ${config.OIDC_ISSUER}`);
  logger.info(`[OIDC] Resource identifier: ${resourceUrl.origin}${resourceUrl.pathname}`);
  logger.info(`[OIDC] Scopes required: ${requiredScopes.length ? requiredScopes.join(', ') : '(none)'}`);
  logger.info(`[OIDC] Scopes advertised: ${scopesSupported.length ? scopesSupported.join(', ') : '(none)'}`);

  const issuer = config.OIDC_ISSUER;
  const resource = config.OIDC_RESOURCE;
  _instance = {
    bearerAuth: (verify, opts) => bearerAuthMiddleware(verify, { ...opts, issuers: [issuer] }),
    protectedResourceMetadataRouter: () => resourceMetadataRouter({ resource, issuer, scopesSupported }),
  };

  return _instance;
}
