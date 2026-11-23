// tests/unit/adapter_transaction_reference_guard.test.js
// #747: addTransactions, updateTransaction and updateTransactionBatch refuse a payee or category id
// that does not exist (upstream stores it and every read joins it to null), through one adapter
// helper reading the per-drain payees and categories listings. Same stubbing model as
// adapter_transaction_account_guard.test.js: raw api functions are replaced before the adapter is
// imported, init/shutdown are disarmed.
//
// Run: node tests/unit/adapter_transaction_reference_guard.test.js   (needs `npm run build` first)

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://127.0.0.1:5999';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const check = (cond, label, d = '') => {
  if (cond) console.log(`  ok: ${label}`);
  else { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; }
};

const ACCT = '11111111-1111-4111-8111-111111111111';
const PAYEE = '33333333-3333-4333-8333-333333333333';
const TRANSFER_PAYEE = '55555555-5555-4555-8555-555555555555';
const TOMB_PAYEE = '66666666-6666-4666-8666-666666666666';
const CAT = '77777777-7777-4777-8777-777777777777';
const HIDDEN_CAT = '88888888-8888-4888-8888-888888888888';
const GROUP_ID = '99999999-9999-4999-8999-999999999999';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const NEW_PAYEE = '44444444-4444-4444-8444-444444444444';

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;
let rows = [];
let payeeReads = 0;
let categoryReads = 0;
let payeeListing = [];
let updates = [];
let adds = [];
let creates = [];
api.sync = async () => {};
api.runQuery = async () => ({ data: rows });
api.getAccounts = async () => [{ id: ACCT, name: 'A' }];
api.getPayees = async () => { payeeReads++; return payeeListing.map((p) => ({ ...p })); };
api.getCategories = async () => {
  categoryReads++;
  return [{ id: CAT, name: 'Food' }, { id: HIDDEN_CAT, name: 'Old', hidden: true }];
};
api.createPayee = async (p) => { creates.push(p); payeeListing.push({ id: NEW_PAYEE, name: p.name }); return NEW_PAYEE; };
api.updateTransaction = async (id, payload) => { updates.push([id, payload]); };
api.addTransactions = async (acct, txs) => { adds.push([acct, txs]); return ['n1']; };

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
const adapter = adapterMod.default;
const { isPreflightRefusal } = await import('../../dist/src/lib/errors.js');

const reset = (ids = ['t-1']) => {
  rows = ids.map((id) => ({ id }));
  payeeReads = 0; categoryReads = 0; updates = []; adds = []; creates = [];
  payeeListing = [
    { id: PAYEE, name: 'Shop' },
    { id: TRANSFER_PAYEE, name: 'Transfer', transfer_acct: ACCT },
    { id: TOMB_PAYEE, name: 'Gone', tombstone: true },
  ];
};
const refused = async (fn) => { try { await fn(); } catch (e) { return e; } return null; };
const PAYEE_MSG = (id) => `Payee "${id}" not found. Use actual_payees_get to list available payees.`;
const CAT_MSG = (id) => `Category "${id}" not found. Use actual_categories_get to list available categories.`;
const tx = (extra) => ({ account: ACCT, date: '2018-06-01', amount: -111, ...extra });

console.log('\n[#747] create: unknown payee, category and child category refused, nothing written');
for (const [label, extra, msg, entity] of [
  ['payee', { payee: UNKNOWN }, PAYEE_MSG(UNKNOWN), 'actual_payees_get'],
  ['category', { category: UNKNOWN }, CAT_MSG(UNKNOWN), 'actual_categories_get'],
  ['child category', { subtransactions: [{ amount: -111, category: UNKNOWN }] }, CAT_MSG(UNKNOWN), 'actual_categories_get'],
  ['tombstoned payee', { payee: TOMB_PAYEE }, PAYEE_MSG(TOMB_PAYEE), 'actual_payees_get'],
  ['category group id', { category: GROUP_ID }, CAT_MSG(GROUP_ID), 'actual_categories_get'],
]) {
  reset();
  const e = await refused(() => adapter.addTransactions([tx(extra)]));
  check(e !== null && isPreflightRefusal(e), `${label}: typed refusal`, e && String(e.message));
  check(e && e.message.startsWith(msg), `${label}: message`, e && e.message);
  check(e && e.message.includes('No transactions were created'), `${label}: create detail sentence`, e && e.message);
  check(e && e.message.includes(entity), `${label}: names ${entity}`);
  check(adds.length === 0, `${label}: raw addTransactions not called`);
}

console.log('\n[#747] create: known ids and hidden category pass; null and absent read nothing');
reset();
let e = await refused(() => adapter.addTransactions([tx({ payee: PAYEE, category: CAT })]));
check(e === null && adds.length === 1, 'known payee and category written', e && e.message);
reset();
e = await refused(() => adapter.addTransactions([tx({ category: HIDDEN_CAT })]));
check(e === null && adds.length === 1, 'hidden category accepted', e && e.message);
reset();
// #793: a transfer payee on create is refused (see adapter_transaction_create_transfer_payee.test.js).
e = await refused(() => adapter.addTransactions([tx({ payee: TRANSFER_PAYEE })]));
check(e !== null && isPreflightRefusal(e) && adds.length === 0, 'transfer payee refused on create (#793)', e && e.message);
reset();
e = await refused(() => adapter.addTransactions([tx({ payee: null, category: null })]));
check(e === null && adds.length === 1 && payeeReads === 0 && categoryReads === 0, 'null payee and category read no listing', `${payeeReads}/${categoryReads}`);
reset();
e = await refused(() => adapter.addTransactions([tx({ notes: 'x' })]));
check(e === null && payeeReads === 0 && categoryReads === 0, 'neither field: no listing read');
reset();
e = await refused(() => adapter.addTransactions([tx({ payee: PAYEE, category: CAT }), tx({ payee: PAYEE, category: CAT }), tx({ payee: PAYEE, category: CAT })]));
check(e === null && payeeReads === 1 && categoryReads === 1, 'bulk create reads each listing once', `${payeeReads}/${categoryReads}`);
reset();
e = await refused(() => adapter.addTransactions([tx({ payee: PAYEE }), tx({ category: UNKNOWN })]));
check(e !== null && e.message.startsWith(CAT_MSG(UNKNOWN)) && adds.length === 0, 'second entry unknown refuses the whole call');

console.log('\n[#747] update: unknown ids refused, nothing written, no payee created');
for (const [label, fields, msg] of [
  ['payee', { payee: UNKNOWN }, PAYEE_MSG(UNKNOWN)],
  ['category', { category: UNKNOWN }, CAT_MSG(UNKNOWN)],
  ['child category', { subtransactions: [{ amount: -5, category: UNKNOWN }], amount: -5 }, CAT_MSG(UNKNOWN)],
  ['category with payee_name', { category: UNKNOWN, payee_name: 'Ghost' }, CAT_MSG(UNKNOWN)],
]) {
  reset();
  e = await refused(() => adapter.updateTransaction('t-1', fields));
  check(e !== null && isPreflightRefusal(e), `${label}: typed refusal`, e && String(e.message));
  check(e && e.message.startsWith(msg), `${label}: message`, e && e.message);
  check(e && e.message.includes('The transaction was not changed'), `${label}: update detail sentence`, e && e.message);
  check(updates.length === 0 && creates.length === 0, `${label}: no raw update, no createPayee`, JSON.stringify({ updates, creates }));
}
reset();
e = await refused(() => adapter.updateTransaction('t-1', { payee: PAYEE, category: HIDDEN_CAT }));
check(e === null && updates.length === 1, 'known payee and hidden category written', e && e.message);
reset();
await adapter.updateTransaction('t-1', { payee: null, category: null });
check(updates.length === 1 && payeeReads === 0 && categoryReads === 0, 'null clears and reads no listing');
reset();
await adapter.updateTransaction('t-1', { notes: 'x' });
check(updates.length === 1 && payeeReads === 0 && categoryReads === 0, 'neither field: no listing read');

console.log('\n[#747] update_batch: bad item fails alone, listings read once, in-drain payee accepted');
reset(['t-1', 't-2', 't-3', 't-4']);
const res = await adapter.updateTransactionBatch([
  { id: 't-1', fields: { category: UNKNOWN } },
  { id: 't-2', fields: { payee: PAYEE, category: CAT } },
  { id: 't-3', fields: { payee: UNKNOWN } },
  { id: 't-4', fields: { notes: 'n' } },
]);
check(res.failed.length === 2, 'two bad items in failed[]', JSON.stringify(res.failed));
check(res.failed[0] && res.failed[0].error.startsWith(CAT_MSG(UNKNOWN)) && res.failed[0].error.includes('The transaction was not changed'), 'category item message', res.failed[0] && res.failed[0].error);
check(res.failed[1] && res.failed[1].error.startsWith(PAYEE_MSG(UNKNOWN)), 'payee item message', res.failed[1] && res.failed[1].error);
check(res.succeeded.map((s) => s.id).join() === 't-2,t-4', 'good items succeeded', JSON.stringify(res.succeeded));
check(updates.map((u) => u[0]).join() === 't-2,t-4', 'raw update only for the good items');
check(payeeReads === 1 && categoryReads === 1, 'each listing read once for the batch', `${payeeReads}/${categoryReads}`);
reset(Array.from({ length: 10 }, (_, i) => `t-${i}`));
const big = await adapter.updateTransactionBatch(rows.map((r) => ({ id: r.id, fields: { payee: PAYEE, category: CAT } })));
check(big.succeeded.length === 10 && payeeReads === 1 && categoryReads === 1, '10 items sharing known ids: one read per kind', `${payeeReads}/${categoryReads}`);
reset(['t-1', 't-2']);
const inDrain = await adapter.updateTransactionBatch([
  { id: 't-1', fields: { payee_name: 'Fresh Co' } },
  { id: 't-2', fields: { payee: NEW_PAYEE } },
]);
check(inDrain.failed.length === 0 && inDrain.succeeded.length === 2, 'a payee created earlier in the batch is accepted', JSON.stringify(inDrain));
reset(['t-1']);
const pb = await adapter.updateTransactionBatch([{ id: 't-1', fields: { category: UNKNOWN, payee_name: 'Ghost' } }]);
check(pb.failed.length === 1 && creates.length === 0, 'batch: refused item creates no payee');

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall passed');
