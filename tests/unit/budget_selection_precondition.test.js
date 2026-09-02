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
// #396: loadBudgetTracked now PROBES after every download, because a resolved downloadBudget
// is not proof a budget is open. Mirrors this file's own `loaded` notion of the singleton.
api.getBudgetMonths = async () => { if (!loaded) throw { type: 'APIError', message: 'No budget file is open' }; return ['2026-01']; };
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
describe('(4) GUARD: every raw budget load is an argument to the tracked loader');
{
  // The fix was incomplete on its first pass precisely here: sites recorded and others did not,
  // so the recorded value went stale and the reproduction still failed. A missed site is SILENT,
  // so it needs a guard rather than care.
  //
  // #410 changed what this asserts, because the invariant changed. Every load now funnels through
  // `trackBudgetMutation` in budgetLoader.ts, which owns the clear-before and the record-on-settle,
  // so "a setter in the same block" stopped discriminating: both raw sites carried a redundant
  // clear that existed only to satisfy the scan, and deleting the helper's REAL record left this
  // green. What matters now is that a raw load is an ARGUMENT to the tracked helper.
  //
  // #407 review rebuilt the predicate after mutation testing found two holes: a file-wide
  // exemption for budgetLoader.ts (which blinded it in the one file most likely to gain a new load
  // path) and PROXIMITY matching (any raw load within 12 lines after a tracker call was invisible).
  // Both are gone. The check is structural: walk back to the nearest unclosed `(` and require the
  // token before it to be a tracker.
  //
  // ONE function does the work, used by both the real scan and the teeth check below. The previous
  // version reimplemented the predicate in its self-check, the two drifted, and the self-check
  // reported green while the real predicate was neutered.
  const LOAD_CALL = /(\.|\braw)(downloadBudget|importBudget|loadBudget|DownloadBudget|ImportBudget|LoadBudget)\(/;
  const TRACKER = /(trackBudgetMutation|importBudgetTracked|loadBudgetTracked)\s*$/;

  function unguardedLoadSites(source) {
    const lines = source.split('\n');
    const out = [];
    lines.forEach((line, i) => {
      const m = LOAD_CALL.exec(line);
      if (!m) return;
      // Only RAW api receivers. `adapter.importBudget(...)` is a caller, not a mutator; the adapter
      // method it calls is checked on its own line. Without this the guard reports the caller and
      // sends the next reader to the wrong file.
      if (/\badapter\s*\./.test(line)) return;
      if (/^\s*[/*]/.test(line)) return;                       // a comment mentioning it

      // Scope for the fallback record check: the call's OWN block, by brace balance, checked PER
      // CHARACTER. Per line let `} else {` cancel itself out, so the scan ran into the sibling
      // branch and found ITS record: deleting one arm's setter still passed.
      let depth = 0;
      let end = lines.length;
      outer: for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') depth++;
          else if (ch === '}') { depth--; if (depth < 0) { end = j; break outer; } }
        }
      }
      const window = lines.slice(i, end).join('\n');

      // Structural: from the matched call's own paren, walk backwards to the nearest UNCLOSED
      // paren. Starting from the first paren on the line was the bug in the first attempt: an
      // `() =>` arrow wrapper made it inspect the arrow's own parens instead of the call's.
      // ANY enclosing level, not just the nearest. The legitimate shape nests the raw call inside
      // `withConcurrency(retry(...))` inside the tracker, so requiring the IMMEDIATE enclosing call
      // to be a tracker reported a correct site. Each time the walk finds an unclosed `(` it tests
      // that callee and then keeps going outward.
      const callParen = m.index + m[0].length - 1;
      let d = 0;
      let wrapped = false;
      back: for (let j = i; j >= 0; j--) {
        const l = lines[j];
        for (let c = (j === i ? callParen - 1 : l.length - 1); c >= 0; c--) {
          const ch = l[c];
          if (ch === ')') d++;
          else if (ch === '(') {
            if (d === 0) {
              if (TRACKER.test(l.slice(0, c))) { wrapped = true; break back; }
              // not a tracker: keep walking outward to the next enclosing call
            } else {
              d--;
            }
          }
        }
      }

      // The fallback is REGISTRATION, not the setter. Round 2 caught this: `wrapped` was added as
      // an OR to the old `setLoadedBudgetSyncId` check rather than replacing it, so the guard was
      // strictly MORE permissive than before, and the escape it left is exactly the shape #410
      // removed: a redundant clear placed after the call purely to satisfy the scan. Reproduced
      // with a rogue `const p = api.downloadBudget(id); setLoadedBudgetSyncId(null); await p;`,
      // which has no `registerBudgetLoad` and so is never waited for: the #390/#393 leak, added
      // silently and reported green.
      //
      // `registerBudgetLoad` is the invariant that actually matters, and it is what the one
      // legitimate non-tracker site (diagnose's `api.loadBudget`) calls on the very next line.
      if (!wrapped && !/registerBudgetLoad\(/.test(window)) out.push(i + 1);
    });
    return out;
  }

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
    for (const lineNo of unguardedLoadSites(readFileSync(f, 'utf8'))) {
      offenders.push(`${f.replace(SRC, 'src')}:${lineNo}`);
    }
  }
  check(offenders.length === 0,
    `every raw budget load is an argument to the tracked loader (unguarded: ${offenders.join(', ') || 'none'})`);

  // TEETH, run through the SAME function above, on the shapes mutation testing showed the previous
  // predicate missed.
  check(
    unguardedLoadSites('export async function probeReload(syncId) {\n  await api.downloadBudget(syncId);\n}').length === 1,
    'it sees an untracked load inside budgetLoader-like code, which the old file-wide exemption hid',
  );
  check(
    unguardedLoadSites('  await loadBudgetTracked(a, b);\n  logger.info("x");\n  await api.downloadBudget(rogue);').length === 1,
    'it sees an untracked load just after a tracker call, which proximity matching missed',
  );
  // The round-2 hole: a rogue load made to look compliant by a redundant clear after it. This is
  // the exact shape #410 removed from the real code, so the guard must not accept it as evidence.
  check(
    unguardedLoadSites('  const p = api.downloadBudget(syncId);\n  setLoadedBudgetSyncId(null);\n  await p;').length === 1,
    'a redundant setLoadedBudgetSyncId after the load does NOT satisfy the guard; only registration does',
  );
  // and the one legitimate non-tracker site stays accepted, because it registers.
  check(
    unguardedLoadSites('    const p = api.loadBudget(localId);\n    registerBudgetLoad(p);\n    await p;').length === 0,
    'a raw load that registers itself is accepted, which is what diagnose() does',
  );
  check(
    unguardedLoadSites('    await trackBudgetMutation(\n      () => api.downloadBudget(syncId),\n      () => syncId,\n    );').length === 0,
    'and it ACCEPTS a load passed as an argument to the tracked helper, so it is not reporting everything',
  );
  // The real import shape nests the raw call two wrappers deep inside the tracker. Requiring the
  // IMMEDIATE enclosing call to be a tracker reported this correct site as an offender.
  check(
    unguardedLoadSites('    await importBudgetTracked(() => {\n      const started = withConcurrency(() =>\n        retry(() => rawImportBudget(input, opts), { retries: 0 }),\n      );\n      return started;\n    });').length === 0,
    'and it accepts a load nested inside withConcurrency/retry within the tracker',
  );
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
describe('(7) GUARD: every pool api.init is opened under the api mutex');
{
  // Recording and checking inside the lock only NARROWS the race while the MUTATOR stays
  // outside it: ActualConnectionPool.getConnection called api.init + downloadBudget with no
  // lock at all, so a session opening could re-point the singleton while another session's
  // operation was mid-flight holding the lock. The window is the whole duration of an
  // operation, and since #378 made the drain sequential, of a whole batch.
  //
  // WHAT THIS CHECKS, EXACTLY: that a `withApiLock(async () => {` opening precedes each pool
  // `api.init` within 25 lines. It does NOT prove the block is still open at that point, and
  // it does NOT cover the api.shutdown() sites. I tried to widen it to every singleton
  // mutation with a backwards brace scan and the scan misreported sites that ARE locked, so
  // rather than ship a analyser I do not trust, the claim here is narrowed to what it verifies
  // and the shutdown paths are tracked separately. A guard that overstates its reach is worse
  // than a narrow one, because the next reader stops looking.
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
    `every pool api.init is opened under the api mutex (unguarded at line: ${unguarded.join(', ') || 'none'})`);
}

log(`\n[#390] Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
