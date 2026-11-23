// tests/unit/schedules_unknown_refs.test.js
//
// #785: createSchedule and updateSchedule stored any well-formed account or payee id, including
// one that names nothing, so the schedule's rule held a dangling id and never matched. The
// adapter now refuses an unknown account or payee with a NotFoundRefusal, inside the same queued
// write and before the raw call, reading the per-drain accounts and payees listings. The raw api
// is stubbed (destructured at adapter load, so stubs are installed BEFORE the import).
//
// Mutation check (done by hand when this test was written): removing the
// assertScheduleLinksExist call from createSchedule turns the create negatives red, and removing
// it from updateSchedule turns the update negatives red (the raw write is then called).
//
// Run: node tests/unit/schedules_unknown_refs.test.js   (needs `npm run build` first)

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || '00000000-0000-0000-0000-000000000000';

import assert from 'node:assert';

let passed = 0, failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
console.log('\n[#785] schedules refuse an unknown account or payee');

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const SID = '00000000-0000-0000-0000-000000000785';
const ACC = 'aaaaaaaa-0000-4000-8000-000000000001';
const CLOSED = 'aaaaaaaa-0000-4000-8000-000000000002';
const PAY = 'bbbbbbbb-0000-4000-8000-000000000001';
const XFER = 'bbbbbbbb-0000-4000-8000-000000000002';
const DEAD = 'bbbbbbbb-0000-4000-8000-000000000003';
const NEW_PAY = 'bbbbbbbb-0000-4000-8000-000000000009';
const ACC_TEXT = (id) => `Account "${id}" not found. Use actual_accounts_list to list available accounts. The schedule was not written: its rule would otherwise point at an account that does not exist and never match.`;
const PAY_TEXT = (id) => `Payee "${id}" not found. Use actual_payees_get to list available payees. The schedule was not written: its rule would otherwise point at a payee that does not exist and never match.`;

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

let accounts, payees, accListCalls, payListCalls, createCalls, updateCalls;
api.sync = async () => {};
api.getCategories = async () => [];
api.getCategoryGroups = async () => [];
let witness; // the adapter destructures the raw stubs at load, so they call a late-bound witness
api.getAccounts = async () => { witness?.noteRead(); accListCalls++; return accounts.map((a) => ({ ...a })); };
api.getPayees = async () => { payListCalls++; return payees.map((p) => ({ ...p })); };
api.getSchedules = async () => [{ id: SID, amountOp: 'is', amount: -100 }];
api.getRules = async () => [{ id: 'rule785', conditions: [], actions: [{ op: 'link-schedule', value: SID }] }];
api.createSchedule = async (s) => { witness?.noteWrite(); createCalls.push(s); return SID; };
api.updateSchedule = async (id, f) => { updateCalls.push({ id, f }); };
api.createPayee = async (p) => { payees.push({ id: NEW_PAY, ...p }); return NEW_PAY; };
api.createAccount = async () => 'x';

const { makeCycleWitness } = await import('./helpers/write-cycle.mjs');
const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
const { isPreflightRefusal, NotFoundRefusal } = await import('../../dist/src/lib/errors.js');
adapterMod._setSkipApiInitForTests(true);
const adapter = adapterMod.default;
witness = makeCycleWitness(adapterMod);

function reset() {
  accounts = [{ id: ACC, name: 'Checking' }, { id: CLOSED, name: 'Old', closed: true }];
  payees = [{ id: PAY, name: 'Shop' }, { id: XFER, name: 'Transfer: Checking', transfer_acct: ACC }, { id: DEAD, name: 'Gone', tombstone: true }];
  accListCalls = 0; payListCalls = 0; createCalls = []; updateCalls = [];
  witness.reset();
}
const caught = async (fn) => { try { await fn(); } catch (e) { return e; } return null; };
const base = { date: '2027-04-01', amount: -100, amountOp: 'is' };
const refused = (e, text) => {
  assert.ok(e instanceof NotFoundRefusal, String(e));
  assert.ok(isPreflightRefusal(e));
  assert.strictEqual(e.message, text);
};

await check('NEGATIVE: create with an unknown account is refused with the exact text, nothing written', async () => {
  reset();
  refused(await caught(() => adapter.createSchedule({ ...base, account: UNKNOWN, payee: PAY })), ACC_TEXT(UNKNOWN));
  assert.strictEqual(createCalls.length, 0);
});
await check('NEGATIVE: create with an unknown payee is refused', async () => {
  reset();
  refused(await caught(() => adapter.createSchedule({ ...base, account: ACC, payee: UNKNOWN })), PAY_TEXT(UNKNOWN));
  assert.strictEqual(createCalls.length, 0);
});
await check('NEGATIVE: update with an unknown account is refused', async () => {
  reset();
  refused(await caught(() => adapter.updateSchedule(SID, { account: UNKNOWN })), ACC_TEXT(UNKNOWN));
  assert.strictEqual(updateCalls.length, 0);
});
await check('NEGATIVE: update with an unknown payee is refused', async () => {
  reset();
  refused(await caught(() => adapter.updateSchedule(SID, { payee: UNKNOWN })), PAY_TEXT(UNKNOWN));
  assert.strictEqual(updateCalls.length, 0);
});
await check('NEGATIVE: a payee id sent as account is refused as an unknown account', async () => {
  reset();
  refused(await caught(() => adapter.createSchedule({ ...base, account: PAY })), ACC_TEXT(PAY));
  assert.strictEqual(createCalls.length, 0);
});
await check('NEGATIVE: an account id sent as payee is refused as an unknown payee', async () => {
  reset();
  refused(await caught(() => adapter.createSchedule({ ...base, payee: ACC })), PAY_TEXT(ACC));
  assert.strictEqual(createCalls.length, 0);
});
await check('NEGATIVE: both unknown, the account text wins', async () => {
  reset();
  refused(await caught(() => adapter.createSchedule({ ...base, account: UNKNOWN, payee: UNKNOWN })), ACC_TEXT(UNKNOWN));
});
await check('a closed account and a transfer payee are accepted, the raw write runs once', async () => {
  reset();
  await adapter.createSchedule({ ...base, account: CLOSED, payee: XFER });
  assert.strictEqual(createCalls.length, 1);
});
await check('NEGATIVE: a tombstoned payee is refused', async () => {
  reset();
  refused(await caught(() => adapter.createSchedule({ ...base, payee: DEAD })), PAY_TEXT(DEAD));
  assert.strictEqual(createCalls.length, 0);
});
await check('a known account and payee are accepted and passed through unchanged', async () => {
  reset();
  const id = await adapter.createSchedule({ ...base, account: ACC, payee: PAY });
  assert.strictEqual(id, SID);
  assert.strictEqual(createCalls[0].account, ACC);
  assert.strictEqual(createCalls[0].payee, PAY);
});
await check('update with account null and payee null clears and reads no listing', async () => {
  reset();
  await adapter.updateSchedule(SID, { account: null, payee: null });
  assert.strictEqual(updateCalls.length, 1);
  assert.strictEqual(accListCalls, 0);
  assert.strictEqual(payListCalls, 0);
});
await check('update that carries neither field reads no listing', async () => {
  reset();
  await adapter.updateSchedule(SID, { name: 'Renamed' });
  assert.strictEqual(updateCalls.length, 1);
  assert.strictEqual(accListCalls, 0);
  assert.strictEqual(payListCalls, 0);
});
await check('NEGATIVE: an unknown schedule id with an unknown payee gets the payee refusal', async () => {
  reset();
  refused(await caught(() => adapter.updateSchedule('00000000-0000-0000-0000-0000000000ff', { payee: UNKNOWN })), PAY_TEXT(UNKNOWN));
});
await check('one drain: a payee created after the listing was warmed is accepted by a schedule create', async () => {
  reset();
  const before = adapterMod._getWriteQueueBatchCountForTests();
  const warm = adapter.createSchedule({ ...base, payee: PAY });
  const mk = adapter.createPayee({ name: 'Fresh' });
  const use = adapter.createSchedule({ ...base, payee: NEW_PAY });
  await Promise.all([warm, mk, use]);
  assert.strictEqual(adapterMod._getWriteQueueBatchCountForTests() - before, 1, 'same drain');
  assert.strictEqual(createCalls.length, 2);
});
await check('two creates in one drain read the accounts and payees listings once each', async () => {
  reset();
  const before = adapterMod._getWriteQueueBatchCountForTests();
  await Promise.all([
    adapter.createSchedule({ ...base, account: ACC, payee: PAY }),
    adapter.createSchedule({ ...base, account: ACC, payee: PAY }),
  ]);
  assert.strictEqual(adapterMod._getWriteQueueBatchCountForTests() - before, 1, 'same drain');
  assert.strictEqual(accListCalls, 1);
  assert.strictEqual(payListCalls, 1);
});
await check('the guard sits in the write cycle: listing reads and the raw write share one cycle', async () => {
  reset();
  await adapter.createSchedule({ ...base, account: ACC });
  assert.ok(witness.sharedOneCycle(), witness.describe());
});

console.log(`\n[#785] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
