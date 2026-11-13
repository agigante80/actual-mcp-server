import type { CompactToolSpec } from './types.js';
import { getContext } from './tools/get_context.js';
import { listBudgetMonths } from './tools/list_budget_months.js';
import { listEntities } from './tools/list_entities.js';
import { runQuery } from './tools/run_query.js';
import { searchTransactions } from './tools/search_transactions.js';
import { summarizeTransactions } from './tools/summarize_transactions.js';

/**
 * Every compact tool this server can publish (#671). Each compact tool lands in its own
 * ticket (#672 onward) by appending one spec here. A compact tool is NOT in IMPLEMENTED_TOOLS
 * or src/tools/index.ts: the legacy registry stays 85 tools.
 */
export const COMPACT_TOOLS: readonly CompactToolSpec[] = [getContext, listEntities, searchTransactions, summarizeTransactions, listBudgetMonths, runQuery];
