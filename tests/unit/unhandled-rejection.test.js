// Tests for the unhandledRejection allow-list predicate.
// Covers the original string-based entries plus the stack-anchored check for
// the @actual-app/api worker's secondary rejection (issue #152).
//
// Critical empirical finding: the SECONDARY rejection that escapes is an
// Error whose only set property is `stack`. The primary error (with code/
// errno/syscall/path) is already caught by ActualConnectionPool. So the
// allow-list entry anchors purely on the stack frame, not on a code value.

import assert from 'node:assert/strict';

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID =
  process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD ?? 'stub-password-for-unit-test';

console.log('Running unit tests for unhandled-rejection allow-list');

const { isKnownBenignRejection, isActualApiWorkerRejection } = await import(
  '../../dist/src/lib/rejection-allowlist.js'
);

function workerSecondaryRejection(stack) {
  // Shape observed in production: Error with stack set, no other props.
  const err = new Error();
  Object.defineProperty(err, 'stack', { value: stack, enumerable: false });
  return err;
}

// 1. Worker secondary rejection (download-budget frame): swallow.
{
  const r = workerSecondaryRejection(
    'Error\n    at handlers$1.api/download-budget (/app/node_modules/@actual-app/api/dist/index.js:112969:9)',
  );
  assert.equal(
    isKnownBenignRejection(r),
    true,
    'production-shape secondary rejection must be swallowed',
  );
}

// 2. EACCES from elsewhere (no api stack frame): still exit.
{
  const r = { code: 'EACCES', stack: 'Error\n    at writeLog (/app/src/lib/loggerFactory.js:42:11)' };
  assert.equal(
    isKnownBenignRejection(r),
    false,
    'EACCES from unrelated code must still trigger process.exit',
  );
}

// 3. Path-anchor in isolation: api/dist stack without download-budget should swallow.
{
  const r = workerSecondaryRejection(
    'Error\n    at someOtherHandler (/app/node_modules/@actual-app/api/dist/index.js:99:1)',
  );
  assert.equal(
    isKnownBenignRejection(r),
    true,
    'api/dist stack alone is sufficient (durable path anchor)',
  );
}

// 4. download-budget frame alone (no @actual-app/api/dist text): swallow.
{
  const r = workerSecondaryRejection('Error\n    at downloader (some-other-path/download-budget.js:1:1)');
  assert.equal(
    isKnownBenignRejection(r),
    true,
    'download-budget frame alone is sufficient (precise frame anchor)',
  );
}

// 5. Stack mentions @actual-app/api by name but not under dist/: should NOT swallow.
//    Guards against false positives in error messages that quote the package name.
{
  const r = { stack: 'Error: failed to import @actual-app/api package\n    at /app/src/lib/x.js:1:1' };
  assert.equal(
    isKnownBenignRejection(r),
    false,
    'package name mentioned in error text without /dist/ frame must not swallow',
  );
}

// 6. Non-string stack: should not swallow.
{
  const r = { stack: 42 };
  assert.equal(isActualApiWorkerRejection(r), false);
  assert.equal(isKnownBenignRejection(r), false);
}

// 7. Null/undefined safety.
assert.equal(isKnownBenignRejection(null), false, 'null reason must not swallow');
assert.equal(isKnownBenignRejection(undefined), false, 'undefined reason must not swallow');
assert.equal(isActualApiWorkerRejection(null), false);
assert.equal(isActualApiWorkerRejection(undefined), false);

// 8. Authentication failure string (existing allow-list regression guard).
assert.equal(
  isKnownBenignRejection('Authentication failed: invalid credentials'),
  true,
  'existing Authentication failed: entry must still swallow',
);

// 9. BankSyncError type object (existing allow-list regression guard).
{
  const r = { type: 'BankSyncError', message: 'Failed syncing account abc' };
  assert.equal(isKnownBenignRejection(r), true, 'BankSyncError type must still swallow');
}

// 10. GoCardless string (existing allow-list regression guard).
assert.equal(
  isKnownBenignRejection('GoCardless rate limit exceeded'),
  true,
  'GoCardless message must still swallow',
);

// 11. Generic Error with unrelated stack: must still trigger process.exit.
assert.equal(
  isKnownBenignRejection(new Error('something unexpected')),
  false,
  'generic Error must still trigger exit',
);

// 12. Plain unknown string: must still trigger exit.
assert.equal(
  isKnownBenignRejection('out of memory'),
  false,
  'unknown rejection string must still trigger exit',
);

console.log('unhandled-rejection allow-list tests passed');
