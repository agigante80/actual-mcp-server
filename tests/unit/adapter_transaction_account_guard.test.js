// tests/unit/adapter_transaction_account_guard.test.js
// #744: updateTransaction, updateTransactionBatch and importTransactions refuse an account id
// that does not exist (as addTransactions has since #359), through one adapter helper. A closed
// account stays allowed. Same stubbing model as adapter_transaction_update_payee.test.js: the raw
// api functions are replaced before the adapter is imported, init/shutdown are disarmed.
//
// Run: node tests/unit/adapter_transaction_account_guard.test.js   (needs `npm run build` first)

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://127.0.0.1:5999';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const check = (cond, label, d = '') => {
  if (cond) console.log(`  ok: ${label}`);
  else { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; }
};

const OPEN = '11111111-1111-4111-8111-111111111111';
const CLOSED = '22222222-2222-4222-8222-222222222222';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const NEW_PAYEE = '44444444-4444-4444-8444-444444444444';

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;
let rows = [];
let accountReads = 0;
let updates = [];
let imports = [];
let adds = [];
let creates = [];
api.sync = async () => {};
api.runQuery = async () => ({ data: rows });
api.getAccounts = async () => { accountReads++; return [{ id: OPEN, name: 'Open' }, { id: CLOSED, name: 'Old', closed: true }]; };
api.getPayees = async () => [];
api.createPayee = async (p) => { creates.push(p); return NEW_PAYEE; };
api.updateTransaction = async (id, payload) => { updates.push([id, payload]); };
api.importTransactions = async (acct, txs) => { imports.push([acct, txs]); return { added: ['x'], updated: [], errors: [] }; };
api.addTransactions = async (acct, txs) => { adds.push([acct, txs]); return ['n1']; };

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
const adapter = adapterMod.default;
const { isPreflightRefusal } = await import('../../dist/src/lib/errors.js');

const reset = (ids = ['t-1']) => {
  rows = ids.map((id) => ({ id }));
  accountReads = 0; updates = []; imports = []; adds = []; creates = [];
};
const refused = async (fn) => { try { await fn(); } catch (e) { return e; } return null; };
const PREFIX = `Account "${UNKNOWN}" not found. Use actual_accounts_list to list available accounts.`;

console.log('\n[#744] update: unknown account refused, nothing written');
reset();
let e = await refused(() => adapter.updateTransaction('t-1', { account: UNKNOWN }));
check(e !== null && isPreflightRefusal(e), 'typed refusal', e && String(e.message));
check(e && e.message.startsWith(PREFIX), 'message starts with the not-found text', e && e.message);
check(e && e.message.includes('The transaction was not changed'), 'update detail sentence', e && e.message);
check(updates.length === 0, 'raw updateTransaction not called');

console.log('\n[#744] update: unknown account plus a new payee_name creates no payee');
reset();
e = await refused(() => adapter.updateTransaction('t-1', { account: UNKNOWN, payee_name: 'New Co' }));
check(e !== null && isPreflightRefusal(e), 'refused');
check(creates.length === 0 && updates.length === 0, 'createPayee and updateTransaction never called', JSON.stringify({ creates, updates }));

console.log('\n[#744] update: open and closed accounts pass, absent or null account reads nothing');
for (const [label, acct] of [['open', OPEN], ['closed', CLOSED]]) {
  reset();
  e = await refused(() => adapter.updateTransaction('t-1', { account: acct }));
  check(e === null && updates.length === 1 && updates[0][1].account === acct, `${label} account written`);
}
reset();
await adapter.updateTransaction('t-1', { notes: 'x' });
check(accountReads === 0 && updates.length === 1, 'no account field: no accounts read');
reset();
await adapter.updateTransaction('t-1', { account: null });
check(accountReads === 0 && updates.length === 1, 'account null: no accounts read');

console.log('\n[#744] update_batch: bad item fails alone, accounts listed once');
reset(['t-1', 't-2', 't-3', 't-4']);
const res = await adapter.updateTransactionBatch([
  { id: 't-1', fields: { account: UNKNOWN } },
  { id: 't-2', fields: { account: OPEN } },
  { id: 't-3', fields: { account: UNKNOWN } },
  { id: 't-4', fields: { notes: 'n' } },
]);
check(res.failed.length === 2 && res.failed.every((f) => f.error.startsWith(PREFIX) && f.error.includes('The transaction was not changed')), 'both bad items in failed[] with the text', JSON.stringify(res.failed));
check(res.succeeded.map((s) => s.id).join() === 't-2,t-4', 'good items succeeded', JSON.stringify(res.succeeded));
check(updates.map((u) => u[0]).join() === 't-2,t-4', 'raw update only for the good items');
check(accountReads === 1, 'accounts read exactly once for the batch', String(accountReads));
reset(['t-1']);
const closedBatch = await adapter.updateTransactionBatch([{ id: 't-1', fields: { account: CLOSED } }]);
check(closedBatch.succeeded.length === 1 && closedBatch.failed.length === 0, 'closed account accepted in a batch');
reset(['t-1']);
const pb = await adapter.updateTransactionBatch([{ id: 't-1', fields: { account: UNKNOWN, payee_name: 'New Co' } }]);
check(pb.failed.length === 1 && creates.length === 0, 'batch: refused item creates no payee');

console.log('\n[#744] import: unknown account refused, nothing written');
reset();
e = await refused(() => adapter.importTransactions(UNKNOWN, [{ date: '2018-06-23', amount: -7 }]));
check(e !== null && isPreflightRefusal(e), 'typed refusal');
check(e && e.message.startsWith(PREFIX) && e.message.includes('No transactions were imported'), 'message', e && e.message);
check(imports.length === 0, 'raw importTransactions not called');
for (const [label, acct] of [['open', OPEN], ['closed', CLOSED]]) {
  reset();
  e = await refused(() => adapter.importTransactions(acct, [{ date: '2018-06-23', amount: -7 }]));
  check(e === null && imports.length === 1 && imports[0][0] === acct, `${label} account imported into`);
}

console.log('\n[#744] create text unchanged');
reset();
e = await refused(() => adapter.addTransactions([{ account: UNKNOWN, date: '2018-06-23', amount: -7 }]));
check(e !== null && isPreflightRefusal(e) && e.message.includes('No transactions were created'), 'create still refused with its own sentence', e && e.message);
check(adds.length === 0, 'raw addTransactions not called');

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall passed');
