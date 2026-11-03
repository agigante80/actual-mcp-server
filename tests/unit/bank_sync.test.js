// tests/unit/bank_sync.test.js
// #548: actual_bank_sync reports what the sync imported. Since @actual-app/api 26.11.0
// runBankSync resolves { newTransactions, matchedTransactions, updatedAccounts } (id arrays) and
// rejects with a plain Error carrying `.code` only. The raw api is stubbed BEFORE the adapter
// loads (it destructures the raw functions at import), and api init is disarmed so the real
// adapter method runs: the preflight refusals, the error mapping and the normalisation live in
// the adapter, the per-list cap in the tool.
//
// The pooled-mode cases at the end are the first unit coverage of withActualApiWrite's pool
// branch (adapter_write_pool_cooperation covers the queued write path, not this wrapper): the
// trailing api.sync() runs once after a resolved op, and a rejecting sync drops the pool entry
// and rethrows.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const ACC = 'aaaaaaaa-0000-4000-8000-000000000548';
const ids = (n, p = 't') => Array.from({ length: n }, (_, i) => `${p}-${i}`);

(async () => {
  const apiMod = await import('@actual-app/api');
  const api = (apiMod.default || apiMod);

  // One row answers both the tool's existence check (#388) and the adapter's preflight.
  let rows = [];
  let syncCalls = [];
  let syncImpl = async () => ({ newTransactions: [], matchedTransactions: [], updatedAccounts: [] });
  let apiSyncCalls = 0;
  let apiSyncImpl = async () => {};
  api.runQuery = async () => ({ data: rows });
  api.getAccounts = async () => [{ id: ACC, name: 'Checking', offbudget: false, closed: false }];
  api.runBankSync = async (args) => { syncCalls.push(args); return syncImpl(args); };
  api.sync = async () => { apiSyncCalls++; return apiSyncImpl(); };
  api.shutdown = async () => {};

  const [tool, adapterMod, errorsMod, constants] = await Promise.all([
    import('../../dist/src/tools/bank_sync.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
    import('../../dist/src/lib/errors.js'),
    import('../../dist/src/lib/constants.js'),
  ]);
  const { isPreflightRefusal } = errorsMod;
  const { BANK_SYNC_IDS_CAP } = constants;
  const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');
  const { requestContext } = await import('../../dist/src/lib/requestContext.js');
  adapterMod._setSkipApiInitForTests(true);

  const reset = () => {
    rows = [{ id: ACC, account_sync_source: 'goCardless', account_id: 'prov-1', name: 'Checking', closed: false }];
    syncCalls = []; apiSyncCalls = 0; apiSyncImpl = async () => {};
    syncImpl = async () => ({ newTransactions: [], matchedTransactions: [], updatedAccounts: [] });
  };
  const errOf = async (fn) => { try { await fn(); return undefined; } catch (e) { return e; } };

  console.log('\n[#548] positive: counts and ids per list, capped at BANK_SYNC_IDS_CAP');
  check(BANK_SYNC_IDS_CAP === 100, 'the cap is 100', String(BANK_SYNC_IDS_CAP));
  for (const n of [0, 100, 101, 150]) {
    reset();
    syncImpl = async () => ({ newTransactions: ids(n), matchedTransactions: ids(2, 'm'), updatedAccounts: [ACC] });
    const r = await tool.call({ accountId: ACC });
    const nt = r?.newTransactions;
    check(r?.result === 'Bank sync completed', `${n}: result text kept`);
    check(nt?.count === n, `${n}: newTransactions.count is the full ${n}`, String(nt?.count));
    check(nt?.ids?.length === Math.min(n, 100), `${n}: ${Math.min(n, 100)} ids returned`, String(nt?.ids?.length));
    check(n === 0 || nt?.ids?.[0] === 't-0', `${n}: ids kept in upstream order`);
    check(r?.matchedTransactions?.count === 2 && r?.matchedTransactions?.ids?.length === 2, `${n}: matched list untouched`);
    check(r?.updatedAccounts?.count === 1 && r?.updatedAccounts?.ids?.[0] === ACC, `${n}: updatedAccounts carries the account`);
    check(r?.truncated === (n > 100), `${n}: truncated is ${n > 100}`, String(r?.truncated));
    check(JSON.stringify(syncCalls) === JSON.stringify([{ accountId: ACC }]), `${n}: runBankSync called once with { accountId }`);
  }

  console.log('\n[#548] positive: truncation in one list only still sets truncated');
  {
    reset();
    syncImpl = async () => ({ newTransactions: [], matchedTransactions: ids(150, 'm'), updatedAccounts: [] });
    const r = await tool.call({ accountId: ACC });
    check(r?.matchedTransactions?.count === 150 && r?.matchedTransactions?.ids?.length === 100, 'matched: 150 counted, 100 ids');
    check(r?.newTransactions?.count === 0 && r?.truncated === true, 'truncated true from the matched list alone');
  }

  console.log('\n[#548] positive: all accounts passes {} and resolves fast');
  {
    reset();
    const t0 = Date.now();
    const r = await tool.call({});
    check(JSON.stringify(syncCalls) === '[{}]', 'runBankSync called with {}', JSON.stringify(syncCalls));
    check(Date.now() - t0 < 1000, 'no settle sleep: resolved under 1 s', `${Date.now() - t0} ms`);
    check(r?.newTransactions?.count === 0 && r?.truncated === false, 'empty report');
  }

  console.log('\n[#548] normalisation: a malformed upstream result becomes empty lists');
  for (const [label, raw] of [
    ['undefined', undefined], ['null', null], ['{}', {}], ['a string', 'ok'],
    ['a non-array field', { newTransactions: 'x', matchedTransactions: 3, updatedAccounts: null }],
  ]) {
    reset();
    syncImpl = async () => raw;
    const r = await adapterMod.runBankSync(ACC);
    check(JSON.stringify(r) === '{"newTransactions":[],"matchedTransactions":[],"updatedAccounts":[]}', `${label}: three empty lists`, JSON.stringify(r));
  }
  {
    reset();
    syncImpl = async () => ({ newTransactions: ['a'] });
    const r = await adapterMod.runBankSync(ACC);
    check(r.newTransactions[0] === 'a' && r.matchedTransactions.length === 0 && r.updatedAccounts.length === 0, 'a missing array is [] and the present one is kept');
  }

  console.log('\n[#548] negative: preflight refusals are typed and never reach runBankSync');
  for (const [label, rowSet, accountId, re] of [
    ['local account', [{ id: ACC, account_sync_source: null, name: 'Cash', closed: false }], ACC, /Account "Cash" is a local account, not configured for bank sync/],
    ['closed account', [{ id: ACC, account_sync_source: 'goCardless', name: 'Old', closed: true }], ACC, /Account "Old" is closed; Actual skips closed accounts/],
    ['closed account (sqlite 1)', [{ id: ACC, account_sync_source: 'goCardless', name: 'Old', closed: 1 }], ACC, /is closed/],
    ['half-linked account (no provider account id)', [{ id: ACC, account_sync_source: 'goCardless', account_id: null, name: 'Half', closed: false }], ACC, /Account "Half" has a goCardless link with no provider account/],
    ['all accounts, none linked', [{ account_sync_source: null, closed: false }], undefined, /No accounts are configured for bank sync/],
    ['all accounts, only half-linked', [{ account_sync_source: 'goCardless', account_id: null, closed: false }], undefined, /No accounts are configured for bank sync/],
    ['all accounts, every linked one closed', [{ account_sync_source: 'goCardless', account_id: 'p', closed: true }, { account_sync_source: null, closed: false }], undefined, /Every bank-linked account is closed/],
  ]) {
    reset();
    rows = rowSet;
    const err = await errOf(() => adapterMod.runBankSync(accountId));
    check(isPreflightRefusal(err), `${label}: isPreflightRefusal`, err?.message);
    check(re.test(err?.message ?? ''), `${label}: message`, err?.message);
    check(syncCalls.length === 0, `${label}: runBankSync never called`);
  }

  console.log('\n[#548] negative: the refusal reaches the caller as the SAME object through the tool');
  {
    reset();
    rows = [{ id: ACC, account_sync_source: null, name: 'Cash', closed: false }];
    // Wrap the adapter method the tool calls so the object the adapter threw is captured.
    const adapter = adapterMod.default;
    const real = adapter.runBankSync;
    let fromAdapter;
    adapter.runBankSync = async (...a) => { try { return await real(...a); } catch (e) { fromAdapter = e; throw e; } };
    const err = await errOf(() => tool.call({ accountId: ACC }));
    adapter.runBankSync = real;
    check(fromAdapter !== undefined && isPreflightRefusal(fromAdapter), 'the adapter threw a preflight refusal');
    check(err === fromAdapter, 'the tool rethrows that same object, not a wrapper', err?.message);
  }

  console.log('\n[#548] negative: rate limit maps to the exact message, one upstream call, no retry');
  {
    reset();
    syncImpl = async () => { const e = new Error('Failed syncing account "Checking": Rate limit exceeded'); e.code = 'UNKNOWN'; throw e; };
    const err = await errOf(() => adapterMod.runBankSync(ACC));
    check(err?.message === 'Bank sync failed: GoCardless rate limit exceeded for this account. (NORDIGEN RATE_LIMIT_EXCEEDED: account success quota exhausted)', 'exact rate-limit message', err?.message);
    check(syncCalls.length === 1, 'runBankSync called once', String(syncCalls.length));
    check(!isPreflightRefusal(err), 'not a preflight refusal');
  }

  console.log('\n[#548] negative: a provider error keeps the upstream text and its cause');
  {
    reset();
    const upstream = Object.assign(new Error('Failed syncing account "Checking": 503 Service Unavailable'), { code: 'UNKNOWN' });
    syncImpl = async () => { throw upstream; };
    const err = await errOf(() => adapterMod.runBankSync(ACC));
    check(err?.message === 'Bank sync failed: Provider error: Failed syncing account "Checking": 503 Service Unavailable (code UNKNOWN)', 'provider message carries the code', err?.message);
    check(err?.cause === upstream, 'cause is the upstream error');
  }

  {
    reset();
    syncImpl = async () => { throw new Error('Failed syncing account "Checking."'); };
    const err = await errOf(() => adapterMod.runBankSync(ACC));
    check(err?.message === 'Bank sync failed: Provider error: Failed syncing account "Checking."', 'no code: no suffix', err?.message);
  }
  {
    reset();
    rows = [{ account_sync_source: 'goCardless', account_id: 'p', closed: true }, { account_sync_source: 'simpleFin', account_id: 'q', closed: false }];
    await adapterMod.runBankSync();
    check(syncCalls.length === 1, 'all accounts: one open linked account among closed ones is enough to sync');
  }

  console.log('\n[#548] negative: any other error keeps its text and cause');
  {
    reset();
    const upstream = new Error('something odd');
    syncImpl = async () => { throw upstream; };
    const err = await errOf(() => adapterMod.runBankSync(ACC));
    check(err?.message === 'Bank sync failed: something odd' && err?.cause === upstream, 'generic mapping', err?.message);
  }

  console.log('\n[#548] pooled mode: withActualApiWrite syncs once after a resolved op');
  const SID = 'sess-bank-sync-548';
  const prime = () => connectionPool.connections.set(SID, { sessionId: SID, initialized: true, lastActivity: Date.now(), dataDir: '/tmp/test' });
  {
    reset();
    adapterMod._setApiInitializedForTests(true);
    prime();
    syncImpl = async () => ({ newTransactions: ['n1'], matchedTransactions: [], updatedAccounts: [ACC] });
    const r = await requestContext.run({ sessionId: SID }, () => adapterMod.runBankSync(ACC));
    check(r.newTransactions[0] === 'n1', 'report returned');
    check(apiSyncCalls === 1, 'api.sync() called exactly once', String(apiSyncCalls));
    check(connectionPool.hasConnection(SID), 'pool entry kept');
  }
  {
    reset();
    adapterMod._setApiInitializedForTests(true);
    prime();
    syncImpl = async () => { throw new Error('Failed syncing account "Checking": 503 Service Unavailable'); };
    const err = await requestContext.run({ sessionId: SID }, () => errOf(() => adapterMod.runBankSync(ACC)));
    check(/Provider error/.test(err?.message ?? ''), 'rejection mapped', err?.message);
    check(apiSyncCalls === 0, 'no api.sync() in the rejection path', String(apiSyncCalls));
  }
  {
    reset();
    adapterMod._setApiInitializedForTests(true);
    prime();
    apiSyncImpl = async () => { throw new Error('network-failure'); };
    const err = await requestContext.run({ sessionId: SID }, () => errOf(() => adapterMod.runBankSync(ACC)));
    check(apiSyncCalls === 1, 'api.sync() attempted once');
    check(/Cannot connect to Actual Budget server/.test(err?.message ?? ''), 'a failed sync surfaces as an error', err?.message);
    check(!connectionPool.hasConnection(SID), 'the pool entry is dropped after the failed sync');
  }
  connectionPool.connections.delete(SID);
  adapterMod._setApiInitializedForTests(false);

  console.log(`\n[bank-sync] ${failures === 0 ? 'all passed' : failures + ' failed'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
