// tests/unit/httpServer_host_validation.test.js
//
// #612: DNS rebinding protection on the HTTP transport. Three layers:
//   1. resolveAllowedHosts (pure): which hostnames each posture accepts, or null.
//   2. The MCP_ALLOWED_HOSTS schema in configSchema: bare hostnames only.
//   3. The real server from dist/, in a CHILD process (config.ts parses env once), with
//      requests sent by node:http so the Host header is really what we set. Node's fetch
//      silently replaces a Host override with the real one, so a fetch-based negative
//      would pass vacuously.
//
// Run: node tests/unit/httpServer_host_validation.test.js

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SENTINEL = '__HOST_VALIDATION_RESULT__ ';
const TOKEN = 'host-validation-unit-test-612-tttttttttttttt';

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const { resolveAllowedHosts } = await import('../../dist/src/lib/authPosture.js');

console.log('\n[#612] resolveAllowedHosts');
const LOOP = ['localhost', '127.0.0.1', '[::1]'];
check('authenticated, list unset: null (no check, unchanged behaviour)', () =>
  assert.strictEqual(resolveAllowedHosts({ openMode: false, allowedHosts: [], bindHost: '0.0.0.0' }), null));
check('authenticated, list set: the list plus the loopback names', () =>
  assert.deepStrictEqual(resolveAllowedHosts({ openMode: false, allowedHosts: ['mcp.example.org'], bindHost: '0.0.0.0' }), [...LOOP, 'mcp.example.org']));
check('authenticated: a concrete bind address is NOT added', () =>
  assert.deepStrictEqual(resolveAllowedHosts({ openMode: false, allowedHosts: ['a.example'], bindHost: '192.168.1.5' }), [...LOOP, 'a.example']));
check('open mode, wildcard 0.0.0.0 bind: loopback names only', () =>
  assert.deepStrictEqual(resolveAllowedHosts({ openMode: true, allowedHosts: [], bindHost: '0.0.0.0' }), LOOP));
check('open mode, wildcard :: bind: loopback names only', () =>
  assert.deepStrictEqual(resolveAllowedHosts({ openMode: true, allowedHosts: [], bindHost: '::' }), LOOP));
check('open mode, concrete bind 192.168.1.5: the bind address is added (--test-mcp-client)', () =>
  assert.deepStrictEqual(resolveAllowedHosts({ openMode: true, allowedHosts: [], bindHost: '192.168.1.5' }), [...LOOP, '192.168.1.5']));
check('open mode, IPv6 bind: added bracketed', () =>
  assert.deepStrictEqual(resolveAllowedHosts({ openMode: true, allowedHosts: [], bindHost: 'fd00::5' }), [...LOOP, '[fd00::5]']));
check('open mode, a non-canonical IPv6 bind is stored as the SDK sees the Host (canonical form)', () => {
  assert.deepStrictEqual(resolveAllowedHosts({ openMode: true, allowedHosts: [], bindHost: '2001:db8:0:0::5' }), [...LOOP, '[2001:db8::5]']);
  assert.deepStrictEqual(resolveAllowedHosts({ openMode: true, allowedHosts: [], bindHost: '::ffff:192.168.1.5' }), [...LOOP, '[::ffff:c0a8:105]']);
});
check('open mode, undefined bind: loopback names only', () =>
  assert.deepStrictEqual(resolveAllowedHosts({ openMode: true, allowedHosts: [], bindHost: undefined }), LOOP));
check('open mode, list set: additive, no duplicates', () =>
  assert.deepStrictEqual(resolveAllowedHosts({ openMode: true, allowedHosts: ['mcp-server-test', 'localhost'], bindHost: '127.0.0.1' }), [...LOOP, 'mcp-server-test']));

console.log('\n[#612] MCP_ALLOWED_HOSTS schema');
// configSchema is exported, but importing config.js also parses process.env at load:
// give it the dummy Actual settings so that parse succeeds and only our rows matter.
process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
const { configSchema } = await import('../../dist/src/config.js');
const field = configSchema.shape.MCP_ALLOWED_HOSTS;
check('unset parses to an empty list', () => assert.deepStrictEqual(field.parse(undefined), []));
check('comma list is trimmed, lowercased, empties dropped', () =>
  assert.deepStrictEqual(field.parse(' MCP-Server-Test , ,mcp.example.org,[::1] '), ['mcp-server-test', 'mcp.example.org', '[::1]']));
for (const bad of ['mcp.example.org:3600', '*.example.org', 'https://mcp.example.org/', '::1', '2130706433', 'a.example/path']) {
  check(`refuses ${JSON.stringify(bad)} with a message naming MCP_ALLOWED_HOSTS`, () => {
    const r = field.safeParse(`ok.example,${bad}`);
    assert.strictEqual(r.success, false);
    assert.ok(r.error.issues.some((i) => /MCP_ALLOWED_HOSTS entry/.test(i.message)), JSON.stringify(r.error.issues));
  });
}

// ---- wiring: the real server in a child process ----
const child = `
const http = await import('node:http');
// OIDC rows: stub the issuer's discovery and JWKS, so startup needs no network.
const issuer = process.env.OIDC_ISSUER;
if (issuer) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (u.startsWith(issuer + '/')) {
      if (u.endsWith('/.well-known/openid-configuration')) {
        return Response.json({ issuer, jwks_uri: issuer + '/jwks', authorization_endpoint: issuer + '/authorize',
          token_endpoint: issuer + '/token', response_types_supported: ['code'] });
      }
      if (u.endsWith('/jwks')) return Response.json({ keys: [] });
      return new Response('not stubbed', { status: 404 });
    }
    return realFetch(input, init);
  };
}
const { connectionPool } = await import('./dist/src/lib/ActualConnectionPool.js');
connectionPool.getConnection = async (sid) => {
  connectionPool.connections.set(sid, {
    sessionId: sid, initialized: true, lastActivity: Date.now(),
    dataDir: '/nonexistent', serverUrl: 'http://127.0.0.1:5999', password: 'x', syncId: 'alpha-sync',
  });
  return connectionPool.connections.get(sid);
};
const mcp = { executeTool: async () => ({ ok: true }) };
const { startHttpServer } = await import('./dist/src/server/httpServer.js');
const bind = process.env.TEST_BIND;
const { listener } = await startHttpServer(mcp, 0, '/http', {}, ['actual_accounts_list'], 'desc', 'instr', {}, 'test', bind, undefined);
if (!listener.listening) await new Promise((res, rej) => { listener.once('listening', res); listener.once('error', rej); });
const port = listener.address().port;

const req = (method, path, headers, body) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : undefined;
  const h = { ...headers };
  if (data) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(data); h.accept = 'application/json, text/event-stream'; }
  const r = http.request({ host: '127.0.0.1', port, method, path, headers: h }, (res) => {
    let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; });
    res.on('end', () => resolve({ status: res.statusCode, body: b, acao: res.headers['access-control-allow-origin'] ?? null }));
  });
  r.on('error', reject); if (data) r.write(data); r.end();
});
const auth = process.env.MCP_SSE_AUTHORIZATION ? { authorization: 'Bearer ' + process.env.MCP_SSE_AUTHORIZATION } : {};
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'host-test', version: '0' } } };
const post = (headers) => req('POST', '/http', { ...auth, ...headers }, init);

const out = {};
for (const [k, h] of Object.entries(JSON.parse(process.env.TEST_POSTS))) out[k] = await post(h);
for (const [k, [path, h]] of Object.entries(JSON.parse(process.env.TEST_GETS ?? '{}'))) out[k] = await req('GET', path, h);
await new Promise((res) => listener.close(res));
process.stdout.write(${JSON.stringify(SENTINEL)} + JSON.stringify(out) + '\\n');
process.exit(0);
`;

const baseEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  ACTUAL_SERVER_URL: 'http://127.0.0.1:5999',
  ACTUAL_PASSWORD: 'stub-password-for-unit-test',
  ACTUAL_BUDGET_SYNC_ID: 'alpha-sync',
  MCP_BRIDGE_DATA_DIR: mkdtempSync(join(tmpdir(), 'unit612h-')),
  NODE_ENV: 'production',
};
function run(label, env, bind, posts, gets = {}) {
  const c = spawnSync(process.execPath, ['--input-type=module', '-e', child], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000,
    env: { ...baseEnv, ...env, TEST_BIND: bind, TEST_POSTS: JSON.stringify(posts), TEST_GETS: JSON.stringify(gets) },
  });
  const lines = (c.stdout || '').split('\n').filter((l) => l.startsWith(SENTINEL));
  assert.strictEqual(c.signal, null, `${label} child hung`);
  assert.strictEqual(c.status, 0, `${label} child exited ${c.status}\n${(c.stderr || '').slice(-2000)}\n${(c.stdout || '').slice(-2000)}`);
  assert.strictEqual(lines.length, 1, `${label}: expected one sentinel line`);
  return { r: JSON.parse(lines[0].slice(SENTINEL.length)), out: c.stdout + c.stderr };
}
const body403 = (msg) => JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: msg }, id: null });
const is403 = (res, msg) => {
  assert.strictEqual(res.status, 403, res.body);
  assert.strictEqual(res.body, body403(msg));
};
const handled = (res) => assert.strictEqual(res.status, 200, `expected the MCP handler (200), got ${res.status}: ${res.body}`);

console.log('\n[#612 http] open mode, loopback bind 127.0.0.1');
const loop = run('open-loopback', {}, '127.0.0.1', {
  localhost: { host: 'localhost:3600' },
  ip: { host: '127.0.0.1:3600' },
  v6: { host: '[::1]:3600' },
  evil: { host: 'evil.example' },
  xfh: { host: 'evil.example', 'x-forwarded-host': 'localhost' },
  originEvil: { host: 'localhost:3600', origin: 'https://evil.example' },
  originOk: { host: 'localhost:3600', origin: 'http://localhost:3000' },
  originNull: { host: 'localhost:3600', origin: 'null' },
  originJunk: { host: 'localhost:3600', origin: 'not a url' },
}).r;
check('Host localhost:3600 with no Origin reaches the MCP handler', () => handled(loop.localhost));
check('Host 127.0.0.1:3600 reaches the MCP handler', () => handled(loop.ip));
check('Host [::1]:3600 reaches the MCP handler', () => handled(loop.v6));
check('Host evil.example: 403 with the exact SDK body', () => is403(loop.evil, 'Invalid Host: evil.example'));
check('X-Forwarded-Host: localhost does not bypass the Host check', () => is403(loop.xfh, 'Invalid Host: evil.example'));
check('Origin https://evil.example: 403 Invalid Origin: evil.example', () => is403(loop.originEvil, 'Invalid Origin: evil.example'));
check('Origin http://localhost:3000 reaches the MCP handler', () => handled(loop.originOk));
check('Origin null: 403 Invalid Origin: null', () => is403(loop.originNull, 'Invalid Origin: null'));
check('an unparsable Origin is treated as null: 403', () => is403(loop.originJunk, 'Invalid Origin: null'));

console.log('\n[#612 http] open mode, wildcard bind 0.0.0.0');
const wild = run('open-wildcard', {}, '0.0.0.0',
  { evil: { host: 'evil.example:3600' }, svc: { host: 'mcp-server-test:3600' }, localhost: { host: 'localhost:3600' } },
  { health: ['/health', { host: 'evil.example' }], healthOk: ['/health', { host: 'localhost' }] });
check('Host evil.example:3600: 403 Invalid Host: evil.example (port stripped)', () => is403(wild.r.evil, 'Invalid Host: evil.example'));
check('an unlisted service name is refused while MCP_ALLOWED_HOSTS is unset', () => is403(wild.r.svc, 'Invalid Host: mcp-server-test'));
check('Host localhost:3600 still reaches the MCP handler', () => handled(wild.r.localhost));
check('GET /health with Host evil.example: 403 (the guard runs before every route)', () => is403(wild.r.health, 'Invalid Host: evil.example'));
check('GET /health with Host localhost: 200', () => assert.strictEqual(wild.r.healthOk.status, 200));
check('the startup info line names the accepted hosts and MCP_ALLOWED_HOSTS', () =>
  assert.ok(/Accepting Host localhost, 127\.0\.0\.1, \[::1\] only.*MCP_ALLOWED_HOSTS/.test(wild.out), wild.out.slice(-1500)));
check('a rejection logs a warn naming the hostname', () =>
  assert.ok(/hostname not allowed \(DNS rebinding protection, #612\)/.test(wild.out) && /evil\.example/.test(wild.out), wild.out.slice(-1500)));

console.log('\n[#612 http] open mode, wildcard bind, MCP_ALLOWED_HOSTS=mcp-server-test');
const svc = run('open-allowlisted', { MCP_ALLOWED_HOSTS: 'mcp-server-test' }, '0.0.0.0',
  { svc: { host: 'mcp-server-test:3600' }, evil: { host: 'evil.example' }, originSvc: { host: 'mcp-server-test:3600', origin: 'http://mcp-server-test:3080' } });
check('Host mcp-server-test:3600 reaches the MCP handler', () => handled(svc.r.svc));
check('an allowlisted Origin reaches the MCP handler', () => handled(svc.r.originSvc));
check('Host evil.example is still refused', () => is403(svc.r.evil, 'Invalid Host: evil.example'));
check('no startup info line once MCP_ALLOWED_HOSTS is set', () => assert.ok(!/Accepting Host/.test(svc.out)));

console.log('\n[#612 http] authenticated (static bearer), wildcard bind');
const authUnset = run('auth-unset', { MCP_SSE_AUTHORIZATION: TOKEN }, '0.0.0.0',
  { any: { host: 'anything.example' }, anyOrigin: { host: 'anything.example', origin: 'https://evil.example' } });
check('MCP_ALLOWED_HOSTS unset: Host anything.example is handled as today', () => handled(authUnset.r.any));
check('MCP_ALLOWED_HOSTS unset: no Origin check runs', () => handled(authUnset.r.anyOrigin));
const authSet = run('auth-set', { MCP_SSE_AUTHORIZATION: TOKEN, MCP_ALLOWED_HOSTS: 'mcp.example.org' }, '0.0.0.0',
  { other: { host: 'other.example' }, listed: { host: 'mcp.example.org' }, listedOrigin: { host: 'mcp.example.org', origin: 'https://client.example' } });
check('MCP_ALLOWED_HOSTS set: Host other.example gets 403 Invalid Host: other.example', () => is403(authSet.r.other, 'Invalid Host: other.example'));
check('MCP_ALLOWED_HOSTS set: the listed name is handled', () => handled(authSet.r.listed));
check('authenticated: a foreign Origin is not checked (the Origin guard is open mode only)', () => handled(authSet.r.listedOrigin));

console.log('\n[#612 http] OIDC, wildcard bind: authenticated, so no guard unless MCP_ALLOWED_HOSTS is set');
const OIDC = { AUTH_PROVIDER: 'oidc', OIDC_ISSUER: 'https://idp.test', OIDC_RESOURCE: 'https://mcp.example.org/http' };
const META = '/.well-known/oauth-protected-resource/http';
const oidcUnset = run('oidc-unset', OIDC, '0.0.0.0',
  { foreign: { host: 'mcp.example.org', origin: 'https://client.example' } },
  { meta: [META, { host: 'mcp.example.org', origin: 'https://client.example' }] });
check('OIDC, MCP_ALLOWED_HOSTS unset: the public metadata is readable cross-origin (200)', () =>
  assert.strictEqual(oidcUnset.r.meta.status, 200, oidcUnset.r.meta.body));
check('OIDC, MCP_ALLOWED_HOSTS unset: a public Host and foreign Origin reach auth (401), not the guard (403)', () =>
  assert.strictEqual(oidcUnset.r.foreign.status, 401, oidcUnset.r.foreign.body));
const oidcSet = run('oidc-set', { ...OIDC, MCP_ALLOWED_HOSTS: 'mcp.example.org' }, '0.0.0.0',
  { other: { host: 'other.example' } },
  { meta: [META, { host: 'mcp.example.org', origin: 'https://client.example' }] });
check('OIDC, MCP_ALLOWED_HOSTS set: Host other.example gets 403 Invalid Host: other.example', () => is403(oidcSet.r.other, 'Invalid Host: other.example'));
check('OIDC, MCP_ALLOWED_HOSTS set: the metadata on the listed name stays readable cross-origin', () =>
  assert.strictEqual(oidcSet.r.meta.status, 200, oidcSet.r.meta.body));

console.log('\n[#612 http] an invalid MCP_ALLOWED_HOSTS refuses startup');
for (const bad of ['mcp.example.org:3600', '*.example.org']) {
  check(`MCP_ALLOWED_HOSTS=${bad}: the config load fails naming the variable`, () => {
    const c = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./dist/src/config.js'); console.log('LOADED');"], {
      cwd: ROOT, encoding: 'utf8', timeout: 30000, env: { ...baseEnv, MCP_ALLOWED_HOSTS: bad },
    });
    const out = (c.stdout || '') + (c.stderr || '');
    assert.notStrictEqual(c.status, 0, out.slice(-1500));
    assert.ok(!/LOADED/.test(c.stdout || ''), 'config loaded');
    assert.ok(/MCP_ALLOWED_HOSTS/.test(out), out.slice(-1500));
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
