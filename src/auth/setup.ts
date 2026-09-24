// src/auth/setup.ts
//
// Factory for the mcp-auth MCPAuth instance (CF-5: OIDC multi-user auth).
// Returns null when AUTH_PROVIDER !== 'oidc'; the existing static Bearer token
// auth (MCP_SSE_AUTHORIZATION) is then used unchanged.
//
// Uses the mcp-auth "discovery config" approach: OIDC metadata is fetched
// on-demand on the first incoming request, so no top-level async needed here.

import { MCPAuth } from 'mcp-auth';
import config from '../config.js';
import logger from '../logger.js';
import { validateOidcResource } from '../lib/oidc-resource.js';
import { parseScopeList, buildScopesSupported } from '../lib/oidc-scopes.js';

let _instance: MCPAuth | null = null;

/**
 * Returns an MCPAuth instance configured for this server's OIDC settings,
 * or null if AUTH_PROVIDER is not 'oidc'.
 *
 * The instance is a singleton, safe to call multiple times.
 *
 * @throws If AUTH_PROVIDER=oidc but OIDC_ISSUER or OIDC_RESOURCE are unset, or if
 *   OIDC_RESOURCE is not an absolute http(s) URL (#461: mcp-auth derives the RFC 9728
 *   well-known route from it and would otherwise throw its own TypeError at startup).
 */
export function createMcpAuth(): MCPAuth | null {
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

  // #461: validate the shape BEFORE mcp-auth sees it. The parsed URL is used only for
  // checks and for the log line below (origin plus pathname, so an accepted query
  // component never reaches a log); the RAW string is what MCPAuth receives, because
  // url.href would append a trailing slash to the origin form and split the metadata
  // `resource`, the WWW-Authenticate value and the accepted audience into three strings.
  const resourceUrl = validateOidcResource(config.OIDC_RESOURCE);

  if (_instance) return _instance;

  const requiredScopes = parseScopeList(config.OIDC_SCOPES);
  const scopesSupported = buildScopesSupported(config.OIDC_SCOPES_SUPPORTED, config.OIDC_SCOPES);

  logger.info(`[OIDC] Configuring mcp-auth, issuer: ${config.OIDC_ISSUER}`);
  logger.info(`[OIDC] Resource identifier: ${resourceUrl.origin}${resourceUrl.pathname}`);
  logger.info(`[OIDC] Scopes required: ${requiredScopes.length ? requiredScopes.join(', ') : '(none)'}`);
  logger.info(`[OIDC] Scopes advertised: ${scopesSupported.length ? scopesSupported.join(', ') : '(none)'}`);

  _instance = new MCPAuth({
    protectedResources: [
      {
        metadata: {
          resource: config.OIDC_RESOURCE,
          // Discovery config: mcp-auth fetches OIDC metadata lazily on first request.
          authorizationServers: [{ issuer: config.OIDC_ISSUER, type: 'oidc' }],
          scopesSupported,
        },
      },
    ],
  });

  return _instance;
}
