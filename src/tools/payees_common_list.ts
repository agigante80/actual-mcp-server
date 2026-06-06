import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';

export default createTool({
  name: 'actual_payees_common_list',
  description:
    'Return the most frequently used payees from recent transaction history (last ~12 weeks, top 10, ' +
    'non-transfer payees only). ' +
    'Distinct from actual_payees_get, which lists ALL payees with no recency or frequency filter. ' +
    'An empty list is a normal, successful result: it means no non-transfer payees appear in recent ' +
    'transactions, not that an error occurred. ' +
    'Each item has the shape { id, name, transfer_acct? }.',
  schema: z.object({}),
  handler: async () => {
    return await adapter.getCommonPayees();
  },
  examples: [
    { description: 'List recently frequent payees', input: {} },
  ],
});
