/**
 * Initialisation-failure classification, shared by BOTH transports.
 *
 * #438 built this for HTTP and left it inside `httpServer.ts`. #452 moved it here
 * unchanged, because stdio needs the same answers and a transport importing another
 * transport for a domain concept is the wrong dependency. `httpServer.ts` re-exports
 * `classifyInitFailure` and `InitFailureCause`, so every existing importer is unaffected.
 *
 * The BRAND at the bottom of this file is the #452 addition. Read its comment before
 * calling the classifier from any new site: the classifier is only safe where the caller
 * already knows it is holding an initialisation failure.
 */

/**
 * #438: classify a session-init failure into a CLOSED enum plus our own sentence.
 *
 * PURE and TOTAL: it never throws, never reads I/O, and never returns anything
 * derived from the caught value. That last property is the wire contract: the
 * response carries the enum member and the fixed sentence below and nothing
 * else, so no upstream string reaches a remote client and no scrubber has to be
 * correct. Upstream strings can carry a stack, raw SQL (`SyncError.meta.query`),
 * an `EACCES ... mkdir '/home/<user>/.actual'` path, and a configured server URL.
 *
 * Exported for tests: there is NO fault-injection seam in actualConnection.ts or
 * the pool, and booting against a closed port reaches only `network-failure`, so
 * every other class is covered by calling this directly with synthetic values.
 */
// The rate-limit decision is IMPORTED, never copied. #177 collapsed the retry decision and the
// pool-drop decision onto one authored pattern source precisely so a second list could not drift
// from the first, and a classifier holding its own near-miss copy would reintroduce that.
import { isRateLimitError } from './retry.js';

export type InitFailureCause =
  | 'schema_too_new' | 'auth_failed' | 'network_unreachable' | 'budget_not_found'
  | 'out_of_sync' | 'encryption_error' | 'clock_drift' | 'permission_denied'
  | 'timeout' | 'rate_limited' | 'unknown';

const INIT_FAILURE_SENTENCES: Record<InitFailureCause, string> = {
  schema_too_new: "The Actual server's database schema is newer than the @actual-app/api this build bundles. Upgrade actual-mcp-server, or hold the server upgrade until its dependency update ships.",
  auth_failed: 'Authentication against the Actual server failed. Check ACTUAL_PASSWORD and the budget password.',
  // Deliberately not asserting permanence: ECONNRESET and ETIMEDOUT are classed
  // TRANSIENT by isRetryableError, so this can be a blip rather than misconfiguration.
  network_unreachable: 'The Actual server could not be reached, which may be transient. If it persists, check ACTUAL_SERVER_URL and that the server is running.',
  // Deliberately does NOT name a single env var. `loadBudgetTracked` brands every failed load,
  // and actual_budgets_switch loads a budget the CALLER named, so on a multi-budget deployment
  // "check ACTUAL_BUDGET_SYNC_ID" sent a user who asked to switch to their household budget to
  // the wrong variable entirely. The sync id is what is wrong either way; which setting holds
  // it depends on how the budget was selected.
  budget_not_found: 'The requested budget was not found on the Actual server. Check the sync id it was selected by: ACTUAL_BUDGET_SYNC_ID for the default budget, or the matching BUDGET_n_SYNC_ID in a multi-budget setup.',
  out_of_sync: 'The local budget copy is out of sync with the Actual server and could not be reconciled.',
  encryption_error: "The budget's end-to-end encryption password is wrong or missing.",
  clock_drift: "The host clock differs too far from the Actual server's. Fix the system time.",
  // A filesystem permission error, WITHOUT claiming which path: the classifier
  // sees only the errno, and EACCES can come from the data directory, TLS
  // material, or a socket during api.init.
  permission_denied: 'The server was denied filesystem access while initialising. Check the data directory mount and its ownership first, then any TLS material.',
  timeout: 'Initialising the Actual connection ran out of time, which may be transient.',
  // Deliberately NOT phrased as a credential problem: the credentials are fine, the login
  // window is full. Actual's limiter is 500 requests per minute and is not configurable.
  rate_limited: 'The Actual server rejected the login because too many requests were made in a short window. Nothing is misconfigured: wait a minute and retry.',
  unknown: 'The Actual connection for this session could not be initialised. See the server log for the cause.',
};

/** Actual's own reason strings, from `withErrorCode` and SyncError, to our enum.
 *  `out-of-sync-migrations` maps to schema_too_new, NOT out_of_sync: `invalid-schema`
 *  is absent from budgetLoader's KNOWN_LOAD_REASONS, so migrations is the only route
 *  by which a too-new schema surfaces on the post-condition path, and upstream's own
 *  sentence for it is "This budget cannot be loaded with this version of the app." */
const REASON_TO_CAUSE: Record<string, InitFailureCause> = {
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

/** Node fs/net codes. A DIFFERENT namespace from Actual's reasons, deliberately
 *  kept in its own table so the two can never be conflated. */
const SYSTEM_CODE_TO_CAUSE: Record<string, InitFailureCause> = {
  EACCES: 'permission_denied',
  EPERM: 'permission_denied',
  EROFS: 'permission_denied',
  ECONNREFUSED: 'network_unreachable',
  ENOTFOUND: 'network_unreachable',
  ECONNRESET: 'network_unreachable',
  EHOSTUNREACH: 'network_unreachable',
  ETIMEDOUT: 'timeout',
};

/**
 * Walks the `cause` chain, for the same reason `isInitFailure` does and discovered the same way:
 * `runQuery` and `bankSync` rewrap into a friendlier message, and the rewrapped error carries
 * neither the upstream `.code` nor the reason in its own text. Recognising it as an init failure
 * while classifying it `unknown` would leave those tools propagating the raw upstream sentence,
 * which is the exact defect #452 exists to remove. The FIRST named answer in the chain wins;
 * `unknown` means keep looking rather than give up.
 */
export function classifyInitFailure(err: unknown): { cause: InitFailureCause; sentence: string } {
  let current: unknown = err;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 10; depth++) {
    const verdict = classifyOne(current);
    if (verdict.cause !== 'unknown') return verdict;
    if (!current || (typeof current !== 'object' && typeof current !== 'function')) break;
    if (seen.has(current)) break;
    seen.add(current);
    current = (current as { cause?: unknown }).cause;
    if (current === undefined || current === null) break;
  }
  return { cause: 'unknown', sentence: INIT_FAILURE_SENTENCES.unknown };
}

function classifyOne(err: unknown): { cause: InitFailureCause; sentence: string } {
  const done = (cause: InitFailureCause) => ({ cause, sentence: INIT_FAILURE_SENTENCES[cause] });
  try {
    const e = err as { code?: unknown; reason?: unknown; message?: unknown } | null | undefined;

    // `.code` FIRST: upstream's api/download-budget and api/load-budget never let a
    // SyncError escape, they throw a plain Error carrying .code via withErrorCode.
    // `Object.hasOwn`, never a bare truthiness test on the lookup: these are object literals, so
    // they inherit Object.prototype and an error carrying `code: 'constructor'` (or 'toString',
    // 'valueOf') would match, returning a `cause` that is not an InitFailureCause and a sentence
    // that is `undefined`. The stdio handler would then answer a tool call with
    // `{ isError: true, content: [{ type: 'text', text: undefined }] }`. Pre-existing from #438,
    // but #452 is what routes EVERY stdio tool error through here, so it is reachable now.
    const code = typeof e?.code === 'string' ? e.code : undefined;
    if (code && Object.hasOwn(REASON_TO_CAUSE, code)) return done(REASON_TO_CAUSE[code]);
    if (code && Object.hasOwn(SYSTEM_CODE_TO_CAUSE, code)) return done(SYSTEM_CODE_TO_CAUSE[code]);

    // `.reason` only as a defensive fallback, for a SyncError that reaches us by
    // some path that does not go through those two handlers.
    const reason = typeof e?.reason === 'string' ? e.reason : undefined;
    if (reason && Object.hasOwn(REASON_TO_CAUSE, reason)) return done(REASON_TO_CAUSE[reason]);

    const message = typeof e?.message === 'string' ? e.message : '';

    // Our OWN synthesized post-condition error (#396) embeds the upstream reason
    // in prose. On a resync of an existing local copy this is the shape that
    // actually arrives for the schema and migration classes, so a classifier that
    // handled only the upstream shapes would answer `unknown` for exactly the
    // failures this ticket is about.
    const embedded = /Upstream reason: \[([a-z-]+)\]/.exec(message)?.[1];
    if (embedded && Object.hasOwn(REASON_TO_CAUSE, embedded)) return done(REASON_TO_CAUSE[embedded]);

    // Last resort, message shapes. `network-failure` is tested BEFORE the auth
    // wording because upstream reports an unreachable server as
    // "Authentication failed: network-failure", where the actionable half is the
    // network, not the credentials.
    if (/network-failure|ECONNREFUSED|ENOTFOUND/i.test(message)) return done('network_unreachable');
    if (/timed out|ETIMEDOUT/i.test(message)) return done('timeout');
    // #452 review: BEFORE the auth branch. A throttled login surfaces as
    // "Authentication failed: Too many requests" (retry.ts documents that exact shape), and
    // withAuthRetry rethrows it once its budget is exhausted, so it reaches here as a genuine
    // INITIALISATION failure and is branded. Classifying it `auth_failed` told a rate-limited
    // user to check their password, which is a wrong answer in the same family this whole
    // classifier exists to remove. It affects HTTP identically; that was live before #452.
    if (isRateLimitError(err)) return done('rate_limited');
    if (/Authentication failed|invalid-password|Invalid password/i.test(message)) return done('auth_failed');
    if (/invalid-schema/i.test(message)) return done('schema_too_new');
    return done('unknown');
  } catch {
    // TOTAL by construction: a classifier that throws would land on the outer POST
    // catch and egress as raw String(err), defeating this contract through the one
    // line deliberately left to #446.
    return done('unknown');
  }
}

/**
 * #452: the brand that says "this error came from establishing the Actual connection".
 *
 * WHY A BRAND AND NOT THE MESSAGE. `classifyInitFailure` falls back to matching message
 * prose, which is safe at the HTTP call site because that site is reached ONLY from the
 * catch around session init, so anything it sees IS an init failure. The stdio call site
 * is every tool error, and there the prose branches misfire on errors that are not init
 * failures at all. Measured on v0.21.0:
 *
 *   `Actual API operation timed out after 30000ms (ACTUAL_OP_TIMEOUT_MS)`  -> `timeout`
 *   `Authentication failed: Too many requests` (the #422 rate-limit tail)   -> `auth_failed`
 *
 * The first is the #270 nesting-bug signal, which CLAUDE.md instructs a reader to
 * interpret as a probable deadlock rather than a slow server. The second would tell a
 * rate-limited user their password is wrong. Both replace a true message with a false one.
 *
 * So classification is gated on ORIGIN, not wording, which is the same rule #377 applies
 * to refusals: decide by TYPE, never by matching prose.
 *
 * The mark is applied at the CHOKEPOINTS, not at call sites: the api-init try/catch in
 * `initActualApiForOperation`, and both branches of `loadBudgetTracked`'s catch. The second was
 * added in review, and the reason generalises: the write drain calls
 * `ensureLoadedBudgetMatchesSession` directly per operation, and the pooled precondition does
 * too, so a budget-load failure on those paths reached stdio UNBRANDED and handed the user the
 * raw upstream sentence this exists to suppress. Branding the funnel every load passes through
 * means the set of call sites stops mattering, which is the same argument #393 used for the
 * abandoned-load wait.
 *
 * `Symbol.for` rather than a class or `instanceof`: the error object is raised by
 * `@actual-app/api` and merely passes through us, so it cannot be OUR type, and a symbol
 * survives being rethrown by `toolFactory` and `actualToolsManager` untouched.
 */
const INIT_FAILURE_BRAND = Symbol.for('actual-mcp.init-failure');

/** Tag an error as having come from connection initialisation. Returns the same object. */
export function markInitFailure<T>(err: T): T {
  try {
    if (err && (typeof err === 'object' || typeof err === 'function')) {
      Object.defineProperty(err, INIT_FAILURE_BRAND, {
        value: true,
        enumerable: false,   // never serialised into a response or a log line
        configurable: true,
      });
    }
  } catch {
    // A frozen or exotic error stays unbranded, which degrades to today's behaviour
    // (the raw error propagates) rather than to a wrong sentence. Never let the mark
    // itself become a failure path.
  }
  return err;
}

/**
 * True only for an error raised while establishing the Actual connection.
 *
 * WALKS `cause`, because several adapter paths REWRAP an error into a new one with a friendlier
 * message (`runQuery` and `bankSync` both do), and a rewrap that dropped the object would drop
 * the brand with it, silently disabling #452 for exactly those tools. Those sites now pass the
 * original as `cause`, so the mark survives one hop or many.
 *
 * Depth bounded, and cycle safe: an error whose `cause` points back at itself (or a long chain
 * built by a retry wrapper) must not spin here. A diagnostic helper is never worth a hang.
 */
export function isInitFailure(err: unknown): boolean {
  let current: unknown = err;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 10; depth++) {
    if (!current || (typeof current !== 'object' && typeof current !== 'function')) return false;
    if (seen.has(current)) return false;
    seen.add(current);
    if ((current as Record<symbol, unknown>)[INIT_FAILURE_BRAND] === true) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
