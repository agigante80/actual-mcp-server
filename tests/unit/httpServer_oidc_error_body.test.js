// tests/unit/httpServer_oidc_error_body.test.js
//
// #463: a 401 from the OIDC bearer middleware must not reflect the presented token's
// own claims back to the caller.
//
// customJwtVerify wraps a failed jwtVerify as MCPAuthTokenVerificationError('invalid_token',
// joseError). Outside NODE_ENV=production the server passes showErrorDetails=true, and
// mcp-auth then serialises the cause into the 401 body. jose's JWTClaimValidationFailed
// carries the DECODED PAYLOAD of the token it rejected, so the body used to contain
// `cause.payload` with `sub`, `email` and `aud`. Self-disclosure only (the caller holds
// the token), but response bodies are routinely captured by proxies and client logs.
//
// The fix keeps showErrorDetails (the claim name is what an operator debugging an
// audience mismatch needs, #245) and strips only the payload. So the assertions here
// are: with NODE_ENV unset, the body still names the claim and carries no payload; with
// NODE_ENV=production, the body carries no cause at all (unchanged behaviour).
//
// One child process per NODE_ENV value, for the same reason as the #461 harness:
// config.ts parses env once and setup.ts memoises the MCPAuth instance. Same fetch stub,
// same sentinel line (winston owns console.* and writes every level to stdout).
//
// Run: node tests/unit/httpServer_oidc_error_body.test.js

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ISSUER = 'https://idp.test';
const RESOURCE = 'https://actual-mcp.example.com/http';
const SENTINEL = '__OIDC_RESULT__ ';
// Distinctive values so a reflection is unambiguous in the assertion.
const SUB = 'sub-reflect-4f9c1a02';
const EMAIL = 'reflect-4f9c1a02@example.test';

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const CHILD = `
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
const ISSUER = ${JSON.stringify(ISSUER)};
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = await exportJWK(publicKey); jwk.alg = 'RS256'; jwk.kid = 'k1';
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (u.startsWith(ISSUER + '/')) {
    if (u.endsWith('/.well-known/openid-configuration')) {
      return Response.json({ issuer: ISSUER, jwks_uri: ISSUER + '/jwks', userinfo_endpoint: ISSUER + '/userinfo',
        authorization_endpoint: ISSUER + '/authorize', token_endpoint: ISSUER + '/token', response_types_supported: ['code'] });
    }
    if (u.endsWith('/jwks')) return Response.json({ keys: [jwk] });
    return new Response('not stubbed: ' + u, { status: 404 });
  }
  return realFetch(input, init);
};
const { startHttpServer } = await import('./dist/src/server/httpServer.js');
const { listener, cleanup } = await startHttpServer({}, 0, '/http', {}, [], 'desc', 'instr', {}, 'test', '127.0.0.1', undefined);
if (!listener.listening) await new Promise((res, rej) => { listener.once('listening', res); listener.once('error', rej); });
const base = 'http://127.0.0.1:' + listener.address().port;
const variant = process.env.T_TOKEN || 'other-aud';
const claims = new SignJWT({ scope: 'openid', email: ${JSON.stringify(EMAIL)} }).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
  .setIssuer(ISSUER).setSubject(${JSON.stringify(SUB)});
let token;
if (variant === 'expired') {
  const past = Math.floor(Date.now() / 1000) - 3600;
  token = await claims.setAudience(${JSON.stringify(RESOURCE)}).setIssuedAt(past - 60).setExpirationTime(past).sign(privateKey);
} else if (variant === 'wrong-key') {
  // A DIFFERENT key pair under the SAME kid: the JWKS stub still serves k1, so jose reaches
  // signature verification (JWSSignatureVerificationFailed). An unknown kid would throw
  // JWKSNoMatchingKey instead and prove nothing about the stripper.
  const other = await generateKeyPair('RS256');
  token = await claims.setAudience(${JSON.stringify(RESOURCE)}).setIssuedAt().setExpirationTime('5m').sign(other.privateKey);
} else {
  token = await claims.setAudience('https://some-other-app.example.test').setIssuedAt().setExpirationTime('5m').sign(privateKey);
}
const r = await realFetch(base + '/http', { method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
const results = { status: r.status, wwwAuthenticate: r.headers.get('www-authenticate'), body: await r.text() };
await new Promise((res) => listener.close(res));
process.removeListener('SIGTERM', cleanup); process.removeListener('SIGINT', cleanup);
process.stdout.write(${JSON.stringify(SENTINEL)} + JSON.stringify(results) + '\\n');
process.exit(0);
`;

function boot(nodeEnv, label, tokenVariant) {
  const env = {
    ...process.env,
    ACTUAL_SERVER_URL: 'http://localhost:5006',
    ACTUAL_PASSWORD: 'stub-password-for-unit-test',
    ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000',
    AUTH_PROVIDER: 'oidc',
    OIDC_ISSUER: ISSUER,
    OIDC_RESOURCE: RESOURCE,
    OIDC_ACCEPTED_AUDIENCES: undefined,
    NODE_ENV: nodeEnv,
    T_TOKEN: tokenVariant,
  };
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], { cwd: ROOT, env, encoding: 'utf8', timeout: 30000 });
  const resultLines = (child.stdout || '').split('\n').filter((l) => l.startsWith(SENTINEL));
  assert.strictEqual(child.signal, null, `${label}: child hung`);
  assert.strictEqual(child.status, 0, `${label}: child exited ${child.status}\n${(child.stderr || '').slice(-1200)}\n${(child.stdout || '').slice(-1200)}`);
  assert.strictEqual(resultLines.length, 1, `${label}: expected one sentinel line`);
  const r = JSON.parse(resultLines[0].slice(SENTINEL.length));
  let json = null;
  try { json = JSON.parse(r.body); } catch { /* asserted below */ }
  return { ...r, json };
}

console.log('\n[oidc-error-body] #463 NODE_ENV unset (showErrorDetails on): the claim is named, the payload is not reflected');
{
  const r = boot(undefined, 'dev');
  check('the other-audience token is rejected with 401 and WWW-Authenticate', () => {
    assert.strictEqual(r.status, 401, r.body);
    assert.ok(r.wwwAuthenticate, 'WWW-Authenticate missing');
  });
  check('the body is JSON with error=invalid_token', () => {
    assert.ok(r.json, `not JSON: ${r.body}`);
    assert.strictEqual(r.json.error, 'invalid_token');
  });
  check('the cause still names the failing claim (operators debugging an aud mismatch need this, #245)', () => {
    assert.ok(r.json.cause, `no cause in dev body: ${r.body}`);
    assert.strictEqual(r.json.cause.claim, 'aud', JSON.stringify(r.json.cause));
    assert.strictEqual(r.json.cause.code, 'ERR_JWT_CLAIM_VALIDATION_FAILED', JSON.stringify(r.json.cause));
  });
  check('the cause is the CLOSED shape: keys are a subset of code, claim, reason (no payload, name, message, stack)', () => {
    const extra = Object.keys(r.json.cause).filter((k) => !['code', 'claim', 'reason'].includes(k));
    assert.deepStrictEqual(extra, [], `unexpected keys in cause: ${JSON.stringify(r.json.cause)}`);
  });
  check('the body carries NO payload, and neither the sub nor the email of the presented token', () => {
    assert.ok(!('payload' in r.json.cause), `payload reflected: ${JSON.stringify(r.json.cause)}`);
    assert.ok(!r.body.includes(SUB), `sub reflected: ${r.body}`);
    assert.ok(!r.body.includes(EMAIL), `email reflected: ${r.body}`);
    assert.ok(!r.body.includes('some-other-app'), `aud reflected: ${r.body}`);
  });
}

console.log('\n[oidc-error-body] #463 NODE_ENV=production (showErrorDetails off): unchanged, no cause at all');
{
  const r = boot('production', 'production');
  check('401 with a bare invalid_token body and no cause key', () => {
    assert.strictEqual(r.status, 401, r.body);
    assert.ok(r.json, `not JSON: ${r.body}`);
    assert.strictEqual(r.json.error, 'invalid_token');
    assert.ok(!('cause' in r.json), `cause present in production: ${r.body}`);
    assert.ok(!r.body.includes(SUB) && !r.body.includes(EMAIL), r.body);
  });
}

console.log('\n[oidc-error-body] #463 scenario 4: an EXPIRED token (JWTExpired carries the same payload) is stripped too');
{
  const r = boot(undefined, 'expired', 'expired');
  check('401, cause.claim=exp, cause.code=ERR_JWT_EXPIRED, no payload, no sub or email', () => {
    assert.strictEqual(r.status, 401, r.body);
    assert.ok(r.json && r.json.cause, `no cause: ${r.body}`);
    assert.strictEqual(r.json.cause.claim, 'exp', JSON.stringify(r.json.cause));
    assert.strictEqual(r.json.cause.code, 'ERR_JWT_EXPIRED', JSON.stringify(r.json.cause));
    assert.ok(!('payload' in r.json.cause) && !r.body.includes(SUB) && !r.body.includes(EMAIL), r.body);
  });
}

console.log('\n[oidc-error-body] #463 scenario 5: a wrong-key signature (same kid) yields code only, nothing fabricated');
{
  const r = boot(undefined, 'wrong-key', 'wrong-key');
  check('401 and cause is exactly { code: ERR_JWS_SIGNATURE_VERIFICATION_FAILED }', () => {
    assert.strictEqual(r.status, 401, r.body);
    assert.ok(r.json && r.json.cause, `no cause: ${r.body}`);
    assert.deepStrictEqual(r.json.cause, { code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }, JSON.stringify(r.json.cause));
  });
}

console.log('\n[oidc-error-body] #463 source shape: the catch block touches err only through stripJoseCause');
check('inside customJwtVerify, `err` appears in the catch block only as the argument of stripJoseCause(', () => {
  const src = readFileSync(new URL('../../src/server/httpServer.ts', import.meta.url), 'utf8');
  const m = /catch \(err\) \{([\s\S]*?)\n\s*\}/.exec(src.slice(src.indexOf('const customJwtVerify')));
  assert.ok(m, 'catch (err) block not found in customJwtVerify');
  const body = m[1];
  const uses = body.match(/\berr\b/g) || [];
  const allowed = body.match(/stripJoseCause\(err\)/g) || [];
  assert.ok(uses.length >= 1, 'err is never used; the cause was dropped entirely (fails AC1)');
  assert.strictEqual(uses.length, allowed.length, `err is referenced outside stripJoseCause(err): ${body.trim()}`);
});

console.log(`\n[oidc-error-body] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
