import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import { localIsoDate } from '../lib/localDate.js';
import adapter from '../lib/actual-adapter.js';
import { CommonSchemas } from '../lib/schemas/common.js';

const InputSchema = z.object({
  startDate: CommonSchemas.date.optional().describe('Start date in YYYY-MM-DD format (default: first day of current month)'),
  endDate: CommonSchemas.date.optional().describe('End date in YYYY-MM-DD format (default: today)'),
  accountId: z.string().optional().describe('Optional: Filter by specific account ID'),
  limit: z.number().int().min(1).optional().default(50).describe('Optional: Maximum number of payees to return (default: 50)'),
});

const tool: ToolDefinition = {
  name: 'actual_transactions_summary_by_payee',
  description: 'Get spending summary grouped by payee using ActualQL aggregation. Returns total amount and transaction count per payee for a date range. Useful for identifying top vendors and analyzing merchant spending patterns. Results are ordered largest spending first (refunds and income last); limit keeps the top and totalAmount is the sum of the returned rows.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    
    // #388: this filter silently returned an EMPTY result set when given an account NAME, a
    // plausible-looking wrong answer. A well-formed id reads no listing, so a correct call is
    // unchanged.
    if (input.accountId) await adapter.resolveFilterId('account', input.accountId);

    // Build ActualQL query with groupBy and aggregation
    const api = await import('@actual-app/api');
    const q = (api as any).q;
    
    // Default to the current month to date, as LOCAL calendar days (localIsoDate says why).
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startDate = input.startDate || localIsoDate(firstDayOfMonth);
    const endDate = input.endDate || localIsoDate(today);
    
    // Start with date filter
    let query = q('transactions').filter({
      $and: [
        { date: { $gte: startDate } },
        { date: { $lte: endDate } }
      ]
    });
    
    // #685: accountId was validated above and never applied, so totals covered every account.
    if (input.accountId) {
      query = query.filter({ account: input.accountId });
    }

    // Group by payee and calculate sum. #686: no limit here. A limit on the grouped query has
    // no ordering, so it kept an arbitrary subset of payees; the cap is applied after the sort.
    query = query
      .groupBy('payee.name')
      .select([
        'payee.name',
        { totalAmount: { $sum: '$amount' } },
        { transactionCount: { $count: '*' } }
      ]);
    
    const rawResult = await adapter.runQuery(query);
    // @actual-app/api runQuery returns { data: [...] } — unwrap if needed
    const result = Array.isArray(rawResult) ? rawResult : (rawResult as any)?.data;

    // Ensure result is an array
    if (!result || !Array.isArray(result)) {
      return {
        summary: [],
        totalAmount: 0,
        dateRange: {
          startDate,
          endDate,
        },
      };
    }
    
    const summary = result
      .map((row: any) => ({
        payeeName: row['payee.name'] || 'Unknown',
        totalAmount: row.totalAmount || 0,
        transactionCount: row.transactionCount || 0,
      }))
      // #686: largest spending first. Amounts are signed cents and spending is negative, so
      // ascending puts the biggest outflow first; descending ranked refunds above rent.
      // Equal totals fall back to the payee name, so the rows the limit keeps are stable.
      .sort((a, b) => a.totalAmount - b.totalAmount || String(a.payeeName).localeCompare(String(b.payeeName)))
      // The schema refuses a limit below 1: slice(0, -3) would silently drop the last three rows.
      .slice(0, input.limit);
    
    // Calculate grand total
    const totalAmount = summary.reduce((sum, item) => sum + item.totalAmount, 0);
    
    return {
      summary,
      totalAmount,
      dateRange: {
        startDate,
        endDate,
      },
    };
  },
};

export default tool;
