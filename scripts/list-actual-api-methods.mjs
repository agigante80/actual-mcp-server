import * as ActualApi from '@actual-app/api';

console.log('=== Available Actual API Methods ===\n');

const methods = Object.keys(ActualApi).filter(key => typeof ActualApi[key] === 'function');

console.log(`Found ${methods.length} methods:\n`);

methods.sort().forEach((method, index) => {
  console.log(`${(index + 1).toString().padStart(3)}. ${method}`);
});

console.log('\n=== Comparison with MCP Tools ===\n');

// List of implemented MCP tools based on current tool files (synchronized with actualToolsManager.ts)
const implementedTools = [
  'actual_accounts_close',
  'actual_accounts_create',
  'actual_accounts_delete',
  'actual_accounts_get_balance',
  'actual_accounts_list',
  'actual_accounts_reopen',
  'actual_accounts_update',
  'actual_budgets_getMonth',
  'actual_budgets_getMonths',
  'actual_budgets_setAmount',
  'actual_budgets_setCarryover',
  'actual_categories_create',
  'actual_categories_delete',
  'actual_categories_get',
  'actual_categories_update',
  'actual_category_groups_create',
  'actual_category_groups_delete',
  'actual_category_groups_get',
  'actual_category_groups_update',
  'actual_payees_create',
  'actual_payees_delete',
  'actual_payees_get',
  'actual_payees_update',
  'actual_rules_create',
  'actual_rules_delete',
  'actual_rules_get',
  'actual_rules_update',
  'actual_transactions_create',
  'actual_transactions_delete',
  'actual_transactions_get',
  'actual_transactions_import',
  'actual_transactions_update',
];

// Mapping from the actualToolsManager.ts (synchronized)
const apiToolMap = {
  'getAccounts': 'actual_accounts_list',
  'createAccount': 'actual_accounts_create',
  'updateAccount': 'actual_accounts_update',
  'deleteAccount': 'actual_accounts_delete',
  'getAccountBalance': 'actual_accounts_get_balance',
  'getTransactions': 'actual_transactions_get',
  'addTransactions': 'actual_transactions_create',
  'importTransactions': 'actual_transactions_import',
  'updateTransaction': 'actual_transactions_update',
  'deleteTransaction': 'actual_transactions_delete',
  'getBudgetMonths': 'actual_budgets_getMonths',
  'getBudgetMonth': 'actual_budgets_getMonth',
  'setBudgetAmount': 'actual_budgets_setAmount',
  'setBudgetCarryover': 'actual_budgets_setCarryover',
  'getCategories': 'actual_categories_get',
  'createCategory': 'actual_categories_create',
  'updateCategory': 'actual_categories_update',
  'deleteCategory': 'actual_categories_delete',
  'getPayees': 'actual_payees_get',
  'createPayee': 'actual_payees_create',
  'updatePayee': 'actual_payees_update',
  'deletePayee': 'actual_payees_delete',
  'getRules': 'actual_rules_get',
  'createRule': 'actual_rules_create',
  'updateRule': 'actual_rules_update',
  'deleteRule': 'actual_rules_delete',
  'closeAccount': 'actual_accounts_close',
  'reopenAccount': 'actual_accounts_reopen',
  'getCategoryGroups': 'actual_category_groups_get',
  'createCategoryGroup': 'actual_category_groups_create',
  'updateCategoryGroup': 'actual_category_groups_update',
  'deleteCategoryGroup': 'actual_category_groups_delete',
};

console.log('✅ Implemented Tools:');
implementedTools.forEach(tool => console.log(`   - ${tool}`));

console.log('\n🔍 API Methods Mapped but NOT Implemented:');
const notImplemented = Object.entries(apiToolMap)
  .filter(([apiMethod, toolName]) => 
    methods.includes(apiMethod) && !implementedTools.includes(toolName)
  )
  .map(([apiMethod, toolName]) => ({ apiMethod, toolName }));

notImplemented.forEach(({ apiMethod, toolName }) => {
  console.log(`   - ${apiMethod} → ${toolName}`);
});

console.log('\n📋 API Methods Available but NOT Mapped:');
const unmapped = methods.filter(method => !Object.keys(apiToolMap).includes(method));
unmapped.forEach(method => console.log(`   - ${method}`));

console.log(`\n📊 Summary:`);
console.log(`   Total API Methods: ${methods.length}`);
console.log(`   Implemented MCP Tools: ${implementedTools.length}`);
console.log(`   Mapped but Not Implemented: ${notImplemented.length}`);
console.log(`   Unmapped API Methods: ${unmapped.length}`);
