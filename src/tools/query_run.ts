import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  query: z.string().min(1).describe('ActualQL query string to execute'),
});

type Output = unknown;

const tool: ToolDefinition = {
  name: 'actual_query_run',
  description: `Execute ActualQL queries for advanced financial data analysis.

Supported Query Formats:
1. ActualQL (Native): Use the q() builder syntax
   Example: q('transactions').filter({ 'category.name': 'Food' }).select(['id', 'date', 'amount'])

2. GraphQL-like: query Name { table(args) { fields } }
   Example: query RecentTx { transactions(startDate: "2025-01-01", endDate: "2025-12-31") { id date amount payee_name category { name } } }

3. SQL-like: SELECT fields FROM table WHERE conditions ORDER BY field LIMIT n
   Example: SELECT * FROM transactions WHERE date >= "2025-01-01" ORDER BY date DESC LIMIT 50

4. Simple table name: Returns all records from the table
   Example: accounts

Available Tables:
- transactions: Financial transactions with fields: id, date, amount, payee_name, notes, cleared, account, payee, category
- accounts: Bank accounts with fields: id, name, type, closed, offbudget
- categories: Budget categories with fields: id, name, group_id, is_income
- payees: Transaction payees with fields: id, name, category, transfer_acct
- category_groups: Category groups with fields: id, name, is_income
- schedules: Scheduled transactions
- rules: Automation rules

Filtering Examples:
- Date ranges: date >= "2025-01-01" AND date <= "2025-12-31"
- Category: category.name = "Food"
- Amount: amount > 10000 (amounts are in cents, e.g., $100 = 10000)
- Multiple conditions: Use AND to combine

Joining: Use dot notation to access related tables (e.g., category.name, payee.name, account.name)

For more details: https://actualbudget.org/docs/api/actual-ql/`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    try {
      const input = InputSchema.parse(args || {});
      const result = await adapter.runQuery(input.query);
      return { result };
    } catch (error: any) {
      // Provide helpful error messages
      const errorMessage = error?.message || String(error);
      
      if (errorMessage.includes('does not exist in the schema')) {
        throw new Error(`Invalid table or field name. Available tables: transactions, accounts, categories, payees, category_groups, schedules, rules. Use dot notation for joins (e.g., category.name). Original error: ${errorMessage}`);
      } else if (errorMessage.includes('ActualQL query builder not available')) {
        throw new Error('ActualQL query builder is not available. The Actual Budget API may not be properly initialized.');
      } else if (errorMessage.includes('parse') || errorMessage.includes('syntax')) {
        throw new Error(`Query syntax error: ${errorMessage}\n\nSupported formats:\n1. GraphQL: query Name { table(args) { fields } }\n2. SQL: SELECT fields FROM table WHERE conditions\n3. Table name: transactions\n\nSee tool description for examples.`);
      } else {
        throw new Error(`Query execution failed: ${errorMessage}`);
      }
    }
  },
};

export default tool;
