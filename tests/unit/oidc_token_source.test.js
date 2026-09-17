// tests/unit/oidc_token_source.test.js
//
// #462: promoteAssertionHeader and the promotion middleware, pure (no server boot).
// The contract: in assertion mode the value written to Authorization is
// `Bearer <assertion>` from Cf-Access-Jwt-Assertion, and ANY doubt (missing, empty,
// non-string, whitespace, duplicates joined by Node with ", ") deletes Authorization so
// mcp-auth answers 401 rather than a value being guessed. With the default source the
// middleware is the identity function.
//
// Run: node tests/unit/oidc_token_source.test.js

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promoteAssertionHeader, createAssertionPromotionMiddleware, ASSERTION_HEADERS } from '../../dist/src/lib/oidc-token-source.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const JWS = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.eyJzdWIiOiJ1MSJ9.c2ln';
const OTHER = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.eyJzdWIiOiJ1MiJ9.c2ln';
const SRC = 'cf-access-jwt-assertion';

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[oidc-token-source] #462 promoteAssertionHeader');

check('a single valid assertion becomes Bearer <assertion>', () => {
  assert.strictEqual(promoteAssertionHeader({ authorization: 'Bearer oauth:opaque', [SRC]: JWS }, SRC), `Bearer ${JWS}`);
});
check('missing header: undefined', () => {
  assert.strictEqual(promoteAssertionHeader({ authorization: 'Bearer oauth:opaque' }, SRC), undefined);
});
check('empty header: undefined', () => {
  assert.strictEqual(promoteAssertionHeader({ [SRC]: '' }, SRC), undefined);
});
check('leading or trailing whitespace around a valid JWS: undefined (never trimmed, D3)', () => {
  assert.strictEqual(promoteAssertionHeader({ [SRC]: ` ${JWS}` }, SRC), undefined);
  assert.strictEqual(promoteAssertionHeader({ [SRC]: `${JWS} ` }, SRC), undefined);
});
check('two duplicate headers with distinct valid values, as Node joins them with ", ": undefined (no silent pick)', () => {
  assert.strictEqual(promoteAssertionHeader({ [SRC]: `${JWS}, ${OTHER}` }, SRC), undefined);
});
check('a non-string value (array shape): undefined', () => {
  assert.strictEqual(promoteAssertionHeader({ [SRC]: [JWS, OTHER] }, SRC), undefined);
});
check('source authorization: the original Authorization value is returned untouched, the assertion header is ignored', () => {
  assert.strictEqual(promoteAssertionHeader({ authorization: 'Bearer original', [SRC]: JWS }, 'authorization'), 'Bearer original');
  assert.strictEqual(promoteAssertionHeader({ [SRC]: JWS }, 'authorization'), undefined);
});
check('MUTATION: the function can fail (a valid value is not undefined)', () => {
  assert.notStrictEqual(promoteAssertionHeader({ [SRC]: JWS }, SRC), undefined);
});

console.log('\n[oidc-token-source] #462 createAssertionPromotionMiddleware');

const run = (source, headers) => {
  const req = { headers: { ...headers } };
  let called = false;
  createAssertionPromotionMiddleware(source)(req, {}, () => { called = true; });
  assert.ok(called, 'next() was not called');
  return req;
};
check('assertion mode: Authorization is overwritten IN PLACE and the opaque bearer is gone', () => {
  const req = run(SRC, { authorization: 'Bearer oauth:opaque', [SRC]: JWS });
  assert.strictEqual(req.headers.authorization, `Bearer ${JWS}`);
  assert.ok(!JSON.stringify(req.headers.authorization).includes('oauth:opaque'));
});
check('assertion mode without the header: Authorization is DELETED (mcp-auth then answers missing_auth_header)', () => {
  const req = run(SRC, { authorization: 'Bearer oauth:opaque' });
  assert.ok(!('authorization' in req.headers), JSON.stringify(req.headers));
});
check('assertion mode with a VALID JWT already in Authorization and no header: still deleted (D4, no fallback)', () => {
  const req = run(SRC, { authorization: `Bearer ${JWS}` });
  assert.ok(!('authorization' in req.headers));
});
check('default source: identity (headers untouched, assertion header ignored)', () => {
  const req = run('authorization', { authorization: 'Bearer original', [SRC]: JWS });
  assert.strictEqual(req.headers.authorization, 'Bearer original');
});

console.log('\n[oidc-token-source] #462 the header table covers every non-authorization source');

check('ASSERTION_HEADERS names a lowercase header for cf-access-jwt-assertion', () => {
  assert.deepStrictEqual(ASSERTION_HEADERS, { 'cf-access-jwt-assertion': 'cf-access-jwt-assertion' });
});
check('every enum value except authorization has a table entry (mirrors the compile-time satisfies clause)', () => {
  const src = readFileSync(join(ROOT, 'src', 'lib', 'oidc-token-source.ts'), 'utf8');
  const enumLine = /export type OidcTokenSource = ([^;]+);/.exec(src);
  assert.ok(enumLine, 'OidcTokenSource type not found');
  const values = [...enumLine[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((v) => v !== 'authorization');
  for (const v of values) assert.ok(v in ASSERTION_HEADERS, `no header table entry for ${v}`);
});
check('the logger denylist carries the assertion header name (a literal, since logger.ts loads before config.ts)', () => {
  const src = readFileSync(join(ROOT, 'src', 'logger.ts'), 'utf8');
  for (const h of Object.values(ASSERTION_HEADERS)) assert.ok(src.includes(`'${h}'`), `logger.ts SENSITIVE_KEYS lacks ${h}`);
});
check('purity: the module imports only node:http types', () => {
  const src = readFileSync(join(ROOT, 'src', 'lib', 'oidc-token-source.ts'), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepStrictEqual(imports, ['node:http'], imports.join(', '));
});

console.log(`\n[oidc-token-source] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
