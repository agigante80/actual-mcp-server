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
apiDefault.sync = async () => {};
apiDefault.getCategories = async () => { reads.categories++; witness?.noteRead(); return [{ id: CAT, name: 'Food', group_id: GROUP }]; };
apiDefault.getPayees = async () => {
  reads.payees++; witness?.noteRead();
  return [{ id: PAYEE, name: 'Shop' }, { id: XFER, name: 'Transfer', transfer_acct: ACCT }, { id: DEAD, name: 'Gone', tombstone: true }];
};
apiDefault.getAccounts = async () => { reads.accounts++; witness?.noteRead(); return [{ id: ACCT, name: 'Chk' }, { id: CLOSED, name: 'Old', closed: true, offbudget: true }]; };
apiDefault.createRule = async () => { createCalls++; witness?.noteWrite(); return 'new-rule-id'; };

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

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll rule reference guard checks passed');
process.exit(0);
