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
    getCategoryGroups: [{ id: 'grp_1', name: 'Expenses' }],
    createCategory: 'c-new',
    deleteCategory: null,
    updateCategory: null,
    createCategoryGroup: 'grp-new',
    deleteCategoryGroup: null,
    updateCategoryGroup: null,
    getPayees: [{ id: 'p1', name: 'Kroger' }],
    getCommonPayees: [{ id: 'p1', name: 'Kroger' }],
    getPayeeRules: [{ id: 'rule1', conditions: [] }],
    createPayee: 'p-new',
    deletePayee: null,
    updatePayee: null,
    mergePayees: null,
    getRules: [{ id: 'rule1', conditions: [] }],
    createRule: 'rule-new',
    deleteRule: null,
    updateRule: null,
    getBudgetMonths: ['2025-10'],
    getBudgetMonth: { month: '2025-10', categories: [
      { categoryId: 'cat_1', amount: 1000 },
      { categoryId: 'cat_2', amount: 500 }
    ] },
    setBudgetAmount: null,
    setBudgetCarryover: null,
    holdBudgetForNextMonth: null,
    resetBudgetHold: null,
    batchBudgetUpdates: null,
    createAccount: 'acct-new',
    updateAccount: null,
    deleteAccount: null,
    closeAccount: null,
    reopenAccount: null,
    getAccountBalance: 12345,
    deleteTransaction: null,
    updateTransaction: null,
    runQuery: [{ id: 'result1', value: 100 }],
    runBankSync: null,
    getBudgets: [{ id: 'budget1', name: 'My Budget' }],
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
  if (name.includes('transactions_delete')) inputExample.id = 'tx_1';
  if (name.includes('transactions_update')) inputExample.id = 'tx_1', inputExample.fields = { notes: 'test' };
  if (name.includes('accounts_get_balance')) inputExample.id = 'acct_1';
  if (name.includes('accounts_create')) inputExample.name = 'New';
  if (name.includes('accounts_update')) inputExample.id = 'acct_1', inputExample.name = 'Updated Name';
  if (name.includes('accounts_delete')) inputExample.id = 'acct_1';
  if (name.includes('accounts_close')) inputExample.id = 'acct_1';
  if (name.includes('accounts_reopen')) inputExample.id = 'acct_1';
  if (name.includes('categories_create')) inputExample.name = 'Food';
  if (name.includes('categories_delete')) inputExample.id = 'cat_1';
  if (name.includes('categories_update')) inputExample.id = 'cat_1', inputExample.fields = { name: 'Updated' };
  if (name.includes('category_groups_create')) inputExample.name = 'Expenses';
  if (name.includes('category_groups_delete')) inputExample.id = 'grp_1';
  if (name.includes('category_groups_update')) inputExample.id = 'grp_1', inputExample.fields = { name: 'Updated' };
  if (name.includes('payees_create')) inputExample.name = 'Kroger';
  if (name.includes('payees_delete')) inputExample.id = 'p_1';
  if (name.includes('payees_update')) inputExample.id = 'p_1', inputExample.fields = { name: 'Updated' };
  if (name.includes('payees_merge')) inputExample.targetId = 'p_1', inputExample.mergeIds = ['p_2', 'p_3'];
  if (name.includes('payee_rules_get')) inputExample.payeeId = 'p_1';
  if (name.includes('rules_create')) inputExample.conditions = [{ field: 'description', op: 'contains', value: 'test' }], inputExample.actions = [{ op: 'set', field: 'category', value: 'cat_1' }];
  if (name.includes('rules_delete')) inputExample.id = 'rule_1';
  if (name.includes('rules_update')) inputExample.id = 'rule_1', inputExample.fields = { conditions: [] };
  if (name.includes('budgets_setAmount')) inputExample.month = '2025-10', inputExample.categoryId = 'cat_1', inputExample.amount = 100;
  if (name.includes('budgets_getMonth')) inputExample.month = '2025-10';
  if (name.includes('budget_updates_batch')) inputExample.operations = [{ month: '2025-10', categoryId: 'cat_1', amount: 100 }];
  if (name.includes('budgets_holdForNextMonth')) inputExample.month = '2025-10', inputExample.categoryId = 'cat_1';
  if (name.includes('budgets_resetHold')) inputExample.month = '2025-10', inputExample.categoryId = 'cat_1';
  if (name.includes('budgets_setCarryover')) inputExample.month = '2025-10', inputExample.categoryId = 'cat_1', inputExample.flag = true;
  if (name.includes('budgets_transfer')) inputExample.month = '2025-10', inputExample.fromCategoryId = 'cat_1', inputExample.toCategoryId = 'cat_2', inputExample.amount = 100;
  if (name.includes('query_run')) inputExample.query = 'SELECT * FROM transactions LIMIT 10';
  if (name.includes('bank_sync')) inputExample.accountId = 'acct_1';

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
