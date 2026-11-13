import { z } from 'zod';
import type { CompactToolSpec } from '../types.js';

/**
 * run_query (#674): the compact front for the read-only SQL escape hatch. No selector
 * (`selector: null`), one field. The query goes to actual_query_run untouched; its own
 * checks (GraphQL rejection, validateQueryShape, validateQuery) stay the enforcement point,
 * and their refusals name this tool because the dispatcher rewrites the legacy name (4b).
 * Nothing here imports the adapter.
 *
 * `query` has no .max(): the legacy tool has none either (HTTP is bounded by
 * MCP_HTTP_BODY_LIMIT), and a compact cap would be a second, drifting limit.
 */

const query = z.string().min(1).describe('The read-only SQL query to run, for example SELECT id, name FROM accounts.');

export const runQuery: CompactToolSpec = {
  name: 'run_query',
  domain: 'Querying',
  summary: 'Run a read-only SQL query against the budget data when no other read tool fits.',
  examplePrompt: 'Run a query that lists my ten largest payees by total spend.',
  description:
    'Run a read-only SQL query against the budget data; the escape hatch when search_transactions, summarize_transactions, list_entities and list_budget_months do not fit (prefer them when they do). ' +
    'A bare table name (e.g. "transactions") returns all its records. ' +
    'Form: SELECT [fields] FROM [table] WHERE [conditions] ORDER BY [field] DESC LIMIT [n]. ' +
    'Example: "SELECT id, date, amount, payee.name FROM transactions WHERE amount < 0 ORDER BY date DESC LIMIT 10". ' +
    'WHERE supports =, !=, >, >=, <, <=; IN (v1, v2); LIKE / NOT LIKE (case and accent-insensitive, % wildcard, e.g. imported_payee LIKE \'%amazon%\'); IS NULL / IS NOT NULL; ' +
    'boolean columns as true / false (cleared = false, category.hidden = true); conditions joined with AND. ' +
    'OR, REGEXP, NOT IN and parenthesised groups are not supported and return an error (a query is never silently run unfiltered). ' +
    'Writes, stacked statements and comments are refused. ' +
    'Transactions come back in split-inline mode: "is_parent = true" returns nothing, use "is_parent = false" to exclude split children. ' +
    'Joins use dot notation: payee.name, category.name, account.name (NOT payee_name). Amounts are in cents: $100.00 = 10000. Dates are quoted YYYY-MM-DD strings: date >= \'2025-01-01\'. ' +
    'Read-only: it never changes data. Returns { result: rows }; an empty result may carry a "hint" naming a category.name, payee.name or account.name value that matches no entity, with the query that lists the exact names. ' +
    'Tables: transactions (id, date, amount, notes, cleared, account, payee, category); accounts (id, name, type, closed, offbudget); ' +
    'categories (id, name, group, is_income); payees (id, name); category_groups (id, name, is_income).',
  selector: null,
  defaultAction: 'run',
  actions: new Map([['run', { legacy: 'actual_query_run', fields: z.object({ query }) }]]),
};
