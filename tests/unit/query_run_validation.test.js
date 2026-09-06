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
const { ACTUAL_SCHEMA } = await import('../../dist/src/lib/actual-schema.js');

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

// #450: the clause terminators had no word boundaries, so the lazy match cut the WHERE clause at
// the first occurrence of the LETTERS `GROUP`, `ORDER` or `LIMIT` anywhere, including inside a
// column name, and every field after the cut escaped the allowlist loop entirely. Same defect on
// the SELECT side, where `\s+FROM` terminated inside any identifier beginning with `from`.
//
// Mutation self-check (do this by hand when touching the terminators): revert
// `\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b` to `GROUP|ORDER|LIMIT`, or `\s+FROM\b` to `\s+FROM`,
// and every case in this section must go RED. The whole character of this bug is that it passed
// quietly, so a test that cannot fail on the un-fixed code is worthless here.
console.log('\n[query-run-validation] #450 terminator truncation must not skip validation');
const TRUNCATION_BYPASS = [
  // Every left-hand column below is REAL and contains (or is) a terminator keyword.
  ['sort_order',        'SELECT id FROM accounts WHERE sort_order = 5 AND made_up_col = "x"'],
  ['balance_limit',     'SELECT id FROM accounts WHERE balance_limit = 5 AND made_up_col = "x"'],
  ['account_group_id',  'SELECT id FROM accounts WHERE account_group_id = "g" AND made_up_col = "x"'],
  // `group` IS the keyword, not merely a string containing it. Word boundaries alone do NOT fix
  // this one: it is why the terminator anchors on the two-word `GROUP BY` clause.
  ['group (categories)','SELECT id FROM categories WHERE group = "g" AND made_up_col = "x"'],
  // SELECT side. No schema column starts with `from`, but an alias does, and the truncated part
  // (`made_up_col AS`) then fails the `^\w+$` test so ZERO fields are extracted.
  ['alias from_x',      'SELECT made_up_col AS from_x FROM accounts'],
];
for (const [label, q] of TRUNCATION_BYPASS) {
  ok(`rejects bogus field after ${label}`, () => {
    const r = validateQuery(q);
    assert.strictEqual(r.valid, false, `expected rejection, got valid=true for: ${q}`);
    assert.ok(
      r.errors.some((e) => e.field === 'made_up_col' || /made_up_col/.test(e.message)),
      `expected the error to name made_up_col, got: ${JSON.stringify(r.errors)}`,
    );
  });
}

// Controls. The fix must not make a real clause or a real column invalid.
const TRUNCATION_CONTROLS = [
  ['real GROUP BY still terminates', 'SELECT id FROM accounts WHERE closed = false GROUP BY type'],
  ['real ORDER BY still terminates', 'SELECT id FROM accounts WHERE closed = false ORDER BY sort_order'],
  ['real LIMIT still terminates',    'SELECT id FROM accounts WHERE closed = false LIMIT 5'],
  ['real column balance_limit',      'SELECT id FROM accounts WHERE balance_limit = 5'],
  ['real column group',              'SELECT id FROM categories WHERE group = "g"'],
  ['keyword column + real clauses',  'SELECT balance_limit FROM accounts ORDER BY sort_order LIMIT 5'],
];
for (const [label, q] of TRUNCATION_CONTROLS) {
  ok(`accepts control: ${label}`, () => {
    const r = validateQuery(q);
    assert.strictEqual(r.valid, true, `expected acceptance, got: ${JSON.stringify(r.errors)}`);
  });
}

// Round 2 (found in code review of the fix above): word boundaries close the COLUMN-NAME
// instance of the truncation, and leave the STRING-LITERAL instance wide open, which is the
// likelier route by far. Every extractor now runs on a literal-blanked copy.
console.log('\n[query-run-validation] #450 keywords inside string literals');
const LITERAL_BYPASS = [
  // A user searching for notes that contain the word "limit" truncated the clause, and the
  // typo'd column after it was handed straight to ActualQL.
  ['LIMIT in a literal',    "SELECT id FROM transactions WHERE notes LIKE '%limit%' AND catgeory = 'groceries'", 'catgeory'],
  ['ORDER BY in a literal', "SELECT id FROM transactions WHERE notes = 'order by z' AND made_up_col = 'x'", 'made_up_col'],
  ['GROUP BY in a literal', "SELECT id FROM transactions WHERE notes = 'group by z' AND made_up_col = 'x'", 'made_up_col'],
  ['FROM in a select literal', "SELECT 'a from b', made_up_col FROM transactions", 'made_up_col'],
];
for (const [label, q, expected] of LITERAL_BYPASS) {
  ok(`rejects bogus field despite ${label}`, () => {
    const r = validateQuery(q);
    assert.strictEqual(r.valid, false, `expected rejection for: ${q}`);
    assert.ok(
      r.errors.some((e) => e.field === expected || e.message.includes(expected)),
      `expected the error to name ${expected}, got: ${JSON.stringify(r.errors)}`,
    );
  });
}

// The same blindness produced FALSE REJECTIONS of legitimate queries, which is a live
// usability bug rather than a bypass: any note search containing the word "join" was refused.
const LITERAL_FALSE_REJECTIONS = [
  ['JOIN in a literal', "SELECT id FROM transactions WHERE notes = 'join secrets'"],
  ['FROM in a literal', "SELECT id FROM transactions WHERE notes = 'from nowhere'"],
  ['keyword soup in a literal', "SELECT id FROM transactions WHERE notes LIKE '%group by order by limit%'"],
];
for (const [label, q] of LITERAL_FALSE_REJECTIONS) {
  ok(`accepts legitimate query with ${label}`, () => {
    const r = validateQuery(q);
    assert.strictEqual(r.valid, true, `expected acceptance, got: ${JSON.stringify(r.errors)}`);
  });
}

// Round 3 (found in code review of round 2's fix): blanking literals with two independent
// regex passes, and honouring a backslash as an escape, both SWALLOW real clause text and so
// reopen the bypass the blanking exists to close. SQL escapes a quote by DOUBLING it.
console.log('\n[query-run-validation] #450 the literal scanner must not swallow real SQL');
const SCANNER = [
  // A backslash is NOT an escape in SQLite/ActualQL, so this literal ENDS at the second quote
  // and `made_up_col` is a live column reference.
  ['backslash inside a literal', "SELECT id FROM transactions WHERE notes = 'a\\' AND made_up_col = 'x'"],
  // An apostrophe inside a double-quoted value: a single-quote pass run independently matches
  // ACROSS the two values and deletes everything between them, bogus column included.
  ['apostrophe inside double quotes', 'SELECT id FROM transactions WHERE notes = "it\'s" AND made_up_col = "don\'t" AND cleared = true'],
  // The real SQL escape: a doubled quote stays INSIDE the literal.
  ["doubled-quote escape", "SELECT id FROM transactions WHERE notes = 'it''s fine' AND made_up_col = 'x'"],
];
for (const [label, q] of SCANNER) {
  ok(`still catches the bogus column with ${label}`, () => {
    const r = validateQuery(q);
    assert.strictEqual(r.valid, false, `expected rejection for: ${q}`);
    assert.ok(r.errors.some((e) => e.field === 'made_up_col' || /made_up_col/.test(e.message)),
      `expected the error to name made_up_col, got ${JSON.stringify(r.errors)}`);
  });
}

// The same defect let a STACKED STATEMENT past the #162 shape gate, which is a stronger gate
// than the schema validator. This was reachable before the scanner was rewritten.
ok('a stacked statement hidden behind a backslash is still blocked', () => {
  assert.throws(
    () => validateQueryShape("SELECT id FROM transactions WHERE notes = 'a\\' ; DELETE FROM accounts; --'"),
    /stacked|comment/i,
  );
});

// Controls: the scanner must still blank genuine literals, or #162's false-positive protection
// (a forbidden keyword inside a quoted value) is lost.
ok('a forbidden keyword inside a literal is still not a write', () => {
  assert.doesNotThrow(() => validateQueryShape("SELECT id FROM transactions WHERE notes = 'drop everything'"));
});
// An UNTERMINATED literal must leave its tail VISIBLE to the shape gate. The first version of
// the scanner dropped everything after an unmatched quote, which made #162 fail OPEN: both cases
// below were rejected before the rewrite and were ACCEPTED after it. The assertion that replaced
// this one only checked `typeof r.valid === 'boolean'`, which cannot fail for any input, so it
// could not have caught the regression it was sitting next to.
const UNTERMINATED_MUST_STILL_BE_GATED = [
  ['stacked statement after an unmatched quote', "SELECT * FROM transactions WHERE notes = 'x ; DROP TABLE accounts", /stacked|read-only/i],
  ['write keyword after an unmatched quote', "SELECT * FROM transactions WHERE notes = 'x AND DELETE FROM accounts", /read-only/i],
];
for (const [label, q, re] of UNTERMINATED_MUST_STILL_BE_GATED) {
  ok(`the shape gate still sees a ${label}`, () => assert.throws(() => validateQueryShape(q), re));
}

// Generative: the five cases above are the instances that exist TODAY. This walks every field of
// every table in the real schema and asserts the bogus sibling is still caught, so the guard grows
// with the schema instead of with someone's memory of which names contain a keyword.
console.log('\n[query-run-validation] #450 generative: no schema field may mask a bogus sibling');
{
  let checked = 0;
  const masking = [];       // let the bogus sibling through: the bypass this ticket closes
  const wrongReason = [];   // rejected, but NOT because of the bogus column
  const falseReject = [];   // the real field alone was rejected: a regression the sweep must catch
  for (const [table, fieldsObj] of Object.entries(ACTUAL_SCHEMA)) {
    for (const field of Object.keys(fieldsObj)) {
      checked++;
      // The bogus sibling must be REJECTED, and the error must NAME it. Asserting only
      // `valid === false` would pass vacuously if a future change wrongly rejected the real
      // field instead, leaving the property this sweep guards broken while it stayed green.
      const withBogus = validateQuery(`SELECT id FROM ${table} WHERE ${field} = 1 AND made_up_col = "x"`);
      if (withBogus.valid) {
        masking.push(`${table}.${field}`);
      } else if (!withBogus.errors.some((e) => e.field === 'made_up_col' || /made_up_col/.test(e.message))) {
        wrongReason.push(`${table}.${field} -> ${withBogus.errors.map((e) => e.message).join('; ')}`);
      }
      // Positive control, same field, no bogus sibling: a real column must stay valid.
      const clean = validateQuery(`SELECT id FROM ${table} WHERE ${field} = 1`);
      if (!clean.valid) falseReject.push(`${table}.${field} -> ${clean.errors.map((e) => e.message).join('; ')}`);
    }
  }
  ok(`no field masks a bogus sibling (checked ${checked} fields)`, () => {
    assert.deepStrictEqual(masking, [], `these fields let an unknown column through: ${masking.join(', ')}`);
  });
  ok('rejections name the bogus column, not something else', () => {
    assert.deepStrictEqual(wrongReason, [], `rejected for the wrong reason: ${wrongReason.join(' | ')}`);
  });
  ok('no real schema field is rejected on its own', () => {
    assert.deepStrictEqual(falseReject, [], `false rejections: ${falseReject.join(' | ')}`);
  });
  ok('the generative sweep actually ran', () => assert.ok(checked > 100, `only ${checked} fields checked`));
}

console.log(`\n[query-run-validation] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
