// #574: with logins on more than one Actual server, the password login is our own fetch
// (`loginOverFetch`) so it can be aborted at the op bound. Upstream's sign-in takes no signal, so
// before this a stalled login could only be raced, and its late answer re-pointed the client and
// wrote its token under the next operation.
//
// These rows pin the helper against a stub fetch: every error mapping in upstream's
// `post`/`throwIfNot200` order with its `.code`, the auth-retry classification the callers depend
// on (a 429 is still retried, a timeout is not), the refused redirect, and that no password,
// token or response body reaches a log line, an error message or `.cause`.
//
// Run: node tests/unit/api_login_fetch.test.js

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_OP_TIMEOUT_MS = '300';
// #620: row (6) asserts the default, so a shell that exported the opt-in must not leak in.
delete process.env.ACTUAL_API_VERBOSE;

let passed = 0, failed = 0;
const log = (m) => process.stderr.write(`${m}\n`);
const describe = (l) => log(`\n[#574] ${l}`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

// Captured BEFORE redaction: the logger's env scrub would otherwise mask a leaked env password,
// and the sentinels below are not in process.env at all, so neither path can hide a leak.
const logger = (await import('../../dist/src/logger.js')).default;
const logged = [];
for (const level of ['error', 'warn', 'info', 'debug', 'verbose', 'silly', 'log']) {
  const orig = logger[level]?.bind(logger);
  logger[level] = (...args) => { logged.push(JSON.stringify(args, (_, v) => (v instanceof Error ? { message: v.message, stack: v.stack } : v))); return orig?.(...args); };
}

const { loginOverFetch, initApiLoggedIn } = await import('../../dist/src/lib/apiLogin.js');
const { isRetryableAuthError, withAuthRetry } = await import('../../dist/src/lib/actual-adapter/auth-retry.js');
const { withOpTimeout } = await import('../../dist/src/lib/opTimeout.js');
const { setLoginsSpanServers } = await import('../../dist/src/lib/apiState.js');
const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

const SENTINEL_PW = 'sentinel-pw-574-xyzzy';
const SENTINEL_TOKEN = 'sentinel-token-574-plugh';
const SERVER = 'http://actual.test:5006';
const LOGIN = { serverUrl: SERVER, password: SENTINEL_PW };

// One stub fetch, driven per row by `answer`. Every request is recorded with the options it was
// sent with, so the redirect row can see a second POST and the option that prevented it.
let answer = () => new Response('{}');
const requests = [];
globalThis.fetch = async (url, opts = {}) => {
  requests.push({ url: String(url), opts });
  const res = await answer(String(url), opts);
  // Follow a redirect the way a default fetch does, unless the caller asked not to: re-POST.
  if (res.status >= 300 && res.status < 400 && opts.redirect !== 'manual' && opts.redirect !== 'error') {
    const next = res.headers.get('Location');
    requests.push({ url: next, opts });
    return new Response(JSON.stringify({ status: 'ok', data: { token: 'tok-at-redirect-target' } }), { status: 200 });
  }
  return res;
};

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const text = (status, body, headers = {}) => new Response(body, { status, headers });

async function attempt(signal = new AbortController().signal, login = LOGIN) {
  try { return { token: await loginOverFetch(login, signal) }; } catch (err) { return { err }; }
}

// ---------------------------------------------------------------------------
describe('(1) a valid answer resolves the token, posted the way upstream posts it');
{
  requests.length = 0;
  answer = () => json(200, { status: 'ok', data: { token: SENTINEL_TOKEN } });
  const r = await attempt();
  check(r.token === SENTINEL_TOKEN, 'resolves the token');
  const req = requests[0];
  check(req?.url === `${SERVER}/account/login`, `POSTs <server>/account/login (got ${req?.url})`);
  check(req?.opts.method === 'POST' && req?.opts.headers['Content-Type'] === 'application/json',
    'a JSON POST');
  check(JSON.parse(req?.opts.body).loginMethod === 'password' && JSON.parse(req?.opts.body).password === SENTINEL_PW,
    'body is { loginMethod: password, password }');
  check(req?.opts.redirect === 'manual', `redirect: manual (got ${req?.opts.redirect})`);
  check(requests.length === 1, 'one request');

  requests.length = 0;
  await attempt(undefined, { serverUrl: 'http://actual.test:5006/sub/', password: 'p' });
  check(requests[0]?.url === 'http://actual.test:5006/sub/account/login',
    `a server path is kept and joined (got ${requests[0]?.url})`);
}

// ---------------------------------------------------------------------------
describe('(2) every failure maps like upstream, with .code');
{
  const rows = [
    ['fetch rejects (refused connection)', () => { throw new TypeError('fetch failed'); }, 'network-failure'],
    ['status 500', () => text(500, 'boom'), 'internal'],
    ['JSON 401 token-not-found', () => json(401, { status: 'error', reason: 'unauthorized', details: 'token-not-found' }), 'token-expired'],
    ['JSON 400 invalid-password', () => json(400, { status: 'error', reason: 'invalid-password' }), 'invalid-password'],
    ['JSON content type, unparseable body', () => text(400, 'not json', { 'Content-Type': 'application/json' }), 'parse-json'],
    ['ngrok error header', () => text(502, 'tunnel down', { 'ngrok-error-code': 'ERR_NGROK_3200' }), 'network-failure'],
    ['429 raw text', () => text(429, 'Too many requests, please try again later.'), 'Too many requests, please try again later.'],
    ['other non-200, long text, cut to 200', () => text(418, 'x'.repeat(500)), 'x'.repeat(200)],
    ['200, unparseable body', () => text(200, '<html>'), 'parse-json'],
    ['status error with description', () => json(200, { status: 'error', reason: 'r', description: 'described' }), 'described'],
    ['status error with reason only', () => json(200, { status: 'error', reason: 'invalid-password' }), 'invalid-password'],
    ['status error with neither', () => json(200, { status: 'error' }), 'unknown'],
  ];
  for (const [name, a, code] of rows) {
    answer = a;
    const { err } = await attempt();
    check(err?.message === `Authentication failed: ${code}` && err?.code === code,
      `${name}: "Authentication failed: ${code.slice(0, 40)}" with that .code (got "${String(err?.message).slice(0, 80)}", ${String(err?.code).slice(0, 40)})`);
  }

  answer = () => json(200, { status: 'ok', data: { returnUrl: 'https://idp.test/auth' } });
  let { err } = await attempt();
  check(err?.code === 'openid-required' && /requires OpenID login/.test(err?.message) && err.message.startsWith('Authentication failed: '),
    `returnUrl: openid-required (got "${err?.message}", ${err?.code})`);

  answer = () => json(200, { status: 'ok', data: {} });
  ({ err } = await attempt());
  check(err?.message === 'login: User token not set', `no token: upstream's message (got "${err?.message}")`);

  ({ err } = await attempt(undefined, { serverUrl: 'not a url', password: SENTINEL_PW }));
  check(err?.code === 'invalid-server-url' && err?.message === 'Authentication failed: invalid-server-url',
    `malformed server URL: invalid-server-url (got "${err?.message}")`);

  // An abort is never `network-failure`: that one withAuthRetry retries, three times, under the lock.
  const c = new AbortController();
  answer = (_, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
  });
  const pending = attempt(c.signal);
  c.abort();
  ({ err } = await pending);
  check(err?.code === 'aborted' && !isRetryableAuthError(err), `abort: aborted, not retryable (got ${err?.code})`);
}

// ---------------------------------------------------------------------------
describe('(3) a redirect fails closed: no second POST, no password, not retried');
{
  requests.length = 0;
  answer = () => new Response(null, { status: 307, headers: { Location: 'http://u:leak@elsewhere.test/account/login?k=leak' } });
  const { err } = await attempt(undefined, { serverUrl: 'http://admin:hunter2@actual.test:5006', password: SENTINEL_PW });
  check(requests.length === 1, `one POST, the redirect was not followed (got ${requests.length})`);
  check(err?.code === 'redirect-refused' && err?.message ===
    'Authentication failed: redirect refused by http://actual.test:5006 (it redirects to http://elsewhere.test; configure that URL instead)',
    `redirect-refused, both URLs without userinfo, path or query (got "${err?.message}")`);
  check(!isRetryableAuthError(err), 'not retryable');
  check(!/hunter2|leak/.test(String(err?.message)) && !String(err?.message).includes(SENTINEL_PW), 'no password or userinfo in the error');
}
{
  // The common case behind a TLS proxy: http answered by a 308 to https on the same host, with a
  // relative Location resolved against the request. Still refused, but the message says the fix.
  requests.length = 0;
  answer = () => new Response(null, { status: 308, headers: { Location: 'https://actual.test/account/login' } });
  const { err } = await attempt(undefined, { serverUrl: 'http://actual.test', password: SENTINEL_PW });
  check(requests.length === 1 && err?.code === 'redirect-refused' &&
    String(err?.message).endsWith('(it redirects to https://actual.test; configure that URL instead)'),
    `an http to https upgrade names the https origin (got "${err?.message}")`);
  requests.length = 0;
  answer = () => new Response(null, { status: 302 });
  const { err: bare } = await attempt(undefined, LOGIN);
  check(bare?.message === `Authentication failed: redirect refused by ${SERVER}`, `no Location: no hint (got "${bare?.message}")`);
  // A subpath deployment keeps its subpath; a same-URL or non-http Location gives no hint.
  const hintFor = async (serverUrl, location) => {
    answer = () => new Response(null, { status: 308, headers: { Location: location } });
    return (await attempt(undefined, { serverUrl, password: SENTINEL_PW })).err?.message;
  };
  const sub = await hintFor('http://host.test/actual', 'https://host.test/actual/account/login');
  check(String(sub).endsWith('(it redirects to https://host.test/actual; configure that URL instead)'), `subpath kept (got "${sub}")`);
  const same = await hintFor('http://host.test/actual', '/actual/account/login/');
  check(same === 'Authentication failed: redirect refused by http://host.test/actual', `same URL: no hint (got "${same}")`);
  const odd = await hintFor(SERVER, 'javascript:x');
  check(odd === `Authentication failed: redirect refused by ${SERVER}`, `non-http Location: no hint (got "${odd}")`);
}

// ---------------------------------------------------------------------------
describe('(4) the auth-retry classification the callers depend on');
{
  // Positive: express-rate-limit's 429 keeps upstream's raw text, which the retry matches.
  let n = 0;
  answer = () => (++n === 1
    ? text(429, 'Too many requests, please try again later.')
    : json(200, { status: 'ok', data: { token: 't' } }));
  const tok = await withAuthRetry(() => loginOverFetch(LOGIN, new AbortController().signal), { baseBackoffMs: 1 });
  check(tok === 't' && n === 2, `a 429 is retried and then succeeds (${n} requests)`);

  n = 0;
  answer = () => { n++; throw new TypeError('fetch failed'); };
  try { await withAuthRetry(() => loginOverFetch(LOGIN, new AbortController().signal), { baseBackoffMs: 1, maxRetries: 2 }); } catch {}
  check(n === 3, `a network-failure is retried (${n} requests for 2 retries)`);

  // Negative: a stalled login times out once. It is not retried while holding the lock.
  n = 0;
  answer = (_, opts) => { n++; return new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted')))); };
  let err;
  try {
    await withAuthRetry(async () => {
      const c = new AbortController();
      try { return await withOpTimeout(() => loginOverFetch(LOGIN, c.signal), 'login'); } finally { c.abort(); }
    }, { baseBackoffMs: 1 });
  } catch (e) { err = e; }
  check(n === 1, `a timed-out login made exactly one request (got ${n})`);
  check(/timed out after 300ms \(ACTUAL_OP_TIMEOUT_MS\)/.test(String(err?.message)), `the op-timeout message (got "${err?.message}")`);
}

// ---------------------------------------------------------------------------
describe('(5) no password, token or response body reaches a log line, message or .cause');
{
  const errors = [];
  logged.length = 0;
  const answers = [
    () => json(200, { status: 'ok', data: { token: SENTINEL_TOKEN } }),
    () => json(200, { status: 'error', reason: 'bad', token: SENTINEL_TOKEN, data: { token: SENTINEL_TOKEN } }),
    () => json(400, { status: 'error', reason: 'invalid-password', echo: SENTINEL_PW }),
    () => text(200, `not json ${SENTINEL_TOKEN} ${SENTINEL_PW}`),
    () => json(200, { status: 'ok', data: {} }),
    () => { throw new TypeError(`fetch failed ${SENTINEL_PW}`); },
  ];
  for (const a of answers) {
    answer = a;
    const { err } = await attempt();
    if (err) errors.push(err);
  }
  const surface = [
    ...logged,
    ...errors.map(e => `${e.message} ${e.code ?? ''} ${e.cause ? JSON.stringify(e.cause, Object.getOwnPropertyNames(e.cause)) : ''}`),
  ].join('\n');
  check(errors.length === 5, `five of the six answers failed (got ${errors.length})`);
  check(!surface.includes(SENTINEL_PW), 'the password appears nowhere');
  check(!surface.includes(SENTINEL_TOKEN), 'the token appears nowhere');
}

// ---------------------------------------------------------------------------
describe('(6) control: a one-login deployment keeps upstream\'s own login and never fetches');
{
  const inits = [];
  api.init = async (cfg) => { inits.push(cfg); return { send: async () => 'ok' }; };
  requests.length = 0;
  setLoginsSpanServers(false);
  await initApiLoggedIn('/tmp/unused', LOGIN, 'login');
  check(requests.length === 0, `no /account/login fetch (got ${requests.length})`);
  check(inits.length === 1 && inits[0].password === SENTINEL_PW, 'api.init carried the password');
  // #620: ACTUAL_API_VERBOSE is unset here, so upstream's verbose mode is turned off explicitly.
  check('verbose' in inits[0] && inits[0].verbose === false, `one login: api.init got verbose false (${JSON.stringify(inits[0]?.verbose)})`);

  // Positive control: with several logins the same call fetches, and api.init gets no credential.
  inits.length = 0;
  answer = () => json(200, { status: 'ok', data: { token: 't' } });
  setLoginsSpanServers(true);
  await initApiLoggedIn('/tmp/unused', LOGIN, 'login');
  check(requests.length === 1 && inits.length === 1 && inits[0].password === '',
    `several logins: one fetch, then a credential-less init (${requests.length} fetches, password ${JSON.stringify(inits[0]?.password)})`);
  check('verbose' in inits[0] && inits[0].verbose === false, `several logins: api.init got verbose false (${JSON.stringify(inits[0]?.verbose)})`);
  setLoginsSpanServers(false);
}

log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
