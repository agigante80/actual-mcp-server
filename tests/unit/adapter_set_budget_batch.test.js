// tests/unit/adapter_set_budget_batch.test.js
// #516: adapter.setBudgetBatch, driven through the REAL adapter with RAW api stubs.
//
// The raw stubs are installed BEFORE the adapter import (it destructures them at module load)
// and the session is disarmed with _setSkipApiInitForTests(true). The adapter is never stubbed:
// stubbing it would stub the guard away, which is the defect this ticket fixes.
//
// Run via: npm run test:unit-js
// Or: node tests/unit/adapter_set_budget_batch.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';
// The cooperative deadline is 75% of this; pinned so the deadline case does not depend on the environment.
process.env.ACTUAL_OP_TIMEOUT_MS  = '30000';

import { makeCycleWitness } from './helpers/write-cycle.mjs';
import { stripTsComments } from './helpers/source-text.js';
import { readFileSync } from 'node:fs';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' - ' + d : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const FOOD   = '10000000-0000-4000-8000-000000000001';
const RENT   = '10000000-0000-4000-8000-000000000002';
const SALARY = '10000000-0000-4000-8000-000000000003'; // income category
const GHOST  = '19999999-0000-4000-8000-000000000009'; // well-formed, does not exist

const apiMod = await import('@actual-app/api');
const apiDefault = (apiMod.default || apiMod);

// Recorded raw call order, writes, and per-test behaviour switches.
let events = [];
let writes = [];
let carryoverFails = null; // categoryId whose raw carryover write throws
let amountFails = null;    // categoryId whose raw amount write throws
let writeCostMs = 0;       // simulated clock advance per raw amount write
let readCostMs = 0;        // simulated clock advance per getBudgetMonth read
let amountFailMessage = 'upstream rejected the amount';
let amountFailsOnCall = 0;  // #539: when > 0, the Nth raw amount write (1-based) throws amountFailMessage
let amountCalls = 0;
let witness = null;
let clockOffset = 0;

apiDefault.sync = async () => {};
apiDefault.getCategories = async () => {
  events.push('getCategories'); witness?.noteRead();
  return [
    { id: FOOD, name: 'Food', is_income: false },
    { id: RENT, name: 'Rent', is_income: false },
    { id: SALARY, name: 'Salary', is_income: true },
  ];
};
apiDefault.getBudgetMonths = async () => { events.push('getBudgetMonths'); witness?.noteRead(); return ['2026-01', '2026-02', '2026-03']; };
// #539: a TRIPWIRE, kept on purpose. The adapter must never call it (a source guard below
// checks that too); if a change reintroduces the bracket, this stub's detached rejection
// reaches the unhandled-rejection recorder and, outside it, kills this test process.
// It is a stand-in for upstream's bracket. Upstream `api/batch-budget-start` runs
// `batchMessages` un-awaited and applies the queued messages AFTER `batch-budget-end`
// returns, so an apply failure is a rejection on a promise nobody holds. This stub
// reproduces that shape: the caller's await resolves, then a detached promise rejects.
apiDefault.batchBudgetUpdates = async (fn) => {
  events.push('bracket-enter');
  try { await fn(); } finally { events.push('bracket-exit'); }
  void (async () => { await null; throw new Error('#539 deferred apply failed after batch-budget-end'); })();
};
apiDefault.getBudgetMonth = async () => (clockOffset += readCostMs, {
  categoryGroups: [{ categories: [{ id: FOOD, budgeted: 5000 }, { id: RENT, budgeted: 1000 }] }],
});
apiDefault.setBudgetAmount = async (month, categoryId, amount) => {
  events.push('setAmount'); witness?.noteWrite();
  amountCalls += 1;
  if (categoryId === amountFails || amountCalls === amountFailsOnCall) throw new Error(amountFailMessage);
  writes.push({ kind: 'amount', month, categoryId, amount });
  clockOffset += writeCostMs;
};
apiDefault.setBudgetCarryover = async (month, categoryId, flag) => {
  events.push('setCarryover'); witness?.noteWrite();
  if (categoryId === carryoverFails) throw new Error('upstream rejected the carryover');
  writes.push({ kind: 'carryover', month, categoryId, flag });
};

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
const errorsMod = await import('../../dist/src/lib/errors.js');
const { NotFoundRefusal } = errorsMod;
const retryMod = await import('../../dist/src/lib/retry.js');
witness = makeCycleWitness(adapterMod);
adapterMod._setSkipApiInitForTests(true);
const adapter = adapterMod.default;

const reset = () => { amountFailMessage = 'upstream rejected the amount'; amountFailsOnCall = 0; amountCalls = 0; events = []; writes = []; carryoverFails = null; amountFails = null; writeCostMs = 0; readCostMs = 0; };
const run = async (items) => { reset(); witness.reset(); return adapter.setBudgetBatch(items); };

console.log('\n[#516] valid items: applied inside ONE drain, guard reads before the first write');
{
  const res = await run([
    { month: '2026-01', categoryId: FOOD, amount: 1000 },
    { month: '2026-02', categoryId: RENT, amount: 2000 },
    { month: '2026-03', categoryId: FOOD, carryover: true },
  ]);
  check(res.succeeded.length === 3 && res.failed.length === 0, 'all three items succeed');
  check(JSON.stringify(res.succeeded.map((s) => s.index)) === '[0,1,2]', 'succeeded entries carry their input index');
  check(res.succeeded[0].month === '2026-01' && res.succeeded[0].categoryId === FOOD, 'and the month and categoryId');
  check(writes.length === 3, 'three raw writes happened');
  check(witness.sharedOneCycle(), 'guard reads and writes shared ONE write-queue drain', witness.describe());
  const firstWrite = events.findIndex((e) => e === 'setAmount' || e === 'setCarryover');
  const lastRead = Math.max(events.lastIndexOf('getCategories'), events.lastIndexOf('getBudgetMonths'));
  check(firstWrite > -1 && lastRead > -1 && lastRead < firstWrite, 'both guard reads happen BEFORE the first write', events.join(','));
  check(events.filter((e) => e === 'getBudgetMonths').length === 1, 'months are read from upstream exactly once', events.join(','));
  check(events.filter((e) => e === 'getCategories').length === 1,
    'categories reach upstream exactly once (a repeated read through readDrainListing is absorbed by the drain cache, so this cannot see one)', events.join(','));
  check(!events.includes('bracket-enter'), '[#539] no upstream bracket is opened', events.join(','));
  const after = events.slice(firstWrite);
  check(after.length === 3 && after.every((e) => e === 'setAmount' || e === 'setCarryover'), 'only raw writes run after the reads', after.join(','));
}

console.log('\n[#516] an unknown category fails that item only, and is never written');
{
  const res = await run([
    { month: '2026-01', categoryId: FOOD, amount: 1000 },
    { month: '2026-01', categoryId: GHOST, amount: 1000 },
    { month: '2026-02', categoryId: RENT, amount: 2000 },
  ]);
  check(res.succeeded.map((s) => s.index).join() === '0,2', 'items 0 and 2 are applied');
  const expected = new NotFoundRefusal('Category', GHOST, 'actual_categories_get').message;
  check(JSON.stringify(res.failed) === JSON.stringify([{ index: 1, month: '2026-01', categoryId: GHOST, error: expected }]),
    'item 1 is in failed with the exact not-found entry', JSON.stringify(res.failed));
  check(!writes.some((w) => w.categoryId === GHOST), 'the refused item never reached a raw write');
  check(writes.length === 2, 'and the other two were applied (no rollback, no abort)');
}

console.log('\n[#516] an out-of-range month is refused per item');
{
  const res = await run([
    { month: '1899-01', categoryId: FOOD, amount: 1000 },
    { month: '2026-01', categoryId: FOOD, amount: 1000 },
  ]);
  check(res.failed.length === 1 && res.failed[0].index === 0 && res.failed[0].month === '1899-01', 'item 0 failed');
  check(/outside this budget's range/.test(res.failed[0].error) && /2026-01/.test(res.failed[0].error) && /2026-03/.test(res.failed[0].error) && /actual_budgets_getMonths/.test(res.failed[0].error),
    'with the range refusal naming the bounds and the listing tool', res.failed[0].error);
  check(res.succeeded.length === 1 && writes.length === 1, 'the valid item is applied');
}

console.log('\n[#516] the guards apply to carryover-only items too');
{
  const res = await run([
    { month: '2026-01', categoryId: GHOST, carryover: true },
    { month: '1899-01', categoryId: FOOD, carryover: true },
  ]);
  check(res.failed.length === 2 && res.succeeded.length === 0, 'both carryover-only items are refused');
  check(res.failed[0].error === new NotFoundRefusal('Category', GHOST, 'actual_categories_get').message, 'unknown category: the same not-found refusal as an amount');
  check(/outside this budget's range/.test(res.failed[1].error), 'bad month: the same range refusal as an amount');
  check(writes.length === 0 && !events.includes('setCarryover'), 'no raw carryover write was attempted');
  check(!events.includes('bracket-enter'), 'with nothing to write, no bracket is opened (and none ever is, #539)');
}

console.log('\n[#516] an income category carryover is refused BEFORE its amount is written');
{
  const res = await run([{ month: '2026-01', categoryId: SALARY, amount: 5000, carryover: true }]);
  check(res.failed.length === 1 && /income category/.test(res.failed[0].error), 'refused as an income category', JSON.stringify(res.failed));
  check(writes.length === 0, 'the amount did NOT land first');
  const amountOnly = await run([{ month: '2026-01', categoryId: SALARY, amount: 5000 }]);
  check(amountOnly.succeeded.length === 1 && writes.length === 1, 'an amount alone on an income category is still allowed');
}

console.log('\n[#516] upstream rejection stays as a backstop, reported per item');
{
  carryoverFails = null;
  reset(); witness.reset(); carryoverFails = RENT;
  const res = await adapter.setBudgetBatch([
    { month: '2026-01', categoryId: RENT, amount: 700, carryover: true },
    { month: '2026-01', categoryId: FOOD, amount: 800 },
  ]);
  check(res.failed.length === 1 && res.failed[0].index === 0, 'the item whose carryover upstream rejected is in failed');
  check(/upstream rejected the carryover/.test(res.failed[0].error) && /amount was applied/.test(res.failed[0].error),
    'its error says the amount was applied and carries the upstream message', res.failed[0].error);
  check(res.succeeded.length === 1 && res.succeeded[0].index === 1, 'the next item still runs');
  check(!events.includes('bracket-enter'), '[#539] no bracket was opened');
  reset(); witness.reset(); amountFails = FOOD;
  const r2 = await adapter.setBudgetBatch([
    { month: '2026-01', categoryId: FOOD, amount: 1 },
    { month: '2026-01', categoryId: RENT, amount: 2 },
  ]);
  check(r2.failed.length === 1 && r2.failed[0].error === 'upstream rejected the amount' && r2.succeeded.length === 1, 'an amount write error is caught per item and the loop continues');
}

console.log('\n[#516] infrastructure errors abort the batch instead of becoming per-item failures');
{
  reset(); witness.reset(); amountFails = RENT; amountFailMessage = 'read ECONNRESET';
  let threw = null;
  try {
    await adapter.setBudgetBatch([
      { month: '2026-01', categoryId: FOOD, amount: 1 },
      { month: '2026-01', categoryId: FOOD, amount: 2 },
      { month: '2026-01', categoryId: RENT, amount: 3 },
      { month: '2026-01', categoryId: FOOD, amount: 4 },
    ]);
  } catch (e) { threw = e; }
  check(threw instanceof Error, 'the call rejects');
  check(threw && threw.message.startsWith('Budget batch aborted after 2 of 4 items (applied: 0, 1): read ECONNRESET.') && /actual_budgets_getMonth before retrying/.test(threw.message),
    'with the count, the applied indices, the original text and the read-back advice', threw?.message);
  // The pool-drop decision is isRetryableError && !isRateLimitError (_shouldDropPoolOnError delegates to exactly that).
  check(retryMod.isRetryableError(threw) && !retryMod.isRateLimitError(threw), 'the rethrown error is still classified as infrastructure (pool drop)');
  check(threw?.cause instanceof Error && threw.cause.message === 'read ECONNRESET', '[#521] the abort carries the original error as cause');
  check(writes.length === 2 && events.at(-1) === 'setAmount', 'the loop stopped at the failing write (item 3 never written)', events.join(','));
  check(!events.includes('bracket-enter'), '[#539] no bracket was opened');
  // A rate limit is transient but does NOT drop the pool, so it stays a per-item failure.
  reset(); witness.reset(); amountFails = FOOD; amountFailMessage = 'Authentication failed: too-many-requests';
  const rl = await adapter.setBudgetBatch([{ month: '2026-01', categoryId: FOOD, amount: 1 }, { month: '2026-01', categoryId: RENT, amount: 2 }]);
  check(rl.failed.length === 1 && rl.succeeded.length === 1, 'a rate-limit error is a per-item failure and the batch continues');
}

console.log('\n[#516] every item failing is a normal result');
{
  const res = await run([
    { month: '2026-01', categoryId: GHOST, amount: 1 },
    { month: '2026-01', categoryId: GHOST, amount: 2 },
  ]);
  check(res.succeeded.length === 0 && res.failed.length === 2, 'resolves with two failures and no success (does not throw)');
  check(res.failed.map((f) => f.index).join() === '0,1', 'in input order');
}

console.log('\n[#516] repeated items on one category and month: last write wins');
{
  const res = await run([
    { month: '2026-01', categoryId: FOOD, amount: 100 },
    { month: '2026-01', categoryId: FOOD, amount: 300 },
    { month: '2026-01', categoryId: FOOD, amount: 200 },
  ]);
  check(res.succeeded.length === 3, 'all three are reported as applied');
  check(writes.map((w) => w.amount).join() === '100,300,200', 'and written in input order, so the last (200) is what remains', writes.map((w) => w.amount).join());
}

console.log('\n[#516] cooperative deadline: stop writing at 75% of ACTUAL_OP_TIMEOUT_MS');
{
  // Deterministic: the clock is advanced by each raw amount write rather than by real waiting.
  // 30000ms timeout -> 22500ms deadline; each write costs 10000ms, so the 4th item (clock at
  // 30000) is the first one stopped.
  const realNow = Date.now;
  Date.now = () => realNow() + clockOffset;
  try {
    clockOffset = 0;
    reset(); witness.reset(); writeCostMs = 10000;
    const items = Array.from({ length: 6 }, () => ({ month: '2026-01', categoryId: FOOD, amount: 5 }));
    const res = await adapter.setBudgetBatch(items);
    check(res.succeeded.map((s) => s.index).join() === '0,1,2', 'items before the deadline are applied', res.succeeded.map((s) => s.index).join());
    check(res.failed.map((f) => f.index).join() === '3,4,5', 'the remaining items are failed', res.failed.map((f) => f.index).join());
    check(res.failed.every((f) => f.error === 'not attempted: batch time budget exhausted'), 'with the exact deadline error');
    check(writes.length === 3, 'and none of them reached a raw write');
    check(!events.includes('bracket-enter'), '[#539] no bracket was opened');
  } finally { Date.now = realNow; clockOffset = 0; writeCostMs = 0; }
}

console.log('\n[#539] no upstream bracket: a deferred apply rejection cannot escape setBudgetBatch or transferBudgetAmount');
{
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(String(reason));
  process.on('unhandledRejection', onUnhandled);
  try {
    const res = await run([
      { month: '2026-01', categoryId: FOOD, amount: 1000 },
      { month: '2026-02', categoryId: RENT, carryover: true },
    ]);
    check(!events.includes('bracket-enter'), 'setBudgetBatch never opens the upstream bracket', events.join(','));
    reset(); witness.reset();
    const t = await adapter.transferBudgetAmount('2026-01', FOOD, RENT, 500);
    // Let any detached rejection reach the process handler before asserting.
    await new Promise((r) => setTimeout(r, 20));
    check(res.succeeded.length === 2 && res.failed.length === 0, 'setBudgetBatch: both items succeed');
    check(t.transferred === 500 && writes.length === 2, 'transferBudgetAmount: both writes happen', JSON.stringify(writes));
    check(!events.includes('bracket-enter'), 'transferBudgetAmount never opens the upstream bracket', events.join(','));
    check(unhandled.length === 0, 'no unhandled rejection reached the process', unhandled.join(' | '));
  } finally { process.off('unhandledRejection', onUnhandled); }
}

console.log('\n[#539] a write whose apply rejects is a failed item, not a false success');
{
  amountFails = null;
  reset(); witness.reset(); amountFails = RENT; amountFailMessage = 'SqliteError: database is locked';
  const res = await adapter.setBudgetBatch([
    { month: '2026-01', categoryId: FOOD, amount: 1 },
    { month: '2026-01', categoryId: RENT, amount: 2 },
  ]);
  check(res.succeeded.map((s) => s.index).join() === '0', 'only the applied item is succeeded');
  check(res.failed.length === 1 && res.failed[0].index === 1 && /database is locked/.test(res.failed[0].error), 'the rejected apply is reported on its item', JSON.stringify(res.failed));
  check(!events.includes('bracket-enter'), 'every write was awaited on its own (no bracket)', events.join(','));
}

console.log('\n[#539] transfer: a first-write failure writes nothing and passes the error through');
{
  reset(); witness.reset(); amountFailsOnCall = 1; amountFailMessage = 'SqliteError: database is locked';
  let threw = null;
  try { await adapter.transferBudgetAmount('2026-01', FOOD, RENT, 500); } catch (e) { threw = e; }
  check(threw instanceof Error && threw.message === 'SqliteError: database is locked', 'rejects with the upstream message unchanged', threw?.message);
  check(writes.length === 0, 'nothing was written');
}

console.log('\n[#539] transfer: a second-write failure is reported as a partial transfer');
{
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(String(reason));
  process.on('unhandledRejection', onUnhandled);
  try {
    reset(); witness.reset(); amountFailsOnCall = 2; amountFailMessage = 'SqliteError: database is locked';
    let threw = null;
    try { await adapter.transferBudgetAmount('2026-01', FOOD, RENT, 500); } catch (e) { threw = e; }
    await new Promise((r) => setTimeout(r, 20));
    const m = threw?.message || '';
    check(threw instanceof Error && m.startsWith('Partial transfer:'), 'rejects as a partial transfer', m);
    check(m.includes(`source category ${FOOD} was set from 5000 to 4500`), 'names the source and its old and new amounts', m);
    check(m.includes(`target category ${RENT} failed, so it is unchanged at 1000`), 'says the target is unchanged', m);
    check(m.includes('SqliteError: database is locked') && m.includes('actual_budgets_getMonth'), 'keeps the original text and the read-back tool', m);
    check(threw?.cause instanceof Error && threw.cause.message === 'SqliteError: database is locked', 'carries the original error as cause');
    check(writes.length === 1 && writes[0].categoryId === FOOD && writes[0].amount === 4500, 'exactly the source write landed', JSON.stringify(writes));
    check(unhandled.length === 0, 'no unhandled rejection reached the process', unhandled.join(' | '));
  } finally { process.off('unhandledRejection', onUnhandled); }
}

console.log('\n[#539] transfer: the partial-transfer rethrow keeps infrastructure classification');
{
  const classify = async (text) => {
    reset(); witness.reset(); amountFailsOnCall = 2; amountFailMessage = text;
    try { await adapter.transferBudgetAmount('2026-01', FOOD, RENT, 500); } catch (e) { return e; }
    return null;
  };
  for (const text of ['out of memory', 'read ECONNRESET']) {
    const e = await classify(text);
    check(e && retryMod.isRetryableError(e) && !retryMod.isRateLimitError(e), `"${text}" on the second write still drops the pool`, e?.message);
    check(e && e.message.includes(`so its outcome is unknown (it was 1000)`) && !e.message.includes('unchanged'),
      `"${text}": the target is reported as unknown, never as unchanged`, e?.message);
  }
  const domain = await classify('category "x" is not an expense category');
  check(domain && !retryMod.isRetryableError(domain), 'a domain error on the second write does not', domain?.message);
  check(domain && domain.message.includes('so it is unchanged at 1000'), 'and a domain rejection may say the target is unchanged', domain?.message);
}

console.log('\n[#539] transfer: the cooperative deadline stops the second write');
{
  // 30000ms timeout -> 22500ms deadline; the first write costs 25000ms of simulated clock.
  const realNow = Date.now;
  Date.now = () => realNow() + clockOffset;
  try {
    clockOffset = 0;
    reset(); witness.reset(); writeCostMs = 25000;
    let threw = null;
    try { await adapter.transferBudgetAmount('2026-01', FOOD, RENT, 500); } catch (e) { threw = e; }
    const m = threw?.message || '';
    check(m.startsWith('Partial transfer:') && m.includes('was not attempted (not attempted: batch time budget exhausted)') && m.includes('unchanged at 1000'),
      'rejects as a partial transfer that names the deadline', m);
    check(writes.length === 1 && writes[0].categoryId === FOOD, 'only the source write happened', JSON.stringify(writes));
  } finally { Date.now = realNow; clockOffset = 0; writeCostMs = 0; }
}

console.log('\n[#539] transfer: the deadline clock counts the read, not just the first write');
{
  // A 20000ms read plus a 5000ms write is 25000ms > 22500ms. A clock started at the first
  // write would see only 5000ms and make the second write after the caller timed out.
  const realNow = Date.now;
  Date.now = () => realNow() + clockOffset;
  try {
    clockOffset = 0;
    reset(); witness.reset(); readCostMs = 20000; writeCostMs = 5000;
    let threw = null;
    try { await adapter.transferBudgetAmount('2026-01', FOOD, RENT, 500); } catch (e) { threw = e; }
    check((threw?.message || '').includes('was not attempted'), 'a slow read counts toward the deadline', threw?.message);
    check(writes.length === 1, 'so the target write is never made', JSON.stringify(writes));
  } finally { Date.now = realNow; clockOffset = 0; writeCostMs = 0; readCostMs = 0; }
}

console.log('\n[#539] source guard: the adapter never references batchBudgetUpdates');
{
  const src = stripTsComments(readFileSync(new URL('../../src/lib/actual-adapter.ts', import.meta.url), 'utf8'));
  check(!/\bbatchBudgetUpdates\b/.test(src) && !/\brawBatchBudgetUpdates\b/.test(src),
    'no batchBudgetUpdates identifier outside comments (the bracket defers the apply onto a detached promise)');
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll setBudgetBatch adapter checks passed');
process.exit(0);
