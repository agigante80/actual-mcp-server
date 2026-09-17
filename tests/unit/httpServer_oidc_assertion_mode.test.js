// tests/unit/httpServer_oidc_assertion_mode.test.js
//
// #462: Cloudflare Access assertion mode, end to end against the REAL startHttpServer.
//
// Cloudflare's documented pattern for MCP servers: the MCP server is an Access
// application with Managed OAuth; the client obtains an OPAQUE access token and sends
// it as the bearer; Cloudflare resolves it at the edge and forwards a signed JWT in
// Cf-Access-Jwt-Assertion (iss = the team domain, aud = the application's AUD tag,
// keys at <team>/cdn-cgi/access/certs); "the MCP server must validate the Access JWT
// sent in the Cf-Access-Jwt-Assertion header". Two things stood in the way here:
// mcp-auth reads only Authorization, and JWKS resolution required an OpenID discovery
// document the team domain does not publish. This file proves both are solved and,
// above all, that the mode widens NOTHING: the assertion is verified exactly like any
// bearer JWT (signature, issuer, closed audience allowlist, sub), the header is ignored
// when the mode is off, and a bad assertion is a 401.
//
// One child process per variant (config.ts parses env once, setup.ts memoises the
// MCPAuth instance); URL-dispatching fetch stub that serves the JWKS at OIDC_JWKS_URI
// and records whether discovery was ever requested; sentinel line on stdout because
// winston owns console.* and writes every level to stdout in HTTP mode.
//
// Run: node tests/unit/httpServer_oidc_assertion_mode.test.js

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEAM = 'https://team.cloudflareaccess.test';
const JWKS_URI = `${TEAM}/cdn-cgi/access/certs`;
const AUD_TAG = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678901234567890abcdef123456';
const RESOURCE = 'https://actual-mcp.example.com/http';
const SENTINEL = '__OIDC_RESULT__ ';

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const CHILD = `
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
const TEAM = ${JSON.stringify(TEAM)};
const JWKS_URI = ${JSON.stringify(JWKS_URI)};
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = await exportJWK(publicKey); jwk.alg = 'RS256'; jwk.kid = 'k1';
let discoveryCalls = 0, jwksCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (u.includes('/.well-known/openid-configuration')) {
    discoveryCalls++;
    if (process.env.T_DISCOVERY === 'serve') return Response.json({ issuer: TEAM, jwks_uri: JWKS_URI, userinfo_endpoint: TEAM + '/userinfo', authorization_endpoint: TEAM + '/authorize', token_endpoint: TEAM + '/token', response_types_supported: ['code'] });
    return new Response('no discovery on the team domain', { status: 404 });
  }
  if (u === JWKS_URI) { jwksCalls++; return Response.json({ keys: [jwk] }); }
  if (u.startsWith(TEAM)) return new Response('not stubbed: ' + u, { status: 404 });
  return realFetch(input, init);
};
const { startHttpServer } = await import('./dist/src/server/httpServer.js');
const { listener, cleanup } = await startHttpServer({}, 0, '/http', {}, [], 'desc', 'instr', {}, 'test', '127.0.0.1', undefined);
if (!listener.listening) await new Promise((res, rej) => { listener.once('listening', res); listener.once('error', rej); });
const base = 'http://127.0.0.1:' + listener.address().port;
const variant = process.env.T_ASSERTION || 'valid';
const build = (aud, key) => new SignJWT({ email: 'alice@example.test', type: 'app', identity_nonce: 'n1', country: 'GB' })
  .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(TEAM).setAudience(aud).setSubject('cf-sub-42').setIssuedAt().setExpirationTime('5m').sign(key);
let assertion = null;
if (variant === 'valid') assertion = await build(${JSON.stringify(AUD_TAG)}, privateKey);
else if (variant === 'other-aud') assertion = await build('0000000000000000000000000000000000000000000000000000000000000000', privateKey);
else if (variant === 'wrong-key') assertion = await build(${JSON.stringify(AUD_TAG)}, (await generateKeyPair('RS256')).privateKey);
else if (variant === 'not-a-jwt') assertion = 'oauth:definitely-not-a-jwt';
// The bearer: opaque by default; T_BEARER=valid-jwt puts a VALID assertion-shaped JWT in Authorization
// (the captured-assertion-direct-to-origin case) so D4 can be proven.
const bearer = process.env.T_BEARER === 'valid-jwt' ? await build(${JSON.stringify(AUD_TAG)}, privateKey) : 'oauth:CvNooOpaqueTokenFromCloudflare';
const headers = new Headers({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + bearer });
if (assertion !== null) headers.append('Cf-Access-Jwt-Assertion', assertion);
if (variant === 'duplicate') { headers.append('Cf-Access-Jwt-Assertion', await build(${JSON.stringify(AUD_TAG)}, privateKey)); headers.append('Cf-Access-Jwt-Assertion', await build(${JSON.stringify(AUD_TAG)}, privateKey)); }
const r = await realFetch(base + '/http', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
const meta8414 = await realFetch(base + '/.well-known/oauth-authorization-server');
const results = { status: r.status, wwwAuthenticate: r.headers.get('www-authenticate'), body: await r.text(), discoveryCalls, jwksCalls, rfc8414: meta8414.status };
await new Promise((res) => listener.close(res));
process.removeListener('SIGTERM', cleanup); process.removeListener('SIGINT', cleanup);
process.stdout.write(${JSON.stringify(SENTINEL)} + JSON.stringify(results) + '\\n');
process.exit(0);
`;

function boot(env, label) {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], {
    cwd: ROOT,
    env: {
      ...process.env,
      ACTUAL_SERVER_URL: 'http://localhost:5006',
      ACTUAL_PASSWORD: 'stub-password-for-unit-test',
      ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000',
      AUTH_PROVIDER: 'oidc',
      OIDC_ISSUER: TEAM,
      OIDC_RESOURCE: RESOURCE,
      OIDC_ACCEPTED_AUDIENCES: AUD_TAG,
      OIDC_JWKS_URI: JWKS_URI,
      OIDC_TOKEN_SOURCE: 'cf-access-jwt-assertion',
      OIDC_JWKS_TRUSTED_HOSTS: undefined,
      NODE_ENV: 'production',
      ...env,
    },
    encoding: 'utf8',
    timeout: 30000,
  });
  const lines = (child.stdout || '').split('\n');
  const resultLines = lines.filter((l) => l.startsWith(SENTINEL));
  const out = { label, status: child.status, signal: child.signal, stdout: child.stdout || '', stderr: child.stderr || '', result: null };
  if (resultLines.length === 1) out.result = JSON.parse(resultLines[0].slice(SENTINEL.length));
  return out;
}
const booted = (r) => {
  assert.strictEqual(r.signal, null, `${r.label}: child hung`);
  assert.strictEqual(r.status, 0, `${r.label}: child exited ${r.status}\n${r.stderr.slice(-1200)}\n${r.stdout.slice(-1200)}`);
  assert.ok(r.result, `${r.label}: no sentinel result line`);
};

console.log('\n[oidc-assertion-mode] #462 scenario 1: a valid assertion behind an opaque bearer is accepted');
{
  const r = boot({}, 'valid');
  check('boots with OIDC_JWKS_URI and the assertion source, with NO discovery fetch and one JWKS fetch', () => {
    booted(r);
    assert.strictEqual(r.result.discoveryCalls, 0, 'discovery was requested although OIDC_JWKS_URI is set');
    assert.ok(r.result.jwksCalls >= 1, 'the JWKS at OIDC_JWKS_URI was never fetched');
  });
  check('sessionless tools/list is 200 (the assertion, not the opaque bearer, authenticated the request)', () => {
    assert.strictEqual(r.result.status, 200, r.result.body);
  });
  check('GET /.well-known/oauth-authorization-server is 404 in direct-JWKS mode (nothing discovered to re-serve)', () => {
    assert.strictEqual(r.result.rfc8414, 404);
  });
}

console.log('\n[oidc-assertion-mode] #462 scenarios 1b and 1c: in assertion mode Authorization is never consulted (D4)');
{
  const b = boot({ T_BEARER: 'valid-jwt', T_ASSERTION: 'other-aud' }, 'valid bearer, foreign assertion');
  check('a VALID JWT in Authorization plus a foreign-audience assertion is 401 (the bearer is not a fallback)', () => {
    booted(b);
    assert.strictEqual(b.result.status, 401, b.result.body);
  });
  const c = boot({ T_BEARER: 'valid-jwt', T_ASSERTION: 'none' }, 'valid bearer, no assertion');
  check('a VALID JWT in Authorization with NO assertion is 401 missing_auth_header (captured-assertion-direct-to-origin case)', () => {
    booted(c);
    assert.strictEqual(c.result.status, 401, c.result.body);
    assert.ok(/missing_auth_header/.test(String(c.result.wwwAuthenticate)), String(c.result.wwwAuthenticate));
  });
}

console.log('\n[oidc-assertion-mode] #462 scenario 2: the assertion is verified like any JWT');
{
  const a = boot({ T_ASSERTION: 'other-aud' }, 'other AUD tag');
  check('an assertion for another application AUD tag is 401 with WWW-Authenticate', () => {
    booted(a);
    assert.strictEqual(a.result.status, 401, a.result.body);
    assert.ok(a.result.wwwAuthenticate, 'WWW-Authenticate missing');
  });
  const k = boot({ T_ASSERTION: 'wrong-key' }, 'wrong key');
  check('an assertion signed by a different key under the same kid is 401', () => {
    booted(k);
    assert.strictEqual(k.result.status, 401, k.result.body);
  });
  const n = boot({ T_ASSERTION: 'none' }, 'no header');
  check('no assertion header at all: the opaque bearer alone is 401', () => {
    booted(n);
    assert.strictEqual(n.result.status, 401, n.result.body);
  });
  const j = boot({ T_ASSERTION: 'not-a-jwt' }, 'header not a JWT');
  check('a header value that is not a JWT is 401 and made no outbound request beyond the JWKS', () => {
    booted(j);
    assert.strictEqual(j.result.status, 401, j.result.body);
    assert.strictEqual(j.result.discoveryCalls, 0);
  });
}

console.log('\n[oidc-assertion-mode] #462 scenario 3: with the mode OFF the header is ignored');
{
  const r = boot({ OIDC_TOKEN_SOURCE: undefined }, 'mode off');
  check('default OIDC_TOKEN_SOURCE: a valid assertion plus an unverifiable bearer is 401 (bypass surface unchanged)', () => {
    booted(r);
    assert.strictEqual(r.result.status, 401, r.result.body);
  });
}

console.log('\n[oidc-assertion-mode] #462 scenario 4: OIDC_JWKS_URI obeys the same-origin and https rules');
{
  const x = boot({ OIDC_JWKS_URI: 'https://other.example.test/certs' }, 'cross-origin JWKS');
  check('a cross-origin OIDC_JWKS_URI refuses to start, naming OIDC_JWKS_URI and OIDC_JWKS_TRUSTED_HOSTS', () => {
    assert.strictEqual(x.signal, null, 'child hung');
    assert.notStrictEqual(x.status, 0, 'started with an untrusted cross-origin JWKS');
    const out = x.stdout + x.stderr;
    assert.ok(out.includes('OIDC_JWKS_URI') && out.includes('OIDC_JWKS_TRUSTED_HOSTS'), out.slice(-600));
  });
  const h = boot({ OIDC_JWKS_URI: 'http://team.cloudflareaccess.test/cdn-cgi/access/certs' }, 'http JWKS');
  check('a plaintext OIDC_JWKS_URI refuses to start', () => {
    assert.strictEqual(h.signal, null, 'child hung');
    assert.notStrictEqual(h.status, 0, 'started with an http JWKS');
  });
}

console.log('\n[oidc-assertion-mode] #462 scenario 8: duplicate assertion headers are refused, never one silently chosen');
{
  const r = boot({ T_ASSERTION: 'duplicate' }, 'duplicate headers');
  check('two Cf-Access-Jwt-Assertion headers with distinct valid values are 401', () => {
    booted(r);
    assert.strictEqual(r.result.status, 401, r.result.body);
  });
}

console.log('\n[oidc-assertion-mode] #462 scenarios 6, 6b, 9: the cross-variable refines refuse at startup, naming both variables');
{
  const refused = (env, label, ...names) => {
    const r = boot(env, label);
    check(`${label}: exits non-zero naming ${names.join(' and ')}`, () => {
      assert.strictEqual(r.signal, null, 'child hung');
      assert.notStrictEqual(r.status, 0, `started: ${r.stdout.slice(-300)}`);
      const out = r.stdout + r.stderr;
      for (const n of names) assert.ok(out.includes(n), `output lacks ${n}: ${out.slice(-700)}`);
    });
  };
  refused({ AUTH_BUDGET_ACL_IDENTITY_SOURCE: 'userinfo' }, 'scenario 6: OIDC_JWKS_URI + userinfo identity', 'AUTH_BUDGET_ACL_IDENTITY_SOURCE', 'OIDC_JWKS_URI');
  refused({ AUTH_BUDGET_ACL_IDENTITY_SOURCE: 'userinfo', OIDC_JWKS_URI: undefined, T_DISCOVERY: 'serve' }, 'scenario 6b: assertion mode alone + userinfo identity', 'AUTH_BUDGET_ACL_IDENTITY_SOURCE', 'OIDC_TOKEN_SOURCE');
  refused({ AUTH_PROVIDER: 'none', OIDC_JWKS_URI: undefined }, 'scenario 9a: AUTH_PROVIDER=none + assertion mode', 'AUTH_PROVIDER', 'OIDC_TOKEN_SOURCE');
  refused({ OIDC_SCOPES: 'openid' }, 'scenario 9b: assertion mode + OIDC_SCOPES', 'OIDC_SCOPES', 'OIDC_TOKEN_SOURCE');
}

console.log('\n[oidc-assertion-mode] #462 scenario 7: ordinary discovery mode is unchanged (negative control)');
{
  const r = boot({ OIDC_JWKS_URI: undefined, OIDC_TOKEN_SOURCE: undefined, AUTH_BUDGET_ACL_IDENTITY_SOURCE: 'userinfo', T_DISCOVERY: 'serve' }, 'discovery mode');
  check('with OIDC_JWKS_URI unset: discovery is fetched once, userinfo identity still parses, and the RFC 8414 route is 200 (#285 unchanged)', () => {
    booted(r);
    assert.strictEqual(r.result.discoveryCalls, 1, `discovery calls: ${r.result.discoveryCalls}`);
    assert.strictEqual(r.result.rfc8414, 200);
  });
}

console.log('\n[oidc-assertion-mode] #462 source shape: the promotion runs before bearerAuth and the anchors survive');
check('httpServer.ts mounts createAssertionPromotionMiddleware inside the OIDC block, ahead of mcpAuth.bearerAuth(, and keeps both source-scan anchors', () => {
  const src = readFileSync(join(ROOT, 'src', 'server', 'httpServer.ts'), 'utf8');
  const create = src.indexOf('mcpAuth = createMcpAuth()');
  const bearer = src.indexOf('mcpAuth.bearerAuth(');
  const promote = src.indexOf('createAssertionPromotionMiddleware(config.OIDC_TOKEN_SOURCE)');
  assert.ok(create > 0 && bearer > create, 'anchors missing');
  assert.ok(promote > create && promote < bearer, 'the promotion middleware must sit inside the OIDC block, before bearerAuth');
});

console.log(`\n[oidc-assertion-mode] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
