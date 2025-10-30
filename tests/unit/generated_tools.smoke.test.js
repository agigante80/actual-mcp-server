console.log('Running generated tools smoke tests');

(async () => {
  const toolsIndex = await import('../../dist/src/tools/index.js');
  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');

  // Simple monkeypatch map: for any adapter function we'll return a predictable value
  const stubResponses = {
    getAccounts: [{ id: 'a1', name: 'Cash' }],
    addTransactions: ['t1'],
    importTransactions: { added: ['t2'], updated: [], errors: [] },
    getTransactions: [{ id: 't1', amount: 100 }],
    getCategories: [{ id: 'c1', name: 'Food' }],
    createCategory: 'c-new',
    getPayees: [{ id: 'p1', name: 'Kroger' }],
    createPayee: 'p-new',
    getBudgetMonths: ['2025-10'],
    getBudgetMonth: { month: '2025-10', categories: [] },
    setBudgetAmount: null,
    createAccount: 'acct-new',
    updateAccount: null,
    getAccountBalance: 12345,
  };

  // Patch adapter default export functions
  const originalAdapter = Object.assign({}, adapterMod.default);
  for (const [k, v] of Object.entries(stubResponses)) {
    if (typeof adapterMod.default[k] === 'function') {
      adapterMod.default[k] = async (..._args) => v;
    }
  }

  const toolNames = Object.keys(toolsIndex).filter(n => n !== 'default');
  let failures = 0;

  for (const name of toolNames) {
    try {
  let mod = toolsIndex[name];
  // some bundlers/export patterns export the tool object directly, others as default
  if (mod && mod.default) mod = mod.default;
      const inputExample = {};
      // Provide minimal examples for known tools
      if (name.includes('transactions_create')) inputExample.accountId = 'acct_1', inputExample.amount = 12.34;
      if (name.includes('transactions_import')) inputExample.accountId = 'acct_1', inputExample.transactions = [{ amount: 100 }];
      if (name.includes('transactions_get')) inputExample.accountId = 'acct_1';
      if (name.includes('accounts_get_balance')) inputExample.id = 'acct_1';
      if (name.includes('accounts_create')) inputExample.name = 'New';
      if (name.includes('categories_create')) inputExample.name = 'Food', inputExample.group_id = 'g1';
      if (name.includes('payees_create')) inputExample.name = 'Kroger';
      if (name.includes('budgets')) inputExample.month = '2025-10';

      // Validate input parsing
  try { mod.inputSchema.parse(inputExample); } catch (e) { /* ignore parse errors for optional inputs */ }

  const res = await mod.call(inputExample);
      // ensure result serializable
      JSON.stringify(res);
      console.log('OK', name);
    } catch (e) {
      console.error('Tool failed:', name, e && e.message);
      failures++;
    }
  }

  // restore adapter
  Object.assign(adapterMod.default, originalAdapter);

  if (failures > 0) {
    console.error(`${failures} tool(s) failed smoke tests`);
    process.exit(2);
  }

  console.log('All generated tool smoke tests passed');
})();
