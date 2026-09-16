// src/auth/setup.ts
//
// Factory for the mcp-auth MCPAuth instance (CF-5: OIDC multi-user auth).
// Returns null when AUTH_PROVIDER !== 'oidc' — existing static Bearer token
// auth (MCP_SSE_AUTHORIZATION) is then used unchanged.
//
// Uses the mcp-auth "discovery config" approach: OIDC metadata is fetched
// on-demand on the first incoming request, so no top-level async needed here.

import { MCPAuth } from 'mcp-auth';
import config from '../config.js';
import logger from '../logger.js';

let _instance: MCPAuth | null = null;

/**
 * Returns an MCPAuth instance configured for this server's OIDC settings,
 * or null if AUTH_PROVIDER is not 'oidc'.
 *
 * The instance is a singleton — safe to call multiple times.
 *
 * @throws If AUTH_PROVIDER=oidc but OIDC_ISSUER or OIDC_RESOURCE are unset.
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
      'Example: OIDC_RESOURCE=https://actual-mcp.example.com'
    );
  }

  if (_instance) return _instance;

  const scopesSupported = config.OIDC_SCOPES
    ? config.OIDC_SCOPES.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  logger.info(`[OIDC] Configuring mcp-auth — issuer: ${config.OIDC_ISSUER}`);
  logger.info(`[OIDC] Resource identifier: ${config.OIDC_RESOURCE}`);
  logger.info(`[OIDC] Scopes required: ${scopesSupported.length ? scopesSupported.join(', ') : '(none)'}`);

  const resourceList = [config.OIDC_RESOURCE];
  const trimmed = config.OIDC_RESOURCE.replace(/\/+$/, '');
  if (!trimmed.endsWith('/http')) {
    resourceList.push(`${trimmed}/http`);
  } else {
    const baseWithoutHttp = trimmed.slice(0, -5);
    if (baseWithoutHttp) {
      resourceList.push(baseWithoutHttp);
    }
  }

  const protectedResources = resourceList.map((resource) => ({
    metadata: {
      resource,
      // Discovery config: mcp-auth fetches OIDC metadata lazily on first request.
      authorizationServers: [{ issuer: config.OIDC_ISSUER!, type: 'oidc' as const }],
      scopesSupported,
    },
  }));

  _instance = new MCPAuth({
    protectedResources,
  });

  return _instance;
}
