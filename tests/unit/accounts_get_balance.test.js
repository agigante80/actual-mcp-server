console.log('Running JS smoke tests for accounts_get_balance');

(async () => {
  const mod = await import('../../dist/src/tools/accounts_get_balance.js');
  const tool = mod.default;
  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');

  try {
    // id is optional but we'll call with a valid one
    const parsed = tool.inputSchema.parse({ id: 'acct_1' });
    console.log('Parsed OK:', parsed);
  } catch (e) {
    console.error('Unexpected parse failure', e);
    process.exit(2);
  }

  const orig = adapterMod.default.getAccountBalance;
  adapterMod.default.getAccountBalance = async (id, cutoff) => 123.45;
  const res = await tool.call({ id: 'acct_1' });
  if (!res || typeof res.result !== 'number') {
    console.error('Unexpected result from accounts_get_balance:', res);
    process.exit(2);
  }
  console.log('accounts_get_balance returned', res.result);
  adapterMod.default.getAccountBalance = orig;

  console.log('JS accounts_get_balance smoke tests passed');
})();
