// #628: actual_budgets_list_available and actual_budgets_switch must show a budget's server as
// its ORIGIN only. A reverse-proxy credential written into BUDGET_n_SERVER_URL as userinfo
// (https://proxyuser:proxypass@actual.example) used to be returned verbatim to the MCP client and
// onward to the LLM provider. getBudgetRegistry and each of switchBudget's three return sites
// (no-op, same-auth fast path, slow path) render the URL through logSafeOrigin; the internal
// registry entry keeps the raw URL because the login still needs it.
//
// The default-budget case lives in budgets_serverurl_redaction_default.test.js (ACTUAL_SERVER_URL
// is read once at import, so it needs its own process).
//
// Harness: copied from multi_server_budget_selection.test.js, with ONE change. The fetch stub
// answers /account/login for every SERVERS key, the userinfo URL included, and never forwards to
// the real fetch (which refuses a userinfo URL and would touch the network). So a session can
// really open on the userinfo URL and the fast path's `sameAuth` can be true.
//
// Run: node tests/unit/budgets_serverurl_redaction.test.js

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROXY_URL = 'https://proxyuser:proxypass@actual.example';

process.env.ACTUAL_SERVER_URL = 'http://x:5006';
process.env.ACTUAL_PASSWORD = 'pw-x';
process.env.ACTUAL_BUDGET_SYNC_ID = 'alpha-sync';
process.env.MCP_BRIDGE_DATA_DIR = mkdtempSync(join(tmpdir(), 'unit628-'));
process.env.ACTUAL_OP_TIMEOUT_MS = '2000';
process.env.BUDGET_1_NAME = 'Proxied'; process.env.BUDGET_1_SYNC_ID = 'proxy-sync';
process.env.BUDGET_1_SERVER_URL = PROXY_URL; process.env.BUDGET_1_PASSWORD = 'pw-proxy';
// Same server, password and (absent) encryption password as Proxied, other sync id: fast path.
process.env.BUDGET_2_NAME = 'Proxied2'; process.env.BUDGET_2_SYNC_ID = 'proxy2-sync';
process.env.BUDGET_2_SERVER_URL = PROXY_URL; process.env.BUDGET_2_PASSWORD = 'pw-proxy';
// Registry-only cases: userinfo plus path plus query, a plain URL, and an unparseable one.
process.env.BUDGET_3_NAME = 'Pathy'; process.env.BUDGET_3_SYNC_ID = 'path-sync';
process.env.BUDGET_3_SERVER_URL = `${PROXY_URL}/actual?x=1`; process.env.BUDGET_3_PASSWORD = 'pw-path';
process.env.BUDGET_4_NAME = 'Plain'; process.env.BUDGET_4_SYNC_ID = 'plain-sync';
process.env.BUDGET_4_SERVER_URL = 'http://y:5006'; process.env.BUDGET_4_PASSWORD = 'pw-y';
process.env.BUDGET_5_NAME = 'Garbled'; process.env.BUDGET_5_SYNC_ID = 'garbled-sync';
process.env.BUDGET_5_SERVER_URL = 'proxyuser:proxypass@actual.example'; process.env.BUDGET_5_PASSWORD = 'pw-g';

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#628] ${l}`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

const SERVERS = {
  'http://x:5006': { password: 'pw-x', budgets: ['alpha-sync'] },
  'http://y:5006': { password: 'pw-y', budgets: ['plain-sync'] },
  [PROXY_URL]: { password: 'pw-proxy', budgets: ['proxy-sync', 'proxy2-sync'] },
};

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

let server = null;
let token = null;
let live = false;
let loaded = null;
const calls = []; // ['init', url, password] | ['close'] | ['shutdown'] | ['download', id]

// POST <server>/account/login, for every registered server. Anything else is a 404: this file
// must never reach the network.
const fetched = []; // every fetch URL, recorded before the lookup so the last check can fail
globalThis.fetch = async (url, opts = {}) => {
  fetched.push(String(url));
  const m = /^(.*)\/account\/login$/.exec(String(url));
  if (!m || !SERVERS[m[1]]) return new Response('{}', { status: 404 });
  const password = JSON.parse(opts.body).password;
  calls.push(['init', m[1], password]);
  const ok = SERVERS[m[1]].password === password;
  const body = ok ? { status: 'ok', data: { token: `tok@${m[1]}` } } : { status: 'error', reason: 'invalid-password' };
  return new Response(JSON.stringify(body), { status: ok ? 200 : 400, headers: { 'Content-Type': 'application/json' } });
};
const lib = {
  send: async (name, args) => {
    if (name === 'subscribe-set-token') { token = args.token; return; }
    if (name !== 'close-budget') throw new Error(`stub lib.send: unexpected ${name}`);
    if (!loaded) return 'ok';
    calls.push(['close']);
    loaded = null;
    return 'ok';
  },
};
api.init = async ({ serverURL, password }) => {
  server = serverURL;
  token = null;
  if (password) {
    const res = await globalThis.fetch(`${serverURL}/account/login`, { method: 'POST', body: JSON.stringify({ password }) });
    const body = await res.json();
    if (body.status !== 'ok') throw new Error(`Authentication failed: ${body.reason}`);
    token = body.data.token;
  }
  live = true;
  return lib;
};
api.sync = async () => {};
api.shutdown = async () => {
  if (!live) return;
  calls.push(['shutdown']);
  live = false; server = null; loaded = null;
};
api.downloadBudget = async (id) => {
  calls.push(['download', id]);
  if (!SERVERS[server]?.budgets.includes(id)) throw new Error(`budget ${id} not found on ${server}`);
  loaded = id;
};
api.getBudgetMonths = async () => { if (!loaded) throw { type: 'APIError', message: 'No budget file is open' }; return ['2026-01']; };
api.getAccounts = async () => [{ id: `acct-in-${loaded}`, name: `acct-in-${loaded}` }];

const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;
const adapterNamed = await import('../../dist/src/lib/actual-adapter.js');
const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');
const { requestContext } = await import('../../dist/src/lib/requestContext.js');
const switchTool = (await import('../../dist/src/tools/budgets_switch.js')).default;

const since = (n) => calls.slice(n).map(c => c.join(':')).join(' ');
const inSession = (sid, fn) => requestContext.run({ sessionId: sid, allowedBudgets: ['*'] }, fn);
const leaks = (v) => /proxyuser|proxypass/.test(JSON.stringify(v));
const PROXY_SEED = { serverUrl: PROXY_URL, password: 'pw-proxy', syncId: 'proxy-sync', encryptionPassword: undefined };

// ---------------------------------------------------------------------------
describe('registry: getBudgetRegistry shows the origin only');
{
  const reg = adapter.getBudgetRegistry();
  const url = (name) => reg.find(b => b.name === name)?.serverUrl;
  check(url('Pathy') === 'https://actual.example',
    `userinfo, path and query are dropped (got ${url('Pathy')})`);
  check(url('Plain') === 'http://y:5006', `a URL without userinfo is unchanged (got ${url('Plain')})`);
  check(url('Garbled') === '<invalid url>', `an unparseable URL shows the placeholder (got ${url('Garbled')})`);
  check(url('Proxied') === 'https://actual.example', `a userinfo-only URL shows the origin (got ${url('Proxied')})`);
  check(!leaks(reg), 'no registry entry carries the credential');
}

// ---------------------------------------------------------------------------
describe('switch slow path: different server and credentials returns no credential');
{
  await connectionPool.getConnection('sess-slow'); // opens on the default budget, on http://x:5006
  const mark = calls.length;
  const res = await inSession('sess-slow', () => adapter.switchBudget('Proxied'));
  check(res.serverUrl === 'https://actual.example', `the returned serverUrl is the origin (got ${res.serverUrl})`);
  check(!leaks(res), 'the serialized result carries no credential');
  check(since(mark).includes('shutdown') && since(mark).includes(`init:${PROXY_URL}:pw-proxy`),
    `the slow path ran: old entry shut down, new login to the proxy server (got "${since(mark)}")`);

  // The tool handler renders both the field and the message from the adapter's value.
  await connectionPool.getConnection('sess-tool');
  const out = await inSession('sess-tool', () => switchTool.call({ budgetName: 'Proxied' }));
  check(out.serverUrl === 'https://actual.example', `the tool field is the origin (got ${out.serverUrl})`);
  check(!/proxyuser|proxypass/.test(out.message) && out.message.includes('on https://actual.example.'),
    `the tool message names the origin only (got "${out.message}")`);

  // The registry entry still holds the raw URL: the login needed it.
  const cfg = await inSession('sess-slow', () => adapterNamed._getActiveBudgetConfigForTests());
  check(cfg.serverUrl === PROXY_URL, `the active registry entry keeps the raw URL (got ${cfg.serverUrl})`);
  check(calls.slice(mark).some(c => c[0] === 'init' && c[1] === PROXY_URL),
    'the login used the raw URL, userinfo included');
}

// ---------------------------------------------------------------------------
describe('switch fast path: same server and credentials returns no credential');
{
  await connectionPool.getConnection('sess-fast', PROXY_SEED); // pool entry already on the proxy server
  const mark = calls.length;
  const res = await inSession('sess-fast', () => adapter.switchBudget('Proxied2'));
  const seq = since(mark);
  check(!seq.includes('shutdown') && !calls.slice(mark).some(c => c[0] === 'init'),
    `the fast path was taken: no shutdown, no new login (got "${seq}")`);
  check(seq.includes('download:proxy2-sync'), `the budget was reloaded in place (got "${seq}")`);
  check(res.serverUrl === 'https://actual.example', `the returned serverUrl is the origin (got ${res.serverUrl})`);
  check(!leaks(res), 'the serialized result carries no credential');
}

// ---------------------------------------------------------------------------
describe('switch no-op path: already on the budget returns no credential');
{
  // sess-fast is now on Proxied2; selecting it again is the no-op.
  const mark = calls.length;
  const res = await inSession('sess-fast', () => adapter.switchBudget('Proxied2'));
  check(!calls.slice(mark).some(c => c[0] === 'download' || c[0] === 'init' || c[0] === 'shutdown'),
    `the no-op path was taken: no download, login or shutdown (got "${since(mark)}")`);
  check(res.serverUrl === 'https://actual.example', `the returned serverUrl is the origin (got ${res.serverUrl})`);
  check(!leaks(res), 'the serialized result carries no credential');
}

// ---------------------------------------------------------------------------
describe('the registry itself is not rewritten');
{
  const cfg = await inSession('sess-fast', () => adapterNamed._getActiveBudgetConfigForTests());
  check(cfg.name === 'Proxied2' && cfg.serverUrl === PROXY_URL,
    `the session's active entry still holds the raw URL (got ${cfg.name} ${cfg.serverUrl})`);
}

// ---------------------------------------------------------------------------
describe('harness guard: nothing reached the network');
{
  const stray = fetched.filter(u => !SERVERS[u.replace(/\/account\/login$/, '')]);
  check(fetched.length > 0 && stray.length === 0, `every fetch went to a registered fake server (stray: ${stray.join(', ') || 'none'})`);
}

log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
