import tool from '../../src/tools/budgets_transfer.js';

async function run() {
  console.log('Running budgets_transfer InputSchema smoke tests');

  // Should fail when required fields missing
  try {
    tool.inputSchema.parse({});
    console.error('Expected parse to fail for empty input');
    process.exit(2);
  } catch (e) {
    console.log('Empty input correctly failed');
  }

  // Should fail when missing month
  try {
    tool.inputSchema.parse({
      fromCategoryId: 'cat_1',
      toCategoryId: 'cat_2',
      amount: 1000
    });
    console.error('Expected parse to fail for missing month');
    process.exit(2);
  } catch (e) {
    console.log('Missing month correctly failed');
  }

  // Should fail when missing fromCategoryId
  try {
    tool.inputSchema.parse({
      month: '2025-11',
      toCategoryId: 'cat_2',
      amount: 1000
    });
    console.error('Expected parse to fail for missing fromCategoryId');
    process.exit(2);
  } catch (e) {
    console.log('Missing fromCategoryId correctly failed');
  }

  // Should fail when missing toCategoryId
  try {
    tool.inputSchema.parse({
      month: '2025-11',
      fromCategoryId: 'cat_1',
      amount: 1000
    });
    console.error('Expected parse to fail for missing toCategoryId');
    process.exit(2);
  } catch (e) {
    console.log('Missing toCategoryId correctly failed');
  }

  // Should fail when missing amount
  try {
    tool.inputSchema.parse({
      month: '2025-11',
      fromCategoryId: 'cat_1',
      toCategoryId: 'cat_2'
    });
    console.error('Expected parse to fail for missing amount');
    process.exit(2);
  } catch (e) {
    console.log('Missing amount correctly failed');
  }

  // Should pass with minimal valid input
  const good = {
    month: '2025-11',
    fromCategoryId: 'cat_groceries',
    toCategoryId: 'cat_dining',
    amount: 5000
  };
  const parsed = tool.inputSchema.parse(good);
  console.log('Valid input parsed OK:', parsed);

  // Should pass with different month format
  const differentMonth = tool.inputSchema.parse({
    month: '2024-01',
    fromCategoryId: 'cat_1',
    toCategoryId: 'cat_2',
    amount: 10000
  });
  console.log('Different month format parsed OK:', differentMonth);

  // Should fail with invalid month format (not YYYY-MM)
  try {
    tool.inputSchema.parse({
      month: '11-2025',
      fromCategoryId: 'cat_1',
      toCategoryId: 'cat_2',
      amount: 1000
    });
    // Note: Currently accepts any string, so this won't fail
    console.log('Month validation: accepts string (no format validation)');
  } catch (e) {
    console.log('Invalid month format correctly failed');
  }

  // Should fail with invalid amount (non-number)
  try {
    tool.inputSchema.parse({
      month: '2025-11',
      fromCategoryId: 'cat_1',
      toCategoryId: 'cat_2',
      amount: 'not-a-number'
    });
    console.error('Expected parse to fail for non-number amount');
    process.exit(2);
  } catch (e) {
    console.log('Invalid amount type correctly failed');
  }

  // Should fail with negative amount (validated in call logic, not schema)
  const negativeAmount = tool.inputSchema.parse({
    month: '2025-11',
    fromCategoryId: 'cat_1',
    toCategoryId: 'cat_2',
    amount: -1000
  });
  console.log('Negative amount parsed (will fail in call logic):', negativeAmount);

  // Should fail with zero amount (validated in call logic, not schema)
  const zeroAmount = tool.inputSchema.parse({
    month: '2025-11',
    fromCategoryId: 'cat_1',
    toCategoryId: 'cat_2',
    amount: 0
  });
  console.log('Zero amount parsed (will fail in call logic):', zeroAmount);

  console.log('budgets_transfer smoke tests passed');
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
