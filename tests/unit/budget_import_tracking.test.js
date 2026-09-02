// #394: an ABANDONED importBudget must not leave the record naming the pre-import budget.
//
// Upstream's `importBudget` LOADS the imported budget, so it re-points the process-global
// singleton exactly as a download does. Before this ticket, `adapter.importBudget`:
//   - never cleared the record before starting,
//   - never registered the promise, so a late landing was discovered rather than waited for,
//   - wrote `setLoadedBudgetSyncId('imported:<id>')` AFTER the await, so a timeout skipped it.
//
// The reproduction from #390's third security review, which this file pins:
//
//   t+479: import rejected (timeout).  record=budget-A, pending=false
//          [upstream] importBudget LANDED at t+628ms, singleton now holds ATTACKER-IMPORT
//   t+680: victim read -> acct-in-ATTACKER-IMPORT   (record now says imported:imported-1)
//   RESULT: LEAK.
//
// From t+250 to t+628 the record named `budget-A` while the singleton was moving to an
// out-of-registry, un-ACL'd imported file, so a victim session passed the #390 precondition
// legitimately and had its reads served from the importer's file.
//
// A large YNAB or zip import exceeding ACTUAL_OP_TIMEOUT_MS is the EXPECTED case here, not a
// rare one, which is what makes the timeout path the important one.
//
// Run: node tests/unit/budget_import_tracking.test.js

process.env.ACTUAL_SERVER_URL = 'http://test-server';
process.env.ACTUAL_PASSWORD = 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = 'budget-A';
process.env.MCP_BRIDGE_DATA_DIR = '/tmp/unit394';
process.env.ACTUAL_OP_TIMEOUT_MS = '250';

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#394-import-tracking] ${l}`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

let importDelayMs = 0;
let importThrows = null;
let importCalls = 0;
api.init = async () => {};
api.shutdown = async () => {};
api.sync = async () => {};
api.downloadBudget = async () => {};
api.getBudgetMonths = async () => ['2026-01'];
api.importBudget = async () => {
  importCalls++;
  if (importDelayMs) await new Promise((r) => setTimeout(r, importDelayMs));
  if (importThrows) throw importThrows;
  return { id: 'imported-1' };
};

const { importBudgetTracked } = await import('../../dist/src/lib/budgetLoader.js');
const apiState = await import('../../dist/src/lib/apiState.js');

function reset() {
  importCalls = 0; importDelayMs = 0; importThrows = null;
  apiState.setApiInitialized(true);
  apiState.setLoadedBudgetSyncId('budget-A');   // the victim's budget, as in the reproduction
}
async function settle(p) { try { return { ok: true, v: await p }; } catch (e) { return { ok: false, err: e }; } }
const start = () => importBudgetTracked(() => {
  const started = api.importBudget();
  apiState.setLoadedBudgetSyncId(null);
  return started;
});

// --- 1. the reproduction ---------------------------------------------------
describe('an ABANDONED import never leaves the record naming the pre-import budget');
{
  reset();
  importDelayMs = 600;                       // outruns ACTUAL_OP_TIMEOUT_MS=250
  const r = await settle(start());
  check(!r.ok, 'the caller gets the timeout rejection');
  check(
    apiState.getLoadedBudgetSyncId() !== 'budget-A',
    `the record no longer names the pre-import budget (got ${JSON.stringify(apiState.getLoadedBudgetSyncId())})`,
  );
  check(
    apiState._hasPendingBudgetLoadForTests() === true,
    'the abandoned import stays REGISTERED, so the next lock acquisition waits for it',
  );
  await new Promise((res) => setTimeout(res, 700));   // let it land
  check(
    apiState.getLoadedBudgetSyncId() === 'imported:imported-1',
    `after landing the record names the imported file (got ${JSON.stringify(apiState.getLoadedBudgetSyncId())})`,
  );
  check(
    apiState._hasPendingBudgetLoadForTests() === false,
    'and it deregisters itself once settled',
  );
}

// --- 2. the normal path is unchanged ---------------------------------------
describe('a normal import behaves exactly as before, sentinel included');
{
  reset();
  const r = await settle(start());
  check(r.ok, 'it resolves');
  check(r.ok && r.v && r.v.id === 'imported-1', 'it returns the imported id');
  check(apiState.getLoadedBudgetSyncId() === 'imported:imported-1', 'the imported: sentinel is recorded');
  check(apiState.isApiInitialized() === true, 'the singleton stays live');
}

// --- 3. a FAILED import poisons rather than lying --------------------------
describe('a failed import leaves the singleton poisoned, not falsely described');
{
  reset();
  importThrows = new Error('Error importing budget: invalid-zip-file');
  const r = await settle(start());
  check(!r.ok, 'it rejects');
  check(!!r.err && /invalid-zip-file/.test(r.err.message), 'the upstream error propagates unchanged');
  check(apiState.isApiInitialized() === false, 'the singleton is poisoned, because upstream closes before it opens');
  check(
    apiState.getLoadedBudgetSyncId() === null,
    `the record is indeterminate, never the pre-import budget (got ${JSON.stringify(apiState.getLoadedBudgetSyncId())})`,
  );
}

// --- 4. the sentinel can never collide with a configured budget ------------
describe('the sentinel is structurally unmatchable by any configured session');
{
  reset();
  await settle(start());
  const recorded = apiState.getLoadedBudgetSyncId();
  check(/^imported:/.test(String(recorded)), 'it is prefixed');
  check(
    !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(recorded)),
    'it cannot be read as a UUID, so no configured syncId can compare equal to it',
  );
}

log(`\n[#394-import-tracking] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
