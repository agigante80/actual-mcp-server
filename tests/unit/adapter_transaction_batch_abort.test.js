// tests/unit/adapter_transaction_batch_abort.test.js
// #521: adapter.updateTransactionBatch stops on an infrastructure error (the shared
// abortBatchOnInfrastructureError rule) instead of swallowing it into failed[].
//
// Raw api stubs are installed BEFORE the adapter import and the session is disarmed with
// _setSkipApiInitForTests(true). Legacy cases run FIRST with no pool sessions primed: with an
// active session _shouldKeepSingletonAlive keeps the singleton alive and a forced shutdown
// would be invisible. A forced shutdown is observable only under MCP_STDIO_MODE=true.
//
// Run: node tests/unit/adapter_transaction_batch_abort.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (l) => console.log(`  ✓ ${l}`);
const fail = (l, d = '') => { console.error(`  ✗ FAIL: ${l}${d ? ' - ' + d : ''}`); failures++; };
const check = (c, l, d = '') => (c ? pass(l) : fail(l, d));
const yieldMs = (ms = 50) => new Promise((r) => setTimeout(r, ms));

const ID1 = '50000000-0000-4000-8000-000000000001';
const ID2 = '50000000-0000-4000-8000-000000000002';
const ID3 = '50000000-0000-4000-8000-000000000003';
const ID4 = '50000000-0000-4000-8000-000000000004';

const apiMod = await import('@actual-app/api');
const apiDefault = apiMod.default || apiMod;

let existingIds = new Set();
let updateCalls = [];
let throwOn = new Map(); // id -> message
let syncCalls = 0;
let syncFails = false;
apiDefault.runQuery = async () => ({ data: [...existingIds].map((id) => ({ id })) });
apiDefault.updateTransaction = async (id) => {
  updateCalls.push(id);
  if (throwOn.has(id)) throw new Error(throwOn.get(id));
};
apiDefault.sync = async () => { syncCalls++; if (syncFails) throw new Error('read ECONNRESET'); };

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
const retryMod = await import('../../dist/src/lib/retry.js');
const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');
const { requestContext } = await import('../../dist/src/lib/requestContext.js');
const apiState = await import('../../dist/src/lib/apiState.js');
adapterMod._setSkipApiInitForTests(true);
const adapter = adapterMod.default;

const reset = ({ exist, throws = [], failSync = false }) => {
  existingIds = new Set(exist);
  updateCalls = [];
  throwOn = new Map(throws);
  syncCalls = 0;
  syncFails = failSync;
};
const batch = (ids) => ids.map((id) => ({ id, fields: { notes: 'x' } }));
const attempt = async (fn) => { try { return { value: await fn() }; } catch (e) { return { err: e }; } };
const withStdio = async (fn) => {
  const prev = process.env.MCP_STDIO_MODE;
  process.env.MCP_STDIO_MODE = 'true';
  try { return await fn(); } finally { if (prev === undefined) delete process.env.MCP_STDIO_MODE; else process.env.MCP_STDIO_MODE = prev; }
};

console.log('\n[#521] U1/U6: infrastructure error aborts the batch (legacy stdio) and tears the singleton down');
{
  const r = await withStdio(async () => {
    adapterMod._setApiInitializedForTests(true);
    reset({ exist: [ID1, ID2, ID3], throws: [[ID2, 'read ECONNRESET']] });
    const res = await attempt(() => adapter.updateTransactionBatch(batch([ID1, ID2, ID3])));
    await yieldMs();
    return { res, initialized: apiState.isApiInitialized() };
  });
  const e = r.res.err;
  check(e instanceof Error, 'the call rejects');
  check(e && e.message.startsWith(`Transaction batch aborted after 1 of 3 items (applied: ${ID1}; failed before the abort: none; outcome unknown: ${ID2}; not attempted: 1): read ECONNRESET.`)
    && e.message.includes('actual_transactions_get before retrying'), 'message names applied, unknown and not-attempted', e?.message);
  check(updateCalls.length === 2 && !updateCalls.includes(ID3), 'item 3 is never sent');
  check(e && retryMod.isRetryableError(e) && !retryMod.isRateLimitError(e), 'still classified as pool-drop');
  check(r.initialized === false, 'forced full shutdown tore the singleton down (stdio)');
  check(e?.cause instanceof Error && e.cause.message === 'read ECONNRESET', 'U6: cause is the original error');
}

console.log('\n[#521] U1c: a non-infrastructure rejection stays per item and the singleton survives');
{
  const r = await withStdio(async () => {
    adapterMod._setApiInitializedForTests(true);
    reset({ exist: [ID1, ID2, ID3], throws: [[ID2, 'Field "foo" does not exist']] });
    const res = await attempt(() => adapter.updateTransactionBatch(batch([ID1, ID2, ID3])));
    await yieldMs();
    return { res, initialized: apiState.isApiInitialized() };
  });
  const v = r.res.value;
  check(v && JSON.stringify(v.succeeded) === JSON.stringify([{ id: ID1 }, { id: ID3 }]), 'ID1 and ID3 succeeded', JSON.stringify(v));
  check(v && v.failed.length === 1 && v.failed[0].id === ID2 && v.failed[0].error === 'Field "foo" does not exist', 'ID2 is a per-item failure');
  check(updateCalls.length === 3, 'three raw calls');
  check(r.initialized === true, 'no forced teardown');
}

console.log('\n[#521] U4: not-found never reaches the catch (regression guard)');
{
  reset({ exist: [ID1, ID3] });
  const v = await adapter.updateTransactionBatch(batch([ID1, ID2, ID3]));
  check(v.failed.length === 1 && v.failed[0].id === ID2 && /not found/.test(v.failed[0].error), 'ID2 reported not found');
  check(updateCalls.length === 2 && updateCalls[0] === ID1 && updateCalls[1] === ID3, 'raw calls for ID1 and ID3 only');
}

console.log('\n[#521] U5: a rate limit is a per-item failure, not an abort');
{
  reset({ exist: [ID1, ID2, ID3], throws: [[ID2, 'Authentication failed: too-many-requests']] });
  const rl = new Error('Authentication failed: too-many-requests');
  check(retryMod.isRetryableError(rl) && retryMod.isRateLimitError(rl), 'fixture is retryable AND rate-limit');
  const { value: v, err } = await attempt(() => adapter.updateTransactionBatch(batch([ID1, ID2, ID3])));
  check(!err, 'the call resolves', err?.message);
  check(v && v.failed.some((f) => f.id === ID2) && v.succeeded.some((s) => s.id === ID3), 'ID2 failed, ID3 applied');
}

console.log('\n[#521] U7: failed-before-abort and not-attempted counts come from the right sources');
{
  reset({ exist: [ID2, ID3, ID4], throws: [[ID3, 'read ECONNRESET']] });
  const { err } = await attempt(() => adapter.updateTransactionBatch(batch([ID1, ID2, ID3, ID4])));
  check(err && err.message.startsWith(`Transaction batch aborted after 1 of 4 items (applied: ${ID2}; failed before the abort: ${ID1}; outcome unknown: ${ID3}; not attempted: 1): read ECONNRESET.`), 'message', err?.message);
  check(updateCalls.length === 2, 'two raw calls');
}

console.log('\n[#521] U8: abort on the first item');
{
  reset({ exist: [ID1, ID2], throws: [[ID1, 'read ECONNRESET']] });
  const { err } = await attempt(() => adapter.updateTransactionBatch(batch([ID1, ID2])));
  check(err && err.message.startsWith(`Transaction batch aborted after 0 of 2 items (applied: none; failed before the abort: none; outcome unknown: ${ID1}; not attempted: 1): read ECONNRESET.`), 'message', err?.message);
  check(updateCalls.length === 1, 'one raw call');
}

// Pooled cases: prime a session and run inside requestContext.
const SID = 'sess-txn-batch-abort';
const prime = () => {
  connectionPool.connections.set(SID, { sessionId: SID, initialized: true, lastActivity: Date.now(), dataDir: '/tmp/test' });
  adapterMod._setApiInitializedForTests(true);
};
const origShutdown = connectionPool.shutdownConnectionLocked.bind(connectionPool);
let shutdownCalls = [];
connectionPool.shutdownConnectionLocked = async (sid) => { shutdownCalls.push(sid); connectionPool.connections.delete(sid); };

console.log('\n[#521] U2: pooled abort with a healthy sync keeps the pool entry and pushes the applied items');
{
  prime(); shutdownCalls = [];
  reset({ exist: [ID1, ID2, ID3], throws: [[ID2, 'read ECONNRESET']] });
  const { err } = await attempt(() => requestContext.run({ sessionId: SID }, () => adapter.updateTransactionBatch(batch([ID1, ID2, ID3]))));
  await yieldMs();
  check(err instanceof Error, 'rejects');
  check(updateCalls.length === 2, 'two raw calls');
  check(syncCalls >= 1, 'applied items are synced');
  check(shutdownCalls.length === 0, 'no shutdownConnectionLocked call');
  check(connectionPool.hasConnection(SID), 'pool entry kept');
  connectionPool.connections.delete(SID);
}

console.log('\n[#521] U3: pooled abort with a failing sync drops the pool entry exactly once');
{
  prime(); shutdownCalls = [];
  reset({ exist: [ID1, ID2, ID3], throws: [[ID2, 'read ECONNRESET']], failSync: true });
  const { err } = await attempt(() => requestContext.run({ sessionId: SID }, () => adapter.updateTransactionBatch(batch([ID1, ID2, ID3]))));
  await yieldMs();
  check(err instanceof Error, 'rejects');
  check(shutdownCalls.length === 1 && shutdownCalls[0] === SID, 'exactly one shutdownConnectionLocked(sid)', JSON.stringify(shutdownCalls));
}

connectionPool.shutdownConnectionLocked = origShutdown;
connectionPool.connections.delete(SID);
console.log(failures ? `\n${failures} failure(s)` : '\nAll adapter_transaction_batch_abort tests passed');
process.exit(failures ? 1 : 0);
