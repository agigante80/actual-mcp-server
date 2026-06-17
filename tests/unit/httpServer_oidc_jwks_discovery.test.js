// #244: OIDC JWKS discovery + clean-401 error mapping.
//
// Covers (1) the pure resolver in src/lib/oidc-discovery.ts (resolve jwks_uri from
// a discovery document, with the https + same-host hardening), (2) the bearer-path
// behaviour: an expired or malformed token now yields a 401 instead of a 500, and a
// valid token still authorizes and sets req.auth.subject, and (3) a source-text
// assertion that httpServer.ts actually wires discoverJwksUri + the 401 mapping
// (mirrors tests/unit/httpServer_oidc_audience.test.js).
//
// Imports from dist/, so `npm run build` must run first (the pipeline does).
import assert from 'assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import express from 'express';
import { generateKeyPair, SignJWT, jwtVerify, exportJWK, createLocalJWKSet } from 'jose';
import { MCPAuthTokenVerificationError } from 'mcp-auth';
import { handleBearerAuth } from 'mcp-auth/handlers/handle-bearer-auth.js';

const { resolveJwksUri, assertSecureIssuer, isLoopbackHost } = await import('../../dist/src/lib/oidc-discovery.js');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok: ${name}`); }
  catch (err) { failed++; console.error(`  FAIL: ${name}\n        ${err.message}`); }
}
async function checkA(name, fn) {
  try { await fn(); console.log(`  ok: ${name}`); }
  catch (err) { failed++; console.error(`  FAIL: ${name}\n        ${err.message}`); }
}
const throws = (fn, re) => { try { fn(); } catch (e) { if (!re || re.test(e.message)) return; throw new Error(`wrong error: ${e.message}`); } throw new Error('expected a throw'); };

console.log('[oidc-jwks-discovery] resolveJwksUri (pure)');
check('returns a same-host https jwks_uri', () => {
  const got = resolveJwksUri({ jwks_uri: 'https://idp.example.com/keys' }, 'https://idp.example.com');
  assert.strictEqual(got, 'https://idp.example.com/keys');
});
check('accepts a non-default same-host path (Casdoor/Keycloak style)', () => {
  const got = resolveJwksUri({ jwks_uri: 'https://idp.example.com/realms/r/protocol/openid-connect/certs' }, 'https://idp.example.com');
  assert.ok(got.startsWith('https://idp.example.com/'));
});
check('rejects a document with no jwks_uri (fail closed)', () => throws(() => resolveJwksUri({}, 'https://idp.example.com'), /no usable "jwks_uri"/));
check('rejects a null document', () => throws(() => resolveJwksUri(null, 'https://idp.example.com'), /empty or not an object/));
check('rejects a non-https jwks_uri (downgrade)', () => throws(() => resolveJwksUri({ jwks_uri: 'http://idp.example.com/keys' }, 'https://idp.example.com'), /must use https/));
check('rejects a cross-host jwks_uri (tamper / Google-style)', () => throws(() => resolveJwksUri({ jwks_uri: 'https://evil.example.net/keys' }, 'https://idp.example.com'), /does not match the issuer origin/));
check('rejects a same-host but different-PORT jwks_uri (origin, not just host)', () => throws(() => resolveJwksUri({ jwks_uri: 'https://idp.example.com:9443/keys' }, 'https://idp.example.com:8443'), /does not match the issuer origin/));
check('accepts a same-origin jwks_uri with a matching explicit port', () => {
  assert.strictEqual(resolveJwksUri({ jwks_uri: 'https://idp.example.com:8443/keys' }, 'https://idp.example.com:8443'), 'https://idp.example.com:8443/keys');
});
check('rejects a jwks_uri with embedded credentials', () => throws(() => resolveJwksUri({ jwks_uri: 'https://user:pass@idp.example.com/keys' }, 'https://idp.example.com'), /embedded credentials/));

console.log('\n[oidc-jwks-discovery] assertSecureIssuer (downgrade guard)');
check('https issuer ok', () => { assertSecureIssuer('https://idp.example.com'); });
check('loopback http issuer ok (local dev)', () => { assertSecureIssuer('http://localhost:8080'); });
check('non-loopback http issuer fails closed', () => throws(() => assertSecureIssuer('http://idp.example.com'), /must use https/));
check('missing issuer fails closed', () => throws(() => assertSecureIssuer(undefined), /not set/));
check('issuer with embedded credentials fails closed', () => throws(() => assertSecureIssuer('https://user:pass@idp.example.com'), /embedded credentials/));
check('issuer with a query string fails closed', () => throws(() => assertSecureIssuer('https://idp.example.com/realm?x=1'), /query string or fragment/));
check('OIDC_ALLOW_INSECURE_ISSUER allows an http LAN issuer (opt-out)', () => { assertSecureIssuer('http://192.168.33.11:3353', true); });
check('opt-out still rejects embedded credentials', () => throws(() => assertSecureIssuer('http://u:p@192.168.33.11:3353', true), /embedded credentials/));
check('opt-out allows an http same-origin jwks_uri (LAN Casdoor)', () => {
  assert.strictEqual(
    resolveJwksUri({ jwks_uri: 'http://192.168.33.11:3353/.well-known/jwks' }, 'http://192.168.33.11:3353', true),
    'http://192.168.33.11:3353/.well-known/jwks',
  );
});
check('opt-out still enforces same-origin on the jwks_uri', () => throws(() => resolveJwksUri({ jwks_uri: 'http://evil.example.net/keys' }, 'http://192.168.33.11:3353', true), /does not match the issuer origin/));
check('isLoopbackHost', () => { assert.ok(isLoopbackHost('127.0.0.1') && isLoopbackHost('localhost') && !isLoopbackHost('idp.example.com')); });

console.log('\n[oidc-jwks-discovery] bearer path: bad token -> 401 (not 500), valid -> 200');
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = await exportJWK(publicKey); jwk.alg = 'RS256'; jwk.kid = 'k1';
const jwks = createLocalJWKSet({ keys: [jwk] });
const ISS = 'https://idp.example.com', AUD = 'client-1', RESOURCE = 'https://mcp.example.com';

// Mirror httpServer.ts customJwtVerify: wrap jose failures in MCPAuthTokenVerificationError.
const customJwtVerify = async (token) => {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwks, { issuer: ISS, audience: AUD }));
  } catch (err) {
    throw new MCPAuthTokenVerificationError('invalid_token', err instanceof Error ? err : undefined);
  }
  const rawAud = payload.aud; const audience = Array.isArray(rawAud) ? rawAud : (rawAud ? [rawAud] : []);
  return { token, subject: payload.sub, issuer: payload.iss ?? ISS, clientId: audience[0] ?? '', audience, scopes: [], expiresAt: payload.exp, claims: payload };
};

const app = express();
let lastAuthSubject = null;
app.use('/http', handleBearerAuth({ verifyAccessToken: customJwtVerify, issuer: ISS, audience: AUD, requiredScopes: [], resource: RESOURCE, showErrorDetails: true }));
app.post('/http', (req, res) => { lastAuthSubject = req.auth?.subject ?? null; res.status(200).json({ ok: true }); });

let sawUnhandled = false;
const onUnhandled = () => { sawUnhandled = true; };
process.on('unhandledRejection', onUnhandled);
const server = app.listen(0);
const port = server.address().port;
const now = Math.floor(Date.now() / 1000);
const base = () => new SignJWT({ scope: 'openid' }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(ISS).setAudience(AUD).setSubject('user-123').setIssuedAt(now - 60);
const expired = await base().setExpirationTime(now - 3600).sign(privateKey);
const valid = await base().setExpirationTime(now + 3600).sign(privateKey);

async function status(token) {
  const r = await fetch(`http://127.0.0.1:${port}/http`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
  return r.status;
}
await checkA('expired JWT -> 401', async () => assert.strictEqual(await status(expired), 401));
await checkA('malformed token -> 401', async () => assert.strictEqual(await status('not.a.jwt'), 401));
await checkA('valid JWT -> 200 and req.auth.subject set', async () => {
  assert.strictEqual(await status(valid), 200);
  assert.strictEqual(lastAuthSubject, 'user-123');
});
await new Promise((r) => setTimeout(r, 100));
check('no unhandledRejection on the bad-token path', () => assert.strictEqual(sawUnhandled, false));
process.removeListener('unhandledRejection', onUnhandled);
server.close();

console.log('\n[oidc-jwks-discovery] real code wiring (source assertions)');
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../../src/server/httpServer.ts'), 'utf8');
check('httpServer uses discoverJwksUri + jwksUri (not the hardcoded URL construction)', () => {
  assert.ok(/discoverJwksUri\(config\.OIDC_ISSUER\b/.test(src), 'expected discoverJwksUri(config.OIDC_ISSUER, ...) call');
  assert.ok(src.includes('createRemoteJWKSet(new URL(jwksUri))'), 'expected createRemoteJWKSet(new URL(jwksUri))');
  // The OLD hardcoded code construction must be gone (a comment mentioning the path is fine).
  assert.ok(!/new URL\(\s*`\$\{config\.OIDC_ISSUER\}\/\.well-known\/jwks`/.test(src), 'the hardcoded JWKS URL construction must be gone');
});
check('httpServer maps verify failures to MCPAuthTokenVerificationError', () => {
  assert.ok(/catch\s*\(err\)[\s\S]{0,160}MCPAuthTokenVerificationError\('invalid_token'/.test(src), 'expected 401 mapping in customJwtVerify');
});

console.log(`\n[oidc-jwks-discovery] Results: ${failed === 0 ? 'all passed' : failed + ' failed'}`);
process.exit(failed > 0 ? 1 : 0);
