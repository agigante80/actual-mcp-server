// src/actualToolsManager.ts
import * as ActualApi from '@actual-app/api';
import logger from './logger.js';
import { z } from 'zod';

import type { ZodTypeAny } from 'zod';
import type { ToolDefinition } from '../types/tool.d.js';

// ✅ List of tools already implemented in this class.
// Adding the tool name here is considered fully implemented.
const IMPLEMENTED_TOOLS = [
  'get_accounts', 
  'get_account_balance',
];

// 🔑 Mapping of Actual API function names → your MCP tool names
// This allows us to compare what exists in the API vs. what it has been wrapped.
const API_TOOL_MAP: Record<string, string> = {
  getAccounts: 'get_accounts',
  createAccount: 'create_account',
  updateAccount: 'update_account',
  deleteAccount: 'delete_account',
  getAccountBalance: 'get_account_balance',
  getTransactions: 'get_transactions',
  addTransactions: 'add_transactions',
  updateTransaction: 'update_transaction',
  deleteTransaction: 'delete_transaction',
  getBudgetMonths: 'get_budget_months',
  getBudgetMonth: 'get_budget_month',
  setBudgetAmount: 'set_budget_amount',
  getCategories: 'get_categories',
  createCategory: 'create_category',
  updateCategory: 'update_category',
  deleteCategory: 'delete_category',
  getPayees: 'get_payees',
  createPayee: 'create_payee',
  updatePayee: 'update_payee',
  deletePayee: 'delete_payee',
  getRules: 'get_rules',
  createRule: 'create_rule',
  updateRule: 'update_rule',
  deleteRule: 'delete_rule',
};

// Define Account schema for validation (simplified example)
const AccountSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  type: z.string(), // Consider enum if you have fixed valid types
  offbudget: z.boolean().optional().default(false),
  closed: z.boolean().optional().default(false),
});

// Input schema for get_accounts - no args
const GetAccountsInputSchema = z.object({});

// Input schema for get_account_balance
const GetAccountBalanceInputSchema = z.object({
  id: z.string().optional().describe('Account ID to get balance for (optional; defaults to first account)'),
  cutoff: z.string().optional().describe('Optional ISO date string cutoff'),
});

class ActualToolsManager {
  private tools: Map<string, ToolDefinition> = new Map();

  constructor() {}

  async initialize() {
    // Dynamically import all tool modules from src/tools/index.ts
    const toolModules = (await import('./tools/index.js')) as Record<string, unknown>;
    let count = 0;
    for (const [key, tool] of Object.entries(toolModules)) {
      const t = tool as unknown as { name?: string };
      if (t && t.name) {
        this.tools.set(t.name, tool as unknown as ToolDefinition);
        count++;
      }
    }
    logger.info(`🔗 Loaded ${count} tool modules from src/tools`);
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    const tool = this.getTool(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    try {
      const result = await tool.call(args);

      // Force-serialize/deserialize to ensure result is JSON-safe (no circular refs,
      // Buffers, class instances, etc). Convert undefined -> null so callers always
      // receive a valid JSON value.
      const safe = result === undefined ? null : JSON.parse(JSON.stringify(result));

      logger.info(`[TOOL RESULT] ${name}: ${JSON.stringify(safe)}`);
      return safe;
    } catch (err: unknown) {
      const e = err as Error | { message?: unknown } | undefined;
      const msg = e && typeof e.message === 'string' ? e.message : String(err);
      logger.error(`[TOOL ERROR] ${name}: ${msg}`);
      throw err;
    }
  }
}

export default new ActualToolsManager();
