// tests/unit/oidc_bearer_middleware.test.js
//
// #634: src/auth/bearer.ts replaced the mcp-auth package. Its contract is "a client sees no
// difference", so this file replays every response captured from mcp-auth 0.2.0
// (tests/unit/fixtures/mcp-auth-0.2.0-golden.json) against the built module and compares
// status, the auth and CORS headers, and the body. The cases cover each header failure, each
// verifier outcome, issuer, audience and scope checks with and without error details, the
// resource_metadata URL for every resource shape, and the metadata route's methods, CORS
// preflight and sub-path prefix match.
//
// The fixture is frozen: regenerate it only from mcp-auth itself, never from this module, or
// the comparison proves nothing.
//
// Run: node tests/unit/oidc_bearer_middleware.test.js   (needs `npm run build` first)

import assert from 'assert';
import { readFileSync } from 'fs';
import express from 'express';
import {
  BearerAuthError,
  TokenVerificationError,
  bearerAuthMiddleware,
  resourceMetadataRouter,
} from '../../dist/src/auth/bearer.js';

const golden = JSON.parse(readFileSync(new URL('./fixtures/mcp-auth-0.2.0-golden.json', import.meta.url), 'utf8'));
const ISS = golden.issuer;

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

// The same verifiers the capture used, with mcp-auth's error class swapped for ours.
function joseLike() {
  const s = new Error('"aud" claim check failed');
  s.code = 'ERR_JWT_CLAIM_VALIDATION_FAILED'; s.claim = 'aud'; s.reason = 'check_failed';
  return s;
}
const VALID = { token: 't', subject: 'user-1', issuer: ISS, clientId: 'https://mcp.example/mcp', audience: ['https://mcp.example/mcp'], scopes: ['budget:read'], expiresAt: 4102444800, claims: { sub: 'user-1' } };
const verifiers = {
  valid: async () => ({ ...VALID }),
  noScopes: async () => ({ ...VALID, scopes: [] }),
  wrongIssuer: async () => ({ ...VALID, issuer: 'https://other.example' }),
  wrongAudience: async () => ({ ...VALID, audience: ['aud-2'] }),
  tveWithCause: async () => { throw new TokenVerificationError('invalid_token', joseLike()); },
  tveNoCause: async () => { throw new TokenVerificationError('invalid_token'); },
  tveFailed: async () => { throw new TokenVerificationError('token_verification_failed'); },
  boom: async () => { throw new Error('boom'); },
};

const PICK = ['www-authenticate', 'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'vary', 'content-length', 'content-type'];
async function run(app, path, init) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  const text = await res.text();
  await new Promise((r) => server.close(r));
  const headers = {};
  for (const h of PICK) { const v = res.headers.get(h); if (v !== null) headers[h] = v; }
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, headers, body };
}

console.log(`\n[oidc-bearer-middleware] replaying ${golden.capturedFrom} middleware responses`);
for (const c of golden.middleware) {
  await check(`middleware ${c.name}`, async () => {
    const app = express();
    app.use('/mcp', bearerAuthMiddleware(verifiers[c.verify], { issuers: [ISS], resource: c.resource, ...c.opts }),
      (req, res) => res.status(200).json({ reached: true, auth: req.auth }));
    app.use((err, _req, res, _next) => res.status(599).json({ handlerGot: err.message }));
    assert.deepStrictEqual(await run(app, '/mcp', { method: 'POST', headers: c.headers }), c.response);
  });
}

console.log(`[oidc-bearer-middleware] replaying ${golden.capturedFrom} metadata responses`);
for (const c of golden.metadata) {
  await check(`metadata ${c.method} ${c.path} (resource ${c.resource}, ${JSON.stringify(c.requestHeaders)})`, async () => {
    const router = resourceMetadataRouter({ resource: c.resource, issuer: ISS, scopesSupported: golden.scopesSupported });
    assert.deepStrictEqual(router.stack.filter((l) => l.route).map((l) => l.route.path), c.routePaths);
    const app = express();
    app.use(router);
    assert.deepStrictEqual(await run(app, c.path, { method: c.method, headers: c.requestHeaders }), c.response);
  });
}

console.log('[oidc-bearer-middleware] the departures and guards the fixture cannot show');

await check('the fixture covers every verifier and both detail settings (a shrunk fixture would pass vacuously)', () => {
  assert.ok(golden.middleware.length >= 30 && golden.metadata.length >= 35, `${golden.middleware.length} / ${golden.metadata.length}`);
  for (const v of Object.keys(verifiers)) assert.ok(golden.middleware.some((c) => c.verify === v), `no case for ${v}`);
});

await check('a pre-set req.auth is replaced and nothing is written to the console', async () => {
  const writes = [];
  const orig = console.warn;
  console.warn = (...a) => writes.push(a);
  try {
    const app = express();
    app.use((req, _res, next) => { req.auth = { subject: 'stale' }; next(); });
    app.use('/mcp', bearerAuthMiddleware(verifiers.valid, { issuers: [ISS] }), (req, res) => res.json({ subject: req.auth.subject }));
    const r = await run(app, '/mcp', { method: 'POST', headers: { authorization: 'Bearer tok' } });
    assert.deepStrictEqual(r.body, { subject: 'user-1' });
  } finally { console.warn = orig; }
  assert.deepStrictEqual(writes, []);
});

await check('without a resource the 401 carries no resource_metadata', async () => {
  const app = express();
  app.use('/mcp', bearerAuthMiddleware(verifiers.valid, { issuers: [ISS] }), (_req, res) => res.json({}));
  const r = await run(app, '/mcp', { method: 'POST' });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.headers['www-authenticate'], 'Bearer error="missing_auth_header", error_description="Missing `Authorization` header. Please provide a valid bearer token."');
});

await check('a cause is never in the body when showErrorDetails is off (default)', async () => {
  const app = express();
  app.use('/mcp', bearerAuthMiddleware(verifiers.tveWithCause, { issuers: [ISS] }), (_req, res) => res.json({}));
  const r = await run(app, '/mcp', { method: 'POST', headers: { authorization: 'Bearer tok' } });
  assert.deepStrictEqual(r.body, { error: 'invalid_token', error_description: 'The provided token is invalid or malformed.' });
});

await check('BearerAuthError and TokenVerificationError keep their codes and names', () => {
  const b = new BearerAuthError('invalid_issuer');
  const t = new TokenVerificationError('invalid_token');
  assert.strictEqual(b.code, 'invalid_issuer');
  assert.strictEqual(b.name, 'BearerAuthError');
  assert.strictEqual(t.code, 'invalid_token');
  assert.strictEqual(t.name, 'TokenVerificationError');
  assert.ok(b instanceof Error && t instanceof Error);
});

await check('a bare client id as resource throws our TypeError at construction', () => {
  assert.throws(() => resourceMetadataRouter({ resource: 'my-client-id', issuer: ISS, scopesSupported: [] }), /Invalid resource identifier URI: my-client-id/);
  assert.throws(() => bearerAuthMiddleware(verifiers.valid, { issuers: [ISS], resource: 'my-client-id' }), TypeError);
});

console.log(`\n[oidc-bearer-middleware] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
