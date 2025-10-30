console.log('Running JS smoke tests for budgets_setAmount');

(async () => {
  const mod = await import('../../dist/src/tools/budgets_setAmount.js');
  const tool = mod.default;
  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');

  try {
    tool.inputSchema.parse({});
    console.error('Expected parse to fail for empty input');
    process.exit(2);
  } catch (e) {
    console.log('Empty input correctly failed');
  }

  const good = { month: '2025-10', categoryId: 'cat_1', amount: 123 };
  const parsed = tool.inputSchema.parse(good);
  console.log('Parsed OK:', parsed);

  const orig = adapterMod.default.setBudgetAmount;
  adapterMod.default.setBudgetAmount = async (month, cat, amount) => ({ month, cat, amount });
  const res = await tool.call(good);
  if (!res || !res.result) {
    console.error('Unexpected result from budgets_setAmount:', res);
    process.exit(2);
  }
  adapterMod.default.setBudgetAmount = orig;
  console.log('JS budgets_setAmount smoke tests passed');
})();
