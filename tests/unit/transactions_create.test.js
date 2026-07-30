// Stub required env vars so config validation passes at import time.
// The adapter is never actually called in these tests (only the Zod schema is exercised).
process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD ?? 'stub-password-for-unit-test';

console.log('Running JS smoke tests for transactions_create');

(async () => {
  const mod = await import('../../dist/src/tools/transactions_create.js');
  const tool = mod.default;

  try {
    tool.inputSchema.parse({});
    console.error('Expected parse to fail for empty input');
    process.exit(2);
  } catch (e) {
    console.log('Empty input correctly failed');
  }

  const good = { account: '12345678-1234-1234-1234-123456789abc', date: '2026-01-05', amount: 1234 };
  const parsed = tool.inputSchema.parse(good);
  console.log('Parsed OK:', parsed);

  // #305: split (subtransactions) schema rules.
  const A = '12345678-1234-1234-1234-123456789abc';
  const C = '22222222-2222-2222-2222-222222222222';
  let splitFailures = 0;
  const expect = (cond, label) => { if (cond) { console.log(`  ✓ ${label}`); } else { console.error(`  ✗ FAIL: ${label}`); splitFailures++; } };
  const S = tool.inputSchema;

  expect(S.safeParse({ account: A, date: '2026-07-27', amount: -1000, subtransactions: [{ amount: -600, category: C }, { amount: -400 }] }).success,
    'balanced split (sum == amount) parses');
  const mism = S.safeParse({ account: A, date: '2026-07-27', amount: -1000, subtransactions: [{ amount: -600 }, { amount: -300 }] });
  expect(!mism.success && mism.error.issues.some((i) => /sum to the parent amount/i.test(i.message) && /Expected -1000, got -900/.test(i.message)),
    'mismatched sum rejected with expected-vs-actual message');
  expect(!S.safeParse({ account: A, date: '2026-07-27', amount: -1000, category: C, subtransactions: [{ amount: -1000 }] }).success,
    'parent category alongside subtransactions rejected');
  expect(!S.safeParse({ account: A, date: '2026-07-27', amount: -100, subtransactions: [{ amount: -100, payee_name: 'x' }] }).success,
    'child payee_name rejected (strict child schema)');
  expect(!S.safeParse({ account: A, date: '2026-07-27', amount: -100, subtransactions: [{ amount: -100, category: 'not-a-uuid' }] }).success,
    'child category must be a UUID');
  expect(!S.safeParse({ account: A, date: '2026-07-27', amount: -100, subtransactions: [{ amount: 1.5 }] }).success,
    'non-integer child amount rejected');
  expect(!S.safeParse({ account: A, date: '2026-07-27', amount: -101, subtransactions: Array.from({ length: 101 }, () => ({ amount: -1 })) }).success,
    'array over .max(100) rejected');
  expect(!S.safeParse({ account: A, date: '2026-07-27', amount: -100, subtransactions: [] }).success,
    'empty subtransactions array rejected (.min(1))');
  expect(S.safeParse({ account: A, date: '2026-07-27', amount: -100 }).success,
    'no subtransactions still parses (backward compatible)');

  if (splitFailures > 0) { console.error(`${splitFailures} split test(s) FAILED`); process.exit(2); }

  console.log('JS transactions_create smoke tests passed');
})();
