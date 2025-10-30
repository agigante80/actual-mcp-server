console.log('Running JS smoke tests for transactions_get');

(async () => {
  const mod = await import('../../dist/src/tools/transactions_get.js');
  const tool = mod.default;
  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');

  const parsed = tool.inputSchema.parse({ accountId: 'a1', startDate: '2025-10-01', endDate: '2025-10-31' });
  console.log('Parsed OK:', parsed);

  const orig = adapterMod.default.getTransactions;
  adapterMod.default.getTransactions = async (accountId, start, end) => [{ id: 't1', accountId, amount: 10, date: start }];
  const res = await tool.call({ accountId: 'a1', startDate: '2025-10-01', endDate: '2025-10-31' });
  if (!res || !res.result || !Array.isArray(res.result)) {
    console.error('Unexpected result from transactions_get:', res);
    process.exit(2);
  }
  adapterMod.default.getTransactions = orig;
  console.log('JS transactions_get smoke tests passed');
})();
