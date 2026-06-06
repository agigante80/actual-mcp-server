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

const { validateQueryShape } = await import('../../dist/src/lib/query-validator.js');

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
];
for (const [q, re] of BLOCKED) {
  ok(`blocks: ${q.slice(0, 52)}`, () => assert.throws(() => validateQueryShape(q), re));
}

console.log(`\n[query-run-validation] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
