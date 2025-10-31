console.log('Running JS smoke tests for accounts_create');

(async () => {
  const mod = await import('../../dist/src/tools/accounts_create.js');
  const tool = mod.default;
  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');

  try {
    tool.inputSchema.parse({});
    console.error('Expected parse to fail for empty input');
    process.exit(2);
  } catch (e) {
    console.log('Empty input correctly failed');
  }

  const good = { name: 'Checking', balance: 100 };
  const parsed = tool.inputSchema.parse(good);
  console.log('Parsed OK:', parsed);

  const orig = adapterMod.default.createAccount;
  adapterMod.default.createAccount = async (account, balance) => 'acct_123';
  const res = await tool.call(good);
  if (!res || !res.result) {
    console.error('Unexpected result from accounts_create:', res);
    process.exit(2);
  }
  console.log('accounts_create returned id', res.result);
  adapterMod.default.createAccount = orig;

  console.log('JS accounts_create smoke tests passed');
})();
