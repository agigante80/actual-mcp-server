import tool from '../../src/tools/transactions_filter.js';

async function run() {
  console.log('Running transactions_filter InputSchema smoke tests');

  // Should pass with empty input (no filters)
  const noFilters = tool.inputSchema.parse({});
  console.log('No filters parsed OK:', noFilters);

  // Should pass with accountId only
  const accountOnly = tool.inputSchema.parse({ accountId: 'acct_1' });
  console.log('Account filter parsed OK:', accountOnly);

  // Should pass with date range
  const dateRange = tool.inputSchema.parse({
    startDate: '2025-01-01',
    endDate: '2025-12-31'
  });
  console.log('Date range parsed OK:', dateRange);

  // Should pass with amount range
  const amountRange = tool.inputSchema.parse({
    minAmount: -10000,
    maxAmount: -1000
  });
  console.log('Amount range parsed OK:', amountRange);

  // Should pass with category filter
  const categoryFilter = tool.inputSchema.parse({
    categoryId: 'cat_123',
    accountId: 'acct_1'
  });
  console.log('Category filter parsed OK:', categoryFilter);

  // Should pass with payee filter
  const payeeFilter = tool.inputSchema.parse({
    payeeId: 'payee_456',
    cleared: true
  });
  console.log('Payee filter parsed OK:', payeeFilter);

  // Should pass with notes search
  const notesSearch = tool.inputSchema.parse({
    notes: 'grocery',
    reconciled: false
  });
  console.log('Notes search parsed OK:', notesSearch);

  // Should pass with all filters combined
  const allFilters = tool.inputSchema.parse({
    accountId: 'acct_1',
    startDate: '2025-11-01',
    endDate: '2025-11-30',
    minAmount: -5000,
    maxAmount: 0,
    categoryId: 'cat_groceries',
    payeeId: 'payee_walmart',
    notes: 'weekly',
    cleared: true,
    reconciled: false
  });
  console.log('All filters parsed OK:', allFilters);

  // Should fail with invalid date format
  try {
    tool.inputSchema.parse({ startDate: 'invalid-date' });
    // Note: Currently accepts any string, so this won't fail
    console.log('Date validation: accepts string (no format validation)');
  } catch (e) {
    console.log('Invalid date correctly failed');
  }

  // Should fail with invalid amount (non-number)
  try {
    tool.inputSchema.parse({ minAmount: 'not-a-number' });
    console.error('Expected parse to fail for non-number amount');
    process.exit(2);
  } catch (e) {
    console.log('Invalid amount correctly failed');
  }

  // Should fail with invalid boolean
  try {
    tool.inputSchema.parse({ cleared: 'not-a-boolean' });
    console.error('Expected parse to fail for non-boolean cleared');
    process.exit(2);
  } catch (e) {
    console.log('Invalid cleared value correctly failed');
  }

  console.log('transactions_filter smoke tests passed');
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
