import { z } from 'zod';

console.log('Loading transactions_create module...');

const inputSchema = z.object({
  accountId: z.string().optional(),
  amount: z.number().optional(),  
  description: z.string().optional(),
  date: z.string().optional()
});

const tool = {
  name: 'actual_transactions_create',
  description: "Create a transaction", 
  inputSchema,
  call: async (args: any) => {
    console.log('Transactions create call started');
    console.log('Args:', args);
    
    // Return immediately without any async operations
    return { result: 'test-success' };
  },
};

console.log('transactions_create module loaded, exporting tool');
export default tool;
