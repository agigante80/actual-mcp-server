// tests/unit/transactions_update_splits.test.js
// #305: split-edit support on actual_transactions_update.
//
// Two explicit setups (per the gate's qa spec):
//   (A) PRE-FLIGHT (adapter level): the real adapter with its raw primitives
//       stubbed (the #212 pattern from transactions_update_guard.test.js). The
//       is_parent + sum guards live in the adapter's updateTransaction pre-flight,
//       so this is where they are exercised. The stubbed runQuery returns a row
//       carrying { is_parent, amount } and rawUpdateTransaction is a spy; the
//       guards must reject BEFORE the raw write is reached.
//   (B) SCHEMA layer (tool level): the tool's Zod schema rejects bad child
//       shapes before the handler ever reaches the adapter.
//
// A process-level unhandledRejection listener is armed for the whole run and
// must never fire: every rejection is a normal awaited throw, never a detached
// promise (the async-throw hazard from the broken plain-to-split path is avoided
// by rejecting in-queue before the raw write).

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
let unhandled = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);
const onUnhandled = () => { unhandled++; };
process.on('unhandledRejection', onUnhandled);

const ID = '00000000-0000-0000-0000-000000000abc';

(async () => {
  // ---- Setup A: real adapter, stubbed raw primitives (installed BEFORE import) ----
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);
  apiDefault.sync = async () => {};
  let queryRows = [];          // what the existence/pre-flight query "finds"
  let rawUpdateCalls = [];     // ids passed to rawUpdateTransaction (the raw write)
  apiDefault.runQuery = async (_query) => ({ data: queryRows });
  apiDefault.updateTransaction = async (id, _fields) => { rawUpdateCalls.push(id); };

  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const adapter = adapterMod.default;
  adapterMod._setSkipApiInitForTests(true);

  const reset = (rows) => { queryRows = rows; rawUpdateCalls = []; };
  const subs = (...amts) => amts.map((amount) => ({ amount }));

  console.log('\n[#305][A] edit existing split, children only amount, sum == stored amount -> raw write happens');
  {
    reset([{ id: ID, is_parent: true, amount: -1000 }]);
    let threw = null;
    try { await adapter.updateTransaction(ID, { subtransactions: subs(-250, -750) }); } catch (e) { threw = e; }
    check(threw === null, 'no error on a balanced split edit', threw && threw.message);
    check(rawUpdateCalls.length === 1 && rawUpdateCalls[0] === ID, 'rawUpdateTransaction reached');
  }

  console.log('\n[#305][A] non-split target -> rejected, raw write NOT reached');
  {
    reset([{ id: ID, is_parent: false, amount: -800 }]);
    let threw = null;
    try { await adapter.updateTransaction(ID, { subtransactions: subs(-500, -300) }); } catch (e) { threw = e; }
    check(threw instanceof Error, 'throws for a non-split target');
    check(/not a split/i.test(threw?.message || ''), 'message says not a split');
    check(/actual_transactions_create/.test(threw?.message || ''), 'message points to the create tool');
    check(rawUpdateCalls.length === 0, 'rawUpdateTransaction NOT reached');
  }

  console.log('\n[#305][A] sum mismatch vs STORED amount (no fields.amount) -> rejected, raw write NOT reached');
  {
    reset([{ id: ID, is_parent: true, amount: -1000 }]);
    let threw = null;
    try { await adapter.updateTransaction(ID, { subtransactions: subs(-600, -200) }); } catch (e) { threw = e; }
    check(threw instanceof Error, 'throws on sum mismatch');
    check(/sum to the parent amount/i.test(threw?.message || ''), 'message explains the sum invariant');
    check(/Expected -1000, got -800/.test(threw?.message || ''), 'names expected (stored -1000) vs actual -800');
    check(rawUpdateCalls.length === 0, 'rawUpdateTransaction NOT reached');
  }

  console.log('\n[#305][A] fields.amount overrides stored amount as the sum ground truth -> raw write happens');
  {
    reset([{ id: ID, is_parent: true, amount: -1000 }]);
    let threw = null;
    try { await adapter.updateTransaction(ID, { amount: -800, subtransactions: subs(-500, -300) }); } catch (e) { threw = e; }
    check(threw === null, 'no error when children sum to the NEW fields.amount', threw && threw.message);
    check(rawUpdateCalls.length === 1, 'rawUpdateTransaction reached');
  }

  console.log('\n[#305][A] plain update (no subtransactions) is unchanged');
  {
    reset([{ id: ID, is_parent: false, amount: -100 }]);
    let threw = null;
    try { await adapter.updateTransaction(ID, { notes: 'hello' }); } catch (e) { threw = e; }
    check(threw === null, 'no error, no split logic runs', threw && threw.message);
    check(rawUpdateCalls.length === 1, 'rawUpdateTransaction reached');
  }

  // ---- Setup B: tool-level Zod schema rejects bad child shapes before the adapter ----
  console.log('\n[#305][B] schema rejects bad child shapes (before the handler reaches the adapter)');
  {
    const tool = (await import('../../dist/src/tools/transactions_update.js')).default;
    const parseSub = (arr) => tool.inputSchema.safeParse({ id: ID, fields: { subtransactions: arr } });
    check(parseSub(subs(-500, -300)).success, 'valid child amounts parse');
    check(!parseSub([{ amount: -100, payee_name: 'x' }]).success, 'child payee_name rejected (strict child)');
    check(!parseSub([{ amount: -100, category: 'not-a-uuid' }]).success, 'child category must be a UUID');
    check(!parseSub([{ amount: 1.5 }]).success, 'non-integer child amount rejected');
    check(!parseSub(Array.from({ length: 101 }, () => ({ amount: -1 }))).success, 'array over .max(100) rejected');
    check(!parseSub([]).success, 'empty subtransactions array rejected (.min(1))');
  }

  // Give any (unexpected) detached rejection a tick to surface before asserting.
  await new Promise((r) => setTimeout(r, 20));
  process.off('unhandledRejection', onUnhandled);
  check(unhandled === 0, 'no unhandledRejection fired on any path', `${unhandled} fired`);

  console.log('');
  if (failures === 0) console.log('[#305] All transactions_update split tests passed ✓');
  else { console.error(`[#305] ${failures} test(s) FAILED`); process.exit(2); }
})();
