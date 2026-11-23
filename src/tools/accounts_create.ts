import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

export default createTool({
  name: 'actual_accounts_create',
  description:
    'Create a new account, on-budget unless offbudget is true. ' +
    'The optional balance (integer cents, negative for debt) is recorded as a Starting Balance transaction; on an off-budget account it has no category. ' +
    'Not idempotent: repeating the call creates another account; change an existing one with actual_accounts_update. Returns { result: <new account id> }.',
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
    balance: CommonSchemas.optionalAmountCents,
    // #767: upstream api/account-create already maps offbudget; it used to be stripped here.
    offbudget: CommonSchemas.offBudget,
  }),
  handler: async (input) => {
    const accountPayload = { name: input.name, balance: input.balance, offbudget: input.offbudget };
    return await adapter.createAccount(accountPayload, input.balance);
  },
  examples: [
    {
      description: 'Create a checking account with $1000 initial balance',
      input: { name: 'Checking', balance: 100000 },
    },
    {
      description: 'Create an off-budget mortgage account with a negative opening balance',
      input: { name: 'Mortgage', offbudget: true, balance: -25000000 },
    },
    {
      description: 'Create a savings account with no initial balance',
      input: { name: 'Savings' },
    },
  ],
});
