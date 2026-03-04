import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { notFoundMsg } from '../lib/errors.js';

const InputSchema = z.object({ month: z.string().min(1), categoryId: z.string().min(1), amount: z.number() });

const tool: ToolDefinition = {
  name: 'actual_budgets_setAmount',
  description: "Set the budgeted amount for a specific category in a given month. Amount in cents (e.g., 50000 = $500). Use this to allocate money to spending categories for budget planning.",
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // Pre-flight: verify category exists (BUG-6)
    const categories = await adapter.getCategories();
    const category = (categories as any[]).find((c: any) => c.id === input.categoryId);
    if (!category) {
      return {
        error: notFoundMsg('Category', input.categoryId, 'actual_categories_get'),
        result: null,
      };
    }
    const result = await adapter.setBudgetAmount(input.month, input.categoryId, input.amount);
    return { result, categoryName: category.name };
  },
};

export default tool;
