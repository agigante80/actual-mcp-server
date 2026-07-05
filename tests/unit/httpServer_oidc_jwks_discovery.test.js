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

const { resolveJwksUri, assertSecureIssuer, isLoopbackHost, buildTrustedJwksHosts } = await import('../../dist/src/lib/oidc-discovery.js');
const { configSchema } = await import('../../dist/src/config.js');

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

// #254: opt-in cross-origin JWKS trusted-host allowlist (OIDC_JWKS_TRUSTED_HOSTS).
console.log('\n[oidc-jwks-discovery] trusted-hosts allowlist (#254, pure matrix)');
const GOOGLE_DOC = { jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs' };
const GOOGLE_ISS = 'https://accounts.google.com';
check('1. empty allowlist [] + cross-origin jwks_uri still throws (regression)', () =>
  throws(() => resolveJwksUri(GOOGLE_DOC, GOOGLE_ISS, false, []), /does not match the issuer origin/));
check('2. listed host accepts the Google-shaped doc (red check gone green)', () => {
  assert.strictEqual(resolveJwksUri(GOOGLE_DOC, GOOGLE_ISS, false, ['www.googleapis.com']), GOOGLE_DOC.jwks_uri);
});
check('3. matching is case-insensitive after lowercasing', () => {
  assert.strictEqual(resolveJwksUri({ jwks_uri: 'https://WWW.GOOGLEAPIS.COM/oauth2/v3/certs' }, GOOGLE_ISS, false, buildTrustedJwksHosts('WWW.GoogleAPIs.com')), 'https://www.googleapis.com/oauth2/v3/certs');
});
check('4. unlisted cross-origin host still throws', () =>
  throws(() => resolveJwksUri(GOOGLE_DOC, GOOGLE_ISS, false, ['other.example.com']), /does not match the issuer origin/));
check('5. no suffix matching: a listed parent domain does not allow a subdomain', () =>
  throws(() => resolveJwksUri(GOOGLE_DOC, GOOGLE_ISS, false, ['googleapis.com']), /does not match the issuer origin/));
check('6. port-strict: bare host entry does not allow an explicit-port jwks_uri; host:port entry does', () => {
  throws(() => resolveJwksUri({ jwks_uri: 'https://www.googleapis.com:8443/certs' }, GOOGLE_ISS, false, ['www.googleapis.com']), /does not match the issuer origin/);
  assert.strictEqual(resolveJwksUri({ jwks_uri: 'https://www.googleapis.com:8443/certs' }, GOOGLE_ISS, false, ['www.googleapis.com:8443']), 'https://www.googleapis.com:8443/certs');
});
check('7. http jwks_uri on a listed host still throws (https check unconditional)', () =>
  throws(() => resolveJwksUri({ jwks_uri: 'http://www.googleapis.com/certs' }, GOOGLE_ISS, false, ['www.googleapis.com']), /must use https/));
check('8. embedded credentials on a listed host still throws', () =>
  throws(() => resolveJwksUri({ jwks_uri: 'https://u:p@www.googleapis.com/certs' }, GOOGLE_ISS, false, ['www.googleapis.com']), /embedded credentials/));
check('9. same-origin jwks_uri accepted with a non-empty allowlist (list not consulted)', () => {
  assert.strictEqual(resolveJwksUri({ jwks_uri: 'https://idp.example.com/keys' }, 'https://idp.example.com', false, ['www.googleapis.com']), 'https://idp.example.com/keys');
});
check('10. allowInsecure NEVER extends to cross-origin: http jwks_uri on a listed host throws even with the #244 opt-out', () =>
  throws(() => resolveJwksUri({ jwks_uri: 'http://keys.lan/keys' }, 'http://192.168.33.11:3353', true, ['keys.lan']), /must use https/));
check('11. loopback exemption never extends to cross-origin: listed http loopback jwks_uri still throws', () =>
  throws(() => resolveJwksUri({ jwks_uri: 'http://localhost:9999/keys' }, 'https://idp.example.com', false, ['localhost:9999']), /must use https/));

console.log('\n[oidc-jwks-discovery] buildTrustedJwksHosts (pure parser, fail fast)');
check('undefined and empty string give []', () => {
  assert.deepStrictEqual(buildTrustedJwksHosts(undefined), []);
  assert.deepStrictEqual(buildTrustedJwksHosts(''), []);
});
check('trailing comma and whitespace entries dropped; values trimmed + lowercased; duplicates collapsed', () => {
  assert.deepStrictEqual(buildTrustedJwksHosts(' WWW.GoogleAPIs.com , keys.Example.ORG:8443 ,, '), ['www.googleapis.com', 'keys.example.org:8443']);
  assert.deepStrictEqual(buildTrustedJwksHosts('a.example.com,A.EXAMPLE.COM'), ['a.example.com']);
});
check('invalid entries throw at startup (fail fast, never silently dropped)', () => {
  throws(() => buildTrustedJwksHosts('https://host.example.com'), /invalid/i);
  throws(() => buildTrustedJwksHosts('host.example.com/path'), /invalid/i);
  throws(() => buildTrustedJwksHosts('user@host.example.com'), /invalid/i);
  throws(() => buildTrustedJwksHosts('*'), /invalid/i);
  throws(() => buildTrustedJwksHosts('two words.example.com'), /invalid/i);
});
check('never-matchable entries throw too (canonical URL round-trip)', () => {
  throws(() => buildTrustedJwksHosts('www.googleapis.com:443'), /invalid/i, ':443 is elided by URL.host and would sit inert');
  throws(() => buildTrustedJwksHosts('host.example.com:'), /invalid/i);
  throws(() => buildTrustedJwksHosts('host.example.com:abc'), /invalid/i);
  throws(() => buildTrustedJwksHosts('bücher.example'), /invalid/i, 'raw-unicode IDN never equals the punycode URL.host');
  throws(() => buildTrustedJwksHosts('::1'), /invalid/i, 'unbracketed IPv6 never equals the bracketed URL.host');
});
check('a bracketed IPv6 host:port entry is valid and matches its URL.host form', () => {
  assert.deepStrictEqual(buildTrustedJwksHosts('[::1]:8443'), ['[::1]:8443']);
});
check('configSchema keeps OIDC_JWKS_TRUSTED_HOSTS as a raw optional string', () => {
  const base = { ACTUAL_SERVER_URL: 'http://localhost:5006', ACTUAL_PASSWORD: 'x', ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000' };
  const absent = configSchema.safeParse({ ...base });
  assert.strictEqual(absent.success, true);
  assert.strictEqual(absent.data.OIDC_JWKS_TRUSTED_HOSTS, undefined);
  const set = configSchema.safeParse({ ...base, OIDC_JWKS_TRUSTED_HOSTS: 'www.googleapis.com, keys.example.org' });
  assert.strictEqual(set.success, true);
  assert.strictEqual(set.data.OIDC_JWKS_TRUSTED_HOSTS, 'www.googleapis.com, keys.example.org');
});

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
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new MCPAuthTokenVerificationError('invalid_token');
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
await checkA('signature-valid token with NO sub -> 401 (invalid_token)', async () => {
  const noSub = await new SignJWT({ scope: 'openid' }).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISS).setAudience(AUD).setIssuedAt(now - 60).setExpirationTime(now + 3600).sign(privateKey);
  assert.strictEqual(await status(noSub), 401);
});
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
  assert.ok(/discoverJwksUri\(\s*config\.OIDC_ISSUER\b/.test(src), 'expected discoverJwksUri(config.OIDC_ISSUER, ...) call');
  assert.ok(src.includes('createRemoteJWKSet(new URL(jwksUri))'), 'expected createRemoteJWKSet(new URL(jwksUri))');
  // The OLD hardcoded code construction must be gone (a comment mentioning the path is fine).
  assert.ok(!/new URL\(\s*`\$\{config\.OIDC_ISSUER\}\/\.well-known\/jwks`/.test(src), 'the hardcoded JWKS URL construction must be gone');
});
check('httpServer threads buildTrustedJwksHosts(config.OIDC_JWKS_TRUSTED_HOSTS) into discoverJwksUri (#254)', () => {
  assert.ok(/buildTrustedJwksHosts\(config\.OIDC_JWKS_TRUSTED_HOSTS\)/.test(src), 'expected the parsed allowlist threaded at the composition root');
  assert.ok(/discoverJwksUri\(\s*config\.OIDC_ISSUER[\s\S]{0,220}buildTrustedJwksHosts/.test(src), 'expected discoverJwksUri to receive the trusted-hosts array');
});
check('httpServer maps verify failures to MCPAuthTokenVerificationError', () => {
  assert.ok(/catch\s*\(err\)[\s\S]{0,160}MCPAuthTokenVerificationError\('invalid_token'/.test(src), 'expected 401 mapping in customJwtVerify');
});
check('httpServer rejects a token with no usable sub (invalid_token)', () => {
  assert.ok(/payload\.sub[\s\S]{0,120}MCPAuthTokenVerificationError\('invalid_token'\)/.test(src), 'expected a missing-sub rejection');
  assert.ok(src.includes('subject: payload.sub,'), 'expected subject populated from payload.sub');
});

console.log(`\n[oidc-jwks-discovery] Results: ${failed === 0 ? 'all passed' : failed + ' failed'}`);
process.exit(failed > 0 ? 1 : 0);
