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

  console.log('JS transactions_create smoke tests passed');
})();
