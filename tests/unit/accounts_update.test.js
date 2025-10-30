console.log('Running JS smoke tests for accounts_update');

(async () => {
  const mod = await import('../../dist/src/tools/accounts_update.js');
  const tool = mod.default;
  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');

  try {
    tool.inputSchema.parse({ id: 'a1' });
    console.error('Expected parse to fail when no updatable fields are provided');
    process.exit(2);
  } catch (e) {
    console.log('Empty update correctly rejected');
  }

  const good = { id: 'a1', name: 'Updated name' };
  const parsed = tool.inputSchema.parse(good);
  console.log('Parsed OK:', parsed);

  const orig = adapterMod.default.updateAccount;
  adapterMod.default.updateAccount = async (id, fields) => ({ id, ...fields });
  const res = await tool.call(good);
  if (!res || !res.result || res.result.name !== 'Updated name') {
    console.error('Unexpected result from accounts_update:', res);
    process.exit(2);
  }
  adapterMod.default.updateAccount = orig;
  console.log('JS accounts_update smoke tests passed');
})();
