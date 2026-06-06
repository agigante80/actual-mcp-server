// tests/unit/retry_classifier.test.js
//
// #177: the write queue retried deterministic domain/validation errors (e.g.
// "`date` is required") the full attempt budget, wasting work and tripling the
// log noise. isRetryableError() classifies errors so only transient/infra
// failures are retried; retry() gains an opt-in `isRetryable` that fails fast on
// everything else. _shouldDropPoolOnError delegates to the same classifier so
// the pool-drop and retry decisions cannot drift.
//
// Run: node tests/unit/retry_classifier.test.js

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://test-server';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || 'unit-test-sync-id';

import assert from 'assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const { retry, isRetryableError, TRANSIENT_ERROR_PATTERNS } = await import('../../dist/src/lib/retry.js');

let passed = 0, failed = 0;
function check(label, cond) { if (cond) { console.log(`  ok: ${label}`); passed++; } else { console.error(`  FAIL: ${label}`); failed++; } }
async function acheck(label, fn) { try { await fn(); console.log(`  ok: ${label}`); passed++; } catch (e) { console.error(`  FAIL: ${label} -> ${e.message}`); failed++; } }

console.log('\n[retry-classifier] isRetryableError: POSITIVE (transient -> retryable)');
for (const p of TRANSIENT_ERROR_PATTERNS) {
  check(`"${p}" is retryable`, isRetryableError(new Error(`upstream blew up: ${p} here`)) === true);
}

console.log('\n[retry-classifier] isRetryableError: NEGATIVE (domain / unknown -> not retryable)');
const NON_RETRYABLE = [
  '`date` is required when adding a transaction',
  'Field "payee_name" does not exist in table transactions',
  'Schedule "x" not found',
  'Validation error: amount: Expected number',
  'something totally unrecognised',
];
for (const m of NON_RETRYABLE) check(`"${m.slice(0, 36)}..." is NOT retryable`, isRetryableError(new Error(m)) === false);
check('non-Error (string) is NOT retryable', isRetryableError('ECONNRESET') === false);
check('non-Error (plain object) is NOT retryable', isRetryableError({ message: 'ECONNRESET' }) === false);
check('undefined is NOT retryable', isRetryableError(undefined) === false);

console.log('\n[retry-classifier] retry() with isRetryable opt-in');

await acheck('NEGATIVE: a domain error is attempted exactly ONCE (no retry)', async () => {
  let calls = 0;
  await assert.rejects(
    () => retry(async () => { calls++; throw new Error('`date` is required'); },
      { retries: 2, backoffMs: 1, isRetryable: isRetryableError }),
    /date.*required/,
  );
  assert.strictEqual(calls, 1, `expected 1 attempt, got ${calls}`);
});

await acheck('POSITIVE: a transient error IS retried to the budget (3 attempts)', async () => {
  let calls = 0;
  await assert.rejects(
    () => retry(async () => { calls++; throw new Error('ECONNRESET while writing'); },
      { retries: 2, backoffMs: 1, isRetryable: isRetryableError }),
    /ECONNRESET/,
  );
  assert.strictEqual(calls, 3, `expected 3 attempts, got ${calls}`);
});

await acheck('backward compat: no isRetryable -> any error still retried (3 attempts)', async () => {
  let calls = 0;
  await assert.rejects(
    () => retry(async () => { calls++; throw new Error('`date` is required'); }, { retries: 2, backoffMs: 1 }),
  );
  assert.strictEqual(calls, 3, `expected 3 attempts (legacy always-retry), got ${calls}`);
});

await acheck('a transient error that eventually succeeds resolves (retry recovers)', async () => {
  let calls = 0;
  const r = await retry(async () => { calls++; if (calls < 2) throw new Error('socket hang up'); return 'ok'; },
    { retries: 2, backoffMs: 1, isRetryable: isRetryableError });
  assert.strictEqual(r, 'ok');
  assert.strictEqual(calls, 2);
});

console.log('\n[retry-classifier] single source of truth: pool-drop delegates to the classifier');
const here = dirname(fileURLToPath(import.meta.url));
const adapterSrc = readFileSync(resolve(here, '../../src/lib/actual-adapter.ts'), 'utf8');
check('_shouldDropPoolOnError delegates to isRetryableError', /_shouldDropPoolOnError\([^)]*\)[^{]*\{\s*(\/\/[^\n]*\n\s*)*return isRetryableError\(err\);/.test(adapterSrc));
check('write retry call sites opt into isRetryable (21 sites)', (adapterSrc.match(/isRetryable: isRetryableError/g) || []).length >= 21);
check('read retry call sites do NOT opt in (kept always-retry)', /retry\(\(\) => rawGetAccounts\(\)[^\n]*\{ retries: 2, backoffMs: 200 \}/.test(adapterSrc));

console.log(`\n[retry-classifier] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
