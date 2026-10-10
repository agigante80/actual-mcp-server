// tests/unit/budget_updates_batch.test.js
// #516: actual_budget_updates_batch, driven through the REAL tool and the REAL adapter with
// RAW api stubs (installed before the adapter import, session disarmed). Never a stubbed
// adapter: that would stub the category and month guards away.
//
// Run via: npm run test:unit-js
// Or: node tests/unit/budget_updates_batch.test.js

import { readFileSync } from 'node:fs';

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' - ' + d : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const FOOD  = '10000000-0000-4000-8000-000000000001';
const RENT  = '10000000-0000-4000-8000-000000000002';
const GHOST = '19999999-0000-4000-8000-000000000009';

const apiMod = await import('@actual-app/api');
const apiDefault = (apiMod.default || apiMod);
let writes = [];
let infraFails = false; // #539: the first raw write fails with an infrastructure error (there is no bracket to fail)
let amountFailsFor = null;
apiDefault.sync = async () => {};
apiDefault.getCategories = async () => [
  { id: FOOD, name: 'Food', is_income: false },
  { id: RENT, name: 'Rent', is_income: false },
];
apiDefault.getBudgetMonths = async () => ['2026-01', '2026-02', '2026-03'];
apiDefault.setBudgetAmount = async (month, categoryId, amount) => {
  if (infraFails) throw new Error('read ECONNRESET');
  if (amountFailsFor === categoryId) throw new Error('upstream rejected the amount');
  writes.push({ month, categoryId, amount });
};
apiDefault.setBudgetCarryover = async (month, categoryId, flag) => { writes.push({ month, categoryId, flag }); };

// Log capture (the seam budget_acl_enforcement.test.js uses): record every warn, forward it.
const loggerDefault = (await import('../../dist/src/logger.js')).default;
const warnRecords = [];
const origWarn = loggerDefault.warn.bind(loggerDefault);
loggerDefault.warn = (msg, meta) => { warnRecords.push({ msg: String(msg), meta }); return origWarn(msg, meta); };
const batchWarns = () => warnRecords.filter((r) => r.meta?.module === 'BUDGET_BATCH');

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
const tool = (await import('../../dist/src/tools/budget_updates_batch.js')).default;

const zodMessages = async (input) => {
  try { await tool.call(input); return null; }
  catch (e) { return (e.issues ?? []).map((i) => i.message).join(' | ') || String(e.message); }
};

console.log('\n[#516] shape and per-item results');
{
  writes = [];
  const res = await tool.call({ operations: [
    { month: '2026-01', categoryId: FOOD, amount: 1000 },
    { month: '2026-01', categoryId: GHOST, amount: 1000 },
    { month: '2026-02', categoryId: RENT, amount: 2000 },
  ] });
  check(JSON.stringify(Object.keys(res).sort()) === JSON.stringify(['failed', 'failureCount', 'succeeded', 'successCount', 'total']), 'exactly the documented keys, none of the old aggregate fields', Object.keys(res).join());
  check(res.total === 3 && res.successCount === 2 && res.failureCount === 1, 'counts: total 3, successCount 2, failureCount 1');
  check(JSON.stringify(res.succeeded) === JSON.stringify([
    { index: 0, month: '2026-01', categoryId: FOOD },
    { index: 2, month: '2026-02', categoryId: RENT },
  ]), 'succeeded lists the applied items by index');
  check(res.failed.length === 1 && res.failed[0].index === 1 && res.failed[0].month === '2026-01' && res.failed[0].categoryId === GHOST && /not found/i.test(res.failed[0].error) && res.failed[0].error.includes(GHOST),
    'the unknown category is in failed with a not-found error', JSON.stringify(res.failed));
  check(writes.length === 2 && !writes.some((w) => w.categoryId === GHOST), 'nothing was written for the unknown category');
  check(!('success' in res) && !('successful' in res) && !('errors' in res), 'the old success/successful/errors fields are gone');
}

console.log('\n[#523] one aggregated warn for failed items');
{
  warnRecords.length = 0;
  await tool.call({ operations: [
    { month: '2026-01', categoryId: GHOST, amount: 1 },
    { month: '2026-02', categoryId: GHOST, amount: 1 },
    { month: '2026-03', categoryId: GHOST, amount: 1 },
  ] });
  let w = batchWarns();
  check(w.length === 1, 'U3: exactly one BUDGET_BATCH warn for three failures', String(w.length));
  check(w[0]?.msg.includes('Budget batch items failed'), 'U3: message names the aggregate');
  check(w[0]?.meta?.failureCount === 3 && JSON.stringify(w[0]?.meta?.failedIndices) === '[0,1,2]', 'U3: failureCount 3, failedIndices [0,1,2]', JSON.stringify(w[0]?.meta));
  check(!('month' in (w[0]?.meta ?? {})) && !('categoryId' in (w[0]?.meta ?? {})) && !('amount' in (w[0]?.meta ?? {})), 'U3: meta carries no month, categoryId or amount');

  warnRecords.length = 0;
  await tool.call({ operations: [{ month: '2026-01', categoryId: FOOD, amount: 1 }, { month: '2026-01', categoryId: RENT, amount: 1 }] });
  check(batchWarns().length === 0, 'U4: no failures, no BUDGET_BATCH warn');

  warnRecords.length = 0;
  await tool.call({ operations: [
    { month: '2026-01', categoryId: FOOD, amount: 1 },
    { month: '2026-01', categoryId: GHOST, amount: 1 },
    { month: '2026-01', categoryId: RENT, amount: 1 },
    { month: '1899-01', categoryId: FOOD, amount: 1 },
  ] });
  w = batchWarns();
  check(w.length === 1 && w[0].meta.failureCount === 2 && JSON.stringify(w[0].meta.failedIndices) === '[1,3]', 'U5: mixed batch logs one warn with failedIndices [1,3]', JSON.stringify(w.map((r) => r.meta)));

  warnRecords.length = 0;
  amountFailsFor = RENT;
  try {
    await tool.call({ operations: [
      { month: '2026-01', categoryId: RENT, amount: 1 },
      { month: '2026-01', categoryId: GHOST, amount: 1 },
    ] });
  } finally { amountFailsFor = null; }
  w = batchWarns();
  check(w.length === 1 && w[0].meta.failureCount === 2 && JSON.stringify(w[0].meta.failedIndices) === '[0,1]', 'U6: phase 2 write failure and phase 1 refusal share one record, ascending', JSON.stringify(w.map((r) => r.meta)));
}

console.log('\n[#516] every item failing resolves normally');
{
  writes = [];
  let threw = null; let res = null;
  try { res = await tool.call({ operations: [{ month: '2026-01', categoryId: GHOST, amount: 1 }, { month: '1899-01', categoryId: FOOD, amount: 1 }] }); }
  catch (e) { threw = e; }
  check(threw === null, 'does not throw');
  check(res?.successCount === 0 && res?.failureCount === 2 && res?.total === 2 && res.succeeded.length === 0, 'successCount 0, failureCount === total');
}

console.log('\n[#516] invalid input is a thrown schema error with the exact messages');
{
  check((await zodMessages({ operations: [{ month: '2026-01', categoryId: FOOD, amount: 12.5 }] }))?.includes('Amount must be an integer (cents)'), 'amount 12.5 is rejected');
  check((await zodMessages({ operations: [{ month: '2026-01', categoryId: FOOD }] }))?.includes('each operation needs at least one of amount or carryover'), 'an operation with neither field is rejected');
  const empty = await zodMessages({ operations: [] });
  check(empty !== null && />=1 items/.test(empty), 'an empty array is rejected', String(empty));
  const big = await zodMessages({ operations: Array.from({ length: 101 }, () => ({ month: '2026-01', categoryId: FOOD, amount: 1 })) });
  check(big !== null && /<=100 items/.test(big), '101 operations are rejected naming the cap', String(big));
}

console.log('\n[#516] a whole-call failure is a tool error, not a result');
{
  infraFails = true;
  let threw = null;
  try { await tool.call({ operations: [{ month: '2026-01', categoryId: FOOD, amount: 1 }] }); } catch (e) { threw = e; }
  infraFails = false;
  check(threw instanceof Error && /ECONNRESET/.test(threw.message), 'the error propagates');
}

console.log('\n[#516] the description states the contract');
{
  const d = tool.description;
  check(/at least one of amount/i.test(d), 'at-least-one-of rule');
  check(/100/.test(d), 'the 100 cap');
  check(/NOT atomic/.test(d) && /no rollback/i.test(d), 'non-atomic, no rollback');
  check(/actual_budgets_getMonth/.test(d) && /BEFORE retrying/.test(d), 'read back before retrying after a timeout');
}

console.log('\n[#516] the tool file holds no raw API access and no console');
{
  const src = readFileSync(new URL('../../src/tools/budget_updates_batch.ts', import.meta.url), 'utf8');
  check(!/from\s+['"]@actual-app\/api|import\(\s*['"]@actual-app\/api|require\(\s*['"]@actual-app\/api/.test(src), 'no @actual-app/api import');
  check(!/console\./.test(src), 'no console.*');
  check(/createModuleLogger/.test(src), 'uses createModuleLogger');
  check(!/amount/.test((src.match(/log\.(info|warn)\([^)]*\{[^}]*\}/g) || []).join('\n')), 'log calls never include an amount');
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll budget_updates_batch tool checks passed');
process.exit(0);
