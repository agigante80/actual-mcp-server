import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { CommonSchemas } from '../lib/schemas/common.js';
import adapter from '../lib/actual-adapter.js';

export default createTool({
  name: 'actual_payees_create',
  description: 'Create a new payee in Actual Budget',
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
