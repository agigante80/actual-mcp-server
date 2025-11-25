import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({
  account: CommonSchemas.accountId,
  date: CommonSchemas.date,
  amount: CommonSchemas.amountCents,
  payee: CommonSchemas.payeeId.optional(),
  payee_name: z.string().optional().describe('Payee name (alternative to payee ID)'),
  notes: CommonSchemas.notes,
  category: CommonSchemas.categoryId.optional(),
  cleared: CommonSchemas.cleared,
  imported_id: z.string().optional().describe('Original imported transaction ID'),
});

type Output = { id: string };

const tool: ToolDefinition = {
  name: 'actual_transactions_create',
  description: 'Create a new transaction in Actual Budget. Amount should be in cents (negative for expenses, positive for income).',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    try {
      // Use addTransactions - it reliably creates transactions
      // Note: API returns "ok" string instead of ID, which is a known Actual API behavior
      const result = await adapter.addTransactions(input as any);
      
      if (!result || result.length === 0) {
        throw new Error('Failed to create transaction - no result returned');
      }
      
      // If API returns actual ID (starts with UUID pattern), return it
      if (result[0] && result[0] !== 'ok' && result[0].length > 10) {
        return { id: result[0] };
      }
      
      // API returned "ok" - transaction was created successfully
      // Return success without ID (test will need to handle this)
      return { success: true, message: 'Transaction created successfully' };
    } catch (error) {
      throw new Error(`Failed to create transaction: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

export default tool;
