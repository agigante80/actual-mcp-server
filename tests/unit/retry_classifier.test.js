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

const { retry, isRetryableError, isRateLimitError, TRANSIENT_ERROR_PATTERNS } = await import('../../dist/src/lib/retry.js');

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

console.log('\n[retry-classifier] #422 isRateLimitError: matches BOTH forms, feeds the drop carve-out');
// The two shapes @actual-app/api surfaces (server-dependent), plus the phrasing variant.
check('spaced express-default form is a rate-limit', isRateLimitError(new Error('Authentication failed: Too many requests, please try again later.')) === true);
check('hyphenated code form is a rate-limit', isRateLimitError(new Error('Authentication failed: too-many-requests')) === true);
check('"rate limit exceeded" phrasing is a rate-limit', isRateLimitError(new Error('rate limit exceeded')) === true);
// #422: the sync path surfaces the throttle in .code, not the message.
check('rate-limit in .code (sync path) is a rate-limit', (() => { const e = new Error('We had an unknown problem opening "_test-budget".'); e.code = 'Too many requests, please try again later.'; return isRateLimitError(e); })() === true);
check('a non-rate-limit .code is NOT a rate-limit', (() => { const e = new Error('boom'); e.code = 'ECONNRESET'; return isRateLimitError(e); })() === false);
check('a non-rate-limit Authentication failed is NOT a rate-limit', isRateLimitError(new Error('Authentication failed: invalid-password')) === false);
check('network-failure is NOT a rate-limit', isRateLimitError(new Error('Authentication failed: network-failure')) === false);
check('a domain error is NOT a rate-limit', isRateLimitError(new Error('Schedule "x" not found')) === false);
check('a non-Error is NOT a rate-limit', isRateLimitError('too many requests') === false);

console.log('\n[retry-classifier] #422 drop relationship: drop == retryable AND NOT rate-limit');
// The behavioural contract the source pin below fixes in place. A rate-limit is retryable but must
// NOT drop the connection; a non-rate-limit transient error both retries AND drops.
for (const m of ['Authentication failed: Too many requests, please try again later.', 'Authentication failed: too-many-requests']) {
  const e = new Error(m);
  check(`rate-limit is retryable but NOT droppable: "${m.slice(0, 32)}..."`, isRetryableError(e) === true && (isRetryableError(e) && !isRateLimitError(e)) === false);
}
for (const m of ['ECONNRESET', 'socket hang up', 'Authentication failed: invalid-password']) {
  const e = new Error(m);
  // invalid-password matches "Authentication failed" so it is transient AND droppable (unchanged).
  const droppable = isRetryableError(e) && !isRateLimitError(e);
  check(`non-rate-limit transient still drops: "${m}"`, droppable === isRetryableError(e));
}

console.log('\n[retry-classifier] single source of truth: pool-drop derives from the classifier (#177 + #422 carve-out)');
const here = dirname(fileURLToPath(import.meta.url));
const adapterSrc = readFileSync(resolve(here, '../../src/lib/actual-adapter.ts'), 'utf8');
check('_shouldDropPoolOnError = isRetryableError AND NOT isRateLimitError', /_shouldDropPoolOnError\([^)]*\)[^{]*\{\s*(\/\/[^\n]*\n\s*)*return isRetryableError\(err\) && !isRateLimitError\(err\);/.test(adapterSrc));
check('write retry call sites opt into isRetryable (21 sites)', (adapterSrc.match(/isRetryable: isRetryableError/g) || []).length >= 21);
check('read retry call sites do NOT opt in (kept always-retry)', /retry\(\(\) => rawGetAccounts\(\)[^\n]*\{ retries: 2, backoffMs: 200 \}/.test(adapterSrc));

console.log(`\n[retry-classifier] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
