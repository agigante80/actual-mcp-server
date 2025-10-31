import { strict as assert } from 'assert';
import { normalizeToTransactionArray, normalizeToId, normalizeImportResult } from '../../src/lib/actual-adapter.js';

async function run() {
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

  console.log('Adapter normalization tests passed');
}

run().catch(e => {
  console.error('Adapter normalization tests failed:', e);
  process.exit(2);
});
