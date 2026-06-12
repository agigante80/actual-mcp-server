// tests/unit/adapter_nonidempotent_no_retry.test.js
//
// #165: non-idempotent write operations (delete / close / merge) must use
// retries: 0. Retrying after a lost response re-issues the call against an
// already-removed record, surfacing a confusing "not found" / merge-state error
// even though the first attempt succeeded.
//
// We (1) prove the retry helper's call-count contract, and (2) source-assert
// that the five offending adapter functions carry retries: 0.
//
// Run: node tests/unit/adapter_nonidempotent_no_retry.test.js

import assert from 'assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const { retry } = await import('../../dist/src/lib/retry.js');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log(`  ok: ${label}`); passed++; }
  else { console.error(`  FAIL: ${label}`); failed++; }
}

console.log('\n[adapter-nonidempotent-no-retry] retry helper contract');

// retries: 0 -> the operation is attempted exactly once (no re-issue).
let calls0 = 0;
await retry(async () => { calls0++; throw new Error('boom'); }, { retries: 0, backoffMs: 1 }).catch(() => {});
check('retries: 0 invokes the operation exactly once', calls0 === 1);

// retries: 2 -> attempted up to three times (the idempotent read-path policy).
let calls2 = 0;
await retry(async () => { calls2++; throw new Error('boom'); }, { retries: 2, backoffMs: 1 }).catch(() => {});
check('retries: 2 invokes the operation three times', calls2 === 3);

console.log('\n[adapter-nonidempotent-no-retry] non-idempotent ops use retries: 0');

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../../src/lib/actual-adapter.ts'), 'utf8');

// Each of these appears in exactly one retry() call. Extract the retries value
// for that statement and assert it is 0.
const NON_IDEMPOTENT = [
  'rawDeleteTransaction',
  'rawDeleteAccount',
  'rawCloseAccount',
  'rawDeleteCategoryGroup',
  'rawMergePayees',
];
for (const fn of NON_IDEMPOTENT) {
  const m = src.match(new RegExp(`${fn}\\([^;]*?retries:\\s*(\\d)`));
  check(`${fn} uses retries: 0`, !!m && m[1] === '0');
}

console.log(`\n[adapter-nonidempotent-no-retry] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
