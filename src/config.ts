import { z } from 'zod';
import { parseIdentityMap } from './auth/identity-map.js';

export const configSchema = z.object({
  ACTUAL_SERVER_URL: z.string().url(),
  ACTUAL_PASSWORD: z.string().default(''),
  ACTUAL_BUDGET_SYNC_ID: z.string().min(1),
  // Optional per-budget encryption password (leave unset for unencrypted budgets)
  ACTUAL_BUDGET_PASSWORD: z.string().optional(),
  // #270: bound every upstream Actual API operation (api.init, downloadBudget,
  // sync, and each tool operation body) so a stalled call cannot hold the
  // process-global api mutex forever and hang all subsequent tool calls. On
  // timeout the operation rejects with a clear error, the mutex releases, and
  // later calls proceed. Default 30000ms (30s): generous for a healthy
  // init+download on a large budget, short enough that a stalled upstream
  // recovers in seconds instead of wedging the session. Set to 0 to disable the
  // bound (not recommended). A non-numeric or negative value falls back to the
  // default. `0` disables the bound. Any other positive value is clamped to the
  // range [250ms, 2147483647ms]:
  //   - Floor 250ms: a smaller positive value would time out real operations
  //     almost immediately (a self-inflicted DoS footgun, e.g. a typo'd `25`).
  //     Use `0` to disable deliberately rather than a tiny value.
  //   - Ceiling 2147483647ms (~24.8 days, the 32-bit setTimeout max): a larger
  //     value overflows setTimeout and silently clamps to 1ms, timing out
  //     everything.
  ACTUAL_OP_TIMEOUT_MS: z.string().default('30000').transform(val => {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n < 0) return 30000;
    if (n === 0) return 0;
    return Math.min(Math.max(n, 250), 2147483647);
  }),

  /**
   * #407: a separate, larger bound for a budget IMPORT.
   *
   * An import is not a stalled operation, it is a legitimately long one: a large YNAB or zip
   * import runs for minutes. #394 made it a TRACKED load, so while it is in flight every other
   * session's lock acquisition waits for it and then fails at ACTUAL_OP_TIMEOUT_MS. Bounding a
   * five-minute import at the 30 second operation default therefore turned one tenant's import
   * into a process-wide stall, with every other session failing repeatedly for the duration.
   *
   * Same parse-and-clamp shape as ACTUAL_OP_TIMEOUT_MS, and the same escape hatch: 0 disables the
   * bound, which for an import means it can hold the process-global api mutex indefinitely (the
   * #393 P0 shape), so it is for diagnosis rather than production.
   *
   * The clamp floor is 250ms, the same as the operation timeout. It is deliberately NOT raised to
   * the operation timeout's configured VALUE: an earlier comment here claimed an import bound below
   * the general one was prevented, and it was not, so the claim is removed rather than left to
   * mislead. A smaller import bound is unusual but coherent (abandon imports sooner than ordinary
   * reads), and enforcing an ordering between two independently configured knobs at parse time
   * would need one to be parsed before the other.
   */
  ACTUAL_IMPORT_TIMEOUT_MS: z.string().default('600000').transform(val => {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n < 0) return 600000;
    if (n === 0) return 0;
    return Math.min(Math.max(n, 250), 2147483647);
  }),
  // Escape hatch for #161: allow an http:// upstream even when an E2E encryption
  // password is set (e.g. an isolated Docker network where the hop is trusted).
  // Off by default so a plaintext upstream + encryption password is refused.
  ALLOW_INSECURE_UPSTREAM: z.string().optional().transform(val => val === 'true'),
  MCP_BRIDGE_DATA_DIR: z.string().default('./actual-data'),
  // #332: where actual_budgets_export writes budget zips. A budget export is
  // megabytes of binary, so the tool returns a PATH plus metadata rather than
  // base64 in the tool result: inlining it would flood the model's context and
  // can exceed transport payload limits.
  //
  // Empty means "derive as <MCP_BRIDGE_DATA_DIR>/exports", resolved at call time
  // rather than baked in here. A literal default like './actual-data/exports'
  // would be resolved against the process CWD, which in the container is /app:
  // that path is root-owned and the runtime drops to the unprivileged `app` user,
  // so the very first export would fail with EACCES. The data dir is the one
  // location guaranteed to be both writable and persisted (Dockerfile chowns it
  // and it is a named volume), so exports belong under it.
  ACTUAL_EXPORT_DIR: z.string().default(''),
  MCP_BRIDGE_PORT: z.string().default('3600'),
  MCP_TRANSPORT_MODE: z.enum(['--http']).default('--http'),
  MCP_SSE_AUTHORIZATION: z.string().optional(),
  // #242: explicit opt-out for the required-by-default HTTP auth gate. When auth
  // is unconfigured AND the bind is non-loopback, the server refuses to start
  // unless this is the exact string 'true'. Strict parse (only 'true' enables)
  // so a typo like 'yes'/'1' cannot silently leave the server open.
  MCP_ALLOW_UNAUTHENTICATED: z.string().optional().transform(val => val === 'true'),
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
  // #244: escape hatch for a plaintext (http) OIDC issuer on a trusted network
  // (e.g. a LAN Casdoor for local testing). Off by default: an http issuer is
  // refused because a network attacker could swap the JWKS and forge tokens.
  // Set to 'true' ONLY when the issuer hop is genuinely trusted. Mirrors
  // ALLOW_INSECURE_UPSTREAM (#161). Loopback issuers never need this.
  OIDC_ALLOW_INSECURE_ISSUER: z.string().optional().transform(val => val === 'true'),
  // This server's resource identifier URL (e.g. https://actual-mcp.example.com). Required when AUTH_PROVIDER=oidc.
  OIDC_RESOURCE: z.string().optional(),
  // #245: extra accepted JWT audiences beyond OIDC_RESOURCE, comma-separated.
  // For IdPs that put the client-id (not the resource URI) in `aud`, e.g. Authentik.
  // Strict closed allowlist: the accepted set is OIDC_RESOURCE plus these; never a
  // wildcard. Default empty, so single-audience deployments are unchanged.
  OIDC_ACCEPTED_AUDIENCES: z.string().optional(),
  // #254: opt-in allowlist of cross-origin JWKS hosts, comma-separated `host` or
  // `host:port` entries (e.g. "www.googleapis.com" for a Google issuer). Raw string
  // here; parsed fail-fast by buildTrustedJwksHosts (oidc-discovery.ts) at the
  // composition root, per the #245 pattern. Default empty: same-origin only.
  OIDC_JWKS_TRUSTED_HOSTS: z.string().optional(),
  // Comma-separated required scopes (e.g. "read,write"). Optional.
  OIDC_SCOPES: z.string().optional(),
  // JSON map of principal → budget sync-ID list for per-user budget ACL.
  // Keys: email, sub, or "group:<name>". Values: array of sync IDs or ["*"] for all.
  // Example: {"alice@example.com":["budget-1"],"group:admin":["*"]}
  // Leave unset to allow all authenticated users to access all budgets.
  AUTH_BUDGET_ACL: z.string().optional(),
  // #338: where the budget ACL comes from.
  //   'static' (default) = AUTH_BUDGET_ACL above, exactly as before.
  //   'actual'           = derived from the Actual server's own per-file access
  //                        list (`usersWithAccess` on getBudgets()).
  // Opt-in on purpose. Two reasons: it moves the authorization source from local
  // reviewable config to data the UPSTREAM server returns at runtime, and it only
  // functions when that server runs in multi-user (OpenID) mode. Defaulting to
  // 'static' means no existing deployment changes posture on upgrade.
  AUTH_BUDGET_ACL_SOURCE: z.enum(['static', 'actual']).default('static'),
  // #338/#343: which token claim identifies the principal when
  // AUTH_BUDGET_ACL_SOURCE=actual. Default 'auto' walks Actual's OWN precedence
  // (preferred_username, login, email, id, sub) and matches the result against
  // Actual's `userName`.
  //
  // 'auto' is the default because it is the only setting that works out of the
  // box. v0.11.0 defaulted to 'sub', which is the correct identifier by OIDC
  // (the spec guarantees only `sub` is unique and never reassigned) and which
  // could nonetheless never match: Actual stores no `sub`, it stores the
  // precedence result in `user_name` plus a UUID of its own in `id`. See #343.
  //
  // Set a specific claim name to pin one trusted claim instead, which is worth
  // doing if your IdP lets users edit `preferred_username` or does not verify
  // `email`. Whatever you pin must be the same claim your IdP used to populate
  // Actual's `user_name`, or nothing will match.
  AUTH_BUDGET_ACL_CLAIM: z
    .string()
    .default('auto')
    .refine((v) => v === 'auto' || /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(v), 'AUTH_BUDGET_ACL_CLAIM must be "auto" or a simple claim name'),
  // #346: WHERE the identity claims are read from when AUTH_BUDGET_ACL_SOURCE=actual.
  //
  //   token    (default) the verified access-token payload. No network call.
  //   userinfo the IdP's UserInfo endpoint, which is the SAME document Actual
  //            derives user_name from (openid.ts calls client.userinfo()).
  //
  // Default stays `token` deliberately. `userinfo` is more likely to match, but it
  // makes the IdP a hard dependency of authorization: its downtime becomes a total
  // denial, and it requires the access token to carry the `openid` scope, which
  // this server does not require. Correctness that costs availability should be an
  // operator's explicit choice, not a silent upgrade.
  AUTH_BUDGET_ACL_IDENTITY_SOURCE: z.enum(['token', 'userinfo']).default('token'),
  // #346: bound on the UserInfo request, so a hanging IdP cannot stall the
  // authorization path. Same parse-and-clamp shape as ACTUAL_OP_TIMEOUT_MS, but it
  // has NO disable value: a request on the auth path with no timeout is how a slow
  // IdP becomes an outage. A non-numeric or out-of-range value falls back to 5000.
  AUTH_BUDGET_ACL_USERINFO_TIMEOUT_MS: z.string().default('5000').transform((val) => {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n <= 0) return 5000;
    return Math.min(Math.max(n, 250), 60000);
  }),
  // #345: explicit `<sub>=<actual userName>` bindings, consulted BEFORE the claim
  // precedence and authoritative when the sub is present. See src/auth/identity-map.ts
  // for why it is keyed on `sub` and why a blank target is rejected.
  //
  // Validated here (not at first request) so a malformed binding is a startup
  // error naming the offending entry. The parsed Map is rebuilt on use rather
  // than stored on the config object, because this schema is also consumed by
  // drift tooling that expects plain values.
  AUTH_BUDGET_ACL_IDENTITY_MAP: z
    .string()
    .default('')
    .superRefine((v: string, ctx: z.RefinementCtx) => {
      try {
        parseIdentityMap(v);
      } catch (err) {
        // Surface the parser's own message. It names the offending entry, which
        // is the only part the operator can act on.
        const reason = err instanceof Error ? err.message : String(err);
        ctx.addIssue({
          code: 'custom',
          message:
            `AUTH_BUDGET_ACL_IDENTITY_MAP is malformed: ${reason}. ` +
            'Expected "<sub>=<actual userName>" entries separated by commas, for example ' +
            '"a1b2c3=jdoe,d4e5f6=asmith". See docs/CONFIGURATION.md.',
        });
      }
    }),
})
  // #343 UPGRADE GUARD. v0.11.0 and v0.11.1 shipped AUTH_BUDGET_ACL_CLAIM=sub as
  // the default AND the README told operators to keep it. That combination cannot
  // match anything: Actual stores no `sub`, so every principal resolves to zero
  // budgets and every user gets a 403 saying only "no budget access configured".
  //
  // Anyone who followed that advice has `sub` pinned in their .env, where it would
  // survive this upgrade and keep them locked out with the new default never
  // applying. Refusing to start is deliberately louder than a warning: a config
  // error names the problem and the fix at the moment of the upgrade, whereas the
  // alternative is a silent, total denial that already survived two releases
  // undetected. Scoped narrowly to the exact broken pair, so no other deployment
  // is affected.
  .refine(
    (cfg) => !(cfg.AUTH_BUDGET_ACL_SOURCE === 'actual' && cfg.AUTH_BUDGET_ACL_CLAIM === 'sub'),
    {
      path: ['AUTH_BUDGET_ACL_CLAIM'],
      message:
        'AUTH_BUDGET_ACL_CLAIM=sub cannot work with AUTH_BUDGET_ACL_SOURCE=actual: Actual does not store the ' +
        'OIDC sub. It derives a user_name from preferred_username/login/email/id/sub and generates its own ' +
        'unrelated userId, so matching sub denies every user. Use AUTH_BUDGET_ACL_CLAIM=auto (the default, ' +
        'which mirrors that precedence), or pin a claim that your IdP also used to populate Actual user_name. ' +
        'See #343.',
    },
  )
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
    // Print the MESSAGE, not just the variable name. Every refine in this file
    // writes an explanation of what is wrong and how to fix it, and all of them
    // were being discarded here, so a validation failure read as "this var is
    // missing" even when it was present and merely invalid. Found while adding
    // the #343 upgrade guard, whose whole purpose is to explain itself.
    const missing = result.error.issues
      .map((i) => {
        const name = i.path.join('.') || '(config)';
        return i.message && i.message !== 'Required' ? `  • ${name}: ${i.message}` : `  • ${name}`;
      })
      .join('\n');
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
