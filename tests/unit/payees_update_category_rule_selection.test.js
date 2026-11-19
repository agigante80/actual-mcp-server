// tests/unit/payees_update_category_rule_selection.test.js
// #651: actual_payees_update with fields.category must only edit or delete the payee's OWN
// default-category rule: stage null, exactly one condition `payee is <id>`, exactly one action
// `set category`. Upstream's getPayeeRules also returns rules whose payee condition EXCLUDES
// the payee (isNot, notOneOf) or SHARES it with other payees (oneOf); those are never touched.
//
// Two layers: the pure exported helper selectDefaultCategoryRule, and adapter.updatePayee
// driven with RAW api stubs installed before the adapter import (the #522 pattern in
// adapter_rule_reference_guard.test.js), asserting which raw rule writes were called.
//
// Run via: npm run test:unit-js
// Or: node tests/unit/payees_update_category_rule_selection.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const CAT_X = '10000000-0000-4000-8000-000000000001';
const CAT_Y = '10000000-0000-4000-8000-000000000002';
const GROUP = '10000000-0000-4000-8000-0000000000a1';
const A     = '20000000-0000-4000-8000-000000000001';
const B     = '20000000-0000-4000-8000-000000000002';
const R_ISNOT  = '40000000-0000-4000-8000-000000000001';
const R_IS     = '40000000-0000-4000-8000-000000000002';
const R_ONEOF  = '40000000-0000-4000-8000-000000000003';
const R_NOTONE = '40000000-0000-4000-8000-000000000004';
const R_NARROW = '40000000-0000-4000-8000-000000000005';
const R_NOTES  = '40000000-0000-4000-8000-000000000006';
const R_TWOACT = '40000000-0000-4000-8000-000000000007';
const R_PRE    = '40000000-0000-4000-8000-000000000008';

const setCat = (value) => ({ op: 'set', field: 'category', value });
const NOTE = { op: 'set', field: 'notes', value: 'n' };
const rule = (id, conditions, actions, extra = {}) => ({ id, stage: null, conditionsOp: 'and', conditions, actions, ...extra });

const isNotA   = rule(R_ISNOT,  [{ field: 'payee', op: 'isNot', value: A }], [setCat(CAT_X)]);
const isA      = rule(R_IS,     [{ field: 'payee', op: 'is', value: A }], [setCat(CAT_X)]);
const oneOfAB  = rule(R_ONEOF,  [{ field: 'payee', op: 'oneOf', value: [A, B] }], [setCat(CAT_X)]);
const notOneOf = rule(R_NOTONE, [{ field: 'payee', op: 'notOneOf', value: [A] }], [setCat(CAT_X)]);
const narrow   = rule(R_NARROW, [{ field: 'payee', op: 'is', value: A }, { field: 'notes', op: 'contains', value: 'x' }], [setCat(CAT_X)]);
const notesOnly = rule(R_NOTES, [{ field: 'payee', op: 'is', value: A }], [NOTE]);
const twoAct   = rule(R_TWOACT, [{ field: 'payee', op: 'is', value: A }], [setCat(CAT_X), NOTE]);
const preStage = rule(R_PRE,    [{ field: 'payee', op: 'is', value: A }], [setCat(CAT_X)], { stage: 'pre' });

// Raw api stubs, installed BEFORE the adapter import (it destructures them at module load).
const apiMod = await import('@actual-app/api');
const apiDefault = (apiMod.default || apiMod);
let payeeRules = [];
let created = [];
let updated = [];
let deleted = [];
apiDefault.sync = async () => {};
apiDefault.getCategories = async () => [{ id: CAT_X, name: 'X', group_id: GROUP }, { id: CAT_Y, name: 'Y', group_id: GROUP }];
apiDefault.getPayees = async () => [{ id: A, name: 'A' }, { id: B, name: 'B' }];
apiDefault.getAccounts = async () => [];
apiDefault.getPayeeRules = async () => payeeRules;
apiDefault.createRule = async (r) => { created.push(r); return 'new-rule-id'; };
apiDefault.updateRule = async (r) => { updated.push(r); };
apiDefault.deleteRule = async (id) => { deleted.push(id); return true; };
apiDefault.updatePayee = async () => {};

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
const adapter = adapterMod.default;
const { selectDefaultCategoryRule } = adapterMod;

const reset = (rules) => { payeeRules = rules; created = []; updated = []; deleted = []; };
const tryCall = async (fn) => { try { return { val: await fn(), err: null }; } catch (err) { return { val: undefined, err }; } };

console.log('\n[#651] selectDefaultCategoryRule');
{
  const sel = (rules) => (typeof selectDefaultCategoryRule === 'function' ? selectDefaultCategoryRule(rules, A) : 'MISSING');
  check(typeof selectDefaultCategoryRule === 'function', 'H0: selectDefaultCategoryRule is exported');
  check(sel([isNotA]) === undefined, 'H1: payee isNot A alone does not qualify');
  check(sel([oneOfAB]) === undefined, 'H2: payee oneOf [A, B] alone does not qualify');
  check(sel([notOneOf]) === undefined, 'H3: payee notOneOf [A] alone does not qualify');
  check(sel([narrow]) === undefined, 'H4: payee is A AND notes contains does not qualify');
  check(sel([notesOnly]) === undefined, 'H5: payee is A with only a set-notes action does not qualify');
  check(sel([twoAct]) === undefined, 'H6: payee is A with set category AND set notes does not qualify');
  check(sel([preStage]) === undefined, 'H7: payee is A, set category in stage pre does not qualify');
  check(sel([isA]) === isA, 'H8: payee is A, set category (stage null) qualifies');
  check(sel([isNotA, isA]) === isA, 'H9: the is A rule qualifies when listed after an isNot A rule');
  const noStageKey = { id: R_IS, conditions: [{ op: 'is', field: 'payee', value: A }], actions: [setCat(CAT_X)] };
  check(sel([noStageKey]) === noStageKey, 'H10: a rule with no stage key at all qualifies (stage == null)');
  check(typeof selectDefaultCategoryRule !== 'function' || selectDefaultCategoryRule([isA], B) === undefined, 'H11: payee is A does not qualify for payee B');
}

console.log('\n[#651] adapter.updatePayee wiring');
{
  reset([oneOfAB]);
  let r = await tryCall(() => adapter.updatePayee(A, { category: CAT_Y }));
  const c = created[0];
  check(!r.err && created.length === 1 && updated.length === 0 && deleted.length === 0, 'W1: only a oneOf [A, B] rule, set Y: one create, no update, no delete', `err=${r.err?.message} c=${created.length} u=${updated.length} d=${deleted.length}`);
  check(c && c.stage === null && c.conditionsOp === 'and' && c.conditions.length === 1 && c.conditions[0].op === 'is' && c.conditions[0].field === 'payee' && c.conditions[0].value === A && c.actions.length === 1 && c.actions[0].field === 'category' && c.actions[0].value === CAT_Y, 'W1: the created rule is payee is A, set category Y', JSON.stringify(c));

  reset([narrow]);
  r = await tryCall(() => adapter.updatePayee(A, { category: CAT_Y }));
  check(!r.err && created.length === 1 && updated.length === 0 && deleted.length === 0, 'W2: only a payee is A AND notes contains rule, set Y: one create, no update', `err=${r.err?.message} c=${created.length} u=${updated.length} d=${deleted.length}`);

  reset([isNotA]);
  r = await tryCall(() => adapter.updatePayee(A, { category: null }));
  check(!r.err && created.length === 0 && updated.length === 0 && deleted.length === 0, 'W3: only an isNot A rule, clear: no delete, no update, no create, success', `err=${r.err?.message} c=${created.length} u=${updated.length} d=${deleted.length}`);

  reset([isNotA, isA]);
  r = await tryCall(() => adapter.updatePayee(A, { category: CAT_Y }));
  const u = updated[0];
  check(!r.err && created.length === 0 && deleted.length === 0 && updated.length === 1 && u?.id === R_IS && u.actions[0].value === CAT_Y, 'W4: isNot A listed before is A, set Y: the is A rule is updated by id, nothing created', `err=${r.err?.message} c=${created.length} u=${JSON.stringify(u)} d=${deleted.length}`);

  reset([isNotA, isA]);
  r = await tryCall(() => adapter.updatePayee(A, { category: null }));
  check(!r.err && deleted.length === 1 && deleted[0] === R_IS && created.length === 0 && updated.length === 0, 'W5: isNot A plus is A, clear: only the is A rule is deleted', `err=${r.err?.message} d=${JSON.stringify(deleted)}`);

  reset([narrow]);
  r = await tryCall(() => adapter.updatePayee(A, { category: null }));
  check(!r.err && deleted.length === 0, 'W6: only a narrower payee is A AND notes rule, clear: not deleted', `err=${r.err?.message} d=${deleted.length}`);

  reset([twoAct]);
  r = await tryCall(() => adapter.updatePayee(A, { category: null }));
  check(!r.err && deleted.length === 0 && updated.length === 0, 'W7: only a payee is A rule with a second action, clear: not deleted, notes action survives', `err=${r.err?.message} d=${deleted.length}`);

  reset([isNotA]);
  r = await tryCall(() => adapter.updatePayee(A, { category: CAT_Y }));
  check(!r.err && created.length === 1 && updated.length === 0 && deleted.length === 0, 'W8: only an isNot A rule, set Y: one create, the isNot rule is untouched', `err=${r.err?.message} c=${created.length} u=${updated.length}`);

  // A template or formula in the action's options outranks `value` upstream, so an edit
  // that kept them would report success and change nothing.
  reset([{ ...isA, actions: [{ ...isA.actions[0], options: { template: '{{ x }}' } }] }]);
  r = await tryCall(() => adapter.updatePayee(A, { category: CAT_Y }));
  check(!r.err && updated.length === 1 && updated[0].actions[0].value === CAT_Y && !('options' in updated[0].actions[0]), 'W10: the is A rule carries action options, set Y: the edit drops them so the value takes effect', `err=${r.err?.message} u=${JSON.stringify(updated[0])}`);

  reset([isA]);
  r = await tryCall(() => adapter.updatePayee(A, { category: '19999999-0000-4000-8000-000000000009' }));
  check(!!r.err && created.length === 0 && updated.length === 0 && deleted.length === 0, 'W9: a missing category is refused first (#522), no rule write', `err=${r.err?.message}`);
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll payee category rule selection checks passed');
process.exit(0);
