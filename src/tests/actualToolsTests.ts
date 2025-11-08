// src/tests/actualToolsTests.ts
import logger from '../logger.js';
import actualToolsManager from '../actualToolsManager.js';

// Test data mapping for each tool
const getTestArgs = (toolName: string): unknown => {
  switch (toolName) {
    case 'actual.accounts.create':
      return { name: 'Test Account', balance: 1000 };
    case 'actual.accounts.update':
      return { id: 'test-account-id', fields: { name: 'Updated Test Account' } };
    case 'actual.accounts.get.balance':
      return { id: 'test-account-id' };
    case 'actual.transactions.create':
      return { accountId: 'test-account-id', amount: 100, payee: 'Test Payee', date: '2025-11-08' };
    case 'actual.transactions.get':
      return { accountId: 'test-account-id', startDate: '2025-11-01', endDate: '2025-11-08' };
    case 'actual.transactions.import':
      return { accountId: 'test-account-id', txs: [{ amount: 50, payee: 'Import Test', date: '2025-11-08' }] };
    case 'actual.categories.create':
      return { name: 'Test Category' };
    case 'actual.payees.create':
      return { name: 'Test Payee' };
    case 'actual.budgets.setAmount':
      return { month: '2025-11', categoryId: 'test-category-id', amount: 500 };
    case 'actual.budgets.getMonth':
      return { month: '2025-11' };
    // These tools don't require parameters
    case 'actual.accounts.list':
    case 'actual.categories.get':
    case 'actual.payees.get':
    case 'actual.budgets.getMonths':
    default:
      return {};
  }
};

export async function testAllTools() {
  await actualToolsManager.initialize();

  const toolNames = actualToolsManager.getToolNames();
  const results: { name: string; success: boolean; error?: string }[] = [];

  for (const name of toolNames) {
    try {
      logger.info(`⚙️  Testing tool: ${name}`);
      const testArgs = getTestArgs(name);
      const result = await actualToolsManager.callTool(name, testArgs);
      logger.info(`✅ Tool ${name} output: ${JSON.stringify(result, null, 2)}`);
      results.push({ name, success: true });
    } catch (err: unknown) {
      const message = err && typeof (err as { message?: unknown })?.message === 'string' ? (err as { message: string }).message : String(err);
      logger.error(`❌ Tool ${name} test failed: ${message}`);
      results.push({ name, success: false, error: message });
    }
  }

  // Summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  logger.info(`\n📊 Test Summary: ${successful} passed, ${failed} failed`);
  
  if (failed > 0) {
    logger.error(`❌ Failed tools:`);
    results.filter(r => !r.success).forEach(r => {
      logger.error(`  - ${r.name}: ${r.error}`);
    });
    throw new Error(`${failed} tool tests failed`);
  } else {
    logger.info(`🎉 All ${successful} tools passed!`);
  }
}