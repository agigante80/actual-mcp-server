// tests/unit/transactions_update_split_convert.test.js
// #489: actual_transactions_update splits a PLAIN transaction in place.
//
// The real adapter with its raw primitives stubbed BEFORE import (the #212 / #305 pattern).
// The stubbed rawUpdateTransaction models the upstream race measured live at 26.9.0:
// `api/transaction-update` does not await `transactions-batch-update`, so the conversion
// becomes visible only AFTER the call resolves. The adapter must read it back before it
// reports success, and must refuse to report success if it never appears.
//
// Cases:
//   1. conversion that lands late -> success with { parent, children }, read + write + read-back
//      in ONE write-queue drain (write-cycle witness, not a bare counter delta)
//   2. conversion that never lands -> a legible error, not a false success
//   3. sum mismatch on a plain target -> typed refusal, raw write NOT reached
//   4. split CHILD target -> typed refusal, raw write NOT reached
//   5. not found -> a typed NotFoundRefusal with the existing wording, raw write NOT reached
//   6. editing an EXISTING split does not poll (no conversion, no read-back)
//   7. the tool returns { success: true, split } on conversion and { success: true } otherwise
//   8. the converted parent's category is cleared in the SAME write, and a child naming no
//      category inherits the parent's (the caller's new one if given, else the stored one)
//   9. a one-child conversion is allowed (the shared schema's min is 1, as on create)
//  10. `amount` in the same call: children must sum to the NEW amount, not the stored one
//  11. the never-visible error is not classed transient, so it is neither retried nor
//      mistaken for an infrastructure failure that drops the pooled connection

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

import { makeCycleWitness } from './helpers/write-cycle.mjs';

let failures = 0;
let unhandled = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);
process.on('unhandledRejection', () => { unhandled++; });

const ID = '00000000-0000-0000-0000-000000000abc';
const CAT1 = '00000000-0000-0000-0000-0000000000c1';
const CAT2 = '00000000-0000-0000-0000-0000000000c2';

(async () => {
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);
  apiDefault.sync = async () => {};

  // The stored row the pre-read sees, and the rows the read-back sees once the write "lands".
  let stored = null;
  let landed = [];
  let visibleAfterReads = 0;   // read-backs that still see the plain row after the write
  let readBacks = 0;
  let rawUpdateCalls = [];
  let rawUpdateFields = [];
  let witness = null;

  const isReadBack = (s) => Array.isArray(s?.filterExpressions) &&
    s.filterExpressions.some((f) => f && Array.isArray(f.$or));

  apiDefault.runQuery = async (query) => {
    const s = typeof query?.serialize === 'function' ? query.serialize() : query;
    if (isReadBack(s)) {
      readBacks++;
      if (rawUpdateCalls.length === 0 || readBacks <= visibleAfterReads) return { data: stored ? [stored] : [] };
      return { data: landed };
    }
    witness?.noteRead();
    return { data: stored ? [stored] : [] };
  };
  apiDefault.updateTransaction = async (id, fields) => { witness?.noteWrite(); rawUpdateCalls.push(id); rawUpdateFields.push(fields); };

  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const { isPreflightRefusal } = await import('../../dist/src/lib/errors.js');
  const { isRetryableError } = await import('../../dist/src/lib/retry.js');
  const tool = (await import('../../dist/src/tools/transactions_update.js')).default;
  const adapter = adapterMod.default;
  adapterMod._setSkipApiInitForTests(true);
  witness = makeCycleWitness(adapterMod);

  const OLD = '00000000-0000-0000-0000-0000000000c0';
  const plain = { id: ID, is_parent: false, is_child: false, amount: -5000, category: OLD };
  const splitRows = [
    { id: ID, is_parent: true, parent_id: null },
    { id: 'child-1', is_parent: false, parent_id: ID },
    { id: 'child-2', is_parent: false, parent_id: ID },
  ];
  const subs = [{ amount: -3000, category: CAT1 }, { amount: -2000, category: CAT2 }];
  const reset = ({ row, after = [], lagReads = 0 }) => {
    stored = row; landed = after; visibleAfterReads = lagReads; readBacks = 0; rawUpdateCalls = []; rawUpdateFields = [];
    witness.reset();
  };
  const attempt = async (fn) => { try { return { value: await fn(), error: null }; } catch (e) { return { value: null, error: e }; } };

  console.log('\n[#489] 1. plain target, conversion visible only after 3 read-backs -> success');
  {
    reset({ row: plain, after: splitRows, lagReads: 3 });
    const { value, error } = await attempt(() => adapter.updateTransaction(ID, { subtransactions: subs }));
    check(error === null, 'no error', error && error.message);
    check(value?.split?.parent === ID, 'split.parent is the SAME id');
    check(JSON.stringify(value?.split?.children) === JSON.stringify(['child-1', 'child-2']), 'split.children are the new child ids');
    check(readBacks > 3, 'kept reading back until the conversion was visible', `readBacks=${readBacks}`);
    check(rawUpdateCalls.length === 1, 'exactly one raw write (no create plus delete)');
    check(witness.sharedOneCycle(), 'pre-read and write shared ONE drain', witness.describe?.());
  }

  console.log('\n[#489] 2. plain target, conversion never visible -> error, not a false success');
  {
    reset({ row: plain, after: [plain] });
    const t0 = Date.now();
    const { value, error } = await attempt(() => adapter.updateTransaction(ID, { subtransactions: subs }));
    check(value === null && error !== null, 'throws rather than reporting success');
    check(/not visible/i.test(error?.message || ''), 'message says the split is not visible', error?.message);
    check(/actual_transactions_get/.test(error?.message || ''), 'message points at a read-back tool');
    check(!isPreflightRefusal(error), 'NOT a pre-flight refusal: the write was attempted');
    check(/outcome is unknown/.test(error?.message || ''), 'message says the outcome is unknown');
    check(!isRetryableError(error), '[11] not classed transient (no retry, no pool drop)', error?.message);
    check(Date.now() - t0 < 10000, 'bounded wait');
  }

  console.log('\n[#489] 3. plain target, children do not sum to the parent -> typed refusal, no write');
  {
    reset({ row: plain, after: splitRows });
    const { error } = await attempt(() => adapter.updateTransaction(ID, { subtransactions: [{ amount: -3000 }, { amount: -1000 }] }));
    check(isPreflightRefusal(error), 'typed pre-flight refusal', error?.message);
    check(/Expected -5000, got -4000/.test(error?.message || ''), 'names expected and actual sums');
    check(rawUpdateCalls.length === 0, 'rawUpdateTransaction NOT reached');
    check(witness.readInCycleNoWrite(), 'refused after reading inside the drain', witness.describe?.());
  }

  console.log('\n[#489] 4. split CHILD target -> typed refusal, no write');
  {
    reset({ row: { id: ID, is_parent: false, is_child: true, amount: -5000 } });
    const { error } = await attempt(() => adapter.updateTransaction(ID, { subtransactions: subs }));
    check(isPreflightRefusal(error), 'typed pre-flight refusal', error?.message);
    check(/split child/i.test(error?.message || ''), 'message names the split child');
    check(rawUpdateCalls.length === 0, 'rawUpdateTransaction NOT reached');
  }

  console.log('\n[#489] 5. unknown id -> not found, no write');
  {
    reset({ row: null });
    const { error } = await attempt(() => adapter.updateTransaction(ID, { subtransactions: subs }));
    check(error?.message === `Transaction "${ID}" not found. Use actual_transactions_get to list transactions.`, 'wording unchanged', error?.message);
    check(isPreflightRefusal(error) && error.refusalKind === 'not-found', 'typed not-found refusal (nothing written)');
    check(rawUpdateCalls.length === 0, 'rawUpdateTransaction NOT reached');
  }

  console.log('\n[#489] 6. existing split target -> edit children, no read-back');
  {
    reset({ row: { id: ID, is_parent: true, is_child: false, amount: -5000 } });
    const { value, error } = await attempt(() => adapter.updateTransaction(ID, { subtransactions: subs }));
    check(error === null, 'no error', error?.message);
    check(value && value.split === undefined, 'no split descriptor for an edit');
    check(readBacks === 0, 'no read-back poll for an edit', `readBacks=${readBacks}`);
  }

  console.log('\n[#489] 7. tool result shape');
  {
    reset({ row: plain, after: splitRows });
    const converted = await tool.call({ id: ID, fields: { subtransactions: subs } });
    check(converted?.success === true && converted?.split?.parent === ID, 'conversion returns { success, split }', JSON.stringify(converted));
    reset({ row: { ...plain }, after: [] });
    const plainUpdate = await tool.call({ id: ID, fields: { notes: 'x' } });
    check(JSON.stringify(plainUpdate) === '{"success":true}', 'plain update returns { success: true } only', JSON.stringify(plainUpdate));
  }

  console.log('\n[#489] 8. parent category cleared in the same write; unnamed children inherit');
  {
    reset({ row: plain, after: splitRows });
    await attempt(() => adapter.updateTransaction(ID, { subtransactions: [{ amount: -3000, category: CAT1 }, { amount: -2000 }] }));
    const sent = rawUpdateFields[0];
    check(sent && 'category' in sent && sent.category === null, 'parent category sent as null', JSON.stringify(sent));
    check(sent?.subtransactions?.[0]?.category === CAT1, 'a child naming a category keeps it');
    check(sent?.subtransactions?.[1]?.category === OLD, 'a child naming none inherits the STORED parent category');
    reset({ row: plain, after: splitRows.slice(0, 2) });
    await attempt(() => adapter.updateTransaction(ID, { category: CAT2, subtransactions: [{ amount: -5000 }] }));
    check(rawUpdateFields[0]?.category === null && rawUpdateFields[0]?.subtransactions?.[0]?.category === CAT2, 'a category passed in the same call is what children inherit', JSON.stringify(rawUpdateFields[0]));
    reset({ row: { id: ID, is_parent: true, is_child: false, amount: -5000, category: null } });
    const edit = [{ amount: -5000 }];
    await attempt(() => adapter.updateTransaction(ID, { subtransactions: edit }));
    check(rawUpdateFields[0]?.subtransactions === edit && !('category' in rawUpdateFields[0]), 'an EDIT of an existing split is passed through untouched');
  }

  console.log('\n[#489] 9. one-child conversion is allowed');
  {
    reset({ row: plain, after: splitRows.slice(0, 2) });
    const { value, error } = await attempt(() => adapter.updateTransaction(ID, { subtransactions: [{ amount: -5000, category: CAT1 }] }));
    check(error === null && value?.split?.children?.length === 1, 'one child accepted and verified', error?.message);
  }

  console.log('\n[#489] 10. amount supplied in the same call');
  {
    reset({ row: plain, after: splitRows });
    const ok = await attempt(() => adapter.updateTransaction(ID, { amount: -7000, subtransactions: [{ amount: -4000 }, { amount: -3000 }] }));
    check(ok.error === null, 'children summing to the NEW amount are accepted', ok.error?.message);
    reset({ row: plain, after: splitRows });
    const bad = await attempt(() => adapter.updateTransaction(ID, { amount: -7000, subtransactions: subs }));
    check(isPreflightRefusal(bad.error) && /Expected -7000, got -5000/.test(bad.error?.message || ''), 'children summing to the STORED amount are refused', bad.error?.message);
    check(rawUpdateCalls.length === 0, 'rawUpdateTransaction NOT reached');
  }

  await new Promise((r) => setTimeout(r, 50));
  check(unhandled === 0, 'no unhandledRejection fired on any path', `count=${unhandled}`);

  if (failures > 0) {
    console.error(`\n[#489] ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\n[#489] All split-conversion tests passed ✓');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
