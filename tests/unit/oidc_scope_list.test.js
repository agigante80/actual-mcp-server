// tests/unit/oidc_scope_list.test.js
//
// #472: pure unit tests for parseScopeList and buildScopesSupported (mergeScopeLists).
// Asserts trimming, whitespace handling, empties removal, de-duplication with order
// preservation, and correct merging of advertised and required scopes.
//
// Run: node tests/unit/oidc_scope_list.test.js

import assert from 'node:assert';
const { parseScopeList, buildScopesSupported } = await import('../../dist/src/lib/oidc-scopes.js');

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[oidc-scope-list] #472');

// --- parseScopeList ---
check('undefined returns empty array', () => {
  assert.deepStrictEqual(parseScopeList(undefined), []);
});

check('empty string returns empty array', () => {
  assert.deepStrictEqual(parseScopeList(''), []);
});

check('whitespace-only returns empty array', () => {
  assert.deepStrictEqual(parseScopeList('   \t  \n '), []);
});

check('trims individual scopes', () => {
  assert.deepStrictEqual(parseScopeList('  openid ,  email \t, profile  '), ['openid', 'email', 'profile']);
});

check('drops empty items from multiple commas', () => {
  assert.deepStrictEqual(parseScopeList('openid,,email,  ,,profile,'), ['openid', 'email', 'profile']);
});

check('de-duplicates preserving first-seen order', () => {
  assert.deepStrictEqual(parseScopeList('openid,email,openid,profile,email,offline_access'), [
    'openid',
    'email',
    'profile',
    'offline_access',
  ]);
});

// --- buildScopesSupported / mergeScopeLists ---
check('merges advertised and required scopes keeping advertised first and appending missing required', () => {
  const merged = buildScopesSupported('openid,profile', 'email,offline_access');
  assert.deepStrictEqual(merged, ['openid', 'profile', 'email', 'offline_access']);
});

check('advertised duplicates with required are deduplicated without reordering', () => {
  const merged = buildScopesSupported('openid,email', 'email,offline_access');
  assert.deepStrictEqual(merged, ['openid', 'email', 'offline_access']);
});

check('when advertised is unset/empty, equals required scopes exactly (backward compatibility)', () => {
  assert.deepStrictEqual(buildScopesSupported(undefined, 'openid,email'), ['openid', 'email']);
  assert.deepStrictEqual(buildScopesSupported('', 'openid,email'), ['openid', 'email']);
  assert.deepStrictEqual(buildScopesSupported('   ', 'openid,email'), ['openid', 'email']);
});

check('when required is unset/empty, equals advertised scopes', () => {
  assert.deepStrictEqual(buildScopesSupported('openid,offline_access', undefined), ['openid', 'offline_access']);
  assert.deepStrictEqual(buildScopesSupported('openid,offline_access', ''), ['openid', 'offline_access']);
  assert.deepStrictEqual(buildScopesSupported('openid,offline_access', '   '), ['openid', 'offline_access']);
});

check('when both are unset/empty, returns empty array', () => {
  assert.deepStrictEqual(buildScopesSupported(undefined, undefined), []);
  assert.deepStrictEqual(buildScopesSupported('', ''), []);
});

console.log(`\n[oidc-scope-list] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
