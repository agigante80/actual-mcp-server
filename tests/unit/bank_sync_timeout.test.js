// tests/unit/bank_sync_timeout.test.js
// #619: bank sync has its own bound, ACTUAL_BANK_SYNC_TIMEOUT_MS, because the provider call is
// legitimately longer than the general ACTUAL_OP_TIMEOUT_MS (upstream allows SimpleFIN 60 s per
// account and 300 s for a batch). The env is set BEFORE the adapter loads: config is parsed once
// at import. A file of its own so the short general bound cannot touch the other bank sync cases.
//
// What must hold:
//   - a provider call longer than the general bound and shorter than the bank sync bound resolves
//     (pooled and fallback path);
//   - a call longer than the bank sync bound rejects naming ACTUAL_BANK_SYNC_TIMEOUT_MS, drops the
//     pooled connection and is not followed by api.sync();
//   - any other write through withActualApiWrite keeps the general bound;
//   - a queued write that waits behind a sync for longer than the general bound is rejected as
//     never run (its client has likely given up, and a late write plus a retry is a duplicate),
//     while one that waits less runs.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';
process.env.ACTUAL_OP_TIMEOUT_MS = '300';
process.env.ACTUAL_BANK_SYNC_TIMEOUT_MS = '1500';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ACC = 'aaaaaaaa-0000-4000-8000-000000000619';
const SID = 'sess-619';
const REPORT = { newTransactions: ['n1'], matchedTransactions: [], updatedAccounts: [ACC] };

(async () => {
  const apiMod = await import('@actual-app/api');
  const api = (apiMod.default || apiMod);

  let syncImpl = async () => REPORT;
  let apiSyncCalls = 0;
  api.runQuery = async () => ({ data: [{ id: ACC, account_sync_source: 'goCardless', account_id: 'prov-1', name: 'Checking', closed: false }] });
  api.getAccounts = async () => [{ id: ACC, name: 'Checking', offbudget: false, closed: false }];
  api.runBankSync = async (args) => syncImpl(args);
  api.sync = async () => { apiSyncCalls++; };
  api.shutdown = async () => {};
  let rawPayeeCreates = 0;
  let payeeCreateMs = 0;
  api.createPayee = async () => { rawPayeeCreates++; if (payeeCreateMs) await sleep(payeeCreateMs); return 'payee-619'; };
  api.getPayees = async () => [];

  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const { default: config, configSchema } = await import('../../dist/src/config.js');
  const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');
  const { requestContext } = await import('../../dist/src/lib/requestContext.js');
  adapterMod._setSkipApiInitForTests(true);

  const prime = () => {
    apiSyncCalls = 0;
    adapterMod._setApiInitializedForTests(true);
    connectionPool.connections.set(SID, { sessionId: SID, initialized: true, lastActivity: Date.now(), dataDir: '/tmp/test' });
  };
  const errOf = async (fn) => { try { await fn(); return undefined; } catch (e) { return e; } };
  const pooled = (fn) => requestContext.run({ sessionId: SID }, fn);

  console.log('\n[#619] config: the bound is parsed like the other two');
  check(config.ACTUAL_OP_TIMEOUT_MS === 300, 'general bound is 300 in this file', String(config.ACTUAL_OP_TIMEOUT_MS));
  check(config.ACTUAL_BANK_SYNC_TIMEOUT_MS === 1500, 'bank sync bound is 1500 in this file', String(config.ACTUAL_BANK_SYNC_TIMEOUT_MS));

  console.log('\n[#619] positive (pooled): a 700 ms provider call outlives the 300 ms general bound');
  {
    prime();
    syncImpl = async () => { await sleep(700); return REPORT; };
    const started = Date.now();
    const out = await pooled(() => errOf(async () => { globalThis.__r619 = await adapterMod.runBankSync(ACC); }));
    check(out === undefined, 'runBankSync resolved', out?.message);
    check(globalThis.__r619?.newTransactions?.[0] === 'n1', 'the report is returned');
    check(Date.now() - started >= 650, 'it really waited for the provider', String(Date.now() - started));
    check(apiSyncCalls === 1, 'api.sync() ran once after it', String(apiSyncCalls));
    check(connectionPool.hasConnection(SID), 'pool entry kept');
  }

  console.log('\n[#619] negative (pooled): a provider call past the bank sync bound');
  {
    prime();
    syncImpl = () => new Promise(() => {});
    const started = Date.now();
    const err = await pooled(() => errOf(() => adapterMod.runBankSync(ACC)));
    const took = Date.now() - started;
    check(err?.message?.startsWith('Bank sync failed: Actual API bank sync timed out after 1500ms (ACTUAL_BANK_SYNC_TIMEOUT_MS).'),
      'rejects naming the bank sync knob', err?.message);
    check(took >= 1400 && took < 2600, 'at the bank sync bound, not the general one', String(took));
    check(apiSyncCalls === 0, 'no api.sync() after the timeout', String(apiSyncCalls));
    check(!connectionPool.hasConnection(SID), 'the pooled connection is dropped');
  }

  console.log('\n[#619] negative: another write keeps the general bound');
  {
    prime();
    const err = await pooled(() => errOf(() => adapterMod.withActualApiWrite(async () => { await sleep(700); return 1; })));
    check(/timed out after 300ms \(ACTUAL_OP_TIMEOUT_MS\)/.test(err?.message ?? ''), 'rejects naming the general knob', err?.message);
    check(!connectionPool.hasConnection(SID), 'the pooled connection is dropped');
  }

  console.log('\n[#619] negative: a queued write behind a 700 ms sync is rejected at the general bound, unrun');
  {
    prime();
    rawPayeeCreates = 0;
    syncImpl = async () => { await sleep(700); return REPORT; };
    const syncDone = pooled(() => errOf(() => adapterMod.runBankSync(ACC)));
    await sleep(30);
    const started = Date.now();
    const err = await pooled(() => errOf(() => adapterMod.createPayee({ name: 'Queued 619' })));
    const took = Date.now() - started;
    check(/^Write operation did not start within 300ms: .*\(ACTUAL_OP_TIMEOUT_MS\)\. The operation never ran and no data was modified\. Retry it\.$/.test(err?.message ?? ''),
      'the queued write is rejected as never run', err?.message);
    check(!/timed out/.test(err?.message ?? ''), 'and the message cannot be read as an infrastructure failure');
    check(took >= 250 && took < 650, 'at the general bound, before the sync ends', String(took));
    check((await syncDone) === undefined, 'the sync itself still resolves');
    await sleep(150);
    check(rawPayeeCreates === 0, 'the raw write never ran, also not after the lock was released', String(rawPayeeCreates));
    check(connectionPool.hasConnection(SID), 'the pool entry is kept: nothing touched upstream');
  }

  console.log('\n[#619] positive: a queued write behind a 100 ms sync runs');
  {
    prime();
    rawPayeeCreates = 0;
    syncImpl = async () => { await sleep(100); return REPORT; };
    const syncDone = pooled(() => errOf(() => adapterMod.runBankSync(ACC)));
    await sleep(30);
    const err = await pooled(() => errOf(() => adapterMod.createPayee({ name: 'Queued 619' })));
    check(err === undefined, 'the queued write resolved', err?.message);
    check(rawPayeeCreates === 1, 'its raw write ran once', String(rawPayeeCreates));
    await syncDone;
  }

  console.log('\n[#619] positive: the lock-wait bound is disarmed once the batch has the lock');
  {
    // Three writes in one batch, 200 ms each: the third starts 400 ms after dispatch, past the
    // 300 ms bound, while its OWN batch holds the lock. It must run, not be called "never ran".
    prime();
    rawPayeeCreates = 0;
    payeeCreateMs = 200;
    const errs = await pooled(() => Promise.all([1, 2, 3].map(i => errOf(() => adapterMod.createPayee({ name: `Batch 619 ${i}` })))));
    payeeCreateMs = 0;
    check(errs.every(e => e === undefined), 'all three writes of the batch resolved', errs.map(e => e?.message).join(' | '));
    check(rawPayeeCreates === 3, 'and each raw write ran', String(rawPayeeCreates));
  }

  console.log('\n[#619] parse and clamp of ACTUAL_BANK_SYNC_TIMEOUT_MS');
  {
    const parse = (v) => configSchema.shape.ACTUAL_BANK_SYNC_TIMEOUT_MS.parse(v);
    check(parse(undefined) === 300000, 'unset gives the default');
    check(parse('0') === 0, '0 means no bound');
    check(parse('abc') === 300000, 'a non-number falls back to the default');
    check(parse('-5') === 300000, 'a negative value falls back to the default');
    check(parse('100') === 250, 'a value under the floor clamps to 250');
    check(parse('45000') === 45000, 'a valid value is kept');
  }

  console.log('\n[#619] positive (fallback path, no session): the same bound applies');
  {
    connectionPool.connections.delete(SID);
    adapterMod._setApiInitializedForTests(false);
    syncImpl = async () => { await sleep(700); return REPORT; };
    const out = await errOf(async () => { globalThis.__r619 = await adapterMod.runBankSync(ACC); });
    check(out === undefined, 'runBankSync resolved', out?.message);
    syncImpl = () => new Promise(() => {});
    const err = await errOf(() => adapterMod.runBankSync(ACC));
    check(/timed out after 1500ms \(ACTUAL_BANK_SYNC_TIMEOUT_MS\)/.test(err?.message ?? ''), 'and it fires on the fallback path too', err?.message);
  }

  console.log(`\n[bank-sync-timeout] ${failures === 0 ? 'all passed' : failures + ' failed'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
