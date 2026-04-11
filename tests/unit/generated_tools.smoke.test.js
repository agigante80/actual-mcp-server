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
    getAccountsWithBalances: [{ id: 'a1', name: 'Cash', balance_current: 12345 }],
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
    updateTransactionBatch: { succeeded: [{ id: '00000000-0000-0000-0000-000000000001' }], failed: [] },
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
  if (name.includes('transactions_get')) inputExample.accountId = 'a1'; // matches getAccounts stub { id: 'a1' } — nil-UUID would hit not-found path and return { error } without result
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
  if (name.includes('rules_delete')) inputExample.id = 'rule1'; // matches getRules stub: { id: 'rule1' }
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
      // accounts_create / payees_create use createTool which wraps the returned id in { result }
      const resultWrappers = ['accounts_list', 'categories_get',
        'payees_get', 'budgets_getMonth', 'budgets_getMonths', 'budgets_get_all',
        'query_run', 'transactions_filter', 'transactions_get', 'transactions_import',
        'bank_sync', 'budgets_setAmount', 'budgets_transfer',
        'accounts_create', 'payees_create'];
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
        // balance is a number on success, null on error (account not found path)
        if (typeof res?.balance !== 'number' && res?.balance !== null) shapeErr(`expected numeric balance or null`);
      }
      if (n === 'accounts_list') {
        // balance_current must be populated for every account — single-session getAccountsWithBalances()
        if (!Array.isArray(res?.result)) shapeErr(`expected result to be an array`);
        const unbalanced = res.result.filter(a => typeof a.balance_current !== 'number');
        if (unbalanced.length > 0) shapeErr(`expected balance_current to be a number for all accounts, but ${unbalanced.length} account(s) had balance_current=${JSON.stringify(unbalanced[0]?.balance_current)}`);
        // Verify the value matches the getAccountsWithBalances stub — not just the type
        const STUB_BALANCE = stubResponses.getAccountsWithBalances[0].balance_current; // 12345
        const wrongValue = res.result.filter(a => a.balance_current !== STUB_BALANCE);
        if (wrongValue.length > 0) shapeErr(`expected balance_current=${STUB_BALANCE} (from getAccountsWithBalances stub) but got ${wrongValue[0]?.balance_current} for account "${wrongValue[0]?.name}"`);
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
      // categories_create: old ToolDefinition pattern, returns { success, categoryId, message }
      if (n === 'categories_create') {
        if (typeof res?.categoryId !== 'string') shapeErr(`expected categoryId string`);
        if (res?.success !== true) shapeErr(`expected success=true`);
      }
      // category_groups_create: old ToolDefinition pattern, returns { id, success }
      if (n === 'category_groups_create') {
        if (typeof res?.id !== 'string') shapeErr(`expected id string`);
        if (res?.success !== true) shapeErr(`expected success=true`);
      }
      // rules_create: old ToolDefinition pattern, returns { id, success }
      if (n === 'rules_create') {
        if (typeof res?.id !== 'string') shapeErr(`expected id string`);
        if (res?.success !== true) shapeErr(`expected success=true`);
      }
      // session_close: old ToolDefinition pattern, returns { success, message, ... }
      // In stub environment: connectionPool has 0 sessions → success=false is still a boolean
      if (n === 'session_close') {
        if (typeof res?.success !== 'boolean') shapeErr(`expected success boolean`);
        if (typeof res?.message !== 'string') shapeErr(`expected message string`);
      }
      // ────────────────────────────────────────────────────────────────────

      console.log('OK', name);
    } catch (e) {
      console.error('Tool failed:', name, e && e.message);
      failures++;
    }
  }

  // ── Off-budget filtering regression test (issue #80) ─────────────────────
  // transactions_uncategorized must NOT include transactions from off-budget accounts.
  {
    console.log('\n[regression #80] transactions_uncategorized: off-budget filtering');

    // Patch getAccounts + getTransactions: one on-budget account, one off-budget.
    // The fix resolves offbudget status via the account UUID on each transaction.
    // getTransactions(undefined, ...) is the no-accountId code path (full table scan).
    adapterMod.default.getAccounts = async () => [
      { id: 'acct-on',  name: 'Checking',   offbudget: false },
      { id: 'acct-off', name: 'Investment', offbudget: true  },
    ];
    adapterMod.default.getTransactions = async () => [
      { id: 'on1',  amount: -500,  category: null, account: 'acct-on'  },
      { id: 'off1', amount: -1500, category: null, account: 'acct-off' },
    ];

    try {
      const uncatMod = toolsIndex['transactions_uncategorized'];
      const uncatTool = uncatMod?.default ?? uncatMod;
      const res = await uncatTool.call({});
      const txns = res?.transactions ?? [];
      const offBudgetIncluded = txns.some(t => t?.id === 'off1');
      const onBudgetIncluded = txns.some(t => t?.id === 'on1');

      if (offBudgetIncluded) {
        console.error('[known-bug #80] off-budget transaction still included in uncategorized results — fix pending');
        failures++;
      } else {
        console.log('OK [regression #80] off-budget transaction correctly excluded');
      }

      if (!onBudgetIncluded) {
        console.error('[regression #80] on-budget transaction incorrectly excluded — filter is too broad');
        failures++;
      } else {
        console.log('OK [regression #80] on-budget transaction correctly included');
      }
    } catch (e) {
      console.error('[regression #80] unexpected error:', e && e.message);
      failures++;
    } finally {
      // Restore stubs for all patched methods
      adapterMod.default.getAccounts = async (..._args) => stubResponses.getAccounts;
      adapterMod.default.getTransactions = async (..._args) => stubResponses.getTransactions;
    }
  }
  // ── End regression #80 ────────────────────────────────────────────────────

  // ── Off-budget filtering regression test (issue #81) ─────────────────────
  // transactions_filter, transactions_search_by_category, and
  // transactions_search_by_month must NOT include off-budget account transactions.
  {
    console.log('\n[regression #81] off-budget filtering for filter/search_by_category/search_by_month');

    const onBudgetAcct  = { id: 'acct-on',  name: 'Checking',   offbudget: false };
    const offBudgetAcct = { id: 'acct-off', name: 'Investment', offbudget: true  };
    const onTxn  = { id: 'on1',  amount: -500,  category: 'cat-1', account: 'acct-on',  date: '2025-01-15' };
    const offTxn = { id: 'off1', amount: -1500, category: null,    account: 'acct-off', date: '2025-01-15' };

    adapterMod.default.getAccounts     = async () => [onBudgetAcct, offBudgetAcct];
    adapterMod.default.getTransactions = async () => [onTxn, offTxn];
    adapterMod.default.getCategories   = async () => [{ id: 'cat-1', name: 'Food' }];
    adapterMod.default.getPayees       = async () => [];

    const toolsToCheck = [
      { name: 'transactions_filter',             args: {},                        extract: r => r?.result ?? r?.transactions ?? [] },
      { name: 'transactions_search_by_category', args: { categoryName: 'Food' }, extract: r => r?.transactions ?? [] },
      { name: 'transactions_search_by_month',    args: { month: '2025-01' },     extract: r => r?.transactions ?? [] },
    ];

    for (const { name, args, extract } of toolsToCheck) {
      try {
        const mod  = toolsIndex[name];
        const tool = mod?.default ?? mod;
        const res  = await tool.call(args);
        const txns = extract(res);

        if (txns.some(t => t?.id === 'off1')) {
          console.error(`[regression #81] ${name}: off-budget transaction still included`);
          failures++;
        } else {
          console.log(`OK [regression #81] ${name}: off-budget transaction correctly excluded`);
        }

        if (!txns.some(t => t?.id === 'on1')) {
          console.error(`[regression #81] ${name}: on-budget transaction incorrectly excluded`);
          failures++;
        } else {
          console.log(`OK [regression #81] ${name}: on-budget transaction correctly included`);
        }
      } catch (e) {
        console.error(`[regression #81] ${name} unexpected error:`, e && e.message);
        failures++;
      }
    }

    // Restore stubs
    adapterMod.default.getAccounts     = async (..._args) => stubResponses.getAccounts;
    adapterMod.default.getTransactions = async (..._args) => stubResponses.getTransactions;
    adapterMod.default.getCategories   = async (..._args) => stubResponses.getCategories;
    adapterMod.default.getPayees       = async (..._args) => stubResponses.getPayees;
  }
  // ── End regression #81 ────────────────────────────────────────────────────

  // ── Batching regression test (issue #79) ─────────────────────────────────
  // actual_transactions_update_batch must dispatch a SINGLE adapter call for N
  // updates — not N separate calls. N separate calls each trigger a full
  // init/downloadBudget/sync/shutdown cycle, causing compounding timeouts.
  {
    console.log('\n[regression #79] transactions_update_batch: single adapter call for N updates');

    let batchCalls = 0;
    let singleCalls = 0;

    adapterMod.default.updateTransactionBatch = async (updates) => {
      batchCalls++;
      return { succeeded: updates.map(u => ({ id: u.id })), failed: [] };
    };
    adapterMod.default.updateTransaction = async () => {
      singleCalls++;
      return null;
    };

    try {
      const mod  = toolsIndex['transactions_update_batch'];
      const tool = mod?.default ?? mod;
      const res  = await tool.call({
        updates: [
          { id: 'txn-1', fields: { notes: 'a' } },
          { id: 'txn-2', fields: { notes: 'b' } },
          { id: 'txn-3', fields: { notes: 'c' } },
        ],
      });

      if (batchCalls !== 1) {
        console.error(`[regression #79] adapter.updateTransactionBatch called ${batchCalls}x — expected exactly 1`);
        failures++;
      } else {
        console.log('OK [regression #79] adapter.updateTransactionBatch called exactly once for 3 updates');
      }

      if (singleCalls !== 0) {
        console.error(`[regression #79] adapter.updateTransaction called ${singleCalls}x — batch tool must not use the single-update path`);
        failures++;
      } else {
        console.log('OK [regression #79] adapter.updateTransaction not invoked (batch path used correctly)');
      }

      if (res?.successCount !== 3) {
        console.error(`[regression #79] expected successCount=3, got ${res?.successCount}`);
        failures++;
      } else {
        console.log('OK [regression #79] successCount=3 correct for 3-item batch');
      }
    } catch (e) {
      console.error('[regression #79] unexpected error:', e && e.message);
      failures++;
    } finally {
      adapterMod.default.updateTransactionBatch = async (..._args) => stubResponses.updateTransactionBatch;
      adapterMod.default.updateTransaction      = async (..._args) => stubResponses.updateTransaction;
    }
  }
  // ── End regression #79 ───────────────────────────────────────────────────

  // restore adapter
  Object.assign(adapterMod.default, originalAdapter);

  if (failures > 0) {
    console.error(`${failures} tool(s) failed smoke tests`);
    process.exit(2);
  }

  console.log('All generated tool smoke tests passed');
  process.exit(0);
})();
