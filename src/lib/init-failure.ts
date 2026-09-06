/**
 * Classify Actual connection initialization failures into a closed enum and
 * fixed sentences that are safe to return to MCP clients.
 *
 * This module is transport neutral. HTTP and stdio must report the same
 * diagnosis without copying the mapping or allowing upstream error text onto
 * either wire.
 */
export type InitFailureCause =
  | 'schema_too_new' | 'auth_failed' | 'network_unreachable' | 'budget_not_found'
  | 'out_of_sync' | 'encryption_error' | 'clock_drift' | 'permission_denied'
  | 'timeout' | 'unknown';

export const INIT_FAILURE_SENTENCES: Record<InitFailureCause, string> = {
  schema_too_new: "The Actual server's database schema is newer than the @actual-app/api this build bundles. Upgrade actual-mcp-server, or hold the server upgrade until its dependency update ships.",
  auth_failed: 'Authentication against the Actual server failed. Check ACTUAL_PASSWORD and the budget password.',
  // Deliberately not asserting permanence: ECONNRESET and ETIMEDOUT are classed
  // TRANSIENT by isRetryableError, so this can be a blip rather than misconfiguration.
  network_unreachable: 'The Actual server could not be reached, which may be transient. If it persists, check ACTUAL_SERVER_URL and that the server is running.',
  budget_not_found: 'The configured budget was not found on the Actual server. Check ACTUAL_BUDGET_SYNC_ID.',
  out_of_sync: 'The local budget copy is out of sync with the Actual server and could not be reconciled.',
  encryption_error: "The budget's end-to-end encryption password is wrong or missing.",
  clock_drift: "The host clock differs too far from the Actual server's. Fix the system time.",
  // A filesystem permission error, WITHOUT claiming which path: the classifier
  // sees only the errno, and EACCES can come from the data directory, TLS
  // material, or a socket during api.init.
  permission_denied: 'The server was denied filesystem access while initialising. Check the data directory mount and its ownership first, then any TLS material.',
  timeout: 'Initialising the Actual connection ran out of time, which may be transient.',
  unknown: 'The Actual connection for this session could not be initialised. See the server log for the cause.',
};

/** Actual's own reason strings, from `withErrorCode` and SyncError, to our enum. */
export const REASON_TO_CAUSE: Record<string, InitFailureCause> = {
  'invalid-schema': 'schema_too_new',
  'out-of-sync-migrations': 'schema_too_new',
  'out-of-sync': 'out_of_sync',
  'out-of-sync-data': 'out_of_sync',
  'budget-not-found': 'budget_not_found',
  'clock-drift': 'clock_drift',
  'encrypt-failure': 'encryption_error',
  'decrypt-failure': 'encryption_error',
  'missing-key': 'encryption_error',
};

/** Node fs/net codes are a separate namespace from Actual's reasons. */
export const SYSTEM_CODE_TO_CAUSE: Record<string, InitFailureCause> = {
  EACCES: 'permission_denied',
  EPERM: 'permission_denied',
  EROFS: 'permission_denied',
  ECONNREFUSED: 'network_unreachable',
  ENOTFOUND: 'network_unreachable',
  ECONNRESET: 'network_unreachable',
  EHOSTUNREACH: 'network_unreachable',
  ETIMEDOUT: 'timeout',
};

export function classifyInitFailure(err: unknown): { cause: InitFailureCause; sentence: string } {
  const done = (cause: InitFailureCause) => ({ cause, sentence: INIT_FAILURE_SENTENCES[cause] });
  try {
    const e = err as { code?: unknown; reason?: unknown; message?: unknown } | null | undefined;

    // `.code` FIRST: upstream's api/download-budget and api/load-budget never let a
    // SyncError escape, they throw a plain Error carrying .code via withErrorCode.
    const code = typeof e?.code === 'string' ? e.code : undefined;
    if (code && REASON_TO_CAUSE[code]) return done(REASON_TO_CAUSE[code]);
    if (code && SYSTEM_CODE_TO_CAUSE[code]) return done(SYSTEM_CODE_TO_CAUSE[code]);

    // `.reason` only as a defensive fallback, for a SyncError that reaches us by
    // some path that does not go through those two handlers.
    const reason = typeof e?.reason === 'string' ? e.reason : undefined;
    if (reason && REASON_TO_CAUSE[reason]) return done(REASON_TO_CAUSE[reason]);

    const message = typeof e?.message === 'string' ? e.message : '';

    // Our own synthesized post-condition error embeds the upstream reason in prose.
    const embedded = /Upstream reason: \[([a-z-]+)\]/.exec(message)?.[1];
    if (embedded && REASON_TO_CAUSE[embedded]) return done(REASON_TO_CAUSE[embedded]);

    // `network-failure` is tested before auth wording because upstream reports an
    // unreachable server as "Authentication failed: network-failure".
    if (/network-failure|ECONNREFUSED|ENOTFOUND/i.test(message)) return done('network_unreachable');
    if (/timed out|ETIMEDOUT/i.test(message)) return done('timeout');
    if (/Authentication failed|invalid-password|Invalid password/i.test(message)) return done('auth_failed');
    if (/invalid-schema/i.test(message)) return done('schema_too_new');
    return done('unknown');
  } catch {
    // TOTAL by construction. A classifier that throws could leak the original
    // value through an outer transport error path.
    return done('unknown');
  }
}
