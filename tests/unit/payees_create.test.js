console.log('Running JS smoke tests for payees_create');

(async () => {
  const mod = await import('../../dist/src/tools/payees_create.js');
  const tool = mod.default;
  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');

  try {
    tool.inputSchema.parse({});
    console.error('Expected parse to fail for empty input');
    process.exit(2);
  } catch (e) {
    console.log('Empty input correctly failed');
  }

  const good = { name: 'Amazon' };
  const parsed = tool.inputSchema.parse(good);
  console.log('Parsed OK:', parsed);

  const orig = adapterMod.default.createPayee;
  adapterMod.default.createPayee = async (p) => 'payee_1';
  const res = await tool.call(good);
  if (!res || !res.result) {
    console.error('Unexpected result from payees_create:', res);
    process.exit(2);
  }
  adapterMod.default.createPayee = orig;
  console.log('JS payees_create smoke tests passed');
})();
