import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

export default createTool({
  name: 'actual_payees_create',
  description:
    'Create a new payee for transactions and rules to reference. Not idempotent: repeating the call creates another payee, so check actual_payees_get first. ' +
    'To rename or edit one use actual_payees_update; to combine duplicates use actual_payees_merge. Returns { result: <new payee id> }.',
  schema: z.object({ 
    name: CommonSchemas.name, 
    notes: CommonSchemas.notes 
  }),
  handler: async (input) => {
    return await adapter.createPayee(input);
  },
  examples: [
    {
      description: 'Create a payee for a grocery store',
      input: { name: 'Whole Foods' },
    },
    {
      description: 'Create a payee with notes',
      input: { name: 'Electric Company', notes: 'Monthly utility payment' },
    },
  ],
});
