import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

const positiveAmountCents = z
  .number()
  .int('Amount must be an integer (cents)')
  .positive('Amount must be a positive integer in cents (e.g. 5000 = $50.00)');

export default createTool({
  name: 'actual_transfers_create',
  description:
    'Create a paired transfer between two accounts — a debit on the source account and a credit ' +
    'on the destination account, linked by a shared transfer_id. Identical to the Actual Budget UI ' +
    '"Make Transfer" result. Amount must be a positive integer in cents (e.g. 5000 = $50.00). ' +
    'Both accounts must be open. Use actual_accounts_list to look up account UUIDs. ' +
    'Note: if both accounts are bank-synced via GoCardless, a duplicate may appear after the next ' +
    'sync if the bank settles the two sides on different dates.',
  schema: z.object({
    from_account: CommonSchemas.accountId.describe('UUID of the source account (money leaves this account)'),
    to_account:   CommonSchemas.accountId.describe('UUID of the destination account (money enters this account)'),
    amount: positiveAmountCents,
    date:   CommonSchemas.date,
    notes:  z.string().max(1000).optional().describe('Optional memo visible on both sides of the transfer'),
  }),
  handler: async (input) => adapter.createTransfer(input),
  examples: [
    {
      description: 'Transfer $50.00 from Checking to Credit Card',
      input: { from_account: 'uuid-checking', to_account: 'uuid-cc', amount: 5000, date: '2024-01-15' },
    },
  ],
});
