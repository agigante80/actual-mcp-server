// #390: a session must operate on ITS OWN budget, not on whatever was loaded last.
//
// THE BUG. `@actual-app/api` is process-global with ONE loaded budget, while the connection
// pool tracks up to MAX_CONCURRENT_SESSIONS entries that each carry their own syncId. Nothing
// recorded which budget was actually loaded, and both re-entry paths skip the download for
// good reasons of their own: `ActualConnectionPool.getConnection` returns early for an
// initialised entry, and `initActualApiForOperation` returns early when the singleton is live
// (which is #134's fix for the #127 auth burst). Neither is wrong alone. Together they meant a
// session operated on whatever budget the last session to open or switch had asked for.
//
// Reproduced before the fix, through the real switchBudget tool path:
//   after A opens:  singleton holds = budget-A
//   A's first write landed in: budget-A
//   after B opens:  singleton holds = budget-B
//   A's SECOND write landed in: budget-B      <- another user's budget
//
// WHY THE ACL DID NOT CATCH IT. `_enforceBudgetAcl` validates `getActiveBudgetConfig()`, the
// budget the session BELIEVES it is on, against allowedBudgets. The operation then executes
// against whatever is loaded. The check and the effect were on different budgets, so a session
// authorised for budget A only could have its write land in budget B and the ACL would permit
// it. #156 built that ACL to make per-user isolation real; this defeated it without tripping it.
//
// Run: node tests/unit/budget_selection_precondition.test.js

process.env.ACTUAL_SERVER_URL = 'http://test-server';
process.env.ACTUAL_PASSWORD = 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = 'budget-A';
process.env.MCP_BRIDGE_DATA_DIR = '/tmp/unit390';
process.env.BUDGET_1_NAME = 'alpha'; process.env.BUDGET_1_SYNC_ID = 'budget-A';
process.env.BUDGET_2_NAME = 'beta';  process.env.BUDGET_2_SYNC_ID = 'budget-B';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#390] ${l}`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

const ACC = 'aaaaaaaa-0000-4000-8000-000000000001';
const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

let loaded = null;             // what the SINGLETON holds
let downloads = 0;
const writes = [];             // [budgetAtWriteTime, marker]

api.init = async () => {};
api.shutdown = async () => {};
api.sync = async () => {};
api.downloadBudget = async (id) => { downloads++; loaded = id; };
api.getAccounts = async () => [{ id: ACC, name: 'Checking' }];
api.addTransactions = async (_a, txs) => { writes.push([loaded, txs[0].notes]); return 'ok'; };

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
const adapter = adapterMod.default;
const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');
const { requestContext } = await import('../../dist/src/lib/requestContext.js');
const apiState = await import('../../dist/src/lib/apiState.js');

const tx = (note) => [{ account: ACC, date: '2026-01-01', amount: -100, notes: note }];

// ---------------------------------------------------------------------------
describe('(1) a session writes to ITS OWN budget after another session switches away');
{
  await connectionPool.getConnection('sess-A');
  await requestContext.run({ sessionId: 'sess-A' }, () => adapter.addTransactions(tx('A1')));
  check(writes.at(-1)[0] === 'budget-A', `A's first write landed in budget-A (got ${writes.at(-1)[0]})`);

  // Session B opens and selects a DIFFERENT budget through the real tool path.
  await connectionPool.getConnection('sess-B');
  await requestContext.run({ sessionId: 'sess-B' }, () => adapter.switchBudget('beta'));
  check(apiState.getLoadedBudgetSyncId() === 'budget-B',
    `the singleton now records budget-B (got ${apiState.getLoadedBudgetSyncId()})`);

  // THE ASSERTION. Session A's pool entry still exists and is initialised, so nothing on the
  // old code path would have re-selected its budget.
  await requestContext.run({ sessionId: 'sess-A' }, () => adapter.addTransactions(tx('A2')));
  check(writes.at(-1)[0] === 'budget-A',
    `A's SECOND write landed in budget-A, not in session B's budget (got ${writes.at(-1)[0]})`);
}

// ---------------------------------------------------------------------------
describe('(2) the common case pays nothing: a matching budget triggers no download');
{
  const before = downloads;
  await requestContext.run({ sessionId: 'sess-A' }, () => adapter.addTransactions(tx('A3')));
  await requestContext.run({ sessionId: 'sess-A' }, () => adapter.addTransactions(tx('A4')));
  check(downloads === before,
    `two same-budget operations downloaded nothing (got ${downloads - before} downloads)`);
}

// ---------------------------------------------------------------------------
describe('(3) a torn-down singleton holds no budget');
{
  apiState.setApiInitialized(false);
  check(apiState.getLoadedBudgetSyncId() === null,
    'shutdown clears the recorded budget, so no stale claim survives it');
  apiState.setApiInitialized(true);
  apiState.setLoadedBudgetSyncId('budget-A');
}

// ---------------------------------------------------------------------------
describe('(4) GUARD: every downloadBudget call site records what it loaded');
{
  // The fix was incomplete on its first pass precisely here: four sites recorded and two did
  // not (switchBudget's fast path and the startup path), so the recorded value went stale and
  // the reproduction still failed. A missed site is SILENT, so it needs a guard rather than
  // care.
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
  const files = [];
  (function walk(dir) {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (e.endsWith('.ts')) files.push(full);
    }
  })(SRC);

  const offenders = [];
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/\.downloadBudget\(/.test(line)) return;
      if (/^\s*[/*]/.test(line)) return;                       // a comment mentioning it
      // Eight lines, not three. This codebase puts explanatory comments between a call and
      // what follows it, and the first version of this guard reported a site whose setter WAS
      // present but sat one line past a three-line comment. A guard that forbids comments is
      // fighting the house style; eight lines still catches a site with no record at all,
      // which is the failure being guarded.
      const window = lines.slice(i, i + 8).join('\n');
      if (!/setLoadedBudgetSyncId\(/.test(window)) {
        offenders.push(`${f.replace(SRC, 'src')}:${i + 1}`);
      }
    });
  }
  check(offenders.length === 0,
    `every downloadBudget call site records the loaded budget (unrecorded: ${offenders.join(', ') || 'none'})`);
}

log(`\n[#390] Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
