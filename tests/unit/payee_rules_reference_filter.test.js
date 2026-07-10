// tests/unit/payee_rules_reference_filter.test.js
//
// #284: actual_payee_rules_get always returned empty because the adapter's
// getPayeeRules post-filter matched a NONEXISTENT `payee_id` column on serialized
// rules (`r.payee_id === payeeId`). A serialized Actual rule references its payee
// INSIDE a condition/action whose `field` is 'payee' (value = id for op 'is'/'isNot',
// or an array for op 'oneOf'). This test pins the corrected predicate
// `ruleReferencesPayee` so the read tool can never silently go empty again.
//
// The predicate is pure, so this test needs no live connection. The dummy env vars
// only satisfy config validation at adapter import time.
//
// Run: node tests/unit/payee_rules_reference_filter.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

const { ruleReferencesPayee } = await import('../../dist/src/lib/actual-adapter.js');

const PAYEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CAT   = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log(`  ok: ${label}`); passed++; }
  else { console.error(`  FAIL: ${label}`); failed++; }
}

console.log('\n[payee-rules-reference-filter] #284 getPayeeRules predicate');

check('the exported predicate is a function', typeof ruleReferencesPayee === 'function');

// The exact shape actual_payees_update({category}) creates: payee-is condition,
// set-category action. This is the rule the old filter wrongly dropped.
const defaultCategoryRule = {
  id: 'rule-1', stage: 'pre', conditionsOp: 'and',
  conditions: [{ op: 'is', field: 'payee', value: PAYEE, type: 'id' }],
  actions: [{ op: 'set', field: 'category', value: CAT, type: 'id' }],
};
check('matches a payee-is condition for the payee', ruleReferencesPayee(defaultCategoryRule, PAYEE) === true);
check('does NOT match that rule for a different payee', ruleReferencesPayee(defaultCategoryRule, OTHER) === false);

// A serialized rule has NO top-level payee_id: the old `r.payee_id === payeeId`
// filter would have returned false here (the whole bug). Prove the shape.
check('serialized rule carries no top-level payee_id column', !('payee_id' in defaultCategoryRule));

// op 'oneOf' stores an array of payee ids.
const oneOfRule = {
  id: 'rule-2', conditions: [{ op: 'oneOf', field: 'payee', value: [OTHER, PAYEE], type: 'id' }], actions: [],
};
check('matches a payee oneOf array containing the payee', ruleReferencesPayee(oneOfRule, PAYEE) === true);
check('does not match a oneOf array without the payee', ruleReferencesPayee({ conditions: [{ op: 'oneOf', field: 'payee', value: [OTHER] }], actions: [] }, PAYEE) === false);

// A payee referenced by an ACTION (e.g. a rename rule setting payee) also counts,
// mirroring @actual-app/api's getRulesForPayee scanning both conditions and actions.
const actionRule = {
  id: 'rule-3', conditions: [{ op: 'is', field: 'imported_payee', value: 'Amazon' }],
  actions: [{ op: 'set', field: 'payee', value: PAYEE }],
};
check('matches a payee referenced by an action', ruleReferencesPayee(actionRule, PAYEE) === true);

// A rule that references the payee only by NAME/notes, not the id, must not match.
const unrelatedRule = {
  id: 'rule-4', conditions: [{ op: 'contains', field: 'notes', value: PAYEE }], actions: [],
};
check('does not match when the id only appears in a non-payee field', ruleReferencesPayee(unrelatedRule, PAYEE) === false);

// Defensive: malformed rules must not throw.
check('tolerates a rule with no conditions/actions', ruleReferencesPayee({ id: 'x' }, PAYEE) === false);
check('tolerates null/undefined rule', ruleReferencesPayee(null, PAYEE) === false && ruleReferencesPayee(undefined, PAYEE) === false);
check('tolerates non-array conditions', ruleReferencesPayee({ conditions: 'nope', actions: null }, PAYEE) === false);

console.log(`\n[payee-rules-reference-filter] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
