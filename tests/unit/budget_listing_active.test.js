// tests/unit/budget_listing_active.test.js
// #787: the budget listing marks the caller's active budget with active: true, the listing hint no
// longer promises a partial name, and the switch texts state the per-caller scope.
// Real adapter and real tools, no upstream I/O (_setSkipApiInitForTests).
// Run: node tests/unit/budget_listing_active.test.js   (needs `npm run build` first)

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ACTUAL_SERVER_URL = 'http://test-server:5006';
process.env.ACTUAL_PASSWORD = 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = 'default-sync';
process.env.BUDGET_DEFAULT_NAME = 'Default';
process.env.BUDGET_1_NAME = 'Second';
process.env.BUDGET_1_SYNC_ID = 'second-sync';
process.env.ALLOW_INSECURE_UPSTREAM = 'true';
process.env.MCP_BRIDGE_DATA_DIR = mkdtempSync(join(tmpdir(), 'listing-active-'));

const adapter = await import('../../dist/src/lib/actual-adapter.js');
const { requestContext } = await import('../../dist/src/lib/requestContext.js');
const listTool = (await import('../../dist/src/tools/budgets_list_available.js')).default;
const switchTool = (await import('../../dist/src/tools/budgets_switch.js')).default;
adapter._setSkipApiInitForTests(true);

let failures = 0;
const check = (c, m, d = '') => { if (c) console.log(`  ok: ${m}`); else { console.error(`  FAIL: ${m}${d ? ' (' + d + ')' : ''}`); failures++; } };
const run = (ctx, fn) => new Promise((res, rej) => requestContext.run(ctx, async () => { try { res(await fn()); } catch (e) { rej(e); } }));
const activeNames = (rows) => rows.filter((r) => r.active === true).map((r) => r.name);

console.log('\n[#787] active marker');
await run({ sessionId: 's1', principal: 'alice', allowedBudgets: ['*'] }, async () => {
  const a = adapter.getBudgetRegistry();
  check(activeNames(a).join() === 'Default' && a.length === 2, 'the default budget is the only marked row', JSON.stringify(a.map((r) => [r.name, r.active])));
  check(a.filter((r) => 'active' in r).every((r) => r.active === true), 'active is only ever true, never false');
  await adapter.switchBudget('Second');
  check(activeNames(adapter.getBudgetRegistry()).join() === 'Second', 'the mark follows a switch');
});
await run({ sessionId: 's2', principal: 'bob', allowedBudgets: ['*'] }, async () => {
  check(activeNames(adapter.getBudgetRegistry()).join() === 'Default', 'a second open session keeps its own mark');
});
await run({ sessionId: 's3', principal: 'alice', allowedBudgets: ['*'] }, async () => {
  check(activeNames(adapter.getBudgetRegistry()).join() === 'Second', 'a new session of the same caller starts on the switched budget');
});
await run({ sessionId: 's4', principal: 'static-bearer', allowedBudgets: ['*'] }, async () => { await adapter.switchBudget('Second'); });
await run({ sessionId: 's5', principal: 'static-bearer', allowedBudgets: ['*'] }, async () => {
  check(activeNames(adapter.getBudgetRegistry()).join() === 'Second', 'two sessions of the legacy token principal share the preference');
});

console.log('\n[#787] no flag');
await run({ sessionId: 's6', principal: 'carol', allowedBudgets: ['second-sync'] }, async () => {
  const rows = adapter.getBudgetRegistry();
  check(rows.map((r) => r.name).join() === 'Second', 'a restricted caller lists only its budget');
  check(activeNames(rows).join() === 'Second', 'the one permitted row is the marked one', JSON.stringify(rows));
});
check(adapter.getBudgetRegistry().every((r) => !('active' in r)), 'a call outside any context gets rows with no flag');
await run({ allowedBudgets: ['*'] }, async () => {
  check(adapter.getBudgetRegistry().every((r) => !('active' in r)), 'a context without a session id gets no flag');
});

console.log('\n[#787] texts');
const listed = await run({ sessionId: 's8', principal: 'erin', allowedBudgets: ['*'] }, () => listTool.call({}));
check(!/partial/i.test(listed.hint) && /exact name/.test(listed.hint), 'the listing hint does not promise a partial name', listed.hint);
check(/active true/.test(listTool.description), 'the listing description explains active');
check(!/this session only/.test(switchTool.description) && /remembered per caller/.test(switchTool.description) && /other open sessions/.test(switchTool.description) && /legacy MCP_SSE_AUTHORIZATION token/.test(switchTool.description), 'the switch description states the per-caller scope');
const sw = await run({ sessionId: 's9', principal: 'frank', allowedBudgets: ['*'] }, () => switchTool.call({ budgetName: 'Second' }));
check(/Authenticated callers also start their new sessions on this budget/.test(sw.message), 'the switch message says new sessions follow');
let refusal = null;
try { await run({ sessionId: 's10', principal: 'gina', allowedBudgets: ['*'] }, () => switchTool.call({ budgetName: 'Sec' })); } catch (e) { refusal = e; }
check(/not found/i.test(refusal?.message ?? ''), 'a partial name is still refused', refusal?.message);

if (failures) { console.error(`\n[#787] ${failures} check(s) FAILED`); process.exit(2); }
console.log('\n[#787] All listing active tests passed');
