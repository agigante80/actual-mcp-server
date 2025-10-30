console.log('Running JS smoke tests for transactions_import');

(async () => {
  const mod = await import('../../dist/src/tools/transactions_import.js');
  const tool = mod.default;
  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');

  // test array input
  const arr = [{ accountId: 'a1', amount: 10 }];
  const parsedArr = tool.inputSchema.parse(arr);
  console.log('Parsed array OK:', parsedArr.length);

  const orig = adapterMod.default.importTransactions;
  adapterMod.default.importTransactions = async (accountId, items) => ({ added: ['t1'], updated: [], errors: [] });

  const res1 = await tool.call(arr);
  if (!res1 || !res1.result || !res1.result.added) {
    console.error('Unexpected result from transactions_import (array):', res1);
    process.exit(2);
  }
  console.log('transactions_import (array) ok');

  const obj = { accountId: 'a1', transactions: arr };
  const parsedObj = tool.inputSchema.parse(obj);
  console.log('Parsed object OK');
  const res2 = await tool.call(obj);
  if (!res2 || !res2.result) {
    console.error('Unexpected result from transactions_import (obj):', res2);
    process.exit(2);
  }

  adapterMod.default.importTransactions = orig;
  console.log('JS transactions_import smoke tests passed');
})();
