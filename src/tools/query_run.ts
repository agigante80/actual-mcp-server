import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { validateQueryShape } from '../lib/query-validator.js';

const InputSchema = z.object({
  query: z.string().min(1).describe('ActualQL query string to execute'),
});


const tool: ToolDefinition = {
  name: 'actual_query_run',
  description: `Run a read-only SQL query against the budget data. Prefer SQL; a bare table name (e.g. "transactions") returns all its records.

Form: SELECT [fields] FROM [table] WHERE [conditions] ORDER BY [field] DESC LIMIT [n]
Example: "SELECT id, date, amount, payee.name FROM transactions WHERE amount < 0 ORDER BY date DESC LIMIT 10"

WHERE supports: =, !=, >, >=, <, <=; IN (v1, v2); LIKE / NOT LIKE (case and accent-insensitive, % wildcard, e.g. imported_payee LIKE '%amazon%'); IS NULL / IS NOT NULL; boolean columns as true / false (cleared = false, category.hidden = true); conditions joined with AND. OR, REGEXP, NOT IN and parenthesised groups are not supported and return an error (a query is never silently run unfiltered). Transactions come back in split-INLINE mode: "is_parent = true" returns nothing, use "is_parent = false" to exclude split children.

Joins use dot notation: payee.name, category.name, account.name (NOT payee_name). Amounts are in cents: $100.00 = 10000.

Tables:
- transactions: id, date, amount, notes, cleared, account, payee, category
- accounts: id, name, type, closed, offbudget
- categories: id, name, group, is_income
- payees: id, name
- category_groups: id, name, is_income`,
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    try {
      const input = InputSchema.parse(args || {});
      
      // Detect and reject GraphQL-like syntax with nested objects
      if (input.query.trim().startsWith('query ') && input.query.includes('{') && input.query.includes('}')) {
        throw new Error(`GraphQL syntax is not fully supported. Please use SQL instead.\n\nExample: SELECT id, date, amount, payee.name, category.name FROM transactions ORDER BY date DESC LIMIT 5\n\nYour query attempted: ${input.query.substring(0, 100)}...`);
      }

      // Read-only shape gate (#162): reject writes / schema changes / stacked
      // statements before the query reaches the q() builder. Throws on violation.
      validateQueryShape(input.query);

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
