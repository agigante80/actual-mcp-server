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
// Imported at top level, not inside a test: `check()` is synchronous, so an `async` test body
// would resolve to a pending promise that check() never awaits, and the assertions inside it would
// never run (the guard would be permanently green). This import being here keeps the schema test's
// body synchronous.
const { ACTUAL_SCHEMA } = await import('../../dist/src/lib/actual-schema.js');

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

// #420: the boolean coercion is only active when the FROM table is passed, so the type of a column
// can be resolved. This variant supplies it. `filtersFor` above deliberately does NOT, which is
// what proves the pre-#420 behaviour is preserved for every existing assertion in this file.
function filtersForTable(where, table) {
  return parseWhereClause(makeStub(), where, table)._calls;
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

// ─── #420: boolean WHERE literals ──────────────────────────────────────────────
//
// ActualQL requires a real JS boolean for a boolean column: its compiler tags a value 'boolean'
// only from `typeof value === 'boolean'`, and castInput has no string->boolean or integer->boolean
// branch, so `"true"` and `1` are both rejected (the two errors #420 reports, reproduced live).
// These assert on the OBJECT reaching the query builder, because the whole defect is a real boolean
// vs the string "true", which a value-shape assertion can distinguish and a smoke test cannot.
console.log('\n[query-where-operators] #420 boolean literals');

check('= true on a boolean column yields a real boolean, not the string "true"', () => {
  const [f] = filtersForTable('is_parent = true', 'transactions');
  assert.deepStrictEqual(f, { is_parent: true });
  assert.strictEqual(typeof f.is_parent, 'boolean');   // the crux: NOT "true"
});

check('= false yields boolean false', () => {
  assert.deepStrictEqual(filtersForTable('cleared = false', 'transactions'), [{ cleared: false }]);
});

check('TRUE/FALSE are case-insensitive', () => {
  assert.deepStrictEqual(filtersForTable('is_parent = TRUE', 'transactions'), [{ is_parent: true }]);
  assert.deepStrictEqual(filtersForTable('hidden = False', 'categories'), [{ hidden: false }]);
});

check('1 and 0 are accepted as boolean, per SQL convention', () => {
  assert.deepStrictEqual(filtersForTable('is_parent = 1', 'transactions'), [{ is_parent: true }]);
  assert.deepStrictEqual(filtersForTable('is_parent = 0', 'transactions'), [{ is_parent: false }]);
  assert.strictEqual(typeof filtersForTable('is_parent = 1', 'transactions')[0].is_parent, 'boolean');
});

check('!= true maps to $ne with a real boolean', () => {
  assert.deepStrictEqual(filtersForTable('is_parent != true', 'transactions'), [{ is_parent: { $ne: true } }]);
});

check('a joined boolean field (category.hidden, account.closed) resolves through JOIN_PATHS', () => {
  assert.deepStrictEqual(filtersForTable('category.hidden = true', 'transactions'), [{ 'category.hidden': true }]);
  assert.deepStrictEqual(filtersForTable('account.closed = true', 'transactions'), [{ 'account.closed': true }]);
});

check('IN on a boolean column expands to $or of equalities, NOT $oneof', () => {
  // $oneof stringifies its elements upstream, so IN ('true','false') would match nothing on a 0/1
  // column. $or of real-boolean equalities is the only correct compilation.
  assert.deepStrictEqual(
    filtersForTable('is_parent IN (true,false)', 'transactions'),
    [{ $or: [{ is_parent: true }, { is_parent: false }] }],
  );
});

check('a boolean condition ANDs correctly with a date and a string filter', () => {
  assert.deepStrictEqual(
    filtersForTable("is_parent = false AND date >= '2020-01-01' AND notes LIKE '%x%'", 'transactions'),
    [{ is_parent: false }, { date: { $gte: '2020-01-01' } }, { notes: { $like: '%x%' } }],
  );
});

check('a bad boolean literal throws, naming the column and the value', () => {
  assert.throws(() => filtersForTable('is_parent = maybe', 'transactions'),
    /Invalid boolean value for column "is_parent": "maybe"/);
});

console.log('\n[query-where-operators] #420 NEGATIVE: non-boolean columns are untouched');

check('a STRING column keeps a quoted "true" as the string "true"', () => {
  // The trap: quotes are stripped before coercion, so is_parent=true and notes='true' look the
  // same at that point. The column type is what separates them. `notes` is a string column.
  const [f] = filtersForTable("notes = 'true'", 'transactions');
  assert.deepStrictEqual(f, { notes: 'true' });
  assert.strictEqual(typeof f.notes, 'string');
});

check('a numeric column is unaffected', () => {
  assert.deepStrictEqual(filtersForTable('amount = 100', 'transactions'), [{ amount: 100 }]);
});

check('IN on a string column still uses $oneof', () => {
  assert.deepStrictEqual(
    filtersForTable("notes IN ('a','b')", 'transactions'),
    [{ notes: { $oneof: ['a', 'b'] } }],
  );
});

check('an ordering operator on a boolean column is NOT coerced (left for ActualQL to reject)', () => {
  // We do not invent an ordering a boolean does not have; the value passes through unchanged and
  // ActualQL rejects `>` on a boolean itself, which is the honest outcome.
  assert.deepStrictEqual(filtersForTable('is_parent > true', 'transactions'), [{ is_parent: { $gt: 'true' } }]);
});

check('WITHOUT a table, nothing is treated as boolean (pre-#420 behaviour preserved)', () => {
  // This is the guarantee that every other assertion in this file, all of which omit the table,
  // is still exercising the original code path.
  assert.deepStrictEqual(filtersFor('is_parent = true'), [{ is_parent: 'true' }]);
});

console.log('\n[query-where-operators] #420 every schema-declared boolean column is covered');

// The acceptance criterion is that ALL boolean columns work, not the four in the original report.
// This drives the mechanism off the schema itself, so a column added to the schema as boolean is
// covered automatically and a regression that only fixed some columns would fail here.
check('every boolean column in ACTUAL_SCHEMA coerces = true to a real boolean', () => {
  let count = 0;
  for (const [table, cols] of Object.entries(ACTUAL_SCHEMA)) {
    for (const [col, def] of Object.entries(cols)) {
      if (def && def.type === 'boolean') {
        const [f] = filtersForTable(`${col} = true`, table);
        assert.strictEqual(f[col], true, `${table}.${col} did not coerce to boolean true`);
        assert.strictEqual(typeof f[col], 'boolean', `${table}.${col} is not a boolean`);
        count++;
      }
    }
  }
  assert.ok(count >= 20, `expected many boolean columns, only exercised ${count}`);
  console.log(`      (exercised ${count} boolean columns across the schema)`);
});

// #421: IN-list elements must be simple literals so a value cannot terminate its own quote and
// smuggle trailing SQL into upstream's unescaped `$oneof`. validateQueryShape rejects the full PoC
// earlier (UNION + comment), but this is the defense-in-depth layer at the builder itself, for a
// payload that reaches parseWhereClause with a malformed element.
console.log('\n[query-where-operators] #421 IN-list literal safety');

check('a well-formed string IN list maps to $oneof', () => {
  assert.deepStrictEqual(
    filtersFor("notes IN ('groceries','rent')"),
    [{ notes: { $oneof: ['groceries', 'rent'] } }],
  );
});

check('a numeric IN list maps to $oneof of numbers', () => {
  assert.deepStrictEqual(
    filtersFor('amount IN (100, 200)'),
    [{ amount: { $oneof: [100, 200] } }],
  );
});

check('a comma inside a quoted IN value stays one element (quote-aware split)', () => {
  assert.deepStrictEqual(
    filtersFor("notes IN ('Smith, John', 'Doe')"),
    [{ notes: { $oneof: ['Smith, John', 'Doe'] } }],
  );
});

check('a double-quoted IN value is accepted when it holds no single quote', () => {
  assert.deepStrictEqual(
    filtersFor('notes IN ("cash")'),
    [{ notes: { $oneof: ['cash'] } }],
  );
});

check('a DOUBLE-quoted element hiding a single quote is rejected (upstream re-wraps in single quotes)', () => {
  // The review-found bypass: "x' UNION ..." is well-formed as a double-quoted literal, but its inner
  // single quote survives _stripWhereQuotes and would terminate upstream's unescaped `'${id}'` wrap.
  assert.throws(
    () => filtersFor("notes IN (\"x' UNION SELECT id FROM transactions --\")"),
    /Invalid value in IN list/i,
  );
});

check('an IN element that closes its own quote is rejected, never reaching $oneof', () => {
  assert.throws(
    () => filtersFor("notes IN ('a', 'b') UNION SELECT 1 --')"),
    /Invalid value in IN list/i,
  );
});

check('an IN element with a malformed trailing quote is rejected at the builder', () => {
  // A doubled trailing quote, with no OR/UNION keyword that an earlier guard would catch, so this
  // exercises the _isSafeInListElement check itself rather than another rejection path.
  assert.throws(
    () => filtersFor("notes IN ('a', 'b'')"),
    /Invalid value in IN list/i,
  );
});

check('#433: an SQL-ESCAPED apostrophe in an IN list is accepted and passed through doubled', () => {
  // Replaces the assertion that pinned the old limitation. Safe for the same
  // reason #421 made the rule, read the other way round: upstream compiles $oneof
  // by inlining each value verbatim as `'${String(id)}'` (aql/compiler.ts, checked
  // against the installed source), so a DOUBLED quote is exactly SQL's own escape
  // and yields a balanced literal, while a LONE quote breaks out of the wrapper.
  const f = filtersFor("notes IN ('McDonald''s')");
  const oneof = JSON.stringify(f).match(/"\$oneof":\[([^\]]*)\]/);
  assert.ok(oneof, `expected a $oneof filter, got ${JSON.stringify(f)}`);
  // The DOUBLING IS PRESERVED on purpose: upstream supplies the outer quotes, so
  // un-escaping here would produce `'McDonald's'` and reopen the injection.
  assert.ok(oneof[1].includes("McDonald''s"), `doubling must survive to the builder, got ${oneof[1]}`);
});

check('#433: multiple escaped apostrophes and a mixed list still work', () => {
  const f = JSON.stringify(filtersFor("notes IN ('Trader Joe''s', 'Wendy''s', 'plain', 42)"));
  for (const needle of ["Trader Joe''s", "Wendy''s", 'plain', '42']) {
    assert.ok(f.includes(needle), `${needle} survived, got ${f}`);
  }
});

check('#421 STAYS CLOSED: a LONE quote in an IN list is still rejected', () => {
  // The injection witnesses. These must never pass, whatever #433 accepts: a lone
  // quote terminates upstream's wrapper and smuggles trailing SQL.
  assert.throws(() => filtersFor("notes IN ('Trader Joe's')"), /Invalid value in IN list/i);
  assert.throws(() => filtersFor("notes IN ('x' UNION SELECT 1 --')"), /Invalid value in IN list/i);
  assert.throws(() => filtersFor("notes IN ('a''b'c')"), /Invalid value in IN list/i,
    'a doubled quote followed by a lone one is still unbalanced');
});

check('#421 STAYS CLOSED: a double-quoted element hiding a single quote is still rejected', () => {
  // Upstream RE-WRAPS in single quotes, so an internal single quote breaks out
  // exactly as it did before, regardless of the outer quoting the caller used.
  assert.throws(() => filtersFor('notes IN ("x\' UNION SELECT 1 --")'), /Invalid value in IN list/i);
});

console.log(`\n[query-where-operators] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
