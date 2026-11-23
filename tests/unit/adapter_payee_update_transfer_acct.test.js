// tests/unit/adapter_payee_update_transfer_acct.test.js
// #760: adapter.updatePayee refuses any transfer_acct value with a typed ConflictRefusal, before
// any read or write, for any caller. Also pins the legacy tool schema (unknown key) and that
// rename and category updates are unchanged.
//
// Run: node tests/unit/adapter_payee_update_transfer_acct.test.js   (needs `npm run build` first)

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://127.0.0.1:5999';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const check = (cond, label, d = '') => {
  if (cond) console.log(`  ok: ${label}`);
  else { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; }
};

const P = '20000000-0000-4000-8000-000000000001';
const UNKNOWN = '20000000-0000-4000-8000-0000000000ff';
const ACCT = '30000000-0000-4000-8000-000000000001';
const CAT = '10000000-0000-4000-8000-000000000001';
const GROUP = '10000000-0000-4000-8000-0000000000a1';
const EXPECTED = 'transfer_acct cannot be set: transfer payees are created by Actual with their account. Rename the account instead.';

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;
let getPayeesCalls = 0;
let updatePayeeCalls = [];
api.sync = async () => {};
api.getPayees = async () => { getPayeesCalls++; return [{ id: P, name: 'P' }]; };
api.getCategories = async () => [{ id: CAT, name: 'C', group_id: GROUP }];
api.getAccounts = async () => [];
api.getPayeeRules = async () => [];
api.createRule = async () => 'new-rule-id';
api.updateRule = async () => {};
api.deleteRule = async () => true;
api.updatePayee = async (id, f) => { updatePayeeCalls.push({ id, f }); };

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
const adapter = adapterMod.default;
const { isPreflightRefusal } = await import('../../dist/src/lib/errors.js');
const payeesUpdate = (await import('../../dist/src/tools/payees_update.js')).default;

console.log('\n[adapter-payee-update-transfer-acct]');

async function attempt(id, fields) {
  getPayeesCalls = 0; updatePayeeCalls = [];
  try { await adapter.updatePayee(id, fields); } catch (e) { return e; }
  return null;
}

const cases = [
  ['a uuid', P, { transfer_acct: ACCT }],
  ['null', P, { transfer_acct: null }],
  ['empty string', P, { transfer_acct: '' }],
  ['name plus a uuid', P, { name: 'x', transfer_acct: ACCT }],
  ['a uuid on an unknown payee id', UNKNOWN, { transfer_acct: ACCT }],
];
for (const [label, id, fields] of cases) {
  const e = await attempt(id, fields);
  check(e !== null, `${label}: rejects`);
  check(e && isPreflightRefusal(e) && e.refusalKind === 'conflict', `${label}: typed conflict refusal`, e && String(e.refusalKind));
  check(e && e.message === EXPECTED, `${label}: exact message`, e && e.message);
  check(getPayeesCalls === 0 && updatePayeeCalls.length === 0, `${label}: nothing read, nothing written`);
}

let e = await attempt(P, { name: 'x' });
check(e === null && updatePayeeCalls.length === 1 && JSON.stringify(updatePayeeCalls[0].f) === '{"name":"x"}', 'a rename reaches the raw update once');
e = await attempt(P, { transfer_acct: undefined, name: 'x' });
check(e === null, 'an undefined transfer_acct is not refused');
e = await attempt(P, { category: CAT });
check(e === null && updatePayeeCalls.length === 0, 'a category update still takes the rule path (no direct write)');

const bad = payeesUpdate.inputSchema.safeParse({ id: P, fields: { transfer_acct: ACCT } });
check(!bad.success && bad.error.issues.some((i) => i.code === 'unrecognized_keys' && i.keys.includes('transfer_acct')), 'legacy schema: transfer_acct is an unrecognized key');
let msg = '';
try { await payeesUpdate.call({ id: P, fields: {} }); } catch (x) { msg = x.message; }
check(msg === 'No fields provided to update. Include at least one field: name or category.', 'legacy empty-update text', msg);

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall passed');
