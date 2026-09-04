// tests/unit/query_run_validation.test.js
//
// #162 (CWE-89/CWE-20 defense in depth): actual_query_run only validated the
// SELECT shape; it did not block writes (INSERT/UPDATE/DELETE/DROP/...) or
// stacked statements. validateQueryShape() now rejects them before the query
// reaches the q() builder, while leaving SELECTs and the #178 WHERE operators
// usable and not false-positiving on keywords inside quoted literals.
//
// Run: node tests/unit/query_run_validation.test.js

import assert from 'assert';

const { validateQueryShape, validateQuery } = await import('../../dist/src/lib/query-validator.js');

let passed = 0, failed = 0;
function ok(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[query-run-validation] allowed reads (no throw)');
const ALLOWED = [
  'SELECT * FROM transactions LIMIT 5',
  'SELECT id, payee.name FROM transactions WHERE amount < 0 ORDER BY date DESC LIMIT 10',
  'transactions',                                                              // bare table fallthrough
  "SELECT id FROM transactions WHERE imported_payee LIKE '%amazon%'",          // #178 preserved
  'SELECT id FROM transactions WHERE imported_payee IS NULL',                  // #178 preserved
  "SELECT id FROM transactions WHERE notes LIKE '%update%'",                   // keyword inside a literal: NOT a write
  "SELECT id FROM transactions WHERE notes = 'drop everything'",               // literal contains forbidden word
];
for (const q of ALLOWED) {
  ok(`allows: ${q.slice(0, 52)}`, () => assert.doesNotThrow(() => validateQueryShape(q)));
}

console.log('\n[query-run-validation] blocked writes / stacked (throw)');
const BLOCKED = [
  ['UPDATE transactions SET amount = 0',                 /read-only/i],
  ['DELETE FROM transactions',                           /read-only/i],
  ['DROP TABLE transactions',                            /read-only/i],
  ['INSERT INTO transactions (id) VALUES (1)',           /read-only/i],
  ['PRAGMA table_info(transactions)',                    /read-only/i],
  ['SELECT 1; DROP TABLE transactions',                  /stacked|read-only/i],   // stacked + keyword
  ["SELECT id FROM transactions WHERE notes = 'x'; DELETE FROM y", /stacked|read-only/i], // smuggled stacked write
  ['ATTACH DATABASE \'evil.db\' AS e',                   /read-only/i],
  // #421: IN-list injection PoC and its building blocks. The trailing `--` and the UNION are the
  // smuggling vectors; both are now rejected at the shape layer before q() is ever reached.
  ["SELECT id FROM transactions WHERE notes IN ('a','b') UNION SELECT 1 --')", /comment|compound|union/i],
  ["SELECT id FROM transactions WHERE notes IN ('a') UNION SELECT 1",          /compound|union/i],
  ["SELECT id FROM transactions WHERE notes = 'a' -- trailing",               /comment/i],
  ['SELECT id FROM transactions WHERE notes = 5 /* block */',                 /comment/i],
  ['SELECT id FROM transactions EXCEPT SELECT 1',                             /compound|except/i],
];
for (const [q, re] of BLOCKED) {
  ok(`blocks: ${q.slice(0, 52)}`, () => assert.throws(() => validateQueryShape(q), re));
}

// #421: validateQuery must allowlist the column for IN / LIKE / IS NULL, not only for a comparison
// operator. Before the fix, an unknown column skipped validation on those three branches while it
// was correctly rejected before `=`.
console.log('\n[query-run-validation] validateQuery column allowlist covers IN / LIKE / IS NULL');
const INVALID_COLUMN = [
  "SELECT id FROM transactions WHERE bogus_col = 'a'",       // already worked, kept as the control
  "SELECT id FROM transactions WHERE bogus_col IN ('a')",    // #421
  "SELECT id FROM transactions WHERE bogus_col LIKE '%a%'",  // #421
  'SELECT id FROM transactions WHERE bogus_col IS NULL',     // #421
];
for (const q of INVALID_COLUMN) {
  ok(`rejects unknown column: ${q.slice(40)}`, () => assert.strictEqual(validateQuery(q).valid, false));
}
// Real columns on the same branches must stay valid (no regression on #178 operators).
const VALID_COLUMN = [
  "SELECT id FROM transactions WHERE notes IN ('groceries','rent')",
  "SELECT id FROM transactions WHERE imported_payee LIKE '%amazon%'",
  'SELECT id FROM transactions WHERE imported_payee IS NULL',
];
for (const q of VALID_COLUMN) {
  ok(`accepts real column: ${q.slice(40)}`, () => assert.strictEqual(validateQuery(q).valid, true));
}

console.log(`\n[query-run-validation] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
