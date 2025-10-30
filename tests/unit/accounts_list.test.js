console.log('Running JS smoke tests for accounts_list');

(async () => {
  // Import compiled tool and adapter
  const toolMod = await import('../../dist/src/tools/accounts_list.js');
  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const tool = toolMod.default;

  // Monkeypatch adapter.getAccounts
  const original = adapterMod.default.getAccounts;
  adapterMod.default.getAccounts = async () => [{ id: 'a1', name: 'Cash', balance: 100 }];

  const res = await tool.call({});
  if (!res || !res.result || !Array.isArray(res.result)) {
    console.error('Unexpected result from accounts_list:', res);
    process.exit(2);
  }
  console.log('accounts_list returned', res.result.length, 'accounts');

  // restore
  adapterMod.default.getAccounts = original;
  console.log('JS accounts_list smoke tests passed');
})();
