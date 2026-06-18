// tests/unit/httpServer_oidc_audience.test.js
//
// #160 (OWASP A07): the OIDC JWT verifier only checked `issuer`, so a token
// minted by the same IdP for a DIFFERENT relying party was accepted (cross-RP
// replay). The fix passes `audience: config.OIDC_RESOURCE` to jose's jwtVerify.
//
// We (1) prove jose's audience option enforces `aud` (pass on match, throw on
// mismatch/missing), and (2) source-assert that customJwtVerify wires it.
//
// Run: node tests/unit/httpServer_oidc_audience.test.js

import assert from 'assert';
import { SignJWT, jwtVerify, generateKeyPair } from 'jose';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// #245: the accepted-audiences allowlist builder (imports from dist; build first).
const { buildAcceptedAudiences } = await import('../../dist/src/lib/oidc-audiences.js');

let passed = 0, failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const ISSUER = 'https://issuer.example';
const AUD = 'actual-mcp-client-id';
const { publicKey, privateKey } = await generateKeyPair('RS256');

function signed(claims) {
  let t = new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuer(ISSUER).setExpirationTime('5m');
  if (claims.aud) t = t.setAudience(claims.aud);
  return t.sign(privateKey);
}

console.log('\n[oidc-audience] jose audience enforcement');

await check('POSITIVE: token with matching aud verifies', async () => {
  const tok = await signed({ aud: AUD });
  await jwtVerify(tok, publicKey, { issuer: ISSUER, audience: AUD }); // must not throw
});

await check('NEGATIVE: token for a different relying party is rejected', async () => {
  const tok = await signed({ aud: 'some-other-rp' });
  await assert.rejects(
    () => jwtVerify(tok, publicKey, { issuer: ISSUER, audience: AUD }),
    (e) => e.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && e.claim === 'aud',
  );
});

await check('NEGATIVE: token with no aud claim is rejected when audience is enforced', async () => {
  const tok = await signed({});
  await assert.rejects(
    () => jwtVerify(tok, publicKey, { issuer: ISSUER, audience: AUD }),
    (e) => e.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED',
  );
});

await check('control: WITHOUT the audience option the cross-RP token would have passed (the old vuln)', async () => {
  const tok = await signed({ aud: 'some-other-rp' });
  await jwtVerify(tok, publicKey, { issuer: ISSUER }); // issuer-only: accepts any aud
});

console.log('\n[oidc-audience] #245 buildAcceptedAudiences (strict allowlist)');

await check('default (no extras) is exactly [OIDC_RESOURCE]', async () => {
  assert.deepStrictEqual(buildAcceptedAudiences('https://mcp.example.com', undefined), ['https://mcp.example.com']);
  assert.deepStrictEqual(buildAcceptedAudiences('https://mcp.example.com', ''), ['https://mcp.example.com']);
});
await check('extras are added (resource plus configured client-id)', async () => {
  assert.deepStrictEqual(
    buildAcceptedAudiences('https://mcp.example.com', 'client-1, client-2'),
    ['https://mcp.example.com', 'client-1', 'client-2'],
  );
});
await check('trailing comma / whitespace entries are filtered (no empty-string audience)', async () => {
  const set = buildAcceptedAudiences('https://mcp.example.com', 'client-1, ,  ,');
  assert.deepStrictEqual(set, ['https://mcp.example.com', 'client-1']);
  assert.ok(!set.includes(''), 'no empty-string member may enter the accepted set');
});
await check('duplicates are collapsed', async () => {
  assert.deepStrictEqual(buildAcceptedAudiences('a', 'a, b, b'), ['a', 'b']);
});
await check('a whitespace-only resource with no extras yields an EMPTY set (caller must fail closed)', async () => {
  assert.deepStrictEqual(buildAcceptedAudiences('   ', undefined), []);
  assert.deepStrictEqual(buildAcceptedAudiences('   ', '  ,  '), []);
});

console.log('\n[oidc-audience] #245 jose match-any over the array allowlist');

await check('POSITIVE: aud matching ONLY a configured extra (not the resource) is accepted', async () => {
  const accepted = buildAcceptedAudiences(AUD, 'extra-client-id');
  const tok = await signed({ aud: 'extra-client-id' });
  await jwtVerify(tok, publicKey, { issuer: ISSUER, audience: accepted }); // must not throw
});
await check('POSITIVE: aud equal to the resource is still accepted with extras configured', async () => {
  const accepted = buildAcceptedAudiences(AUD, 'extra-client-id');
  const tok = await signed({ aud: AUD });
  await jwtVerify(tok, publicKey, { issuer: ISSUER, audience: accepted });
});
await check('NEGATIVE: aud outside the set is rejected (#160 preserved)', async () => {
  const accepted = buildAcceptedAudiences(AUD, 'extra-client-id');
  const tok = await signed({ aud: 'some-other-rp' });
  await assert.rejects(
    () => jwtVerify(tok, publicKey, { issuer: ISSUER, audience: accepted }),
    (e) => e.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && e.claim === 'aud',
  );
});
await check('NEGATIVE: empty-string aud is rejected (a stray "" cannot widen the set)', async () => {
  const accepted = buildAcceptedAudiences(AUD, 'client-1, ,');   // empties filtered out
  const tok = await signed({ aud: '' });
  await assert.rejects(
    () => jwtVerify(tok, publicKey, { issuer: ISSUER, audience: accepted }),
    (e) => e.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED',
  );
});

console.log('\n[oidc-audience] wiring');

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../../src/server/httpServer.ts'), 'utf8');

await check('customJwtVerify passes the acceptedAudiences allowlist array to jwtVerify (#245)', async () => {
  assert.match(src, /audience:\s*acceptedAudiences/);
  assert.match(src, /buildAcceptedAudiences\(config\.OIDC_RESOURCE,\s*config\.OIDC_ACCEPTED_AUDIENCES\)/);
});
await check('NEGATIVE: no wildcard / accept-any audience branch exists in the verifier', async () => {
  assert.ok(!/audience:\s*['"`]\*['"`]/.test(src), 'no wildcard audience');
  assert.ok(!/audience:\s*\[\s*\]/.test(src), 'no empty-array (accept-any) audience');
});
await check('the verifier fails closed when the accepted-audiences set is empty (no audience-omitted path)', async () => {
  assert.match(src, /acceptedAudiences\.length === 0[\s\S]{0,200}throw new Error/);
  assert.ok(!/\?\s*\{\s*audience:\s*acceptedAudiences\s*\}\s*:\s*\{\s*\}/.test(src), 'the audience-omitting ternary must be gone');
});
await check('the stale single-audience wiring (audience: config.OIDC_RESOURCE) is gone', async () => {
  assert.ok(!/audience:\s*config\.OIDC_RESOURCE\b/.test(src));
});
await check('the misleading "audience intentionally omitted" comment is gone', async () => {
  assert.ok(!/audience intentionally omitted/.test(src));
});

console.log(`\n[oidc-audience] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
