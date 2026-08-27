import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

export default createTool({
  name: 'actual_accounts_create',
  description: 'Create a new account in Actual Budget',
  schema: z.object({ 
    // #380: optional, but a caller-supplied primary key must still be a real id when
    // present. Actual mints UUIDs, so anything else would create a row no listing tool
    // could later resolve by the id the caller thinks it has.
    id: CommonSchemas.accountId.optional(),
    
    name: CommonSchemas.name, 
    balance: CommonSchemas.optionalAmountCents 
  }),
  handler: async (input) => {
    const accountPayload = { id: input.id, name: input.name, balance: input.balance };
    return await adapter.createAccount(accountPayload, input.balance);
  },
  examples: [
    {
      description: 'Create a checking account with $1000 initial balance',
      input: { name: 'Checking', balance: 100000 },
    },
    {
      description: 'Create a savings account with no initial balance',
      input: { name: 'Savings' },
    },
  ],
});
