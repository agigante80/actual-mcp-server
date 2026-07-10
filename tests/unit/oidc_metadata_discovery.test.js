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
import { discoverOidcMetadata, discoverJwksUri } from '../../dist/src/lib/oidc-discovery.js';

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

console.log(`\n[oidc-metadata-discovery] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
