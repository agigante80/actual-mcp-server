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

console.log('\n[oidc-audience] wiring');

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../../src/server/httpServer.ts'), 'utf8');

await check('customJwtVerify passes audience: config.OIDC_RESOURCE to jwtVerify', async () => {
  assert.match(src, /audience:\s*config\.OIDC_RESOURCE/);
});
await check('the misleading "audience intentionally omitted" comment is gone', async () => {
  assert.ok(!/audience intentionally omitted/.test(src));
});

console.log(`\n[oidc-audience] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
