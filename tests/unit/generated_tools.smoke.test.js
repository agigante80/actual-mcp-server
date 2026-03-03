// Stub required env vars so the test runs offline (adapter is monkeypatched below;
// real connection is never attempted). Real vars take precedence if already set.
process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD ?? 'stub-password-for-unit-test';

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
    getBudgetMonths: ['2025-12'],
    getBudgetMonth: { 
      month: '2025-12', 
      categoryGroups: [
        { 
          id: 'grp_1', 
          name: 'Test Group',
          categories: [
            { id: 'cat_1', name: 'Category 1', budgeted: 1000 },
            { id: 'cat_2', name: 'Category 2', budgeted: 500 }
          ]
        }
      ]
    },
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
    getBudgets: [{ name: 'My Budget', cloudFileId: '00000000-0000-0000-0000-000000000001', hasKey: false, state: 'remote' }],
    switchBudget: { name: 'My Budget', syncId: '00000000-0000-0000-0000-000000000001', serverUrl: 'http://localhost:5006' },
    getBudgetRegistry: [{ name: 'My Budget', syncId: '00000000-0000-0000-0000-000000000001', serverUrl: 'http://localhost:5006', hasEncryption: false }],
    getIDByName: '00000000-0000-0000-0000-000000000001',
    getServerVersion: { version: '26.2.1' },
    getSchedules: [{ id: '00000000-0000-0000-0000-000000000099', name: 'Rent', next_date: '2026-04-01' }],
    createSchedule: '00000000-0000-0000-0000-000000000099',
    updateSchedule: null,
    deleteSchedule: null,
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
      // Provide minimal examples for known tools (use UUIDs where schemas require them)
  if (name.includes('transactions_create')) inputExample.account = '00000000-0000-0000-0000-000000000001', inputExample.date = '2025-11-24', inputExample.amount = -1234;
  if (name.includes('transactions_import')) inputExample.accountId = '00000000-0000-0000-0000-000000000001', inputExample.transactions = [{ amount: 100 }];
  if (name.includes('transactions_get')) inputExample.accountId = '00000000-0000-0000-0000-000000000001';
  if (name.includes('transactions_delete')) inputExample.id = '00000000-0000-0000-0000-000000000001';
  if (name.includes('transactions_update') && !name.includes('batch')) inputExample.id = '00000000-0000-0000-0000-000000000001', inputExample.fields = { notes: 'test' };
  if (name.includes('transactions_update_batch')) inputExample.updates = [{ id: '00000000-0000-0000-0000-000000000001', fields: { notes: 'batch-test' } }];
  if (name.includes('accounts_get_balance')) inputExample.id = '00000000-0000-0000-0000-000000000001';
  if (name.includes('accounts_create')) inputExample.name = 'New';
  if (name.includes('accounts_update')) inputExample.id = '00000000-0000-0000-0000-000000000001', inputExample.fields = { name: 'Updated Name' };
  if (name.includes('accounts_delete')) inputExample.id = '00000000-0000-0000-0000-000000000001';
  if (name.includes('accounts_close')) inputExample.id = '00000000-0000-0000-0000-000000000001';
  if (name.includes('accounts_reopen')) inputExample.id = '00000000-0000-0000-0000-000000000001';
  if (name.includes('categories_create')) inputExample.name = 'Food', inputExample.group_id = '00000000-0000-0000-0000-000000000001';
  if (name.includes('categories_delete')) inputExample.id = '00000000-0000-0000-0000-000000000001';
  if (name.includes('categories_update')) inputExample.id = 'cat_1', inputExample.fields = { name: 'Updated' };
  if (name.includes('category_groups_create')) inputExample.name = 'Expenses';
  if (name.includes('category_groups_delete')) inputExample.id = 'grp_1';
  if (name.includes('category_groups_update')) inputExample.id = 'grp_1', inputExample.fields = { name: 'Updated' };
  if (name.includes('payees_create')) inputExample.name = 'Kroger';
  if (name.includes('payees_delete')) inputExample.id = 'p_1';
  if (name.includes('payees_update')) inputExample.id = '00000000-0000-0000-0000-000000000001', inputExample.fields = { name: 'Updated' };
  if (name.includes('payees_merge')) inputExample.targetId = 'p_1', inputExample.mergeIds = ['p_2', 'p_3'];
  if (name.includes('payee_rules_get')) inputExample.payeeId = 'p_1';
  if (name.includes('rules_create') && !name.includes('or_update')) inputExample.conditions = [{ field: 'description', op: 'contains', value: 'test' }], inputExample.actions = [{ op: 'set', field: 'category', value: '00000000-0000-0000-0000-000000000001' }];
  if (name.includes('rules_create_or_update')) inputExample.conditions = [{ field: 'description', op: 'contains', value: 'test' }], inputExample.actions = [{ op: 'set', field: 'category', value: '00000000-0000-0000-0000-000000000001' }];
  if (name.includes('rules_delete')) inputExample.id = 'rule_1';
  if (name.includes('rules_update')) inputExample.id = 'rule_1', inputExample.fields = { conditions: [] };
  if (name.includes('budgets_setAmount')) inputExample.month = '2025-12', inputExample.categoryId = 'cat_1', inputExample.amount = 100;
  if (name.includes('budgets_getMonth')) inputExample.month = '2025-12';
  if (name.includes('budget_updates_batch')) inputExample.operations = [{ month: '2025-12', categoryId: 'cat_1', amount: 100 }];
  if (name.includes('budgets_holdForNextMonth')) inputExample.month = '2025-12', inputExample.amount = 10000;
  if (name.includes('budgets_resetHold')) inputExample.month = '2025-12'; // no categoryId — tool operates on whole month
  if (name.includes('budgets_setCarryover')) inputExample.month = '2025-12', inputExample.categoryId = 'cat_1', inputExample.flag = true;
  if (name.includes('budgets_transfer')) inputExample.month = '2025-12', inputExample.fromCategoryId = 'cat_1', inputExample.toCategoryId = 'cat_2', inputExample.amount = 100;
  if (name.includes('query_run')) inputExample.query = 'SELECT * FROM transactions LIMIT 10';
  if (name.includes('bank_sync')) inputExample.accountId = 'acct_1';
  if (name.includes('budgets_switch')) inputExample.budgetName = 'My Budget';
  if (name.includes('get_id_by_name')) inputExample.type = 'accounts', inputExample.name = 'Cash';
  if (name.includes('schedules_create')) inputExample.date = '2026-06-01';
  if (name.includes('schedules_update')) inputExample.id = '00000000-0000-0000-0000-000000000099';
  if (name.includes('schedules_delete')) inputExample.id = '00000000-0000-0000-0000-000000000099';
  // server_get_version takes no parameters

      // Validate input parsing — only silently skip when no example was provided (tool may have required fields);
      // if an example IS provided it must parse correctly, otherwise the test stub is wrong.
  try {
    mod.inputSchema.parse(inputExample);
  } catch (e) {
    if (Object.keys(inputExample).length > 0) {
      throw new Error(`Schema parse failed for ${name} with provided example: ${e && e.message}`);
    }
    // empty example + schema requires fields: acceptable (no example provided for this tool)
  }

  const res = await mod.call(inputExample);
      // ensure result serializable
      JSON.stringify(res);

      // ── Correctness assertions ──────────────────────────────────────────
      const n = name;
      const shapeErr = (msg) => { throw new Error(`${n}: ${msg} (got: ${JSON.stringify(res).slice(0, 120)})`); };

      // List/get tools that return a { result } wrapper
      const resultWrappers = ['accounts_list', 'categories_get',
        'payees_get', 'budgets_getMonth', 'budgets_getMonths', 'budgets_get_all',
        'query_run', 'transactions_filter', 'transactions_get', 'transactions_import',
        'bank_sync', 'budgets_setAmount', 'budgets_transfer'];
      if (resultWrappers.includes(n)) {
        if (!res || !('result' in res)) shapeErr(`expected { result } wrapper`);
      }

      // Mutate / delete tools that return { success: true }
      const successTools = ['accounts_close', 'accounts_delete', 'accounts_reopen', 'accounts_update',
        'categories_delete', 'categories_update', 'category_groups_delete', 'category_groups_update',
        'payees_delete', 'payees_merge', 'payees_update',
        'rules_delete', 'rules_update',
        'schedules_delete', 'schedules_update',
        'transactions_delete', 'transactions_update',
        'budgets_resetHold', 'budgets_holdForNextMonth',
        'budgets_setCarryover', 'budget_updates_batch'];
      if (successTools.includes(n)) {
        if (!res || res.success !== true) shapeErr(`expected success=true`);
      }

      // Tools with custom named keys (not { result })
      if (n === 'category_groups_get') {
        if (!Array.isArray(res?.groups)) shapeErr(`expected groups array`);
      }
      if (n === 'rules_get') {
        if (!Array.isArray(res?.rules)) shapeErr(`expected rules array`);
      }
      if (n === 'schedules_get') {
        if (!Array.isArray(res?.schedules)) shapeErr(`expected schedules array`);
        if (typeof res?.count !== 'number') shapeErr(`expected count number`);
      }
      if (n === 'schedules_create') {
        if (typeof res?.id !== 'string') shapeErr(`expected id string`);
      }
      if (n === 'payee_rules_get') {
        if (!Array.isArray(res?.rules)) shapeErr(`expected rules array`);
        if (typeof res?.count !== 'number') shapeErr(`expected count number`);
      }

      // Shape-specific assertions
      if (n === 'accounts_get_balance') {
        if (typeof res?.balance !== 'number') shapeErr(`expected numeric balance`);
      }
      if (n === 'server_info') {
        if (!res?.server?.name) shapeErr(`expected server.name`);
      }
      if (n === 'get_id_by_name') {
        if (typeof res?.id !== 'string') shapeErr(`expected id string`);
        if (!res?.type) shapeErr(`expected type field`);
        if (!res?.name) shapeErr(`expected name field`);
      }
      if (n === 'server_get_version') {
        if (!('version' in res) && !('error' in res)) shapeErr(`expected version or error field`);
      }
      if (n === 'budgets_switch') {
        if (res?.success !== true) shapeErr(`expected success=true`);
        if (typeof res?.budgetName !== 'string') shapeErr(`expected budgetName string`);
        if (typeof res?.budgetId !== 'string') shapeErr(`expected budgetId string`);
        if (typeof res?.serverUrl !== 'string') shapeErr(`expected serverUrl string`);
      }
      if (n === 'budgets_list_available') {
        if (!Array.isArray(res?.budgets)) shapeErr(`expected budgets array`);
        if (typeof res?.count !== 'number') shapeErr(`expected count number`);
      }
      if (n === 'session_list') {
        if (typeof res?.totalSessions !== 'number') shapeErr(`expected totalSessions number`);
      }
      if (n.startsWith('transactions_search_by_')) {
        if (!Array.isArray(res?.transactions)) shapeErr(`expected transactions array`);
        if (typeof res?.count !== 'number') shapeErr(`expected count number`);
      }
      if (n.startsWith('transactions_summary_by_')) {
        if (!Array.isArray(res?.summary)) shapeErr(`expected summary array`);
        if (typeof res?.totalAmount !== 'number') shapeErr(`expected totalAmount number`);
      }
      if (n === 'rules_create_or_update') {
        if (typeof res?.id !== 'string') shapeErr(`expected id string`);
        if (typeof res?.created !== 'boolean') shapeErr(`expected created boolean`);
      }
      if (n === 'transactions_update_batch') {
        if (!Array.isArray(res?.succeeded)) shapeErr(`expected succeeded array`);
        if (!Array.isArray(res?.failed)) shapeErr(`expected failed array`);
        if (typeof res?.total !== 'number') shapeErr(`expected total number`);
        if (typeof res?.successCount !== 'number') shapeErr(`expected successCount number`);
        if (typeof res?.failureCount !== 'number') shapeErr(`expected failureCount number`);
      }
      if (n === 'transactions_uncategorized') {
        if (!Array.isArray(res?.transactions)) shapeErr(`expected transactions array`);
        if (typeof res?.count !== 'number') shapeErr(`expected count number`);
        if (typeof res?.summary?.totalAmount !== 'number') shapeErr(`expected summary.totalAmount number`);
      }
      // ────────────────────────────────────────────────────────────────────

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
  process.exit(0);
})();
