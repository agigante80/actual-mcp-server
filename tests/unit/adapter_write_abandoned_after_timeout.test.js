// #800: a queued write that lost the ACTUAL_OP_TIMEOUT_MS race must not perform its raw write later.
//
// THE BUG. `withOpTimeout` rejects the caller but cannot stop the callback. The drain moved on,
// synced and released the api lock, and the stalled callback then resumed (its awaited guard
// listing finally resolved) and did its raw write outside the lock. The timeout text asks the
// caller to retry, so the late write became a duplicate. The fix is a per-operation abandoned
// token (opTimeout.ts) checked by a guard around every raw WRITE binding in the adapter.
//
// The raw api is stubbed (before the adapter import: it destructures at load) and the skip flag
// is on, so no server is involved.
//
// Mutation check (done by hand when this test was written): making `assertOperationLive` a no-op
// turns blocks (1) to (5) and (12) to (14) red; removing one `guarded(...)` wrap turns block (8) red.
//
// Run: node tests/unit/adapter_write_abandoned_after_timeout.test.js   (needs `npm run build` first)

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL ?? 'http://127.0.0.1:5999';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD ?? 'dummy';
process.env.ACTUAL_OP_TIMEOUT_MS = '300';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let failures = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#800] ${l}`);
const check = (c, m, d = '') => { if (c) log(`  ok: ${m}`); else { log(`  FAIL: ${m}${d ? ' (' + d + ')' : ''}`); failures++; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const PAYEE = '33333333-3333-4333-8333-333333333333';
const SCHED = '44444444-4444-4444-8444-444444444444';

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

// A listing the test releases by hand. Each call gets its own gate so one test cannot free another.
let hold = null; // when set, the FIRST getAccounts/getSchedules/getPayees call waits for it (a sibling's read is not held)
const held = async () => { const h = hold; hold = null; if (h) await h.p; };
const gate = () => { let release; const p = new Promise((r) => { release = r; }); return { p, release }; };
const accounts = async () => { await held(); return [{ id: ACCOUNT, name: 'Checking' }]; };
let counts;
const resetCounts = () => { counts = { createSchedule: 0, updateSchedule: 0, deleteSchedule: 0, updatePayee: 0, addTransactions: 0, createPayee: 0 }; };
resetCounts();

api.getAccounts = accounts;
api.getPayees = async () => { await held(); return [{ id: PAYEE, name: 'Shop' }]; };
api.getSchedules = async () => { await held(); return [{ id: SCHED, amountOp: 'is', amount: -100 }]; };
let rulesNow = [];
let createHold = null; // holds the FIRST raw createSchedule (a write already in flight when the timeout hits)
let updateRuleCalls = 0;
api.getRules = async () => rulesNow;
api.updateRule = async () => { updateRuleCalls++; };
api.createSchedule = async () => { counts.createSchedule++; const h = createHold; createHold = null; if (h) await h.p; return SCHED; };
api.updateSchedule = async () => { counts.updateSchedule++; };
api.deleteSchedule = async () => { counts.deleteSchedule++; };
api.updatePayee = async () => { counts.updatePayee++; };
api.createPayee = async () => { counts.createPayee++; return PAYEE; };
api.addTransactions = async () => { counts.addTransactions++; return 'ok'; };
api.sync = async () => {};
const GROUP = '55555555-5555-4555-8555-555555555555';
let groupHold = null; // holds the FIRST raw createCategoryGroup
let groupRows = [];
let groupCalls = { create: 0, update: 0, delete: 0 };
api.getCategoryGroups = async () => groupRows.map((g) => ({ ...g }));
api.createCategoryGroup = async (g) => {
  groupCalls.create++;
  const h = groupHold; groupHold = null; if (h) await h.p;
  groupRows.push({ id: GROUP, name: g.name, is_income: false });
  return GROUP;
};
api.updateCategoryGroup = async (id, f) => { groupCalls.update++; const r = groupRows.find((x) => x.id === id); if (r) Object.assign(r, f); };
api.deleteCategoryGroup = async (id) => { groupCalls.delete++; groupRows = groupRows.filter((x) => x.id !== id); };

const adapter = await import('../../dist/src/lib/actual-adapter.js');
const a = adapter.default;
adapter._setSkipApiInitForTests(true);
const { retry, isRetryableError, isRateLimitError } = await import('../../dist/src/lib/retry.js').then((m) => ({ retry: m.retry, isRetryableError: m.isRetryableError, isRateLimitError: m.isRateLimitError }));
void retry;
const opTimeout = await import('../../dist/src/lib/opTimeout.js');

const TIMEOUT_RE = /timed out after 300ms/;
const settle = (p) => p.then(() => null, (e) => String(e && e.message));

/** Hold the pre-read, start the write, wait for the timeout, release, give the callback time to run. */
async function lostRace(start) {
  hold = gate();
  const h = hold;
  const err = await settle(start());
  const atTimeout = { ...counts };
  h.release();
  await sleep(150);
  hold = null;
  return { err, atTimeout, after: { ...counts } };
}

describe('(1) createSchedule: guard listing held past the timeout, then released');
{
  resetCounts();
  const r = await lostRace(() => a.createSchedule({ account: ACCOUNT, name: 's', date: '2030-01-01' }));
  check(TIMEOUT_RE.test(r.err ?? ''), 'the caller got the timeout error', String(r.err));
  check(r.atTimeout.createSchedule === 0, 'no raw create at timeout');
  check(r.after.createSchedule === 0, `no raw create after the listing resolved late (got ${r.after.createSchedule})`);
}

describe('(2) sibling in one drain: the stalled first entry never writes, the second does');
{
  resetCounts();
  hold = gate();
  const h = hold;
  const first = settle(a.createSchedule({ account: ACCOUNT, name: 'first', date: '2030-01-01' }));
  // Queued behind the first in the same drain. createPayee has no pre-read (a read-guarded
  // sibling would share the first entry's memoised, still pending listing and stall with it).
  const second = settle(a.createPayee({ name: 'Sibling' }));
  const [e1, e2] = await Promise.all([first, second]);
  h.release();
  await sleep(150);
  hold = null;
  check(TIMEOUT_RE.test(e1 ?? ''), 'first entry timed out', String(e1));
  check(e2 === null, `second entry ran and succeeded (got ${e2})`);
  check(counts.createPayee === 1, `the sibling performed its raw write once (got ${counts.createPayee})`);
  check(counts.createSchedule === 0, `the abandoned first entry performed none (got ${counts.createSchedule})`);
}

describe('(3) updateSchedule: held single-field amount read (getSchedules) then held accounts listing');
{
  resetCounts();
  const r = await lostRace(() => a.updateSchedule(SCHED, { amount: -200, account: ACCOUNT }));
  check(TIMEOUT_RE.test(r.err ?? ''), 'the caller got the timeout error', String(r.err));
  check(r.after.updateSchedule === 0, `no raw update after the late read (got ${r.after.updateSchedule})`);
}

describe('(4) deleteSchedule and updatePayee: a different binding each, same assertion');
{
  resetCounts();
  const d = await lostRace(() => a.deleteSchedule(SCHED));
  check(TIMEOUT_RE.test(d.err ?? ''), 'deleteSchedule timed out', String(d.err));
  check(d.after.deleteSchedule === 0, `no raw delete after the late read (got ${d.after.deleteSchedule})`);
  const u = await lostRace(() => a.updatePayee(PAYEE, { name: 'renamed' }));
  check(TIMEOUT_RE.test(u.err ?? ''), 'updatePayee timed out', String(u.err));
  check(u.after.updatePayee === 0, `no raw payee update after the late read (got ${u.after.updatePayee})`);
}

describe('(5) withActualApiWrite: a held read inside, then a raw write after the timeout');
{
  resetCounts();
  const raw = async () => { await sleep(0); };
  void raw;
  let lateErr = null;
  hold = gate();
  const h = hold;
  const err = await settle(adapter.withActualApiWrite(async () => {
    await api.getAccounts();
    // The adapter does not export its raw bindings and a nested adapter call would deadlock, so
    // the check every guarded binding runs is invoked directly at the point a raw write would be.
    try { opTimeout.assertOperationLive(); counts.createSchedule++; } catch (e) { lateErr = e; }
  }));
  h.release();
  await sleep(150);
  hold = null;
  check(TIMEOUT_RE.test(err ?? ''), 'the caller got the timeout error', String(err));
  check(counts.createSchedule === 0, `the late raw write was refused (got ${counts.createSchedule})`);
  check(lateErr && lateErr.message === 'Write operation was abandoned after its timeout and did not run; no data was modified by this step.', 'the late write saw the exact abandoned error', String(lateErr && lateErr.message));
}

describe('(6) positive: in-bound writes call the raw once');
{
  resetCounts();
  const id = await a.createSchedule({ account: ACCOUNT, payee: PAYEE, name: 's', date: '2030-01-01' }); // both links set: no dead-condition strip (#547)
  check(id === SCHED && counts.createSchedule === 1, `createSchedule once, id returned (got ${id}, ${counts.createSchedule})`);
  await a.updateSchedule(SCHED, { amount: -300, account: ACCOUNT });
  check(counts.updateSchedule === 1, `updateSchedule once (got ${counts.updateSchedule})`);
  let inner = 0;
  await adapter.withActualApiWrite(async () => { opTimeout.assertOperationLive(); counts.createSchedule++; inner = counts.createSchedule; });
  check(inner === 2, `withActualApiWrite in-bound write ran (got ${inner})`);
}

describe('(7) outside any bounded write, assertOperationLive does not throw');
{
  let threw = false;
  try { opTimeout.assertOperationLive(); } catch { threw = true; }
  check(!threw, 'no store means no refusal');
}

describe('(8) drift guard: every raw binding is wrapped unless it is a read');
{
  const src = readFileSync(fileURLToPath(new URL('../../src/lib/actual-adapter.ts', import.meta.url)), 'utf8');
  // Inverted (#800 review): a binding is a WRITE unless its name starts with `get` or it is on
  // this short allowlist, so a new verb (batch, send, transfer) fails closed instead of passing.
  const READS_ALLOWED = new Set(['RunQuery', 'ExportBudget']);
  const classify = (text) => {
    const bindings = [...text.matchAll(/^  (\w+): raw(\w+?)(Unguarded)?,$/gm)].map((m) => ({ name: m[2], unguarded: !!m[3] }));
    const problems = [];
    for (const b of bindings) {
      const isRead = b.name.startsWith('Get') || READS_ALLOWED.has(b.name);
      if (isRead) { if (b.unguarded) problems.push(`${b.name} is a read but was renamed Unguarded`); continue; }
      const wrapped = new RegExp(`^const raw${b.name} = guarded\\(raw${b.name}Unguarded\\);$`, 'm').test(text);
      if (!(b.unguarded && wrapped)) problems.push(`${b.name} is not wrapped by guarded()`);
    }
    return { count: bindings.length, problems };
  };
  const real = classify(src);
  check(real.count > 40, `found the binding block (got ${real.count})`);
  check(real.problems.length === 0, 'every write binding is wrapped', real.problems.join('; '));
  const fake = classify(src.replace('  getAccounts: rawGetAccounts,', '  getAccounts: rawGetAccounts,\n  batchBudgetUpdates: rawBatchBudgetUpdates,'));
  check(fake.problems.some((x) => x.startsWith('BatchBudgetUpdates')), 'an unwrapped fake write (batchBudgetUpdates) is caught', fake.problems.join('; '));
}

describe('(9) the abandoned error cannot reach the pool-drop classifier');
{
  const e = new opTimeout.OperationAbandonedError();
  check(!/timed out/i.test(e.message), 'message has no "timed out"');
  check(!(isRetryableError(e) && !isRateLimitError(e)), 'pool-drop rule returns false for it');
  check(e instanceof Error && e.name === 'OperationAbandonedError', 'plain Error subclass, not a refusal');
}

// The limiter lives in its own module; drive it directly with the real token helpers.
const lim = await import('../../dist/src/lib/actual-adapter/concurrency.js');
lim.setMaxConcurrency(1);

describe('(10) limiter, direction B: an abandoned operation QUEUED write is started by a live task');
{
  let ran = 0;
  const slot = gate();
  // A live holder owns the only slot.
  const holder = opTimeout.runAbandonable(() => lim.withConcurrency(() => slot.p), 'holder', 5000, 'TEST');
  await sleep(20);
  // The abandoned operation queues a raw write behind it, then times out while queued.
  const victim = settle(opTimeout.runAbandonable(() => lim.withConcurrency(async () => { opTimeout.assertOperationLive(); ran++; }), 'victim', 50, 'TEST'));
  await victim;
  slot.release(); // the LIVE holder's slot release starts the queued write
  await holder; await sleep(30);
  check(ran === 0, `the queued write ran under its own (abandoned) token and was refused (ran ${ran})`);
}

describe('(11) limiter, direction A: a LIVE queued write is started by an abandoned task');
{
  let ok = 0; let msg = null;
  const slot = gate();
  const stalled = settle(opTimeout.runAbandonable(() => lim.withConcurrency(() => slot.p), 'stalled', 50, 'TEST'));
  await stalled; // abandoned, still holding the slot
  const liveOp = opTimeout.runAbandonable(() => lim.withConcurrency(async () => { opTimeout.assertOperationLive(); ok++; }), 'live', 5000, 'TEST')
    .catch((e) => { msg = e.message; });
  await sleep(20);
  slot.release(); // the ABANDONED holder's release starts the live write
  await liveOp;
  check(ok === 1 && msg === null, `the live write ran and was not refused (ok ${ok}, ${msg})`);
}

const ABANDONED_MSG = 'Write operation was abandoned after its timeout and did not run; no data was modified by this step.';

describe('(12) option A: an operation whose FIRST write finished late has its follow-ups refused too');
{
  // Token level: the first write starts in bound, finishes after the timeout, then a follow-up and
  // a rollback are attempted. Every raw write of an abandoned operation is refused, started or not.
  let followUps = 0; const refused = [];
  const e = await settle(opTimeout.runAbandonable(async () => {
    opTimeout.assertOperationLive(); // first raw write starts, in bound
    await sleep(120); // finishes after the 50ms bound
    for (let i = 0; i < 2; i++) {
      try { opTimeout.assertOperationLive(); followUps++; } catch (x) { refused.push(x.message); }
    }
  }, 'late-first', 50, 'TEST'));
  await sleep(150);
  check(/timed out/.test(e ?? ''), 'the caller got the timeout error', String(e));
  check(followUps === 0, `no follow-up ran (ran ${followUps})`);
  check(refused.length === 2 && refused.every((m) => m === ABANDONED_MSG), 'both follow-ups refused with the exact message', refused.join(' | '));
}

describe('(13) createSchedule: the raw create finishes late, the dead-condition strip is refused (known limitation)');
{
  // The half state is ACCEPTED (docs/development/testing-and-reliability.md): the schedule exists
  // but keeps its dead link condition. The test pins that the follow-up write does not run.
  resetCounts(); updateRuleCalls = 0;
  rulesNow = [{ id: 'r1', conditions: [{ op: 'is', field: 'payee', value: 'undefined', type: 'id' }], actions: [{ op: 'link-schedule', value: SCHED }] }];
  createHold = gate();
  const ch = createHold;
  const err = await settle(a.createSchedule({ account: ACCOUNT, name: 's', date: '2030-01-01' }));
  ch.release();
  await sleep(250);
  rulesNow = [];
  check(TIMEOUT_RE.test(err ?? ''), 'createSchedule timed out', String(err));
  check(counts.createSchedule === 1, `the first write was already in flight and landed (got ${counts.createSchedule})`);
  check(updateRuleCalls === 0, `the follow-up rule update was refused (got ${updateRuleCalls})`);
}

describe('(14) createCategoryGroup(is_income): the first write finished late, the is_income update is refused (known limitation)');
{
  groupRows = []; groupCalls = { create: 0, update: 0, delete: 0 };
  groupHold = gate();
  const gh = groupHold;
  const err = await settle(a.createCategoryGroup({ name: 'Inc', is_income: true }));
  gh.release();
  await sleep(250);
  check(TIMEOUT_RE.test(err ?? ''), 'the caller got the timeout error', String(err));
  check(groupCalls.create === 1, `the first write landed (got ${groupCalls.create})`);
  check(groupCalls.update === 0, `the is_income follow-up update was refused (got ${groupCalls.update})`);
  check(groupCalls.delete === 0, `no rollback delete ran (got ${groupCalls.delete})`);
  check(groupRows.length === 1 && groupRows[0].is_income === false, 'the half state: a group created as expense, not income');
}

if (failures > 0) { log(`\n${failures} check(s) FAILED`); process.exit(1); }
log('\nAll checks passed');
process.exit(0);
