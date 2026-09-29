import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

/**
 * actual_transactions_split (#489)
 *
 * Split an existing plain transaction into subtransactions. Replaces the original transaction
 * with a split parent transaction, preserving account, date, total amount, and bank-sync /
 * reconciliation fields (imported_id, imported_payee, cleared, reconciled).
 *
 * Child amounts (in integer cents) must sum to the original transaction amount.
 *
 * Destructive (removes the original transaction row).
 */
const schema = z.object({
  id: CommonSchemas.transactionId.describe('ID of the existing plain transaction to split.'),
  subtransactions: CommonSchemas.subtransactions
    .min(2, 'A split requires at least two subtransactions')
    .describe(
      'Split children; child amounts (integer cents) must sum to the original transaction amount. Put categories on the children.',
    ),
});

export default createTool<z.input<typeof schema>>({
  name: 'actual_transactions_split',
  description:
    'Split an existing plain transaction into subtransactions. Replaces the original transaction with a split parent transaction ' +
    'preserving account, date, total amount, and bank-sync/reconciliation fields (imported_id, imported_payee, cleared, reconciled). ' +
    'Child amounts must sum to the original transaction amount. Destructive.',
  schema,
  handler: async (input) => {
    return await adapter.splitTransaction(input);
  },
  examples: [
    {
      description: 'Split a -5000 grocery store receipt into groceries and household categories',
      input: {
        id: '00000000-0000-0000-0000-000000000001',
        subtransactions: [
          { amount: -3500, notes: 'Groceries' },
          { amount: -1500, notes: 'Household supplies' },
        ],
      },
    },
  ],
});
