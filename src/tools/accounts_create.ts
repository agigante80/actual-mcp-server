import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

export default createTool({
  name: 'actual_accounts_create',
  description: 'Create a new account in Actual Budget',
  schema: z.object({ 
    // #380: the `id` field was REMOVED rather than tightened. Upstream ignores it:
    // `handlers['api/account-create']` destructures only name, offbudget, closed and the
    // balance, so `insertWithUUID` always mints a fresh UUID (verified against the
    // @actual-app/api source shipped in dist/index.js.map). A caller who supplied an id got
    // `{ success: true }` and an account with a DIFFERENT id, then a not-found from
    // actual_accounts_get_balance. That is the same success-lie family as #350, so
    // publishing the field at all was the defect; typing it would only have made an
    // unusable field look deliberate.
    name: CommonSchemas.name, 
    balance: CommonSchemas.optionalAmountCents 
  }),
  handler: async (input) => {
    const accountPayload = { name: input.name, balance: input.balance };
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
