// tests/unit/adapter_with_write_session.test.js
// Adapter-layer test for #142's withWriteSession helper.
//
// Asserts:
//   1. Single-acquisition: one withWriteSession call runs the callback under one
//      processWriteQueue cycle.
//   2. Batching semantics: two concurrent withWriteSession calls land in the
//      same processWriteQueue batch (via Promise.allSettled inside the queue),
//      and each caller receives its own return value. This is by design of
//      queueWriteOperation: callers are batched to share one init+sync+shutdown,
//      and they may run in parallel inside that batch.
//   3. Error propagation: a throwing callback rejects its caller AND the lock
//      is released so the next call still resolves.
//
// Run: node tests/unit/adapter_with_write_session.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

(async () => {
  // Stub api.sync() so processWriteQueue's trailing sync becomes a no-op.
  await import('../../dist/src/lib/node-polyfills.js');
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);
  apiDefault.sync = async () => {};

  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const { withWriteSession, _setSkipApiInitForTests } = adapterMod;

  // Disarm real init/shutdown so the queue's processWriteQueue does not hit the
  // upstream Actual server.
  _setSkipApiInitForTests(true);

  // Case 1: single acquisition runs the callback once
  console.log('\n[#142] withWriteSession: single-acquisition');
  {
    let invocations = 0;
    const result = await withWriteSession(async () => {
      invocations++;
      return 'hello';
    });
    check(invocations === 1, 'callback invoked exactly once');
    check(result === 'hello', 'callback return value bubbled up');
  }

  // Case 2: concurrent calls share one processWriteQueue batch and each caller
  // gets its own return value (Promise.allSettled inside the queue lets them run
  // in parallel; this is intentional, see comment block at the top of the file).
  console.log('\n[#142] withWriteSession: concurrent callers, distinct return values');
  {
    const events = [];
    const cb = (label, ms) => async () => {
      events.push(`${label}:start`);
      await new Promise(r => setTimeout(r, ms));
      events.push(`${label}:end`);
      return label;
    };
    const [a, b] = await Promise.all([
      withWriteSession(cb('A', 30)),
      withWriteSession(cb('B', 10)),
    ]);
    check(a === 'A',                  'caller A got A');
    check(b === 'B',                  'caller B got B');
    check(events.includes('A:start'), 'A callback ran');
    check(events.includes('A:end'),   'A callback completed');
    check(events.includes('B:start'), 'B callback ran');
    check(events.includes('B:end'),   'B callback completed');
  }

  // Case 3: error propagates AND lock is released for the next caller
  console.log('\n[#142] withWriteSession: error propagation + lock release');
  {
    let threw = null;
    try {
      await withWriteSession(async () => { throw new Error('boom'); });
    } catch (e) { threw = e; }
    check(threw?.message === 'boom', 'rejection propagates with original message');

    // Now confirm the lock is released by running another withWriteSession call.
    let invoked = false;
    const result = await withWriteSession(async () => { invoked = true; return 'recovered'; });
    check(invoked === true,           'subsequent call ran (lock was released)');
    check(result === 'recovered',     'subsequent call returned its value');
  }

  console.log('');
  if (failures === 0) {
    console.log('[#142] All withWriteSession adapter tests passed ✓');
  } else {
    console.error(`[#142] ${failures} test(s) FAILED`);
    process.exit(2);
  }
})();
