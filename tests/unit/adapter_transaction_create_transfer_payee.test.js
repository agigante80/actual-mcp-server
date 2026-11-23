// tests/unit/adapter_transaction_create_transfer_payee.test.js
// #793: addTransactions refuses a payee id that is the transfer payee of an account. Upstream's add
// path defaults runTransfers to false, so the row would land with no transfer_id and no mirror row.
// The check lives in the #747 reference helper (same payees read, same drain). Same stubbing model
// as adapter_transaction_reference_guard.test.js.
//
// Run: node tests/unit/adapter_transaction_create_transfer_payee.test.js   (needs `npm run build` first)

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://127.0.0.1:5999';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

import { makeCycleWitness } from './helpers/write-cycle.mjs';

let failures = 0;
const check = (cond, label, d = '') => {
  if (cond) console.log(`  ok: ${label}`);
  else { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; }
};

const ACCT = '11111111-1111-4111-8111-111111111111';
const PAYEE = '33333333-3333-4333-8333-333333333333';
const XFER = '55555555-5555-4555-8555-555555555555';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const GHOST_ACCT = '99999999-9999-4999-8999-999999999999';

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;
let payeeReads = 0;
let adds = [];
let witness;
api.sync = async () => {};
api.getAccounts = async () => [{ id: ACCT, name: 'A' }];
api.getCategories = async () => [];
api.getPayees = async () => {
  payeeReads++;
  witness?.noteRead();
  return [{ id: PAYEE, name: 'Shop' }, { id: XFER, name: '', transfer_acct: 'other-account' }];
};
api.addTransactions = async (acct, txs, opts) => { witness?.noteWrite(); adds.push([acct, txs, opts]); return 'ok'; };

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
witness = makeCycleWitness(adapterMod);
const adapter = adapterMod.default;
const { isPreflightRefusal } = await import('../../dist/src/lib/errors.js');

const reset = () => { payeeReads = 0; adds = []; witness.reset(); };
const refused = async (fn) => { try { await fn(); } catch (e) { return e; } return null; };
const MSG = (id) =>
  `Payee "${id}" is the transfer payee of an account, so a transaction created with it would write one side of a transfer only. ` +
  'Nothing was written. To move money between accounts use actual_transfers_create; for an ordinary payment pass another payee or payee_name.';
const tx = (extra) => ({ account: ACCT, date: '2018-06-01', amount: -4202, ...extra });

console.log('\n[#793] NEGATIVE: a transfer payee is refused with the exact text, nothing written');
reset();
let e = await refused(() => adapter.addTransactions([tx({ payee: XFER })]));
check(e !== null && isPreflightRefusal(e), 'typed preflight refusal', e && String(e.message));
check(e && e.message === MSG(XFER), 'exact message', e && e.message);
check(adds.length === 0, 'raw addTransactions not called');

console.log('\n[#793] NEGATIVE: one transfer payee refuses the whole call');
reset();
e = await refused(() => adapter.addTransactions([tx({ payee: PAYEE }), tx({ payee: XFER })]));
check(e !== null && e.message === MSG(XFER) && adds.length === 0, 'second item refuses both, nothing written', e && e.message);

console.log('\n[#793] NEGATIVE: the account check runs first, the payee list is not read');
reset();
e = await refused(() => adapter.addTransactions([tx({ account: GHOST_ACCT, payee: XFER })]));
check(e !== null && e.message.startsWith(`Account "${GHOST_ACCT}" not found`), 'account refusal wins', e && e.message);
check(payeeReads === 0 && adds.length === 0, 'payees never read');

console.log('\n[#793] NEGATIVE: an unknown payee keeps the #747 refusal');
reset();
e = await refused(() => adapter.addTransactions([tx({ payee: UNKNOWN })]));
check(e !== null && e.message.startsWith(`Payee "${UNKNOWN}" not found`), 'not-found text, not the transfer text', e && e.message);

console.log('\n[#793] positive: ordinary payee, payee_name and no payee are written');
reset();
e = await refused(() => adapter.addTransactions([tx({ payee: PAYEE })]));
check(e === null && adds.length === 1, 'ordinary payee written', e && e.message);
reset();
e = await refused(() => adapter.addTransactions([tx({ payee_name: 'Shop' })]));
// #752: a payee_name is looked up once (in the write drain) to refuse a name shared by two payees.
check(e === null && adds.length === 1 && payeeReads === 1, 'payee_name written, the payees read once for the #752 guard', String(payeeReads));
reset();
e = await refused(() => adapter.addTransactions([tx({})]));
check(e === null && adds.length === 1 && payeeReads === 0, 'no payee written, no payees read', String(payeeReads));

console.log('\n[#793] positive: runTransfers true steps aside');
reset();
e = await refused(() => adapter.addTransactions([tx({ payee: XFER })], { runTransfers: true }));
check(e === null && adds.length === 1 && adds[0][2] && adds[0][2].runTransfers === true, 'written with runTransfers forwarded', e && e.message);

console.log('\n[#793] the payees read shares the write drain');
reset();
await adapter.addTransactions([tx({ payee: PAYEE })]);
check(witness.sharedOneCycle(), 'read and write in ONE drain', witness.describe());

if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log('\nadapter_transaction_create_transfer_payee: all checks passed');
