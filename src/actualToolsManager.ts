// src/actualToolsManager.ts
import * as ActualApi from '@actual-app/api';
import logger from './logger.js';
import { z } from 'zod';

const ActualApiAny = ActualApi as any;

import { ZodTypeAny } from 'zod';

type ToolDefinition = {
  name: string;
  description: string;
  call: (args: any) => Promise<any>;
  inputSchema?: ZodTypeAny; // <-- make sure this line exists exactly here
};

// ✅ List of tools that YOU have already implemented in this class.
// Add the tool name here once you fully implement it.
const IMPLEMENTED_TOOLS = [
  'get_accounts', // Example: already implemented below
];

// 🔑 Mapping of Actual API function names → your MCP tool names
// This allows us to compare what exists in the API vs. what you’ve wrapped.
// Add new entries here as you expand support.
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
  id: z.string().describe('Account ID to get balance for'),
  cutoff: z.string().optional().describe('Optional ISO date string cutoff'),
});

class ActualToolsManager {
  private tools: Map<string, ToolDefinition> = new Map();

  constructor() {}

  async initialize() {
    // 👇 Automated check for missing tools
    const availableApiKeys = Object.keys(ActualApi);

    const availableTools = Object.keys(API_TOOL_MAP)
      .filter((apiKey) => availableApiKeys.includes(apiKey))
      .map((apiKey) => API_TOOL_MAP[apiKey]);

    const missingTools = availableTools.filter(
      (tool) => !IMPLEMENTED_TOOLS.includes(tool)
    );

    logger.info('✅ Implemented tools: ' + IMPLEMENTED_TOOLS.join(', '));
    logger.info('🛠️ Available but not yet implemented: ' + missingTools.join(', '));

    // --------------------
    // Example: Implemented tool
    // --------------------
    this.tools.set('get_accounts', {
      name: 'get_accounts',
      description: 'List all accounts',
      call: async () => ActualApiAny.getAccounts(),
      inputSchema: GetAccountsInputSchema,
    });

    this.tools.set('get_account_balance', {
      name: 'get_account_balance',
      description: 'Get the balance for an account, optionally as of a cutoff date',
      call: async (args) => {
        // Validate input with schema
        const validated = GetAccountBalanceInputSchema.parse(args);
        return ActualApiAny.getAccountBalance(validated.id, validated.cutoff);
      },
      inputSchema: GetAccountBalanceInputSchema,
    });

    logger.info(`🔗 Loaded ${this.tools.size} Actual tools for MCP bridge`);
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  async callTool(name: string, args: any): Promise<any> {
    const tool = this.getTool(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    try {
      const result = await tool.call(args);
      logger.info(`[TOOL RESULT] ${name}:`, JSON.stringify(result, null, 2));
      return result;
    } catch (err: any) {
      logger.error(`[TOOL ERROR] ${name}:`, err.message || err);
      throw err;
    }
  }
}

export default new ActualToolsManager();
