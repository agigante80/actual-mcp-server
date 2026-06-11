import { z } from 'zod';

export const configSchema = z.object({
  ACTUAL_SERVER_URL: z.string().url(),
  ACTUAL_PASSWORD: z.string().default(''),
  ACTUAL_BUDGET_SYNC_ID: z.string().min(1),
  // Optional per-budget encryption password (leave unset for unencrypted budgets)
  ACTUAL_BUDGET_PASSWORD: z.string().optional(),
  // Escape hatch for #161: allow an http:// upstream even when an E2E encryption
  // password is set (e.g. an isolated Docker network where the hop is trusted).
  // Off by default so a plaintext upstream + encryption password is refused.
  ALLOW_INSECURE_UPSTREAM: z.string().optional().transform(val => val === 'true'),
  MCP_BRIDGE_DATA_DIR: z.string().default('./actual-data'),
  MCP_BRIDGE_PORT: z.string().default('3600'),
  MCP_TRANSPORT_MODE: z.enum(['--http']).default('--http'),
  MCP_SSE_AUTHORIZATION: z.string().optional(),
  MCP_ENABLE_HTTPS: z.string().optional().transform(val => val === 'true'),
  MCP_HTTPS_CERT: z.string().optional(),
  MCP_HTTPS_KEY: z.string().optional(),
  // Explicit cap on incoming JSON request bodies (#168). Passed to
  // express.json({ limit }). Express accepts a byte string like '512kb' or '2mb'.
  // Default 512kb is generous headroom over the largest legitimate batch payload
  // while bounding the memory-exhaustion surface. Raise it for bulk-import jobs.
  MCP_HTTP_BODY_LIMIT: z.string().default('512kb'),
  MAX_CONCURRENT_SESSIONS: z.string().default('15').transform(val => parseInt(val, 10)),

  // --- OIDC / mcp-auth (CF-5) ---
  // Set AUTH_PROVIDER=oidc to enable JWT validation via mcp-auth.
  // When 'none' (default), the legacy MCP_SSE_AUTHORIZATION static Bearer token is used.
  AUTH_PROVIDER: z.enum(['none', 'oidc']).default('none'),
  // OIDC issuer URL (e.g. https://auth.example.com/realms/myrealm). Required when AUTH_PROVIDER=oidc.
  OIDC_ISSUER: z.string().optional(),
  // This server's resource identifier URL (e.g. https://actual-mcp.example.com). Required when AUTH_PROVIDER=oidc.
  OIDC_RESOURCE: z.string().optional(),
  // Comma-separated required scopes (e.g. "read,write"). Optional.
  OIDC_SCOPES: z.string().optional(),
  // JSON map of principal → budget sync-ID list for per-user budget ACL.
  // Keys: email, sub, or "group:<name>". Values: array of sync IDs or ["*"] for all.
  // Example: {"alice@example.com":["budget-1"],"group:admin":["*"]}
  // Leave unset to allow all authenticated users to access all budgets.
  AUTH_BUDGET_ACL: z.string().optional(),
})
  // When native TLS is enabled, both the cert and key paths must be provided.
  // MCP_ENABLE_HTTPS is transformed to a boolean above, so this object-level
  // refine sees the parsed value (a field-level refine would see the raw
  // string). Without this, httpServer's readFileSync(config.MCP_HTTPS_CERT!)
  // throws an opaque error at startup when a path is missing (#169).
  .refine(
    (cfg) => !cfg.MCP_ENABLE_HTTPS || (!!cfg.MCP_HTTPS_CERT && !!cfg.MCP_HTTPS_KEY),
    { message: 'MCP_ENABLE_HTTPS=true requires both MCP_HTTPS_CERT and MCP_HTTPS_KEY to be set.' },
  )
  // Refuse to send the E2E budget encryption password over a plaintext upstream
  // (#161, CWE-319). If ACTUAL_BUDGET_PASSWORD is set, the default upstream must
  // be https:// unless ALLOW_INSECURE_UPSTREAM=true is set explicitly.
  .refine(
    (cfg) => !cfg.ACTUAL_BUDGET_PASSWORD || cfg.ALLOW_INSECURE_UPSTREAM || !/^http:\/\//i.test(cfg.ACTUAL_SERVER_URL),
    { message: 'ACTUAL_BUDGET_PASSWORD (E2E encryption) must not be sent over an http:// upstream. Use https:// for ACTUAL_SERVER_URL, or set ALLOW_INSECURE_UPSTREAM=true to override (e.g. a trusted isolated network).' },
  );

export type Config = z.infer<typeof configSchema>;

function getConfig(): Config {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map(i => `  • ${i.path.join('.')}`).join('\n');
    console.error(
      `\n❌ Missing or invalid environment variables:\n${missing}\n\n` +
      `Set them in a .env file in the current directory, or export them before running.\n` +
      `Required: ACTUAL_SERVER_URL, ACTUAL_PASSWORD, ACTUAL_BUDGET_SYNC_ID\n` +
      `See: https://github.com/agigante80/actual-mcp-server\n`
    );
    process.exit(1);
  }
  return result.data;
}

const config = getConfig();
export default config;
