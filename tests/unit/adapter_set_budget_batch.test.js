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
let amountFailMessage = 'upstream rejected the amount';
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
apiDefault.batchBudgetUpdates = async (fn) => {
  events.push('bracket-enter');
  try { await fn(); } finally { events.push('bracket-exit'); }
};
apiDefault.setBudgetAmount = async (month, categoryId, amount) => {
  events.push('setAmount'); witness?.noteWrite();
  if (categoryId === amountFails) throw new Error(amountFailMessage);
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

const reset = () => { amountFailMessage = 'upstream rejected the amount'; events = []; writes = []; carryoverFails = null; amountFails = null; writeCostMs = 0; };
const run = async (items) => { reset(); witness.reset(); return adapter.setBudgetBatch(items); };

console.log('\n[#516] valid items: applied inside ONE drain, guard reads before the bracket');
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
  const enter = events.indexOf('bracket-enter');
  const lastRead = Math.max(events.lastIndexOf('getCategories'), events.lastIndexOf('getBudgetMonths'));
  check(enter > -1 && lastRead > -1 && lastRead < enter, 'both guard reads happen BEFORE the bracket is entered', events.join(','));
  check(events.filter((e) => e === 'getCategories').length === 1 && events.filter((e) => e === 'getBudgetMonths').length === 1,
    'categories and months are each read exactly once', events.join(','));
  check(events.filter((e) => e === 'bracket-enter').length === 1, 'exactly one bracket is opened');
  const inside = events.slice(enter + 1, events.indexOf('bracket-exit'));
  check(inside.length === 3 && inside.every((e) => e === 'setAmount' || e === 'setCarryover'), 'only raw writes run inside the bracket', inside.join(','));
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
  check(!events.includes('bracket-enter'), 'with nothing to write, no bracket is opened');
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
  check(res.succeeded.length === 1 && res.succeeded[0].index === 1, 'the next item still runs inside the same bracket');
  check(events.filter((e) => e === 'bracket-enter').length === 1 && events.at(-1) === 'bracket-exit', 'the bracket was opened once and closed');
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
  check(writes.length === 2 && events.at(-1) === 'bracket-exit', 'the loop stopped (item 3 never written) and the bracket was closed');
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
    check(events.at(-1) === 'bracket-exit', 'the bracket was still closed cleanly');
  } finally { Date.now = realNow; clockOffset = 0; writeCostMs = 0; }
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll setBudgetBatch adapter checks passed');
process.exit(0);
