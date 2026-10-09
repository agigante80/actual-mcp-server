// tests/unit/adapter_rule_reference_guard.test.js
// #485: the adapter guard that refuses a rule pointing at a category, payee or account that
// does not exist. Drives the REAL adapter.createRule with RAW api stubs (installed before the
// adapter import, session disarmed), because stubbing the adapter would stub the guard away.
// The guard itself is not exported, so createRule is the only way in from here.
//
// Run via: npm run test:unit-js
// Or: node tests/unit/adapter_rule_reference_guard.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

import { makeCycleWitness } from './helpers/write-cycle.mjs';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const CAT   = '10000000-0000-4000-8000-000000000001';
const CAT2  = '10000000-0000-4000-8000-000000000002';
const OLD_GHOST = '18888888-0000-4000-8000-000000000008';
const RID   = '40000000-0000-4000-8000-000000000001';
const GROUP = '10000000-0000-4000-8000-0000000000a1';
const GHOST = '19999999-0000-4000-8000-000000000009';
const PAYEE = '20000000-0000-4000-8000-000000000001';
const XFER  = '20000000-0000-4000-8000-000000000002'; // transfer payee
const DEAD  = '20000000-0000-4000-8000-000000000003'; // tombstoned payee
const ACCT  = '30000000-0000-4000-8000-000000000001';
const CLOSED = '30000000-0000-4000-8000-000000000002';

const apiMod = await import('@actual-app/api');
const apiDefault = (apiMod.default || apiMod);
let witness = null;
let reads = { categories: 0, payees: 0, accounts: 0 };
let createCalls = 0;
let updateCalls = 0;
let payeeUpdateCalls = 0;
let deleteCalls = 0;
let storedRules = [];       // what getRules returns
let payeeRules = [];        // what getPayeeRules returns
let createBehaviour = null; // optional error thrown by the raw create
apiDefault.sync = async () => {};
apiDefault.getCategories = async () => { reads.categories++; witness?.noteRead(); return [{ id: CAT, name: 'Food', group_id: GROUP }, { id: CAT2, name: 'Fun', group_id: GROUP }]; };
apiDefault.getPayees = async () => {
  reads.payees++; witness?.noteRead();
  return [{ id: PAYEE, name: 'Shop' }, { id: XFER, name: 'Transfer', transfer_acct: ACCT }, { id: DEAD, name: 'Gone', tombstone: true }];
};
apiDefault.getAccounts = async () => { reads.accounts++; witness?.noteRead(); return [{ id: ACCT, name: 'Chk' }, { id: CLOSED, name: 'Old', closed: true, offbudget: true }]; };
apiDefault.createRule = async () => { createCalls++; witness?.noteWrite(); if (createBehaviour) throw createBehaviour; return 'new-rule-id'; };
apiDefault.getRules = async () => { witness?.noteRead(); return storedRules; };
apiDefault.getPayeeRules = async () => { witness?.noteRead(); return payeeRules; };
apiDefault.updateRule = async () => { updateCalls++; witness?.noteWrite(); };
apiDefault.updatePayee = async () => { payeeUpdateCalls++; witness?.noteWrite(); };
apiDefault.deleteRule = async () => { deleteCalls++; witness?.noteWrite(); return true; };

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
const { isPreflightRefusal } = await import('../../dist/src/lib/errors.js');
adapterMod._setSkipApiInitForTests(true);
witness = makeCycleWitness(adapterMod);
const adapter = adapterMod.default;

const mk = (conditions, actions) => ({ stage: null, conditionsOp: 'and', conditions, actions });
const NOTE = { op: 'set', field: 'notes', value: 'n' };
const attempt = async (rule) => {
  createCalls = 0; reads = { categories: 0, payees: 0, accounts: 0 }; witness.reset();
  try { return { id: await adapter.createRule(rule), err: null }; } catch (err) { return { id: null, err }; }
};

console.log('\n[#485] set category');
{
  let r = await attempt(mk([{ field: 'imported_payee', op: 'is', value: 'x' }], [{ op: 'set', field: 'category', value: GHOST }]));
  check(r.err && isPreflightRefusal(r.err) && r.err.entity === 'Category' && r.err.message.includes(GHOST), '(a) an absent category id is a not-found refusal naming the id', String(r.err?.message));
  check(createCalls === 0, '(a) and nothing reaches the raw create');
  check(witness.readInCycleNoWrite(), '(a) the listing was read inside the drain, with no write', witness.describe());

  r = await attempt(mk([{ field: 'imported_payee', op: 'is', value: 'x' }], [{ op: 'set', field: 'category', value: CAT }]));
  check(!r.err && r.id === 'new-rule-id' && createCalls === 1, '(b) a present category id is created and the id returned', String(r.err?.message));

  r = await attempt(mk([{ field: 'imported_payee', op: 'is', value: 'x' }], [{ op: 'set', field: 'category', value: null }]));
  check(!r.err && createCalls === 1, '(c) set category to null (a clear) is not a reference');
  check(reads.categories === 0, '(c) and no listing is read for it');

  r = await attempt(mk([{ field: 'imported_payee', op: 'is', value: 'x' }], [{ op: 'set', field: 'category', value: GROUP }]));
  check(r.err && isPreflightRefusal(r.err) && r.err.message.includes(GROUP), '(f) a category GROUP id is refused');
}

console.log('\n[#485] payee and account references');
{
  let r = await attempt(mk([{ field: 'payee', op: 'is', value: XFER }], [NOTE]));
  check(!r.err && createCalls === 1, '(d) a transfer payee id exists');
  r = await attempt(mk([{ field: 'payee', op: 'is', value: DEAD }], [NOTE]));
  check(r.err && isPreflightRefusal(r.err) && r.err.entity === 'Payee' && r.err.message.includes(DEAD) && createCalls === 0, '(e) a tombstoned payee id is refused', String(r.err?.message));
  r = await attempt(mk([{ field: 'account', op: 'is', value: CLOSED }], [NOTE]));
  check(!r.err && createCalls === 1, '(g) a closed, off-budget account id exists');
  r = await attempt(mk([{ field: 'imported_payee', op: 'is', value: 'x' }], [{ op: 'set', field: 'account', value: GHOST }]));
  check(r.err && r.err.entity === 'Account' && createCalls === 0, 'set account to an absent id is refused');
  r = await attempt(mk([{ field: 'imported_payee', op: 'is', value: 'x' }], [{ op: 'set', field: 'payee', value: GHOST }]));
  check(r.err && r.err.entity === 'Payee' && createCalls === 0, 'set payee to an absent id is refused');
}

console.log('\n[#485] list values and unreferenced fields');
{
  let r = await attempt(mk([{ field: 'category', op: 'oneOf', value: [CAT, GHOST] }], [NOTE]));
  check(r.err && isPreflightRefusal(r.err) && r.err.message.includes(GHOST) && !r.err.message.includes(CAT) && createCalls === 0, '(h) oneOf [known, unknown] is refused naming the unknown id', String(r.err?.message));
  r = await attempt(mk([{ field: 'category', op: 'notOneOf', value: [CAT] }], [NOTE]));
  check(!r.err && createCalls === 1, 'notOneOf with only known ids is created');
  r = await attempt(mk([{ field: 'imported_payee', op: 'is', value: GHOST }, { field: 'notes', op: 'is', value: GHOST }], [{ op: 'append-notes', value: GHOST }]));
  check(!r.err && createCalls === 1 && reads.categories + reads.payees + reads.accounts === 0, 'string fields and notes actions are not references, and nothing is read');
  r = await attempt(mk([{ field: 'imported_payee', op: 'is', value: 'x' }], [{ op: 'link-schedule', value: GHOST }]));
  check(!r.err && createCalls === 1, 'link-schedule values are NOT checked (known gap)');
}

console.log('\n[#485] one listing, in the same drain as the write');
{
  const r = await attempt(mk(
    [{ field: 'category', op: 'is', value: CAT }, { field: 'category', op: 'isNot', value: CAT }],
    [{ op: 'set', field: 'category', value: CAT }, { op: 'set', field: 'payee', value: PAYEE }],
  ));
  check(!r.err && createCalls === 1, 'a rule with several references is created');
  check(reads.categories === 1 && reads.payees === 1 && reads.accounts === 0, 'each referenced kind reached upstream once (the drain cache is part of the mechanism); accounts not read', JSON.stringify(reads));
  check(witness.sharedOneCycle(), '(i) the listing reads and the create shared ONE drain', witness.describe());
}

// ---------------------------------------------------------------------------------------------
// #522: the guard on the other rule writes, op-aware extraction, new-references-only on update.
// ---------------------------------------------------------------------------------------------
const resetCounts = () => {
  createCalls = 0; updateCalls = 0; payeeUpdateCalls = 0; deleteCalls = 0;
  reads = { categories: 0, payees: 0, accounts: 0 }; createBehaviour = null; witness.reset();
};
const tryCall = async (fn) => { try { return { val: await fn(), err: null }; } catch (err) { return { val: null, err }; } };
const refused = (err, id, entity, suffix) =>
  !!err && isPreflightRefusal(err) && err.message.includes(id) && err.message.includes(entity) && (!suffix || err.message.includes(suffix));
const stored = (conditions, actions) => ({ id: RID, stage: null, conditionsOp: 'and', conditions, actions });
const COND = { field: 'imported_payee', op: 'is', value: 'x' };
const setCat = (value, extra = {}) => ({ op: 'set', field: 'category', value, ...extra });
const readsTotal = () => reads.categories + reads.payees + reads.accounts;

console.log('\n[#522] updateRule: only NEW references are checked');
{
  storedRules = [stored([COND], [setCat(CAT)])];
  resetCounts();
  let r = await tryCall(() => adapter.updateRule(RID, { actions: [setCat(GHOST)] }));
  check(refused(r.err, GHOST, 'Category', 'Nothing was changed.') && updateCalls === 0, 'U1: a new dangling category is refused, "Nothing was changed.", 0 raw updates', String(r.err?.message));

  resetCounts();
  r = await tryCall(() => adapter.updateRule(RID, { actions: [setCat(CAT2)] }));
  check(!r.err && updateCalls === 1, 'U1p: a known category is written once', String(r.err?.message));

  storedRules = [stored([COND], [setCat(OLD_GHOST)])];
  resetCounts();
  r = await tryCall(() => adapter.updateRule(RID, { stage: 'pre' }));
  check(!r.err && updateCalls === 1 && readsTotal() === 0, 'U2: a dangling id already stored does not block an unrelated edit, and no listing is read', String(r.err?.message));

  storedRules = [stored([{ field: 'category', op: 'is', value: OLD_GHOST }], [NOTE])];
  resetCounts();
  r = await tryCall(() => adapter.updateRule(RID, { actions: [setCat(OLD_GHOST)] }));
  check(refused(r.err, OLD_GHOST, 'Category') && updateCalls === 0, 'U2n: the same id newly added on the action side counts as new', String(r.err?.message));

  storedRules = [stored([COND], [NOTE])];
  resetCounts();
  r = await tryCall(() => adapter.updateRule(RID, { conditions: [{ field: 'category', op: 'and', value: [GHOST] }] }));
  check(refused(r.err, GHOST, 'Category') && updateCalls === 0, 'U2a: the internal "and" op on category is checked', String(r.err?.message));

  resetCounts();
  r = await tryCall(() => adapter.updateRule(RID, { actions: [setCat(GHOST, { options: { template: '' } })] }));
  check(refused(r.err, GHOST, 'Category') && updateCalls === 0, 'U2e: an EMPTY template is not a template, the id is checked', String(r.err?.message));

  resetCounts();
  r = await tryCall(() => adapter.updateRule(RID, {
    conditions: [{ field: 'payee', op: 'contains', value: 'Amazon' }],
    actions: [setCat('{{notes}}', { options: { template: '{{notes}}' } })],
  }));
  check(!r.err && updateCalls === 1 && readsTotal() === 0, 'U2t: a text op and a truthy-template action are not references', String(r.err?.message));

  resetCounts();
  r = await tryCall(() => adapter.updateRule('50000000-0000-4000-8000-0000000000ff', { stage: 'pre' }));
  check(!!r.err && isPreflightRefusal(r.err) && r.err.entity === 'Rule' && r.err.listTool === 'actual_rules_get' && updateCalls === 0, 'U3: an unknown rule id is a typed NotFoundRefusal for Rule', String(r.err?.message));
}

console.log('\n[#522] upsertRule');
{
  const input = (actions) => ({ stage: null, conditionsOp: 'and', conditions: [COND], actions });
  storedRules = [];
  resetCounts();
  let r = await tryCall(() => adapter.upsertRule(input([{ op: 'set', field: 'payee', value: GHOST }]), true));
  check(refused(r.err, GHOST, 'Payee', 'Nothing was created.') && createCalls === 0, 'U4: create branch refuses a dangling payee, "Nothing was created."', String(r.err?.message));
  resetCounts();
  r = await tryCall(() => adapter.upsertRule(input([{ op: 'set', field: 'payee', value: PAYEE }]), true));
  check(!r.err && createCalls === 1 && r.val?.created === true, 'U4p: create branch with a known payee creates once');

  storedRules = [stored([COND], [NOTE])];
  resetCounts();
  r = await tryCall(() => adapter.upsertRule(input([setCat(GHOST)]), true));
  check(refused(r.err, GHOST, 'Category', 'Nothing was changed.') && updateCalls === 0, 'U5: update branch refuses a dangling category, "Nothing was changed."', String(r.err?.message));
  resetCounts();
  r = await tryCall(() => adapter.upsertRule(input([setCat(CAT)]), true));
  check(!r.err && updateCalls === 1 && r.val?.created === false, 'U5p: update branch with a known category updates once');
}

console.log('\n[#522] updatePayee category');
{
  payeeRules = [];
  resetCounts();
  let r = await tryCall(() => adapter.updatePayee(PAYEE, { name: 'New', category: GHOST }));
  check(refused(r.err, GHOST, 'Category', 'Nothing was changed.') && payeeUpdateCalls === 0 && updateCalls === 0 && createCalls === 0 && deleteCalls === 0, 'U6: a dangling category is refused before ANY write (no partial name write)', String(r.err?.message));
  resetCounts();
  r = await tryCall(() => adapter.updatePayee(PAYEE, { category: GROUP }));
  check(refused(r.err, GROUP, 'Category') && createCalls === 0, 'a category GROUP id is refused as a missing Category');
  resetCounts();
  r = await tryCall(() => adapter.updatePayee(PAYEE, { category: CAT }));
  check(!r.err && createCalls === 1, 'U6p: a known category with no existing rule creates the rule once', String(r.err?.message));

  payeeRules = [{ id: RID, conditions: [{ op: 'is', field: 'payee', value: PAYEE }], actions: [setCat(CAT)] }];
  resetCounts();
  r = await tryCall(() => adapter.updatePayee(PAYEE, { category: null }));
  check(!r.err && reads.categories === 0 && deleteCalls === 1, 'U7: null skips the check and deletes the rule once', String(r.err?.message));
  payeeRules = [];
  resetCounts();
  r = await tryCall(() => adapter.updatePayee(PAYEE, { category: null }));
  check(!r.err && deleteCalls === 0 && createCalls === 0 && updateCalls === 0 && reads.categories === 0, 'U7: null with no existing rule is a no-op');
}

console.log('\n[#522] createRule is not retried');
{
  resetCounts();
  createBehaviour = new Error('read ECONNRESET');
  let r = await tryCall(() => adapter.createRule(mk([COND], [NOTE])));
  check(!!r.err && createCalls === 1, 'U8: a retryable error still reaches the raw create exactly once', `calls=${createCalls}`);
  resetCounts();
  r = await tryCall(() => adapter.createRule(mk([COND], [setCat(CAT)])));
  check(!r.err && r.val === 'new-rule-id' && createCalls === 1, 'U8p: a success is called once and returns the id');
}

console.log('\n[#522] prototype-named fields do not throw');
{
  resetCounts();
  let r = await tryCall(() => adapter.createRule(mk([COND], [{ op: 'set', field: 'toString', value: 'x' }])));
  check(!r.err && createCalls === 1, 'U11: an action field named toString is ignored by the guard', String(r.err?.message));
  resetCounts();
  r = await tryCall(() => adapter.createRule(mk([{ field: 'constructor', op: 'is', value: 'x' }], [NOTE])));
  check(!r.err && createCalls === 1, 'U11: a condition field named constructor is ignored by the guard', String(r.err?.message));

  const { validateRuleInput } = await import('../../dist/src/lib/schemas/rules.js');
  const updateTool = (await import('../../dist/src/tools/rules_update.js')).default;
  const upsertTool = (await import('../../dist/src/tools/rules_create_or_update.js')).default;
  const notTypeError = (e) => !(e instanceof TypeError);
  let threw = null;
  try { validateRuleInput({ conditionsOp: 'and', conditions: [{ field: 'toString', op: 'is', value: 'x' }], actions: [NOTE] }); } catch (e) { threw = e; }
  check(notTypeError(threw), 'U12: validateRuleInput with field toString throws no TypeError', String(threw));
  storedRules = [stored([COND], [NOTE])];
  resetCounts();
  r = await tryCall(() => updateTool.call({ id: RID, fields: { conditions: [{ field: 'constructor', op: 'is', value: 'x' }] } }));
  check(notTypeError(r.err), 'U12: actual_rules_update with field constructor throws no TypeError', String(r.err));
  resetCounts();
  r = await tryCall(() => upsertTool.call({ conditionsOp: 'and', conditions: [{ field: 'constructor', op: 'is', value: 'x' }], actions: [NOTE] }));
  check(notTypeError(r.err), 'U12: actual_rules_create_or_update with field constructor throws no TypeError', String(r.err));
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll rule reference guard checks passed');
process.exit(0);
