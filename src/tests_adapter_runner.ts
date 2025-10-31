import { strict as assert } from 'assert';
import { normalizeToTransactionArray, normalizeToId, normalizeImportResult } from './lib/actual-adapter.js';

async function runAdapterTests() {
  // normalizeToTransactionArray
  const single = { id: 't1', amount: 100 };
  const arrObjs = [{ id: 't1' }, { id: 't2' }];
  const idList = ['t1', 't2'];

  const r1 = normalizeToTransactionArray(single);
  assert.equal(Array.isArray(r1), true);
  assert.equal(r1.length, 1);
  assert.equal(r1[0].id, 't1');

  const txArr = normalizeToTransactionArray(arrObjs);
  assert.equal(txArr.length, 2);
  assert.equal(txArr[1].id, 't2');

  const txFromIds = normalizeToTransactionArray(idList as unknown);
  assert.equal(txFromIds.length, 2);
  assert.equal(txFromIds[0].id, 't1');

  const txEmpty = normalizeToTransactionArray(null);
  assert.equal(Array.isArray(txEmpty), true);
  assert.equal(txEmpty.length, 0);

  // normalizeToId
  assert.equal(normalizeToId('abc'), 'abc');
  assert.equal(normalizeToId({ id: 'xyz' }), 'xyz');
  assert.equal(normalizeToId(['first', 'second']), 'first');
  assert.equal(normalizeToId(null), '');

  // normalizeImportResult
  const raw = { added: ['a'], updated: ['b'], errors: ['e'] };
  const imp = normalizeImportResult(raw);
  assert.deepEqual(imp.added, ['a']);
  assert.deepEqual(imp.updated, ['b']);
  assert.deepEqual(imp.errors, ['e']);

  const imp2 = normalizeImportResult(null);
  assert.deepEqual(imp2.added, []);
  assert.deepEqual(imp2.updated, []);
  assert.deepEqual(imp2.errors, []);

  console.log('✅ Adapter normalization tests passed');
}

runAdapterTests().catch((e) => {
  console.error('Adapter tests failed:', e);
  process.exit(2);
});

// Concurrency and retry tests
import { callWithRetry, getConcurrencyState, setMaxConcurrency } from './lib/actual-adapter.js';
import retry from './lib/retry.js';

async function runConcurrencyAndRetryTests() {
  console.log('Running concurrency and retry tests...');

  // Concurrency test: set max concurrency to 1 and start 3 tasks that resolve after a delay.
  setMaxConcurrency(1);
  const task = (id: number, delayMs = 50) => async () => {
    await new Promise(r => setTimeout(r, delayMs));
    return `done-${id}`;
  };

  const p1 = callWithRetry(task(1, 80));
  const p2 = callWithRetry(task(2, 60));
  const p3 = callWithRetry(task(3, 40));

  // allow microtask scheduling
  await new Promise(r => setTimeout(r, 10));
  const stateDuring = getConcurrencyState();
  if (stateDuring.maxConcurrency !== 1) throw new Error('maxConcurrency not set');
  if (stateDuring.running < 1) throw new Error('expected at least one running task');

  const results = await Promise.all([p1, p2, p3]);
  if (!results.includes('done-1') || !results.includes('done-2') || !results.includes('done-3')) {
    throw new Error('concurrency tasks did not complete as expected');
  }

  // Retry test: function fails twice then succeeds
  let attempts = 0;
  const flaky = async () => {
    attempts++;
    if (attempts < 3) throw new Error('transient');
    return 'ok';
  };

  const res = await callWithRetry(() => retry(flaky, { retries: 3, backoffMs: 5 }));
  if (res !== 'ok') throw new Error('retry did not return ok');
  if (attempts !== 3) throw new Error(`retry attempts expected 3 but got ${attempts}`);

  console.log('✅ Concurrency and retry tests passed');
}

// Run the extra tests after the main suite
runConcurrencyAndRetryTests().catch(e => {
  console.error('Concurrency/retry tests failed:', e);
  process.exit(2);
});
