// tests/unit/httpServer_static_tokens.test.js
//
// #572: the HTTP half of MCP_STATIC_TOKENS, over Express. The adapter half (what a list
// does once it is in requestContext) is tests/unit/static_tokens.test.js.
//
// The real server runs in a CHILD process (config.ts parses env once), like the
// session_ownership_express.test.js harness this follows. Its own child is not reused: that
// one is built around signing OIDC JWTs, and nothing here needs an identity provider. The
// only stub is connectionPool.getConnection (it would need a live Actual server); the
// executor records the requestContext each tool call sees, and runs the real
// actual_session_list so H11 exercises the real owner filter.
//
// Rows (named as in the ticket):
//   H1 no header 401; H2 unknown token 401; H3 strict prefix of a real token 401;
//   H4 non-Bearer scheme 401; H5 malformed header 401; H6 the same five with
//   MCP_ALLOW_UNAUTHENTICATED=true; H7 alice's call sees principal 'alice' and her list;
//   H8 the legacy token beside them is 'static-bearer' with no list; H9 alice POSTing with
//   bob's session id is 404 and bob's next call works; H10 the same for DELETE, and bob's
//   session survives; H11 alice's actual_session_list omits bob's session; H12 a startup
//   refusal exits non-zero and prints no token; H12b static-only startup logs
//   "authentication enabled" and never "authentication disabled", on either stream.
//
// Run: node tests/unit/httpServer_static_tokens.test.js

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SENTINEL = '__STATIC_TOKENS_RESULT__ ';
const TOK_ALICE = 'alice-token-for-unit-test-572-aaaaaaaaaa';
const TOK_BOB = 'bob-token-for-unit-test-572-bbbbbbbbbbbbbb';
const TOK_LEGACY = 'legacy-token-for-unit-test-572-llllllllll';
const STATIC = JSON.stringify({
  alice: { tokenEnv: 'MCP_TOKEN_ALICE', budgets: ['Alpha'] },
  bob: { tokenEnv: 'MCP_TOKEN_BOB', budgets: ['Alpha', 'Gamma'] },
});

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const child = `
const { connectionPool } = await import('./dist/src/lib/ActualConnectionPool.js');
connectionPool.getConnection = async (sid) => {
  connectionPool.connections.set(sid, {
    sessionId: sid, initialized: true, lastActivity: Date.now(),
    dataDir: '/nonexistent', serverUrl: 'http://127.0.0.1:5999', password: 'x', syncId: 'alpha-sync',
  });
  return connectionPool.connections.get(sid);
};
const { requestContext } = await import('./dist/src/lib/requestContext.js');
const sessionList = (await import('./dist/src/tools/session_list.js')).default;
const seen = [];
const mcp = { executeTool: async (name, args) => {
  const s = requestContext.getStore() ?? {};
  seen.push({ name, principal: s.principal ?? null, allowedBudgets: s.allowedBudgets ?? null });
  if (name === 'actual_session_list') return sessionList.call(args);
  return { ok: true };
} };
const { startHttpServer } = await import('./dist/src/server/httpServer.js');
const { listener, cleanup } = await startHttpServer(mcp, 0, '/http', {}, ['actual_accounts_list', 'actual_session_list'], 'desc', 'instr', {}, 'test', '127.0.0.1', undefined);
if (!listener.listening) await new Promise((res, rej) => { listener.once('listening', res); listener.once('error', rej); });
const base = 'http://127.0.0.1:' + listener.address().port + '/http';

const send = async (method, authorization, sid, body) => {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (authorization !== undefined) headers.Authorization = authorization;
  if (sid) headers['mcp-session-id'] = sid;
  const r = await fetch(base, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, sessionId: r.headers.get('mcp-session-id'), www: r.headers.get('www-authenticate'), body: await r.text() };
};
const bearer = (t) => 'Bearer ' + t;
const initParams = { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'static-tokens-test', version: '0' } };
const init = (auth) => send('POST', auth, undefined, { jsonrpc: '2.0', id: 1, method: 'initialize', params: initParams });
const call = (auth, sid, name = 'actual_accounts_list') => send('POST', auth, sid, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: {} } });
const settle = () => new Promise((r) => setTimeout(r, 50));

const r = {};
const ALICE = ${JSON.stringify(TOK_ALICE)};
r.refusals = {
  none: (await init(undefined)).status,
  unknown: (await init(bearer('z'.repeat(40)))).status,
  prefix: (await init(bearer(ALICE.slice(0, -1)))).status,
  scheme: (await init('Basic ' + ALICE)).status,
  malformed: (await init('Bearer')).status,
  noneBody: (await init(undefined)).body,
  // #777: the WWW-Authenticate challenge of each 401, and the presented secret as a probe for a leak.
  www: {
    none: (await init(undefined)).www,
    unknown: (await init(bearer('wrong-token-value'))).www,
    unknownBody: (await init(bearer('wrong-token-value'))).body,
    scheme: (await init('Basic abc')).www,
    malformed: (await init('Bearer')).www,
  },
};

if (process.env.MCP_SSE_AUTHORIZATION) {
  const a = await init(bearer(ALICE)); await settle();
  const b = await init(bearer(${JSON.stringify(TOK_BOB)})); await settle();
  const l = await init(bearer(process.env.MCP_SSE_AUTHORIZATION)); await settle();
  r.inits = [a.status, b.status, l.status];
  const sidA = a.sessionId, sidB = b.sessionId, sidL = l.sessionId;

  seen.length = 0;
  r.callA = (await call(bearer(ALICE), sidA)).status;
  r.callL = (await call(bearer(process.env.MCP_SSE_AUTHORIZATION), sidL)).status;
  r.seen = seen.slice();

  seen.length = 0;
  r.aliceOnBob = await call(bearer(ALICE), sidB);
  r.aliceOnBobExecuted = seen.length;
  r.bobAfter = (await call(bearer(${JSON.stringify(TOK_BOB)}), sidB)).status;

  r.aliceDeletesBob = (await send('DELETE', bearer(ALICE), sidB)).status;
  r.bobAfterDelete = (await call(bearer(${JSON.stringify(TOK_BOB)}), sidB)).status;

  const listed = await call(bearer(ALICE), sidA, 'actual_session_list');
  r.listStatus = listed.status;
  r.listBody = listed.body;
  r.sidA = sidA; r.sidB = sidB;
}

await new Promise((res) => listener.close(res));
process.removeListener('SIGTERM', cleanup); process.removeListener('SIGINT', cleanup);
process.stdout.write(${JSON.stringify(SENTINEL)} + JSON.stringify(r) + '\\n');
process.exit(0);
`;

const baseEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  ACTUAL_SERVER_URL: 'http://127.0.0.1:5999',
  ACTUAL_PASSWORD: 'stub-password-for-unit-test',
  ACTUAL_BUDGET_SYNC_ID: 'alpha-sync',
  BUDGET_DEFAULT_NAME: 'Alpha',
  BUDGET_1_NAME: 'Gamma', BUDGET_1_SYNC_ID: 'gamma-sync',
  MCP_BRIDGE_DATA_DIR: mkdtempSync(join(tmpdir(), 'unit572h-')),
  NODE_ENV: 'production',
  MCP_STATIC_TOKENS: STATIC,
  MCP_TOKEN_ALICE: TOK_ALICE,
  MCP_TOKEN_BOB: TOK_BOB,
};
function run(label, env) {
  const c = spawnSync(process.execPath, ['--input-type=module', '-e', child], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
  const lines = (c.stdout || '').split('\n').filter((l) => l.startsWith(SENTINEL));
  assert.strictEqual(c.signal, null, `${label} child hung`);
  assert.strictEqual(c.status, 0, `${label} child exited ${c.status}\n${(c.stderr || '').slice(-2000)}\n${(c.stdout || '').slice(-2000)}`);
  assert.strictEqual(lines.length, 1, `${label}: expected one sentinel line`);
  return { r: JSON.parse(lines[0].slice(SENTINEL.length)), stdout: c.stdout, stderr: c.stderr };
}
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
const toolResult = (body) => {
  // The SDK answers a POST as JSON or as one SSE "data:" frame, depending on the Accept order.
  const j = json(body) ?? json(String(body).split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? '');
  const text = j?.result?.content?.[0]?.text;
  return text ? json(text) ?? text : j;
};

const refusalRows = (r) => {
  check('H1 no Authorization header: 401', () => assert.strictEqual(r.refusals.none, 401));
  check('H1 the 401 names the missing header', () => assert.ok(/Missing Authorization header/.test(r.refusals.noneBody), r.refusals.noneBody));
  check('H2 a token that matches no principal: 401', () => assert.strictEqual(r.refusals.unknown, 401));
  check('H3 a strict prefix of alice\'s token: 401', () => assert.strictEqual(r.refusals.prefix, 401));
  check('H4 alice\'s token under a non-Bearer scheme: 401', () => assert.strictEqual(r.refusals.scheme, 401));
  check('H5 a malformed header: 401', () => assert.strictEqual(r.refusals.malformed, 401));
  // #777: RFC 9110 15.5.2, the exact challenge of each 401 branch.
  check('H1 #777 no header: WWW-Authenticate is the bare realm challenge', () => assert.strictEqual(r.refusals.www.none, 'Bearer realm="actual-mcp-server"'));
  check('H2 #777 an unknown token: error="invalid_token", and neither header nor body echoes the token', () => {
    assert.strictEqual(r.refusals.www.unknown, 'Bearer realm="actual-mcp-server", error="invalid_token"');
    assert.ok(!r.refusals.www.unknown.includes('wrong-token-value') && !r.refusals.www.unknownBody.includes('wrong-token-value'));
  });
  check('H4 #777 a non-Bearer scheme: error="invalid_request"', () => assert.strictEqual(r.refusals.www.scheme, 'Bearer realm="actual-mcp-server", error="invalid_request"'));
  check('H5 #777 a malformed header: error="invalid_request"', () => assert.strictEqual(r.refusals.www.malformed, 'Bearer realm="actual-mcp-server", error="invalid_request"'));
};

console.log('\n[#572 http] static tokens plus the legacy token');
const main = run('main', { ...baseEnv, MCP_SSE_AUTHORIZATION: TOK_LEGACY });
const r = main.r;
refusalRows(r);
check('alice, bob and the legacy token each initialize (200)', () => assert.deepStrictEqual(r.inits, [200, 200, 200]));
check('H7 alice\'s tool call sees principal alice and her resolved list', () => {
  assert.strictEqual(r.callA, 200);
  assert.deepStrictEqual(r.seen[0], { name: 'actual_accounts_list', principal: 'alice', allowedBudgets: ['alpha-sync'] });
});
check('H8 the legacy token is static-bearer with no list, as before #572', () => {
  assert.strictEqual(r.callL, 200);
  assert.deepStrictEqual(r.seen[1], { name: 'actual_accounts_list', principal: 'static-bearer', allowedBudgets: null });
});
check('H9 alice POSTing with bob\'s session id is 404 and never reaches the executor', () => {
  assert.strictEqual(r.aliceOnBob.status, 404, r.aliceOnBob.body);
  assert.ok(/Session not found/.test(r.aliceOnBob.body), r.aliceOnBob.body);
  assert.strictEqual(r.aliceOnBobExecuted, 0);
});
check('H9 bob\'s next call on his session still succeeds', () => assert.strictEqual(r.bobAfter, 200));
check('H10 alice\'s DELETE of bob\'s session is 404, and bob\'s session survives', () => {
  assert.strictEqual(r.aliceDeletesBob, 404);
  assert.strictEqual(r.bobAfterDelete, 200);
});
check('H11 alice\'s actual_session_list shows her session and not bob\'s', () => {
  assert.strictEqual(r.listStatus, 200, r.listBody);
  const ids = (toolResult(r.listBody)?.sessions ?? []).map((s) => s.sessionId);
  assert.ok(ids.includes(r.sidA), `alice's own session missing: ${r.listBody}`);
  assert.ok(!ids.includes(r.sidB), `bob's session listed for alice: ${r.listBody}`);
});
check('the startup log names the principals with budget counts and flags the legacy token', () => {
  const out = main.stdout + main.stderr;
  assert.ok(/static principals: alice \(1 budget\(s\)\), bob \(2 budget\(s\)\)/.test(out), out.slice(-1500));
  assert.ok(/MCP_SSE_AUTHORIZATION also accepted \(unrestricted\)/.test(out), out.slice(-1500));
  assert.ok(!/Alpha|Gamma/.test(out.split('\n').find((l) => l.includes('static principals')) ?? ''), 'budget names in the startup line');
});
check('no token value appears in any output', () => {
  const out = main.stdout + main.stderr;
  for (const t of [TOK_ALICE, TOK_BOB, TOK_LEGACY]) assert.ok(!out.includes(t), 'a token was printed');
});

console.log('\n[#572 http] static tokens only, with MCP_ALLOW_UNAUTHENTICATED=true');
const open = run('open', { ...baseEnv, MCP_ALLOW_UNAUTHENTICATED: 'true' });
console.log('  (H6: the H1 to H5 rows again)');
refusalRows(open.r);
check('H12b static-only startup logs "authentication enabled", and "authentication disabled" on neither stream', () => {
  assert.ok(/HTTP authentication enabled \(Bearer token required\)/.test(open.stdout + open.stderr), (open.stdout + open.stderr).slice(-1500));
  assert.ok(!/authentication disabled/.test(open.stdout), 'stdout says authentication disabled');
  assert.ok(!/authentication disabled/.test(open.stderr), 'stderr says authentication disabled');
  assert.ok(!/MCP_SSE_AUTHORIZATION also accepted/.test(open.stdout + open.stderr), 'legacy token flagged although unset');
});

console.log('\n[#572 http] H12 a startup refusal, through the real entrypoint');
{
  const SECRET = 'S'.repeat(40);
  const c = spawnSync(process.execPath, ['dist/src/index.js', '--http'], {
    cwd: ROOT, encoding: 'utf8', timeout: 30000,
    env: { ...baseEnv, MCP_BRIDGE_PORT: '3655', MCP_BRIDGE_BIND_HOST: '127.0.0.1',
      MCP_STATIC_TOKENS: JSON.stringify({ alice: { tokenEnv: 'MCP_TOKEN_ALICE', budgets: ['Nope'] } }), MCP_TOKEN_ALICE: SECRET },
  });
  const out = (c.stdout || '') + (c.stderr || '');
  check('H12 exits non-zero', () => assert.ok(c.status !== 0 && c.signal === null, `status ${c.status} signal ${c.signal}`));
  // The HTTP logger writes JSON lines to stdout, so the quotes arrive escaped.
  check('H12 names the unknown budget, as one readable line', () => assert.ok(/Failed to start Actual MCP bridge: MCP_STATIC_TOKENS: \\?"alice\\?" references unknown budget \\?"Nope\\?"/.test(out), out.slice(-1500)));
  check('H12 prints no token value', () => assert.ok(!out.includes(SECRET), 'the token was printed'));
}

console.log(`\n[#572 http] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
