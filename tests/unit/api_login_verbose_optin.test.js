// tests/unit/api_login_verbose_optin.test.js
//
// #620: with ACTUAL_API_VERBOSE=true set before the server loads, every api.init call gets
// `verbose: true`, on the one-login path (upstream's own sign-in) and on the several-logins path
// (our fetched login, then a credential-less init). The default (unset, so `false`) is pinned in
// api_login_fetch.test.js; config is parsed once per process, so each value needs its own file.
//
// Run: node tests/unit/api_login_verbose_optin.test.js

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_OP_TIMEOUT_MS = '300';
process.env.ACTUAL_API_VERBOSE = 'true';

let passed = 0, failed = 0;
const log = (m) => process.stderr.write(`${m}\n`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

const { initApiLoggedIn } = await import('../../dist/src/lib/apiLogin.js');
const { setLoginsSpanServers } = await import('../../dist/src/lib/apiState.js');
const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

const LOGIN = { serverUrl: 'http://actual.test:5006', password: 'pw-620' };
const inits = [];
api.init = async (cfg) => { inits.push(cfg); return { send: async () => 'ok' }; };
const requests = [];
globalThis.fetch = async (url) => {
  requests.push(String(url));
  return new Response(JSON.stringify({ status: 'ok', data: { token: 't-620' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

log('\n[#620] ACTUAL_API_VERBOSE=true reaches every api.init');

setLoginsSpanServers(false);
await initApiLoggedIn('/tmp/unused', LOGIN, 'login');
check(inits.length === 1, `one login: one api.init (got ${inits.length})`);
check(inits[0] && 'verbose' in inits[0] && inits[0].verbose === true, `one login: verbose true (${JSON.stringify(inits[0]?.verbose)})`);

inits.length = 0;
setLoginsSpanServers(true);
await initApiLoggedIn('/tmp/unused', LOGIN, 'login');
check(requests.length === 1 && inits.length === 1, `several logins: one fetch, one init (${requests.length}, ${inits.length})`);
check(inits[0] && 'verbose' in inits[0] && inits[0].verbose === true, `several logins: verbose true (${JSON.stringify(inits[0]?.verbose)})`);
setLoginsSpanServers(false);

log(`\n[api-login-verbose-optin] ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
