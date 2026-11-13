import { z } from 'zod';
import { CommonSchemas } from '../../lib/schemas/common.js';
import type { CompactActionRow, CompactToolSpec } from '../types.js';

/**
 * search_transactions (#673): the compact front for the seven transaction record lookups.
 * Selector `by` is required. Every action is read-only and none has a required field, exactly
 * like the legacy tools. Nothing here imports the adapter: the dispatcher reaches Actual only
 * through callOperation (#671).
 *
 * Mapping (#670 section 7): account -> actual_transactions_get, filter -> actual_transactions_filter,
 * amount -> actual_transactions_search_by_amount, category -> actual_transactions_search_by_category,
 * month -> actual_transactions_search_by_month, payee -> actual_transactions_search_by_payee,
 * uncategorized -> actual_transactions_uncategorized.
 *
 * Every schema below is built ONCE and shared by each row that uses it (the flat published
 * schema keeps a key typed only when every row shares the very same object). No schema carries
 * a default: legacy defaults are applied by the legacy tool. Unlike legacy transactions_filter,
 * no published field is nullable (it would double the published size of five keys). A null value
 * is still treated as an absent field (`nullAsAbsent`), because some clients send null for every
 * optional field they leave out; the legacy tool treats null and absent the same way. `limit` is
 * capped at 1000 on every row (legacy caps only uncategorized): a larger page helps no caller. The tool-size budget in
 * tests/unit/tools_list_size_budget.test.js is why descriptions here are terse.
 */

const accountId = z.string().min(1).describe('Account id from list_entities. Omit for all accounts.').optional();
const startDate = CommonSchemas.date.describe('First day, inclusive.').optional();
const endDate = CommonSchemas.date.describe('Last day, inclusive (uncategorized: default today).').optional();
const minAmount = z.number().int().describe('Smallest amount in cents; outflows negative.').optional();
const maxAmount = z.number().int().describe('Largest amount in cents; outflows negative.').optional();
const categoryName = z.string().min(1).describe('Category name, case-insensitive.').optional();
const payeeName = z.string().min(1).describe('Payee name, case-insensitive.').optional();
const limit = z.number().int().min(1).max(1000).describe('Maximum rows, up to 1000 (default 100; uncategorized 50).').optional();
const month = CommonSchemas.monthYear.describe('Month, YYYY-MM (default current).').optional();
const absoluteAmount = z.number().int().describe('Amount in cents, either sign; overrides min_amount and max_amount.').optional();
const categoryId = z.string().describe('Category id from list_entities.').optional();
const payeeId = z.string().describe('Payee id from list_entities.').optional();
const notes = z.string().describe('Notes substring, case-insensitive.').optional();
const cleared = z.boolean().describe('Only rows with this cleared status.').optional();
const reconciled = z.boolean().describe('Only rows with this reconciled status.').optional();
const includeTransactions = z.boolean().describe('true also returns the rows (default false: counts only).').optional();
const offset = z.number().int().min(0).describe('First row of the page (default 0).').optional();

/** Compact snake_case key to the legacy camelCase key. */
const camel = (keys: readonly string[]): Record<string, string> =>
  Object.fromEntries(keys.map((k) => [k, k.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())]));

const row = (legacy: string, shape: Record<string, z.ZodType>): CompactActionRow => ({
  legacy,
  fields: z.object(shape),
  rename: camel(Object.keys(shape)),
});

/**
 * The legacy amount search refuses a scan with no account and no date, but names its own
 * camelCase keys in that refusal. Refuse here first, in the compact tool's own field names.
 */
const bounded = (target: CompactActionRow): CompactActionRow => ({
  ...target,
  fields: target.fields.superRefine((value, ctx) => {
    const v = value as Record<string, unknown>;
    if (v.account_id === undefined && v.start_date === undefined && v.end_date === undefined) {
      ctx.addIssue({ code: 'custom', path: ['account_id'], message: 'by: amount needs at least one of account_id, start_date, end_date (an unbounded scan is refused)' });
    }
  }) as CompactActionRow['fields'],
});

export const searchTransactions: CompactToolSpec = {
  name: 'search_transactions',
  domain: 'Reading transactions',
  summary: 'Find transactions by date, account, category, payee or amount.',
  examplePrompt: 'Show my Costco purchases over $100 this year.',
  description:
    'Find transaction records (id, date, amount, payee, category, notes), not totals; pick one `by`. Read-only. ' +
    'For totals use summarize_transactions; for ids use list_entities; for a custom query use run_query. ' +
    'All fields optional; one the chosen `by` does not take is refused by name. Amounts are integer cents, outflows negative; dates YYYY-MM-DD. ' +
    'account: account_id, start_date, end_date. ' +
    'filter: account_id, start_date, end_date, min_amount, max_amount, category_id, payee_id, notes, cleared, reconciled (off-budget accounts excluded). ' +
    'amount: min_amount and max_amount, or absolute_amount, plus start_date, end_date, account_id, category_name, limit; needs account_id or a date. ' +
    'category: category_name, start_date, end_date, account_id, min_amount, max_amount, limit. ' +
    'month: month, account_id, category_name, payee_name, min_amount, max_amount, limit. ' +
    'payee: payee_name, start_date, end_date, account_id, category_name, min_amount, max_amount, limit. ' +
    'uncategorized: start_date, end_date, account_id, include_transactions, limit, offset. ' +
    'Returns { result: [transaction] } for account and filter; { transactions, count, totalAmount } for amount, category, month and payee (an unknown name gives an error field); ' +
    '{ totalCount, totalAmount, byAccount, dateRange } for uncategorized, plus transactions and hasMore with include_transactions.',
  selector: 'by',
  nullAsAbsent: true,
  actions: new Map<string, CompactActionRow>([
    ['account', row('actual_transactions_get', { account_id: accountId, start_date: startDate, end_date: endDate })],
    ['filter', row('actual_transactions_filter', {
      account_id: accountId,
      start_date: startDate,
      end_date: endDate,
      min_amount: minAmount,
      max_amount: maxAmount,
      category_id: categoryId,
      payee_id: payeeId,
      notes,
      cleared,
      reconciled,
    })],
    ['amount', bounded(row('actual_transactions_search_by_amount', {
      min_amount: minAmount,
      max_amount: maxAmount,
      absolute_amount: absoluteAmount,
      start_date: startDate,
      end_date: endDate,
      account_id: accountId,
      category_name: categoryName,
      limit,
    }))],
    ['category', row('actual_transactions_search_by_category', {
      category_name: categoryName,
      start_date: startDate,
      end_date: endDate,
      account_id: accountId,
      min_amount: minAmount,
      max_amount: maxAmount,
      limit,
    })],
    ['month', row('actual_transactions_search_by_month', {
      month,
      account_id: accountId,
      category_name: categoryName,
      payee_name: payeeName,
      min_amount: minAmount,
      max_amount: maxAmount,
      limit,
    })],
    ['payee', row('actual_transactions_search_by_payee', {
      payee_name: payeeName,
      start_date: startDate,
      end_date: endDate,
      account_id: accountId,
      category_name: categoryName,
      min_amount: minAmount,
      max_amount: maxAmount,
      limit,
    })],
    ['uncategorized', row('actual_transactions_uncategorized', {
      start_date: startDate,
      end_date: endDate,
      account_id: accountId,
      include_transactions: includeTransactions,
      limit,
      offset,
    })],
  ]),
};
