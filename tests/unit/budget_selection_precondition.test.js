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
api.getAccounts = async () => [{ id: ACC, name: `acct-in-${loaded}` }];
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
      // The invariant is "every path that CHANGES the loaded budget records it", not just
      // downloadBudget. `importBudget` is such a path (upstream documents it as "loads the
      // imported budget"), and the first version of this guard could not see it, which is how
      // the record was left naming the pre-import budget: the one direction that makes the
      // precondition silently pass.
      // Matches BOTH shapes this codebase uses to reach the api: the `api.downloadBudget(...)`
      // property call, and the `rawImportBudget(...)` alias created by destructuring the module
      // at load. The first version matched only the dotted form and therefore could not see
      // importBudget at all, which is precisely the path whose record was left stale.
      if (!/(\.|\braw)(downloadBudget|importBudget|loadBudget|DownloadBudget|ImportBudget|LoadBudget)\(/.test(line)) return;
      // Only RAW api receivers. A tool calling `adapter.importBudget(...)` is not a path that
      // changes the loaded budget itself; the adapter method it calls is, and that one is
      // checked on its own line. Without this the guard reports the caller instead of the
      // mutator, which sends the next reader to the wrong file.
      if (/\badapter\s*\./.test(line)) return;
      if (/^\s*[/*]/.test(line)) return;                       // a comment mentioning it
      // Scope: the call's OWN BLOCK, found by brace balance.
      //
      // This went through three wrong scopes before this one, and each failure is worth
      // keeping. A 3-line then 8-line window kept reporting legitimately-recorded sites,
      // because this codebase puts a paragraph of comment between a call and what follows it;
      // widening the number is a treadmill. Scoping to the enclosing FUNCTION fixed that but
      // introduced the opposite hole: the pool records in both arms of an if/else, so deleting
      // ONE arm's record still found the other and the guard stayed green, which is exactly the
      // per-branch miss that broke the original fix. Brace balance confines the search to the
      // arm the call actually sits in, so both failures are caught and neither false-positives.
      // Depth is checked PER CHARACTER, not per line. Checking per line let `} else {`
      // cancel itself out, so the scan ran straight into the sibling branch and found ITS
      // record: deleting one arm's setter still passed. That is the per-branch miss this
      // scope exists to catch, reintroduced by the scan itself.
      let depth = 0;
      let end = lines.length;
      outer: for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth < 0) { end = j; break outer; }
          }
        }
      }
      const window = lines.slice(i, end).join('\n');
      if (!/setLoadedBudgetSyncId\(/.test(window)) {
        offenders.push(`${f.replace(SRC, 'src')}:${i + 1}`);
      }
    });
  }
  check(offenders.length === 0,
    `every downloadBudget call site records the loaded budget (unrecorded: ${offenders.join(', ') || 'none'})`);
}

// ---------------------------------------------------------------------------
describe('(5) a MIXED-SESSION batch: each write lands in its own budget');
{
  // Round 2 found the drain resolved the budget from the AMBIENT context, and that the
  // long-standing comment claiming "setTimeout strips the ALS frame" is FALSE: ALS propagates
  // through timers, so the drain inherits the context of whichever session most recently
  // SCHEDULED it, which is the last enqueuer in the debounce window and is unrelated to the op
  // being run. Reproduced both ways: A's write landed in B's budget, and in the other ordering
  // the precondition actively re-pointed the singleton at the wrong session, making a write
  // that had been correct wrong.
  for (const order of ['A-first', 'B-first']) {
    writes.length = 0;
    const a = requestContext.run({ sessionId: 'sess-A' }, () => adapter.addTransactions(tx('A')));
    const b = requestContext.run({ sessionId: 'sess-B' }, () => adapter.addTransactions(tx('B')));
    await Promise.all(order === 'A-first' ? [a, b] : [b, a]);
    const byMarker = Object.fromEntries(writes.map(([budget, marker]) => [marker, budget]));
    check(byMarker.A === 'budget-A' && byMarker.B === 'budget-B',
      `${order}: A wrote to budget-A and B to budget-B (got A=${byMarker.A}, B=${byMarker.B})`);
  }
}

// ---------------------------------------------------------------------------
describe('(6) the LEGACY (non-pooled) READ path is covered too');
{
  // Round 2 reproduced a SILENT cross-tenant read here: with A's pool entry dropped but its MCP
  // session still serving (which httpServer deliberately allows), A's next call took the legacy
  // path, initActualApiForOperation early-returned because the singleton was live, and A
  // received B's account list with no warning at all.
  //
  // A READ, deliberately. A write goes through the drain, which carries its own per-op check,
  // so a write here would pass even with the legacy check removed and would prove nothing. I
  // wrote it as a write first and the mutation test caught that it did not discriminate.
  await requestContext.run({ sessionId: 'sess-B' }, () => adapter.switchBudget('beta'));
  connectionPool.connections.delete('sess-A');
  const seen = await requestContext.run({ sessionId: 'sess-A' }, () => adapter.getAccounts());
  const name = Array.isArray(seen) ? seen[0]?.name : undefined;
  check(name === 'acct-in-budget-A',
    `a legacy-path READ returned this session's own budget (got ${name})`);
  await connectionPool.getConnection('sess-A');
}

// ---------------------------------------------------------------------------
describe('(7) GUARD: the pool mutates the singleton under the api mutex');
{
  // Recording and checking inside the lock only NARROWS the race while the MUTATOR stays
  // outside it: ActualConnectionPool.getConnection called api.init + downloadBudget with no
  // lock at all, so a session opening could re-point the singleton while another session's
  // operation was mid-flight holding the lock. The window is the whole duration of an
  // operation, and since #378 made the drain sequential, of a whole batch.
  const poolSrc = readFileSync(
    fileURLToPath(new URL('../../src/lib/ActualConnectionPool.ts', import.meta.url)), 'utf8');
  const lines = poolSrc.split('\n');
  const unguarded = [];
  lines.forEach((line, i) => {
    if (!/await withOpTimeout\(\(\) => api\.init\(/.test(line)) return;
    const preceding = lines.slice(Math.max(0, i - 25), i).join('\n');
    if (!/withApiLock\(async \(\) => \{/.test(preceding)) unguarded.push(i + 1);
  });
  check(unguarded.length === 0,
    `every pool api.init runs under the api mutex (unguarded at line: ${unguarded.join(', ') || 'none'})`);
}

log(`\n[#390] Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
