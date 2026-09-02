// #396: a resolved downloadBudget() is NOT proof that a budget is open.
//
// Upstream's `api/download-budget` handler discards the `{ error }` that `load-budget`
// returns, in BOTH of its branches (loot-core src/server/api.ts:237 for a local copy and
// :261 after a fresh download). `load-budget` never throws: it returns an error object,
// having already called `closeBudget()` internally, which unloads prefs. The sync that
// follows cannot catch it either, because `_fullSync` opens with
// `if (... || !currentId) return []`, so with nothing loaded it reports success by
// returning nothing.
//
// Net effect, reproduced against a real budget two ways (a planted future migration id, and
// a db.sqlite that is not a database): downloadBudget RESOLVES, nothing is open, and every
// later call throws `No budget file is open` permanently for that data dir. Upstream prints
// the real reason to stderr and then throws it away.
//
// Before this guard, loadBudgetTracked recorded setLoadedBudgetSyncId(syncId) on that
// resolution, so the server believed a budget was loaded when none was, and could not tell
// the user which of the five load failures had happened.
//
// The guard lives in loadBudgetTracked because that is the chokepoint every load passes
// through: five call sites across the adapter and the connection pool, so both transports
// are covered by one check.
//
// Run: node tests/unit/budget_loader_postcondition.test.js

process.env.ACTUAL_SERVER_URL = 'http://test-server';
process.env.ACTUAL_PASSWORD = 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = 'budget-A';
process.env.MCP_BRIDGE_DATA_DIR = '/tmp/unit396';
process.env.ACTUAL_OP_TIMEOUT_MS = '250';   // short: case 7 needs a download that outruns it

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#396-postcondition] ${l}`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

// --- the stubbed singleton -------------------------------------------------
// `open` models upstream's prefs.getPrefs().id: what checkFileOpen() actually tests.
let open = null;
let calls = { downloadBudget: 0, getBudgetMonths: 0, getBudgets: 0, loadBudget: 0 };

// Whether the download LOADS what it downloads. The whole point of this ticket is that
// upstream can resolve without doing so.
let downloadLoads = true;
let downloadThrows = null;
let downloadDelayMs = 0;
// #410 review (I7): the witness for the clear-before invariant. Removing the redundant call-site
// clears left `trackBudgetMutation`'s OWN clear with zero coverage of any kind: deleting it kept
// the whole chain green. Sampled from inside the download, because that is the only moment the
// record is supposed to be indeterminate.
let recordDuringDownload;
api.downloadBudget = async (id) => {
  calls.downloadBudget++;
  recordDuringDownload = apiState.getLoadedBudgetSyncId();
  open = null;                       // upstream closes the current budget first
  if (downloadDelayMs) await new Promise((r) => setTimeout(r, downloadDelayMs));
  if (downloadThrows) throw downloadThrows;
  if (downloadLoads) open = id;
};
// The probe. Mirrors upstream: checkFileOpen() first, then cheap local work.
let budgetMonths = ['2026-01', '2026-02'];
let probeHangs = false;
let probeThrows = null;
let probeDelayMs = 0;
api.getBudgetMonths = async () => {
  calls.getBudgetMonths++;
  if (probeDelayMs) await new Promise((r) => setTimeout(r, probeDelayMs));
  if (probeHangs) await new Promise(() => {});   // never settles, on purpose
  if (probeThrows) throw probeThrows;
  // Upstream's checkFileOpen() throws APIError(), which RETURNS A PLAIN OBJECT
  // ({ type, message, meta }), not an Error. Measured against @actual-app/api 26.8.0:
  // `err instanceof Error` is false and String(err) is '[object Object]'. Modelled
  // faithfully, because an `instanceof Error` guard in the implementation would miss it.
  if (!open) throw { type: 'APIError', message: 'No budget file is open', meta: undefined };
  return budgetMonths;
};
// The diagnostic pair, used only on the failure path.
// `api/get-budgets` concatenates the local scan with get-remote-files and does NOT dedupe, so
// a budget synced both ways appears TWICE and only the local entry carries `id`. Measured:
// [{"id":"_test-budget"},{"state":"remote"}] for one groupId.
let getBudgetsResult = [
  { id: 'local-id-1', groupId: 'budget-A', name: 'Main' },
  { groupId: 'budget-A', state: 'remote', cloudFileId: 'c1', name: 'Main', owner: 'someone-else' },
];
let getBudgetsThrows = null;
api.getBudgets = async () => {
  calls.getBudgets++;
  if (getBudgetsThrows) throw getBudgetsThrows;
  return getBudgetsResult;
};
function skewError() {
  // Upstream: withErrorCode(new Error(getSyncError(reason, id)), reason) -> Object.assign(err,{code}).
  // Measured: code === 'out-of-sync-migrations'.
  const e = new Error('This budget cannot be loaded with this version of the app.');
  e.code = 'out-of-sync-migrations';
  return e;
}
let loadBudgetThrows = skewError();
let loadBudgetCalledWith = [];
api.loadBudget = async (id) => {
  calls.loadBudget++;
  loadBudgetCalledWith.push(id);
  if (loadBudgetThrows) throw loadBudgetThrows;
  open = 'budget-A';
};
api.init = async () => {};
api.shutdown = async () => { open = null; };
api.sync = async () => {};

const { loadBudgetTracked, _clearReasonCacheForTests } = await import('../../dist/src/lib/budgetLoader.js');
const apiState = await import('../../dist/src/lib/apiState.js');
const { isRetryableError } = await import('../../dist/src/lib/retry.js');

function reset() {
  calls = { downloadBudget: 0, getBudgetMonths: 0, getBudgets: 0, loadBudget: 0 };
  downloadLoads = true;
  downloadThrows = null;
  downloadDelayMs = 0;
  probeHangs = false;
  probeThrows = null;
  probeDelayMs = 0;
  getBudgetsThrows = null;
  getBudgetsResult = [
    { id: 'local-id-1', groupId: 'budget-A', name: 'Main' },
    { groupId: 'budget-A', state: 'remote', cloudFileId: 'c1', name: 'Main', owner: 'someone-else' },
  ];
  loadBudgetThrows = skewError();
  loadBudgetCalledWith = [];
  budgetMonths = ['2026-01', '2026-02'];
  open = null;
  _clearReasonCacheForTests();   // module state: the reason memo must not leak between cases
  apiState.setApiInitialized(true);
  apiState.setLoadedBudgetSyncId(null);
}

async function settle(p) {
  try { await p; return { ok: true }; } catch (e) { return { ok: false, err: e }; }
}

// --- 1. happy path ---------------------------------------------------------
describe('a download that really loads the budget still succeeds');
{
  reset();
  const r = await settle(loadBudgetTracked('budget-A'));
  check(r.ok, 'loadBudgetTracked resolves');
  check(apiState.getLoadedBudgetSyncId() === 'budget-A', 'the loaded syncId is recorded');
  check(apiState.isApiInitialized() === true, 'the singleton stays live');
  check(calls.getBudgetMonths === 1, `the probe runs exactly once (got ${calls.getBudgetMonths})`);
  check(calls.getBudgets === 0 && calls.loadBudget === 0, 'the diagnostic pair is NOT called on the happy path');
}

// --- 2. an empty budget is still an OPEN budget ----------------------------
describe('an empty budget does not false-positive (a new user must not be broken)');
{
  reset();
  budgetMonths = [];
  const r = await settle(loadBudgetTracked('budget-A'));
  check(r.ok, 'loadBudgetTracked resolves for a budget with no months');
  check(apiState.getLoadedBudgetSyncId() === 'budget-A', 'the loaded syncId is recorded');
}

// --- 3. the reported bug ---------------------------------------------------
describe('a download that resolves with NOTHING open is caught, and fails closed');
{
  reset();
  downloadLoads = false;                 // exactly what upstream does on a swallowed load error
  const r = await settle(loadBudgetTracked('budget-A'));
  check(!r.ok, 'loadBudgetTracked REJECTS rather than reporting success');
  check(!!r.err && /budget-A/.test(r.err.message), 'the error names the syncId');
  check(apiState.getLoadedBudgetSyncId() === null, 'no false loaded-budget record is left behind');
  check(apiState.isApiInitialized() === false, 'the singleton is poisoned so the next op re-inits');
}

// --- 4. the reason is surfaced --------------------------------------------
describe('the upstream reason is recovered and reported');
{
  reset();
  downloadLoads = false;
  const r = await settle(loadBudgetTracked('budget-A'));
  check(!r.ok, 'it rejects');
  check(
    !!r.err && /out-of-sync-migrations/.test(r.err.message),
    `the upstream reason CODE is included, not just the lossy prose (got: ${r.err && r.err.message})`,
  );
  check(calls.loadBudget === 1, 'the diagnostic load ran once');
}

// --- 5. the diagnostic can never mask the real failure ---------------------
describe('a failing diagnostic does not replace the post-condition error');
{
  reset();
  downloadLoads = false;
  getBudgetsThrows = new Error('Could not get remote files');
  const r = await settle(loadBudgetTracked('budget-A'));
  check(!r.ok, 'it still rejects');
  check(!!r.err && /budget-A/.test(r.err.message), 'the post-condition error survives');
  check(!!r.err && !/Could not get remote files/.test(r.err.message), 'the diagnostic failure does not become the message');
  check(apiState.getLoadedBudgetSyncId() === null, 'still fails closed');
}

// --- 6. a genuine download failure is unchanged ----------------------------
describe('a download that THROWS behaves exactly as before');
{
  reset();
  downloadThrows = new Error('Budget "budget-A" not found. Check the sync id');
  const r = await settle(loadBudgetTracked('budget-A'));
  check(!r.ok, 'it rejects');
  check(!!r.err && /not found\. Check the sync id/.test(r.err.message), 'the original upstream error propagates unchanged');
  check(calls.getBudgetMonths === 0, 'the probe is not run after a failed download');
  check(apiState.isApiInitialized() === false, 'the singleton is poisoned, as before');
}

// --- 7. the abandoned load ------------------------------------------------
// The case that separates a correct fix from the subtly wrong one. A probe placed AFTER
// `await withOpTimeout(() => tracked, label)` never runs for a load the timeout abandoned,
// while the tracked chain's success handler still fires later and still writes the record.
// Every other case here passes with the probe in the wrong place; this one does not.
describe('an ABANDONED load is verified when it lands, and writes no record if it did not load');
{
  reset();
  downloadLoads = false;
  downloadDelayMs = 600;                 // outruns ACTUAL_OP_TIMEOUT_MS=250
  const r = await settle(loadBudgetTracked('budget-A'));
  check(!r.ok, 'the caller gets the timeout rejection');
  check(!!r.err && /timed out/.test(r.err.message), `the rejection is the op timeout (got: ${r.err && r.err.message})`);
  const probesAtTimeout = calls.getBudgetMonths;
  check(probesAtTimeout === 0, 'the probe has not run yet, because the download has not landed');
  await new Promise((res) => setTimeout(res, 700));   // let the abandoned download land
  // #403 CHANGED THIS. The probe used to run on the landing, which verified it but did so with no
  // lock held, against the single SQLite connection, while another session could be mid-operation
  // inside the lock. A landing whose caller has already given up now skips the probe and leaves
  // the record INDETERMINATE instead, which forces the next operation to re-select. Same safety
  // property (no false record), reached without an unsynchronised read.
  check(calls.getBudgetMonths === 0, `the probe does NOT run unsynchronised on the landing (got ${calls.getBudgetMonths})`);
  check(apiState.getLoadedBudgetSyncId() === null, 'the late landing wrote NO false loaded-budget record');
  check(
    calls.getBudgets === 0 && calls.loadBudget === 0,
    'the abandoned path pays the LOCAL probe only: no network enrichment inside the registered promise',
  );
}

// --- 8. a stalled probe is a stall, not a diagnosis -----------------------
describe('a probe that times out is reported as an upstream stall, not diagnosed');
{
  reset();
  probeHangs = true;
  const r = await settle(loadBudgetTracked('budget-A'));
  check(!r.ok, 'it rejects');
  check(!!r.err && /timed out/.test(r.err.message), 'the rejection is a timeout');
  check(calls.getBudgets === 0 && calls.loadBudget === 0, 'no network diagnostic is attempted for a stall');
}

// --- 9. the message must not be classed transient -------------------------
describe('the post-condition message is terminal, not transient');
{
  reset();
  downloadLoads = false;
  const r = await settle(loadBudgetTracked('budget-A'));
  check(!r.ok, 'it rejects');
  check(
    !!r.err && isRetryableError(r.err) === false,
    'isRetryableError() is false, so it is neither retried nor used to drop the pooled connection',
  );
}

// --- 10. the undeduplicated remote twin -----------------------------------
describe('the local entry is selected, never the remote twin that has no id');
{
  reset();
  downloadLoads = false;
  getBudgetsResult = [
    { groupId: 'budget-A', state: 'remote', cloudFileId: 'c1', name: 'Main' },   // remote FIRST
    { id: 'local-id-1', groupId: 'budget-A', name: 'Main' },
  ];
  await settle(loadBudgetTracked('budget-A'));
  check(
    loadBudgetCalledWith.length === 1 && loadBudgetCalledWith[0] === 'local-id-1',
    `loadBudget got the local id (got: ${JSON.stringify(loadBudgetCalledWith)})`,
  );
}

// --- 11. no match at all --------------------------------------------------
describe('when nothing matches the syncId, the budgets on the server are NOT enumerated');
{
  reset();
  downloadLoads = false;
  getBudgetsResult = [
    { id: 'other-1', groupId: 'budget-Z', name: 'Someone Elses Budget' },
    { groupId: 'budget-Y', state: 'remote', cloudFileId: 'c9', name: 'Another Budget' },
  ];
  const r = await settle(loadBudgetTracked('budget-A'));
  check(!r.ok, 'it rejects');
  check(calls.loadBudget === 0, 'no diagnostic load is attempted');
  check(
    !!r.err && !/Someone Elses Budget|Another Budget|budget-Z|budget-Y/.test(r.err.message),
    'the message does not enumerate other budgets on the server',
  );
}

// --- 12. a path in the reason never reaches the client --------------------
describe('an unmapped upstream error carrying an absolute path is not echoed');
{
  reset();
  downloadLoads = false;
  const e = new Error("ENOENT: no such file or directory, open '/home/someuser/.actual/budget-A/db.sqlite'");
  loadBudgetThrows = e;                       // no .code: forces the prose fallback
  const r = await settle(loadBudgetTracked('budget-A'));
  check(!r.ok, 'it rejects');
  check(!!r.err && !/\/home\/someuser/.test(r.err.message), 'the absolute path is not in the message');
  check(!!r.err && !/db\.sqlite/.test(r.err.message), 'no file path fragment survives');
}

// --- 13. no entity field beyond the id escapes ----------------------------
describe('no APIFileEntity field beyond the local id reaches the message');
{
  reset();
  downloadLoads = false;
  const r = await settle(loadBudgetTracked('budget-A'));
  check(!r.ok, 'it rejects');
  check(!!r.err && !/someone-else/.test(r.err.message), 'owner is never echoed');
  check(!!r.err && !/Main/.test(r.err.message), 'the budget name is never echoed');
}

// --- 14. a probe failure that is NOT "not open" ---------------------------
// Review finding: classifying EVERY probe rejection as not-open was wrong in the expensive
// direction. A transient probe failure against a healthy OPEN budget would poison the singleton,
// send the diagnosis off to CLOSE and reload that healthy budget, and report a permanent-sounding
// "no budget file is open".
describe('a probe failure that is not the not-open signal is propagated, not misdiagnosed');
{
  reset();
  probeThrows = { type: 'APIError', message: 'database is locked' };
  const r = await settle(loadBudgetTracked('budget-A'));
  check(!r.ok, 'it rejects');
  check(!!r.err && /database is locked/.test(r.err.message), 'the ORIGINAL error propagates unchanged');
  check(!/no budget file is open/i.test(String(r.err && r.err.message)), 'it is not reported as an unloadable budget');
  check(calls.getBudgets === 0 && calls.loadBudget === 0, 'no healthy budget is closed and reloaded to diagnose it');
  check(apiState.getLoadedBudgetSyncId() === null, 'it still fails closed');
}

// --- 15. the reason is diagnosed once, not per call -----------------------
// Review finding: diagnose() runs INSIDE the process-global api mutex, so re-diagnosing on every
// tool call holds the lock for up to 2x ACTUAL_OP_TIMEOUT_MS each time and stalls unrelated
// sessions. The decision is still uncached: it fails closed every time.
describe('the reason is diagnosed once per budget, but the failure is never cached');
{
  reset();
  downloadLoads = false;
  const first = await settle(loadBudgetTracked('budget-A'));
  const second = await settle(loadBudgetTracked('budget-A'));
  check(!first.ok && !second.ok, 'BOTH attempts fail closed: the decision is not cached');
  check(
    !!second.err && /out-of-sync-migrations/.test(second.err.message),
    'the second failure still carries the reason',
  );
  check(calls.getBudgets === 1, `getBudgets ran once, not per call (got ${calls.getBudgets})`);
  check(calls.loadBudget === 1, `the diagnostic load ran once, not per call (got ${calls.loadBudget})`);
}

// --- 16. a recovered budget forgets the old reason ------------------------
describe('a load that later succeeds clears the cached reason');
{
  reset();
  downloadLoads = false;
  await settle(loadBudgetTracked('budget-B'));
  downloadLoads = true;                              // operator fixed the underlying cause
  const ok = await settle(loadBudgetTracked('budget-B'));
  check(ok.ok, 'the recovered load succeeds');
  downloadLoads = false;                             // and it breaks again, differently
  const callsBefore = calls.getBudgets;
  await settle(loadBudgetTracked('budget-B'));
  check(calls.getBudgets === callsBefore + 1, 'it re-diagnoses rather than reusing the stale reason');
}

// --- 17. a transient diagnostic outcome is reported as transient ----------
describe('when the diagnostic load SUCCEEDS, the message says retry rather than "reason discarded"');
{
  reset();
  downloadLoads = false;
  loadBudgetThrows = null;                           // the retry works
  // budget-A, because that is the groupId the getBudgets stub has a LOCAL entry for. With any
  // other id the diagnosis correctly stops at "no local copy" and never reaches the retry.
  const r = await settle(loadBudgetTracked('budget-A'));
  check(!r.ok, 'the operation still fails, because the record is indeterminate by design');
  check(!!r.err && /transient|retry/i.test(r.err.message), 'the message tells the caller to retry');
  check(!!r.err && !/discarded the reason/.test(r.err.message), 'it does not claim the reason was discarded');
  check(!!r.err && isRetryableError(r.err) === false, 'and it still does not match TRANSIENT_ERROR_PATTERNS');
}

// --- 18. path scrubbing, the harder shapes --------------------------------
// Review finding: the first scrub only caught a separator at a word boundary, so `ENOENT:/home/..`
// and `C:/Users/..` both reached the client WITH the OS username.
describe('path-shaped prose is rejected in every shape, not just at a word boundary');
{
  for (const prose of [
    "ENOENT:/home/alice/.actual/budget/db.sqlite",
    "C:/Users/alice/AppData/actual/db.sqlite",
    "C:\\Users\\alice\\actual\\db.sqlite",
    "cannot open ~/actual/db.sqlite",
  ]) {
    reset();
    downloadLoads = false;
    const e = new Error(prose);
    loadBudgetThrows = e;                            // no .code: forces the prose fallback
    const r = await settle(loadBudgetTracked('budget-A'));
    check(
      !!r.err && !/alice/.test(r.err.message),
      `no username escapes for: ${prose.slice(0, 34)}`,
    );
  }
}

// --- 19. the memo must cover the failures that actually persist -----------
// Review round 2 caught this in round 1's own fix: caching only the REPORTABLE outcomes left the
// two most persistent classes re-diagnosing on every call, holding the process-global api mutex
// across two bounded network calls each time. Case 15 could not see it, because its fixture is the
// one shape that IS cacheable (a known .code).
describe('every deterministic diagnosis is memoised, including the ones with nothing to report');
{
  // (a) a raw fs error: .code is outside the known set AND the prose is path-shaped, so the
  // diagnosis yields nothing reportable. This is the ticket's own "db.sqlite is not a database".
  reset();
  downloadLoads = false;
  const e = new Error("ENOENT: no such file or directory, open '/home/alice/.actual/db.sqlite'");
  e.code = 'ENOENT';
  loadBudgetThrows = e;
  await settle(loadBudgetTracked('budget-A'));
  await settle(loadBudgetTracked('budget-A'));
  await settle(loadBudgetTracked('budget-A'));
  check(calls.getBudgets === 1, `unreportable diagnosis runs once, not per call (got ${calls.getBudgets})`);
  check(calls.loadBudget === 1, `and its diagnostic load runs once (got ${calls.loadBudget})`);

  // (b) no local copy: returns early, before the old cache write could ever be reached.
  reset();
  downloadLoads = false;
  getBudgetsResult = [{ id: 'other-1', groupId: 'budget-Z', name: 'Elsewhere' }];
  await settle(loadBudgetTracked('budget-A'));
  await settle(loadBudgetTracked('budget-A'));
  await settle(loadBudgetTracked('budget-A'));
  check(calls.getBudgets === 1, `the no-local-copy branch is memoised too (got ${calls.getBudgets})`);

  // and the DECISION is still never cached: all three attempts failed closed.
  const again = await settle(loadBudgetTracked('budget-A'));
  check(!again.ok && apiState.getLoadedBudgetSyncId() === null, 'the failure itself is still never cached');
}

// --- 20. a cached reason does not outlive its condition forever (#404) ----
// The cache stops diagnose() holding the api mutex for two network calls per failed tool call.
// But an entry used to be dropped only by a successful load or a restart, so a failure mode that
// changed with no success in between reported the FIRST reason indefinitely. Bounded by USES,
// because the cost it avoids is paid per call.
describe('the cached reason is re-derived after a bounded number of uses');
{
  reset();
  downloadLoads = false;
  // Call 1 diagnoses and caches. Calls 2 to 21 reuse it. Call 22 exceeds the budget of 20 uses,
  // drops the entry and diagnoses afresh.
  for (let i = 0; i < 21; i++) await settle(loadBudgetTracked('budget-A'));
  check(calls.getBudgets === 1, `21 failures cost ONE diagnosis (got ${calls.getBudgets})`);
  await settle(loadBudgetTracked('budget-A'));
  check(calls.getBudgets === 2, `the 22nd re-diagnoses (got ${calls.getBudgets})`);

  // and the DECISION is still never cached: every one of those failed closed.
  const last = await settle(loadBudgetTracked('budget-A'));
  check(!last.ok && apiState.getLoadedBudgetSyncId() === null, 'every attempt still fails closed');
}

// --- 21. a changed failure mode is eventually reported --------------------
describe('a failure mode that changes with no intervening success is picked up');
{
  reset();
  downloadLoads = false;
  const first = await settle(loadBudgetTracked('budget-A'));
  check(!!first.err && /out-of-sync-migrations/.test(first.err.message), 'the first reason is reported');

  const changed = new Error('This budget cannot be loaded.');
  changed.code = 'opening-budget';
  loadBudgetThrows = changed;                    // the condition changes, with NO success between
  let seen = null;
  for (let i = 0; i < 25; i++) {
    const r = await settle(loadBudgetTracked('budget-A'));
    if (r.err && /opening-budget/.test(r.err.message)) { seen = i + 2; break; }
  }
  check(seen !== null, `the new reason surfaces without a restart (at failure #${seen})`);
  check(seen !== null && seen <= 23, `and within the bound, not eventually (was #${seen})`);
}

// --- 22. #409: a failed re-diagnosis keeps the answer it already had ---------
describe('a re-diagnosis that fails falls back to the previous reason rather than reporting none');
{
  reset();
  downloadLoads = false;
  // Establish a cached reason.
  const first = await settle(loadBudgetTracked('budget-A'));
  check(!!first.err && /out-of-sync-migrations/.test(first.err.message), 'the reason is cached from the first failure');

  // Burn EXACTLY the use budget: call 1 diagnosed and stored uses=0, these 20 take it to 20, all
  // still cache hits. The NEXT call is the one that exceeds it and re-diagnoses, which is the call
  // whose diagnosis must fail for this case to test anything. Getting this off by one silently
  // turns the case into a plain cache hit, which is what the first version of it did.
  for (let i = 0; i < 20; i++) await settle(loadBudgetTracked('budget-A'));
  check(calls.getBudgets === 1, `still one diagnosis after the budget is spent (got ${calls.getBudgets})`);

  // Now the re-diagnosis itself fails transiently.
  getBudgetsThrows = new Error('Could not get remote files');
  const after = await settle(loadBudgetTracked('budget-A'));
  check(
    !!after.err && /out-of-sync-migrations/.test(after.err.message),
    `the previous reason survives a failed re-diagnosis (got: ${after.err && after.err.message.slice(0, 90)})`,
  );
  check(
    !!after.err && !/discarded the reason/.test(after.err.message),
    'and the caller is not told the reason was discarded',
  );
}

// --- 23. #394/#410 (I7): the record is CLEARED before the load starts -------
// An abandonment must leave the record INDETERMINATE, never confidently naming the old budget:
// that is the one direction that makes #390's precondition silently pass. The clear lives in
// trackBudgetMutation, and after the redundant call-site clears were removed nothing covered it.
describe('the loaded-budget record is indeterminate while a load is in flight');
{
  reset();
  apiState.setLoadedBudgetSyncId('budget-PREVIOUS');
  recordDuringDownload = 'unset';
  await settle(loadBudgetTracked('budget-A'));
  check(
    recordDuringDownload === null,
    `the record was cleared BEFORE the download ran (was ${JSON.stringify(recordDuringDownload)})`,
  );
  check(apiState.getLoadedBudgetSyncId() === 'budget-A', 'and names the new budget once it settles');
}

// --- 24. #403 (M2): the flag can flip DURING the probe ---------------------
// `abandoned` is read before `verify()` and the record is written after it, so a load that resolves
// just before its bound expires can pass the check and then have the flag set while the probe is
// still running. Without the second check the probe runs and the record is written for a load whose
// caller has gone, contradicting the contract stated in the code. The value written would be true
// rather than false, so this is about the invariant being honest rather than about safety.
describe('a load abandoned WHILE its post-condition runs records nothing');
{
  reset();
  apiState.setLoadedBudgetSyncId('budget-PREVIOUS');
  // The window needs care, and the first attempt at it did not discriminate. The probe has its OWN
  // withOpTimeout, so a probe longer than the bound can never complete and the chain fails anyway.
  // What creates the window is download + probe exceeding the OUTER bound while the probe stays
  // inside its own: ACTUAL_OP_TIMEOUT_MS is 250 here, so a 200ms download plus a 100ms probe means
  // the outer timeout fires at 250ms, mid-probe, and the probe still finishes at ~300ms.
  downloadDelayMs = 200;
  probeDelayMs = 100;
  const r = await settle(loadBudgetTracked('budget-A'));
  check(!r.ok, `the caller is given the timeout (got ${JSON.stringify(r).slice(0, 60)})`);
  await new Promise((res) => setTimeout(res, 400));   // let the probe finish
  check(
    apiState.getLoadedBudgetSyncId() === null,
    `no record was written for a load abandoned mid-probe (got ${JSON.stringify(apiState.getLoadedBudgetSyncId())})`,
  );
  probeDelayMs = 0;
  downloadDelayMs = 0;
}

log(`\n[#396-postcondition] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
