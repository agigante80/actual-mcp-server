import tool from '../../src/tools/transactions_create.js';

async function run() {
  console.log('Running transactions_create InputSchema smoke tests');

  // Should fail when required fields missing
  try {
    tool.inputSchema.parse({});
    console.error('Expected parse to fail for empty input');
    process.exit(2);
  } catch (e) {
    console.log('Empty input correctly failed');
  }

  // Should pass with minimal valid input
  const good = { accountId: 'acct_1', amount: 12.34 };
  const parsed = tool.inputSchema.parse(good);
  console.log('Parsed OK:', parsed);

  console.log('transactions_create smoke tests passed');
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
