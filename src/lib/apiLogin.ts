import api, { type InitOptions } from '@actual-app/api';
import config from '../config.js';
import { withOpTimeout } from './opTimeout.js';
import { setApiLogin, setLoadedBudgetSyncId, registerBudgetLoad, loginsSpanServers, type ApiLogin } from './apiState.js';
import { createModuleLogger } from './loggerFactory.js';

const log = createModuleLogger('API-LOGIN');

// Upstream's init accepts `verbose` (#620); the local declaration in types/actual-api.d.ts predates
// it and is in the do-not-modify tier, so the option is widened here instead.
type InitWithVerbose = InitOptions & { verbose: boolean };

type UpstreamLib = { send: (name: string, args?: unknown) => Promise<unknown> };

// Upstream's `init` returns its module-level handler object, the same one every time. Upstream
// exports no other way to reach `close-budget`. Nothing can be open before the first init, which
// is when this is still unset.
let upstreamLib: UpstreamLib | null = null;

/**
 * #571: the ONLY place in src/ that calls `api.init`.
 *
 * With a multi-server budget registry, whether the singleton may skip a login depends on
 * knowing which server (and password) it is logged in to, and an unknown login counts as a
 * mismatch. A site that called `api.init` without recording the login would therefore not be
 * wrong, only slow: every later operation would log in again, which is the #127 auth burst that
 * #134 removed. Routing every init through here makes "logged in" and "recorded" one step, and
 * `tests/unit/multi_server_budget_selection.test.js` fails on any raw `api.init(` elsewhere.
 *
 * Order, every time:
 *  1. clear the login and loaded-budget records. Upstream's init points the client at the new
 *     server before it signs in, so a login that throws or times out leaves the client on a
 *     server with nothing proven; clearing first means nothing trusts it afterwards, and the
 *     next operation of any session re-selects.
 *  2. close any open budget with upstream's `close-budget`, which does NOT sync. Upstream's init
 *     does not close an open budget, so without this a pending change of the outgoing budget
 *     would next try to sync against the new server. Harmless when nothing is open (the legacy
 *     per-operation cycle has already shut down). Never `api.shutdown`: it syncs before it
 *     closes, and syncing an in-memory copy that is stale against its own data dir (another
 *     process wrote that budget) fails "out-of-sync" and leaves the local copy permanently
 *     unopenable; every session open on that budget then fails until the copy is deleted. The
 *     v0.22.48 full run hit exactly that after the stdio #270 regression, which v0.22.47 survived
 *     because its session open only ran upstream's download, whose own close does not sync
 *     either. This removes only the session-open trigger: the adapter precondition still syncs
 *     the outgoing budget before re-selecting (so a pending change is not lost), and that sync
 *     carries the same stale-copy hazard when a second process writes the data dir (#575).
 *     Anything still pending syncs at that budget's next load. Not the pool's shutdown helpers: those drop pool entries, and the other sessions'
 *     entries are still valid.
 *  3. log in, then record the login.
 *
 * Every init passes `verbose` explicitly (#620): upstream only sets its process-global verbose
 * mode when the key is present, and its default is on, which writes reconciled transactions into
 * our log through `wireConsoleAndDebug`.
 *
 * Bounded by the op timeout (#270). Callers that retry on the auth rate limit wrap this whole
 * call in `withAuthRetry`, so each attempt is bounded on its own.
 *
 * A timeout does not cancel (`withOpTimeout` races), so a timed-out close or login keeps running
 * after the caller has thrown and released the lock. A late close would close the budget the next
 * operation loaded, in any deployment, so it is always registered with the #393 abandoned-load
 * registry: every `withApiLock` acquisition settles it, bounded and failing closed, before it runs
 * anything. With one login, upstream logs in itself and the login is not registered: it lands on
 * the only server there is, and registering it would replace #270's per-request recovery with a
 * fail-closed wait on every operation. With more than one (`loginsSpanServers`), a late login
 * could move the client to another server, so #574 performs it as our own abortable fetch and
 * registers only the credential-less init that follows (see `initOverFetchedLogin`). The close
 * has no such exemption: it waits on upstream's spreadsheet and services (not on running handlers), so a close
 * that stalls makes every session wait, bounded and failing closed, in a one-login deployment
 * too (the accepted #393 trade-off; upstream's close takes no signal, so it stays unabortable).
 * A late close, login or init records nothing (the records were cleared in step 1 and `setApiLogin` is only reached by
 * a caller still waiting), so the next operation logs in again.
 */
export async function initApiLoggedIn(dataDir: string, login: ApiLogin, label: string): Promise<void> {
  setApiLogin(null);
  setLoadedBudgetSyncId(null);
  if (upstreamLib) {
    const closing = upstreamLib.send('close-budget');
    registerBudgetLoad(closing);
    await withOpTimeout(() => closing, `${label} (close outgoing budget)`);
  }
  if (loginsSpanServers()) {
    await initOverFetchedLogin(dataDir, login, label);
    return;
  }
  const loggingIn = api.init({
    dataDir,
    serverURL: login.serverUrl,
    password: login.password,
    verbose: config.ACTUAL_API_VERBOSE,
  } as InitWithVerbose) as Promise<UpstreamLib | undefined>;
  const lib = await withOpTimeout(() => loggingIn, label);
  if (lib && typeof lib.send === 'function') upstreamLib = lib;
  setApiLogin(login);
}

/**
 * #574: the multi-login path. Upstream's sign-in takes no signal, so a stalled login could only
 * be raced, and its late answer then pointed the client at its server and wrote its token under
 * whatever operation ran next. Here the login is our own fetch, aborted at the bound, and the
 * client is only touched after that fetch has answered in time:
 *  1. the bounded login: the fetch and its body read, nothing else. `finally` aborts it, which
 *     is a no-op once it has answered. There is deliberately no `signal.aborted` check after
 *     it (round 1 of the gate asked for one, round 2 reversed it): the `finally` aborts on
 *     success too, so the check would fail every login, and a timeout rejects the awaited race
 *     before the next line runs, which `multi_server_budget_selection.test.js` row 22 pins
 *     with a fetch that ignores the abort.
 *  2. a credential-less `api.init` (local: `setServer` plus a fresh in-memory store), then
 *     `subscribe-set-token` on the handle it returns. Neither makes a network call, but both
 *     are still raced, so both are registered like the close: a late one would re-point the
 *     client or hand it the wrong server's token.
 *
 * An empty password keeps upstream's skip: no fetch and no token. Nothing of the previous server
 * survives, because every `api.init` resets upstream's store (`init$3({ persist: false })`).
 */
async function initOverFetchedLogin(dataDir: string, login: ApiLogin, label: string): Promise<void> {
  let token = '';
  if (login.password) {
    const controller = new AbortController();
    try {
      token = await withOpTimeout(() => loginOverFetch(login, controller.signal), label);
    } finally {
      controller.abort();
    }
  }
  // `password: ''` is upstream's no-credential init (it signs in only on a truthy password).
  const pointing = api.init({ dataDir, serverURL: login.serverUrl, password: '', verbose: config.ACTUAL_API_VERBOSE } as InitWithVerbose) as Promise<UpstreamLib | undefined>;
  registerBudgetLoad(pointing);
  const lib = await withOpTimeout(() => pointing, label);
  if (!lib || typeof lib.send !== 'function') throw new Error(`Actual API ${label}: upstream init returned no handle`);
  upstreamLib = lib;
  if (token) {
    // Local, but raced and registered like the init: a late token set after the next init would
    // hand this server's token to whichever server the client then points at.
    const setting = lib.send('subscribe-set-token', { token });
    registerBudgetLoad(setting);
    await withOpTimeout(() => setting, label);
  }
  setApiLogin(login);
}

function authError(reason: string): Error {
  return Object.assign(new Error(`Authentication failed: ${reason}`), { code: reason });
}

/** The server URL as written into a message: no `user:pass@`, which an operator may put there. */
function displayUrl(serverUrl: string): string {
  try {
    const u = new URL(serverUrl);
    u.username = '';
    u.password = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return 'the configured server';
  }
}

/**
 * #574: upstream's password login (`signIn` over `post`), as our own fetch so it can be aborted.
 * Resolves the session token. Errors follow upstream's `post`/`throwIfNot200` order and carry
 * `.code` like its `withErrorCode`, because `classifyInitFailure` and `isRetryableAuthError`
 * read them: in particular a 429 keeps upstream's raw text (`Too many requests, ...`), which is
 * what the auth-rate-limit retry matches. Three cases go beyond upstream on purpose:
 * `redirect-refused` (upstream follows a redirect and re-POSTs the password to its target),
 * `invalid-server-url`, and `openid-required` (upstream returns `{ redirectUrl }` as a success,
 * which a server-side password login cannot follow).
 *
 * Reads `globalThis.fetch` at call time; upstream captured its own at module load. Never logs
 * or throws the password, the token or a response body.
 */
export async function loginOverFetch(login: ApiLogin, signal: AbortSignal): Promise<string> {
  let url: URL;
  try {
    url = new URL(login.serverUrl);
  } catch {
    throw authError('invalid-server-url');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/account/login`;
  let res: Response;
  let text: string;
  try {
    res = await globalThis.fetch(url.toString(), {
      method: 'POST',
      body: JSON.stringify({ loginMethod: 'password', password: login.password }),
      headers: { 'Content-Type': 'application/json' },
      // 'manual', not 'error': under 'error' Node rejects a redirect with the same
      // `TypeError: fetch failed` as a refused connection, which would map to the retried
      // `network-failure`. Here the 3xx arrives as a status and is refused below.
      redirect: 'manual',
      signal,
    });
    text = await res.text();
  } catch (err) {
    if (signal.aborted) throw authError('aborted');
    log.debug('Login request failed', { error: err instanceof Error ? err.name : 'unknown' });
    throw authError('network-failure');
  }
  if (res.status >= 300 && res.status < 400) {
    // Refused even for an http to https upgrade on the same host (the usual TLS proxy setup):
    // following any redirect re-POSTs the password, and one rule is easier to trust than a
    // same-host exception. The operator fixes it once, so the message names the server URL the
    // redirect implies: its origin plus the path before `/account/login` (a subpath deployment
    // keeps its subpath), never its userinfo or query. No hint when the Location is absent,
    // unparseable, not http(s), or implies the URL already configured.
    let hint = '';
    const location = res.headers.get('Location');
    try {
      const target = new URL(location ?? '', url);
      const suggested = target.origin + target.pathname.replace(/\/account\/login\/*$/, '').replace(/\/+$/, '');
      if (location && /^https?:$/.test(target.protocol) && suggested !== displayUrl(login.serverUrl)) {
        hint = ` (it redirects to ${suggested}; configure that URL instead)`;
      }
    } catch {
      // An unparseable Location gives no hint; the refusal stands.
    }
    throw Object.assign(new Error(`Authentication failed: redirect refused by ${displayUrl(login.serverUrl)}${hint}`), { code: 'redirect-refused' });
  }
  if (res.status !== 200) {
    if (res.status === 500) throw authError('internal');
    if ((res.headers.get('Content-Type') ?? '').toLowerCase().includes('application/json')) {
      let body: { reason?: string; details?: string };
      try {
        body = JSON.parse(text);
      } catch {
        throw authError('parse-json');
      }
      const reason = body?.reason === 'unauthorized' && body?.details === 'token-not-found' ? 'token-expired' : body?.reason;
      throw authError(reason || 'network-failure');
    }
    if (res.headers.has('ngrok-error-code')) throw authError('network-failure');
    throw authError(text.slice(0, 200) || 'network-failure');
  }
  let data: { status?: string; reason?: string; description?: string; data?: { token?: string; returnUrl?: string } };
  try {
    data = JSON.parse(text);
  } catch {
    throw authError('parse-json');
  }
  if (data?.status !== 'ok') throw authError(data?.description || data?.reason || 'unknown');
  if (data.data?.returnUrl) {
    throw Object.assign(
      new Error(`Authentication failed: ${displayUrl(login.serverUrl)} requires OpenID login, which a server password cannot use`),
      { code: 'openid-required' },
    );
  }
  if (!data.data?.token) throw new Error('login: User token not set');
  return data.data.token;
}
