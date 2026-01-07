import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  query: z.string().min(1).describe('ActualQL query string to execute'),
});

type Output = unknown;

const tool: ToolDefinition = {
  name: 'actual_query_run',
  description: `Execute SQL queries for advanced financial data analysis.

**RECOMMENDED: Use SQL syntax** - Most reliable and well-tested format.

SQL SYNTAX (Preferred):
  SELECT [fields] FROM [table] WHERE [conditions] ORDER BY [field] DESC LIMIT [n]
  
  Examples:
  • "SELECT * FROM transactions ORDER BY date DESC LIMIT 5"
  • "SELECT id, date, amount, payee.name FROM transactions WHERE amount < 0 LIMIT 10"
  • "SELECT id, date, amount, category.name FROM transactions WHERE date >= '2025-01-01'"

IMPORTANT - Field Names:
  • Use payee.name (NOT payee_name) for payee names
  • Use category.name (NOT category_name) for category names
  • Use account.name (NOT account_name) for account names
  • Amounts are in cents: $100.00 = 10000

Available Tables:
  • transactions: id, date, amount, notes, cleared, account, payee, category
    - Join with: payee.name, category.name, account.name
  • accounts: id, name, type, closed, offbudget
  • categories: id, name, group, is_income
  • payees: id, name
  • category_groups: id, name, is_income

Common Queries:
  • Last 5 transactions: "SELECT * FROM transactions ORDER BY date DESC LIMIT 5"
  • By category: "SELECT id, date, amount, payee.name FROM transactions WHERE category.name = 'Food' LIMIT 10"
  • Expenses: "SELECT id, date, amount, payee.name FROM transactions WHERE amount < 0 ORDER BY date DESC LIMIT 10"
  • Date range: "SELECT * FROM transactions WHERE date >= '2025-01-01' AND date <= '2025-12-31'"

Alternative Formats:
  • Simple table name: "transactions" (returns all records)
  • ActualQL objects: Not recommended, use SQL instead

For details: https://actualbudget.org/docs/api/actual-ql/`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    try {
      const input = InputSchema.parse(args || {});
      
      // Detect and reject GraphQL-like syntax with nested objects
      if (input.query.trim().startsWith('query ') && input.query.includes('{') && input.query.includes('}')) {
        throw new Error(`GraphQL syntax is not fully supported. Please use SQL instead.\n\nExample: SELECT id, date, amount, payee.name, category.name FROM transactions ORDER BY date DESC LIMIT 5\n\nYour query attempted: ${input.query.substring(0, 100)}...`);
      }
      
      const result = await adapter.runQuery(input.query);
      return { result };
    } catch (error: any) {
      // Provide helpful error messages
      const errorMessage = error?.message || String(error);
      
      // Check if error is about payee_name, category_name, account_name
      if (errorMessage.includes('payee_name') || errorMessage.includes('category_name') || errorMessage.includes('account_name')) {
        throw new Error(`Field name error: Use dot notation for joins.\n• Use payee.name (NOT payee_name)\n• Use category.name (NOT category_name)\n• Use account.name (NOT account_name)\n\nExample: SELECT id, date, amount, payee.name FROM transactions LIMIT 5\n\nOriginal error: ${errorMessage}`);
      }
      
      if (errorMessage.includes('does not exist in the schema')) {
        throw new Error(`Invalid table or field name. Available tables: transactions, accounts, categories, payees, category_groups, schedules, rules. Use dot notation for joins (e.g., category.name). Original error: ${errorMessage}`);
      } else if (errorMessage.includes('ActualQL query builder not available')) {
        throw new Error('ActualQL query builder is not available. The Actual Budget API may not be properly initialized.');
      } else if (errorMessage.includes('parse') || errorMessage.includes('syntax')) {
        throw new Error(`Query syntax error: ${errorMessage}\n\nRecommended: Use SQL syntax\nExample: SELECT * FROM transactions ORDER BY date DESC LIMIT 5\n\nSee tool description for more examples.`);
      } else {
        throw new Error(`Query execution failed: ${errorMessage}`);
      }
    }
  },
};

export default tool;
