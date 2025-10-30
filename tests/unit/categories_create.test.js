console.log('Running JS smoke tests for categories_create');

(async () => {
  const mod = await import('../../dist/src/tools/categories_create.js');
  const tool = mod.default;
  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');

  try {
    tool.inputSchema.parse({});
    console.error('Expected parse to fail for empty input');
    process.exit(2);
  } catch (e) {
    console.log('Empty input correctly failed');
  }

  const good = { name: 'Groceries' };
  const parsed = tool.inputSchema.parse(good);
  console.log('Parsed OK:', parsed);

  const orig = adapterMod.default.createCategory;
  adapterMod.default.createCategory = async (c) => 'cat_1';
  const res = await tool.call(good);
  if (!res || !res.result) {
    console.error('Unexpected result from categories_create:', res);
    process.exit(2);
  }
  adapterMod.default.createCategory = orig;
  console.log('JS categories_create smoke tests passed');
})();
