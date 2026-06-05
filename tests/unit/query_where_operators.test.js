// tests/unit/query_where_operators.test.js
//
// #178: actual_query_run silently dropped unsupported WHERE operators, running
// the query UNFILTERED and returning misleading results. parseWhereClause now
// supports LIKE / NOT LIKE / IS NULL / IS NOT NULL (mapped to ActualQL
// $like / $notlike / null / $ne null) and THROWS on anything it cannot map.
//
// We drive parseWhereClause directly against a stub query builder that records
// each .filter({...}) call, so no live Actual server is needed.
//
// Run: node tests/unit/query_where_operators.test.js
//
// Linked issue: https://github.com/agigante80/actual-mcp-server/issues/178

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://test-server';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'sentinel-pwd-DO-NOT-LEAK';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || 'unit-test-sync-id';

import assert from 'assert';

const { parseWhereClause } = await import('../../dist/src/lib/actual-adapter.js');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok: ${label}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${label} -> ${err.message}`);
    failed++;
  }
}

// Stub query builder: every .filter(obj) is recorded and returns the stub so the
// fluent chain in parseWhereClause keeps working.
function makeStub() {
  const calls = [];
  const stub = {
    filter(obj) { calls.push(obj); return stub; },
    _calls: calls,
  };
  return stub;
}

// Returns the recorded filter objects for a WHERE clause.
function filtersFor(where) {
  return parseWhereClause(makeStub(), where)._calls;
}

console.log('\n[query-where-operators] new operators');

check('LIKE maps to $like (quotes stripped, wildcard preserved)', () => {
  assert.deepStrictEqual(
    filtersFor("imported_payee LIKE '%amazon%'"),
    [{ imported_payee: { $like: '%amazon%' } }],
  );
});

check('NOT LIKE maps to $notlike', () => {
  assert.deepStrictEqual(
    filtersFor("imported_payee NOT LIKE '%fee%'"),
    [{ imported_payee: { $notlike: '%fee%' } }],
  );
});

check('IS NULL maps to field: null', () => {
  assert.deepStrictEqual(
    filtersFor('imported_payee IS NULL'),
    [{ imported_payee: null }],
  );
});

check('IS NOT NULL maps to $ne: null', () => {
  assert.deepStrictEqual(
    filtersFor('imported_payee IS NOT NULL'),
    [{ imported_payee: { $ne: null } }],
  );
});

console.log('\n[query-where-operators] existing operators still work (regression)');

check('= maps to direct equality (string)', () => {
  assert.deepStrictEqual(filtersFor("notes = 'Test'"), [{ notes: 'Test' }]);
});

check('< maps to $lt with numeric coercion', () => {
  assert.deepStrictEqual(filtersFor('amount < 0'), [{ amount: { $lt: 0 } }]);
});

check('!= maps to $ne', () => {
  assert.deepStrictEqual(filtersFor('amount != 100'), [{ amount: { $ne: 100 } }]);
});

check('IN maps to $oneof with mixed coercion', () => {
  assert.deepStrictEqual(
    filtersFor("category.name IN ('Food', 'Rent')"),
    [{ 'category.name': { $oneof: ['Food', 'Rent'] } }],
  );
});

check('AND combines multiple conditions into separate filters', () => {
  assert.deepStrictEqual(
    filtersFor("amount < 0 AND imported_payee LIKE '%amazon%'"),
    [{ amount: { $lt: 0 } }, { imported_payee: { $like: '%amazon%' } }],
  );
});

console.log('\n[query-where-operators] unsupported operators throw (no silent drop)');

check('REGEXP throws and names the unsupported condition', () => {
  assert.throws(
    () => filtersFor("notes REGEXP '^x'"),
    /Unsupported WHERE condition: "notes REGEXP '\^x'"/,
  );
});

check('BETWEEN throws (not silently dropped)', () => {
  // Note: AND-splitting turns BETWEEN into two unmatched fragments; the first
  // unmatched fragment must throw rather than be dropped.
  assert.throws(() => filtersFor('amount BETWEEN 1 AND 100'), /Unsupported WHERE condition/);
});

check('error message lists the supported operators', () => {
  assert.throws(() => filtersFor('foo MATCHES bar'), /LIKE, NOT LIKE, IS NULL, IS NOT NULL/);
});

check('OR throws instead of being swallowed into a comparison value (#178)', () => {
  // Without the OR guard this matched as { amount: "100 OR amount < 0" } and ran
  // a silently-wrong filter rather than erroring.
  assert.throws(() => filtersFor('amount = 100 OR amount < 0'), /OR is not supported/);
});

check('OR is caught even when both sides are individually valid', () => {
  assert.throws(
    () => filtersFor("category.name IN ('Food') OR amount < 0"),
    /OR is not supported/,
  );
});

console.log('\n[query-where-operators] keyword matching is case-insensitive');

check('lowercase like / is null are recognised', () => {
  assert.deepStrictEqual(filtersFor("imported_payee like '%x%'"), [{ imported_payee: { $like: '%x%' } }]);
  assert.deepStrictEqual(filtersFor('imported_payee is null'), [{ imported_payee: null }]);
});

console.log(`\n[query-where-operators] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
