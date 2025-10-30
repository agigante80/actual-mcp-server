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

  const good = { accountId: 'acct_1', amount: 12.34 };
  const parsed = tool.inputSchema.parse(good);
  console.log('Parsed OK:', parsed);

  console.log('JS transactions_create smoke tests passed');
})();
