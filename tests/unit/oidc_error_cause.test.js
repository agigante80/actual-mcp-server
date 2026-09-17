// tests/unit/oidc_error_cause.test.js
//
// #463: stripJoseCause keeps the operator-useful fields of a jose verification error
// (code, claim, reason, message) and drops everything else, above all `payload`, the
// decoded token that JWTClaimValidationFailed and JWTExpired carry as an own enumerable
// property and that mcp-auth would otherwise serialise into the 401 body.
//
// Plain objects shaped like the jose classes, no jose import: the helper is structural
// by design, so this file proves the shape contract rather than a class list.
//
// Run: node tests/unit/oidc_error_cause.test.js

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripJoseCause } from '../../dist/src/lib/oidc-error-cause.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
const ownKeys = (e) => Object.keys(e).sort();
const wire = (e) => JSON.parse(JSON.stringify(e)); // what mcp-auth's toJson(true) emits for an Error cause

console.log('\n[oidc-error-cause] #463');

check('JWTClaimValidationFailed shape: code, claim, reason copied; payload dropped; message kept', () => {
  const src = Object.assign(new Error('unexpected "aud" claim value'), {
    code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'aud', reason: 'check_failed',
    payload: { sub: 'sub-1', email: 'a@example.test', aud: 'other-app' },
  });
  const out = stripJoseCause(src);
  assert.ok(out instanceof Error);
  assert.strictEqual(out.message, 'unexpected "aud" claim value');
  assert.deepStrictEqual(ownKeys(out), ['claim', 'code', 'reason']);
  assert.deepStrictEqual(wire(out), { code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'aud', reason: 'check_failed' });
  assert.ok(!JSON.stringify(out).includes('a@example.test'));
});

check('JWTExpired shape: same treatment (the common 401, not only the claim-validation class)', () => {
  const out = stripJoseCause(Object.assign(new Error('"exp" claim timestamp check failed'), {
    code: 'ERR_JWT_EXPIRED', claim: 'exp', reason: 'check_failed', payload: { sub: 'sub-1' },
  }));
  assert.deepStrictEqual(wire(out), { code: 'ERR_JWT_EXPIRED', claim: 'exp', reason: 'check_failed' });
});

check('JWSSignatureVerificationFailed shape: code only, nothing fabricated', () => {
  const out = stripJoseCause(Object.assign(new Error('signature verification failed'), { code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }));
  assert.deepStrictEqual(ownKeys(out), ['code']);
  assert.deepStrictEqual(wire(out), { code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' });
});

check('a plain Error keeps its message and gains no keys', () => {
  const out = stripJoseCause(new Error('boom'));
  assert.strictEqual(out.message, 'boom');
  assert.deepStrictEqual(ownKeys(out), []);
});

check('a Node system error from a failed JWKS fetch loses address, port and syscall', () => {
  const out = stripJoseCause(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED', errno: -111, syscall: 'connect', address: '10.0.0.5', port: 443 }));
  assert.deepStrictEqual(wire(out), { code: 'ECONNREFUSED' });
});

check('non-string values of the allowlisted keys are not copied (the wire shape stays strings only)', () => {
  const out = stripJoseCause(Object.assign(new Error('x'), { code: 42, claim: ['aud'], reason: null }));
  assert.deepStrictEqual(ownKeys(out), []);
});

check('a non-object thrown value yields undefined', () => {
  assert.strictEqual(stripJoseCause('a string'), undefined);
  assert.strictEqual(stripJoseCause(undefined), undefined);
  assert.strictEqual(stripJoseCause(null), undefined);
});

check('MUTATION: the helper really removes something (identity would fail)', () => {
  const src = Object.assign(new Error('m'), { code: 'X', payload: { sub: 's' } });
  assert.notDeepStrictEqual(wire(stripJoseCause(src)), wire(src));
});

check('purity: src/lib/oidc-error-cause.ts has no imports', () => {
  const src = readFileSync(join(ROOT, 'src', 'lib', 'oidc-error-cause.ts'), 'utf8');
  assert.ok(!/^\s*import\s/m.test(src), 'module imports something');
});

console.log(`\n[oidc-error-cause] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
