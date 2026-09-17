// tests/unit/oidc_metadata_discovery.test.js
//
// #285: discoverOidcMetadata fetches the issuer's OIDC discovery document ONCE and
// returns BOTH the validated jwks_uri and the raw metadata object, so the HTTP
// server can re-serve the doc at /.well-known/oauth-authorization-server (RFC 8414)
// without a second fetch and without a request-path SSRF surface. This test pins:
//   - the happy path returns { jwksUri, metadata } with metadata deep-equal to the doc,
//   - it fails closed on the same conditions discoverJwksUri does (non-object doc,
//     missing jwks_uri, non-https issuer, redirect, non-200, bad JSON),
//   - discoverJwksUri still returns the same jwks_uri (delegation preserves behaviour).
//
// Network-free: the fetch is injected. Dummy env only satisfies config validation.
//
// Run: node tests/unit/oidc_metadata_discovery.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

import assert from 'node:assert';
import { discoverOidcMetadata, discoverJwksUri, resolveJwksUri, resolveDirectJwksUri, resolveJwksSource } from '../../dist/src/lib/oidc-discovery.js';

const ISSUER = 'https://idp.example.com';
const JWKS = 'https://idp.example.com/jwks';

// A representative OIDC discovery doc (superset of RFC 8414 fields clients need).
const DOC = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  registration_endpoint: `${ISSUER}/register`,
  jwks_uri: JWKS,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
};

/** Build an injectable fetch that returns `body` as JSON with the given status. */
function okFetch(body, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}
/** A fetch that rejects, simulating redirect:'error' or a network failure. */
function throwingFetch(message) {
  return async () => { throw new Error(message); };
}

let passed = 0, failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label}: ${err.message}`); failed++; }
}

console.log('\n[oidc-metadata-discovery] #285 discoverOidcMetadata');

await check('returns { jwksUri, metadata } with metadata deep-equal to the discovery doc', async () => {
  const { jwksUri, metadata } = await discoverOidcMetadata(ISSUER, false, [], okFetch(DOC));
  assert.strictEqual(jwksUri, JWKS);
  assert.deepStrictEqual(metadata, DOC);
  // The returned object is the served-verbatim RFC 8414 doc: it must carry the
  // token_endpoint a client needs and must NOT be wrapped in any envelope.
  assert.strictEqual(metadata.token_endpoint, `${ISSUER}/token`);
  assert.ok(!('jsonrpc' in metadata) && !('result' in metadata), 'metadata must be a bare object');
});

await check('discoverJwksUri delegates and returns the same jwks_uri (regression)', async () => {
  const jwksUri = await discoverJwksUri(ISSUER, false, [], okFetch(DOC));
  assert.strictEqual(jwksUri, JWKS);
});

await check('throws on a non-https issuer with no opt-out (fail closed, before any fetch)', async () => {
  let fetched = false;
  const spy = async () => { fetched = true; return okFetch(DOC)(); };
  await assert.rejects(() => discoverOidcMetadata('http://idp.example.com', false, [], spy), /must use https/i);
  assert.strictEqual(fetched, false, 'must reject before fetching');
});

await check('throws when the discovery doc has no jwks_uri', async () => {
  const { jwks_uri, ...noJwks } = DOC;
  void jwks_uri;
  await assert.rejects(() => discoverOidcMetadata(ISSUER, false, [], okFetch(noJwks)), /jwks_uri/i);
});

await check('throws when the discovery doc is not an object', async () => {
  await assert.rejects(() => discoverOidcMetadata(ISSUER, false, [], okFetch('not-an-object')), /empty or not an object/i);
});

await check('throws when the jwks_uri is cross-origin and not allowlisted', async () => {
  const crossDoc = { ...DOC, jwks_uri: 'https://evil.example.net/jwks' };
  await assert.rejects(() => discoverOidcMetadata(ISSUER, false, [], okFetch(crossDoc)), /cross-origin/i);
});

await check('accepts a cross-origin jwks_uri when its host is allowlisted (#254 still works via delegation)', async () => {
  const googleDoc = { ...DOC, jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs' };
  const { jwksUri, metadata } = await discoverOidcMetadata(ISSUER, false, ['www.googleapis.com'], okFetch(googleDoc));
  assert.strictEqual(jwksUri, 'https://www.googleapis.com/oauth2/v3/certs');
  assert.deepStrictEqual(metadata, googleDoc);
});

await check('throws (fail closed) when the fetch rejects, e.g. a redirect (redirect:error)', async () => {
  await assert.rejects(() => discoverOidcMetadata(ISSUER, false, [], throwingFetch('redirected')), /discovery fetch failed/i);
});

await check('throws on a non-200 discovery response', async () => {
  await assert.rejects(() => discoverOidcMetadata(ISSUER, false, [], okFetch(DOC, 404)), /HTTP 404/);
});

console.log('\n[oidc-metadata-discovery] #462 resolveDirectJwksUri (operator-typed key URL, no discovery)');

const TEAM = 'https://team.cloudflareaccess.test';
const CERTS = `${TEAM}/cdn-cgi/access/certs`;
const rejects = (fn, ...needles) => {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  assert.ok(msg !== null, 'expected a throw');
  for (const n of needles) assert.ok(msg.includes(n), `message lacks "${n}": ${msg}`);
};

await check('accepts a same-origin https key URL (the Cloudflare certs endpoint) and returns it verbatim', async () => {
  assert.strictEqual(resolveDirectJwksUri(CERTS, TEAM), CERTS);
});
await check('accepts a trusted cross-origin https host (OIDC_JWKS_TRUSTED_HOSTS, #254)', async () => {
  assert.strictEqual(resolveDirectJwksUri('https://keys.example.test/certs', TEAM, false, ['keys.example.test']), 'https://keys.example.test/certs');
});
await check('rejects an untrusted cross-origin host, naming OIDC_JWKS_URI and OIDC_JWKS_TRUSTED_HOSTS', async () => {
  rejects(() => resolveDirectJwksUri('https://keys.example.test/certs', TEAM), 'OIDC_JWKS_URI', 'OIDC_JWKS_TRUSTED_HOSTS');
});
await check('rejects a plaintext key URL under an https issuer, accepts http only same-origin with the insecure opt-in', async () => {
  rejects(() => resolveDirectJwksUri('http://team.cloudflareaccess.test/certs', TEAM, false), 'OIDC_JWKS_URI');
  assert.strictEqual(resolveDirectJwksUri('http://team.cloudflareaccess.test/certs', 'http://team.cloudflareaccess.test', true), 'http://team.cloudflareaccess.test/certs');
});
await check('rejects http cross-origin even with the opt-in AND the trusted host (never plaintext to a third party)', async () => {
  rejects(() => resolveDirectJwksUri('http://keys.example.test/certs', TEAM, true, ['keys.example.test']), 'OIDC_JWKS_URI', 'https');
});
await check('rejects a fragment, a query string, and embedded credentials (direct-path rules)', async () => {
  rejects(() => resolveDirectJwksUri(`${CERTS}#frag`, TEAM), 'OIDC_JWKS_URI', 'fragment');
  rejects(() => resolveDirectJwksUri(`${CERTS}?p=x`, TEAM), 'OIDC_JWKS_URI', 'query');
  const msg = (() => { try { resolveDirectJwksUri('https://u:s3cr3t@team.cloudflareaccess.test/certs', TEAM); } catch (e) { return e.message; } })();
  assert.ok(msg && msg.includes('credentials') && !msg.includes('s3cr3t'), String(msg));
});
await check('rejects an empty or unparseable value naming OIDC_JWKS_URI', async () => {
  rejects(() => resolveDirectJwksUri('', TEAM), 'OIDC_JWKS_URI');
  rejects(() => resolveDirectJwksUri('not a url', TEAM), 'OIDC_JWKS_URI');
});
await check('still validates the ISSUER (assertSecureIssuer runs even though discovery is skipped)', async () => {
  rejects(() => resolveDirectJwksUri(CERTS, 'http://team.cloudflareaccess.test'), 'OIDC_ISSUER');
});
await check('NEGATIVE CONTROL: the discovery path still ACCEPTS a query-bearing jwks_uri (Azure AD B2C ?p=policy), query intact', async () => {
  const b2c = 'https://issuer.example.test/discovery/v2.0/keys?p=B2C_1_signin';
  assert.strictEqual(resolveJwksUri({ jwks_uri: b2c }, 'https://issuer.example.test'), b2c);
});

console.log('\n[oidc-metadata-discovery] #462 resolveJwksSource');

await check('with directJwksUri: returns { jwksUri, metadata: null } and NEVER calls fetch', async () => {
  const r = await resolveJwksSource({ issuer: TEAM, allowInsecure: false, trustedHosts: [], directJwksUri: CERTS }, throwingFetch('fetch must not be called'));
  assert.deepStrictEqual(r, { jwksUri: CERTS, metadata: null });
});
await check('without directJwksUri: delegates to discovery (metadata is the document, jwksUri from it)', async () => {
  const r = await resolveJwksSource({ issuer: ISSUER, allowInsecure: false, trustedHosts: [], directJwksUri: undefined }, okFetch(DOC));
  assert.strictEqual(r.jwksUri, JWKS);
  assert.deepStrictEqual(r.metadata, DOC);
});
await check('an EMPTY directJwksUri is unset: discovery runs (the repo convention for optional vars, matching the config refines)', async () => {
  const r = await resolveJwksSource({ issuer: ISSUER, allowInsecure: false, trustedHosts: [], directJwksUri: '' }, okFetch(DOC));
  assert.deepStrictEqual(r.metadata, DOC);
});
await check('MUTATION: a bad direct URI rejects through resolveJwksSource too', async () => {
  await assert.rejects(() => resolveJwksSource({ issuer: TEAM, allowInsecure: false, trustedHosts: [], directJwksUri: 'https://keys.example.test/certs' }, throwingFetch('x')), /OIDC_JWKS_URI/);
});

console.log(`\n[oidc-metadata-discovery] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
