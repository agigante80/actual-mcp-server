import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';

const InputSchema = z.object({
  topic: z.enum(['fields', 'operators', 'examples', 'actions', 'scenarios', 'all'])
    .optional()
    .default('all')
    .describe('Topic to get help on: fields (field reference), operators (operator reference), examples (rule examples), actions (action types), scenarios (common use cases), all (everything)'),
  scenario: z.string()
    .optional()
    .describe('Specific scenario to get examples for (e.g., "payee-matching", "amount-threshold", "date-range", "auto-categorize")'),
});

const FIELD_REFERENCE = {
  title: 'Rule Condition Fields Reference',
  fields: [
    {
      name: 'imported_payee',
      type: 'string',
      operators: ['contains', 'matches', 'doesNotContain', 'is', 'isNot'],
      description: 'Match payee names with text patterns. Use this for flexible payee name matching.',
      example: { field: 'imported_payee', op: 'contains', value: 'Amazon' },
    },
    {
      name: 'payee',
      type: 'id (UUID)',
      operators: ['is', 'isNot', 'oneOf', 'notOneOf'],
      description: 'Match exact payee by ID. Requires the payee UUID from your budget.',
      example: { field: 'payee', op: 'is', value: '550e8400-e29b-41d4-a716-446655440000' },
    },
    {
      name: 'account',
      type: 'id (UUID)',
      operators: ['is', 'isNot', 'oneOf', 'notOneOf'],
      description: 'Match transactions in specific accounts. Requires account UUID.',
      example: { field: 'account', op: 'oneOf', value: ['uuid-1', 'uuid-2'] },
    },
    {
      name: 'category',
      type: 'id (UUID)',
      operators: ['is', 'isNot', 'oneOf', 'notOneOf'],
      description: 'Match transactions by category. Requires category UUID.',
      example: { field: 'category', op: 'is', value: '550e8400-e29b-41d4-a716-446655440000' },
    },
    {
      name: 'notes',
      type: 'string',
      operators: ['contains', 'matches', 'doesNotContain', 'is', 'isNot'],
      description: 'Match transaction notes with text patterns.',
      example: { field: 'notes', op: 'contains', value: 'subscription' },
    },
    {
      name: 'description',
      type: 'string',
      operators: ['contains', 'matches', 'doesNotContain', 'is', 'isNot'],
      description: 'Match transaction description with text patterns.',
      example: { field: 'description', op: 'matches', value: 'RECURRING.*PAYMENT' },
    },
    {
      name: 'amount',
      type: 'number (cents)',
      operators: ['is', 'gte', 'lte', 'gt', 'lt', 'isapprox'],
      description: 'Match transaction amounts. Values in cents (e.g., 5000 = $50.00). Negative = expense, positive = income.',
      example: { field: 'amount', op: 'gte', value: 100000 },
    },
    {
      name: 'date',
      type: 'date (YYYY-MM-DD)',
      operators: ['is', 'gte', 'lte', 'gt', 'lt'],
      description: 'Match transaction dates.',
      example: { field: 'date', op: 'gte', value: '2025-01-01' },
    },
  ],
};

const OPERATOR_REFERENCE = {
  title: 'Operator Reference',
  categories: [
    {
      category: 'Equality Operators',
      operators: [
        { op: 'is', description: 'Exact match', example: '{ field: "amount", op: "is", value: 5000 }' },
        { op: 'isNot', description: 'Not equal to', example: '{ field: "payee", op: "isNot", value: "uuid" }' },
      ],
    },
    {
      category: 'Comparison Operators (numbers/dates)',
      operators: [
        { op: 'gt', description: 'Greater than', example: '{ field: "amount", op: "gt", value: 10000 }' },
        { op: 'gte', description: 'Greater than or equal', example: '{ field: "date", op: "gte", value: "2025-01-01" }' },
        { op: 'lt', description: 'Less than', example: '{ field: "amount", op: "lt", value: 0 }' },
        { op: 'lte', description: 'Less than or equal', example: '{ field: "date", op: "lte", value: "2025-12-31" }' },
        { op: 'isapprox', description: 'Approximately equal (amount only)', example: '{ field: "amount", op: "isapprox", value: 5000 }' },
      ],
    },
    {
      category: 'Text Operators (strings)',
      operators: [
        { op: 'contains', description: 'Contains substring (case-insensitive)', example: '{ field: "imported_payee", op: "contains", value: "amazon" }' },
        { op: 'doesNotContain', description: 'Does not contain substring', example: '{ field: "notes", op: "doesNotContain", value: "refund" }' },
        { op: 'matches', description: 'Regex pattern match', example: '{ field: "description", op: "matches", value: "^RECURRING" }' },
      ],
    },
    {
      category: 'Set Operators (IDs)',
      operators: [
        { op: 'oneOf', description: 'Matches any value in array', example: '{ field: "account", op: "oneOf", value: ["uuid-1", "uuid-2"] }' },
        { op: 'notOneOf', description: 'Does not match any value in array', example: '{ field: "category", op: "notOneOf", value: ["uuid-1"] }' },
      ],
    },
  ],
};

const ACTION_REFERENCE = {
  title: 'Action Types Reference',
  actions: [
    {
      op: 'set',
      description: 'Set a field to a specific value',
      fields: ['category', 'payee', 'notes', 'cleared', 'account'],
      examples: [
        { op: 'set', field: 'category', value: 'category-uuid', type: 'id' },
        { op: 'set', field: 'notes', value: 'Auto-categorized', type: 'string' },
        { op: 'set', field: 'cleared', value: true, type: 'boolean' },
      ],
    },
    {
      op: 'append-notes',
      description: 'Add text to the end of transaction notes',
      examples: [
        { op: 'append-notes', value: ' [Reviewed]' },
        { op: 'append-notes', value: ' - Flagged for review' },
      ],
    },
    {
      op: 'prepend-notes',
      description: 'Add text to the beginning of transaction notes',
      examples: [
        { op: 'prepend-notes', value: '⚠️ ' },
        { op: 'prepend-notes', value: 'LARGE PURCHASE: ' },
      ],
    },
    {
      op: 'set-split-amount',
      description: 'Split transaction into multiple categories',
      example: { op: 'set-split-amount', value: { amount: 5000, category: 'uuid' } },
    },
    {
      op: 'link-schedule',
      description: 'Link transaction to a scheduled transaction',
      example: { op: 'link-schedule', value: 'schedule-uuid' },
    },
  ],
};

const EXAMPLES = {
  title: 'Common Rule Examples',
  examples: [
    {
      name: 'Auto-categorize Amazon purchases',
      description: 'Automatically categorize all Amazon purchases as Shopping',
      rule: {
        stage: 'post',
        conditionsOp: 'and',
        conditions: [
          { field: 'imported_payee', op: 'contains', value: 'Amazon' },
        ],
        actions: [
          { op: 'set', field: 'category', value: 'shopping-category-uuid', type: 'id' },
        ],
      },
    },
    {
      name: 'Flag large transactions',
      description: 'Add a flag to transactions over $1,000',
      rule: {
        stage: 'post',
        conditionsOp: 'and',
        conditions: [
          { field: 'amount', op: 'lt', value: -100000 }, // Less than -$1000 (expenses are negative)
        ],
        actions: [
          { op: 'prepend-notes', value: '🚨 LARGE EXPENSE: ' },
        ],
      },
    },
    {
      name: 'Categorize salary deposits',
      description: 'Auto-categorize salary deposits to Income category',
      rule: {
        stage: 'post',
        conditionsOp: 'and',
        conditions: [
          { field: 'imported_payee', op: 'contains', value: 'PAYROLL' },
          { field: 'amount', op: 'gt', value: 0 }, // Positive amount (income)
        ],
        actions: [
          { op: 'set', field: 'category', value: 'income-category-uuid', type: 'id' },
        ],
      },
    },
    {
      name: 'Tag recurring subscriptions',
      description: 'Add notes to identify recurring subscription payments',
      rule: {
        stage: 'post',
        conditionsOp: 'or',
        conditions: [
          { field: 'imported_payee', op: 'contains', value: 'Netflix' },
          { field: 'imported_payee', op: 'contains', value: 'Spotify' },
          { field: 'imported_payee', op: 'contains', value: 'Disney+' },
        ],
        actions: [
          { op: 'set', field: 'category', value: 'subscriptions-category-uuid', type: 'id' },
          { op: 'append-notes', value: ' [Subscription]' },
        ],
      },
    },
    {
      name: 'Categorize by amount range',
      description: 'Categorize coffee shop purchases (small amounts)',
      rule: {
        stage: 'post',
        conditionsOp: 'and',
        conditions: [
          { field: 'imported_payee', op: 'matches', value: 'Starbucks|Coffee|Cafe' },
          { field: 'amount', op: 'gte', value: -1000 }, // Between $0 and $10
          { field: 'amount', op: 'lte', value: 0 },
        ],
        actions: [
          { op: 'set', field: 'category', value: 'coffee-category-uuid', type: 'id' },
        ],
      },
    },
    {
      name: 'Multi-account filtering',
      description: 'Apply rules only to specific accounts',
      rule: {
        stage: 'post',
        conditionsOp: 'and',
        conditions: [
          { field: 'account', op: 'oneOf', value: ['checking-uuid', 'savings-uuid'] },
          { field: 'imported_payee', op: 'contains', value: 'Transfer' },
        ],
        actions: [
          { op: 'set', field: 'category', value: 'transfer-category-uuid', type: 'id' },
        ],
      },
    },
    {
      name: 'Date-based categorization',
      description: 'Categorize transactions in a specific date range',
      rule: {
        stage: 'post',
        conditionsOp: 'and',
        conditions: [
          { field: 'date', op: 'gte', value: '2025-12-01' },
          { field: 'date', op: 'lte', value: '2025-12-31' },
          { field: 'notes', op: 'contains', value: 'holiday' },
        ],
        actions: [
          { op: 'set', field: 'category', value: 'holiday-category-uuid', type: 'id' },
        ],
      },
    },
    {
      name: 'Exclude certain payees',
      description: 'Apply categorization except for specific payees',
      rule: {
        stage: 'post',
        conditionsOp: 'and',
        conditions: [
          { field: 'category', op: 'isNot', value: 'already-categorized-uuid' },
          { field: 'imported_payee', op: 'doesNotContain', value: 'Internal Transfer' },
          { field: 'amount', op: 'lt', value: 0 },
        ],
        actions: [
          { op: 'set', field: 'category', value: 'general-expense-uuid', type: 'id' },
        ],
      },
    },
  ],
};

const SCENARIOS = {
  title: 'Common Scenarios & Solutions',
  scenarios: [
    {
      scenario: 'Match payee by name (not ID)',
      solution: 'Use "imported_payee" field with "contains" or "matches" operator',
      example: '{ field: "imported_payee", op: "contains", value: "Amazon" }',
      note: 'The "payee" field requires UUID, so use "imported_payee" for text matching',
    },
    {
      scenario: 'Match multiple payees',
      solution: 'Use "or" conditionsOp with multiple imported_payee conditions',
      example: '{ conditionsOp: "or", conditions: [{ field: "imported_payee", op: "contains", value: "Amazon" }, { field: "imported_payee", op: "contains", value: "eBay" }] }',
    },
    {
      scenario: 'Match transactions in multiple accounts',
      solution: 'Use "oneOf" operator with array of account UUIDs',
      example: '{ field: "account", op: "oneOf", value: ["uuid-1", "uuid-2"] }',
    },
    {
      scenario: 'Match amount greater than $100',
      solution: 'Use "gt" operator with amount in cents (negative for expenses)',
      example: '{ field: "amount", op: "lt", value: -10000 }',
      note: 'Remember: amounts are in cents, expenses are negative',
    },
    {
      scenario: 'Match transactions this year',
      solution: 'Use date field with "gte" operator',
      example: '{ field: "date", op: "gte", value: "2025-01-01" }',
    },
    {
      scenario: 'Regex pattern matching',
      solution: 'Use "matches" operator with regex pattern',
      example: '{ field: "imported_payee", op: "matches", value: "^AMAZON.*COM$" }',
      note: 'Patterns are case-insensitive by default',
    },
    {
      scenario: 'Apply to uncategorized transactions only',
      solution: 'Check if category is not set',
      example: '{ field: "category", op: "is", value: null }',
      note: 'This helps avoid overwriting existing categorizations',
    },
  ],
};

const TIPS = {
  title: 'Pro Tips & Best Practices',
  tips: [
    '🎯 Use "imported_payee" for flexible text matching, "payee" for exact ID matching',
    '💰 Amounts are always in CENTS (5000 = $50.00), expenses are NEGATIVE',
    '📅 Dates use YYYY-MM-DD format',
    '🔗 Use "oneOf"/"notOneOf" for matching multiple IDs (requires array)',
    '⚠️ Pre-stage rules run before sync, post-stage rules run after sync',
    '🔄 Use conditionsOp="and" when ALL conditions must match, "or" when ANY condition matches',
    '📝 Test rules with a small subset before applying broadly',
    '🏷️ List accounts/categories/payees first to get UUIDs for ID-based rules',
    '🔍 Use "contains" for partial matching, "is" for exact matching',
    '✅ Combine multiple actions to set category AND add notes simultaneously',
  ],
};

const tool: ToolDefinition = {
  name: 'actual_rules_help',
  description: 'Get comprehensive help, examples, and reference documentation for creating Actual Budget rules. Includes field reference, operator guide, action types, real-world examples, and common scenarios. Use this before creating rules to understand syntax and avoid errors.',
  inputSchema: InputSchema,
  call: async (args: unknown) => {
    const input = InputSchema.parse(args || {});
    
    let result: any = {
      help: 'Actual Budget Rules Help & Reference',
    };
    
    // Handle specific scenarios
    if (input.scenario) {
      const scenario = SCENARIOS.scenarios.find(s => 
        s.scenario.toLowerCase().includes(input.scenario!.toLowerCase())
      );
      
      if (scenario) {
        result.scenario = scenario;
        result.relatedExamples = EXAMPLES.examples.filter(e => 
          e.name.toLowerCase().includes(input.scenario!.toLowerCase()) ||
          e.description.toLowerCase().includes(input.scenario!.toLowerCase())
        );
        return result;
      }
    }
    
    // Build result based on topic
    switch (input.topic) {
      case 'fields':
        result.fieldReference = FIELD_REFERENCE;
        break;
        
      case 'operators':
        result.operatorReference = OPERATOR_REFERENCE;
        break;
        
      case 'examples':
        result.examples = EXAMPLES;
        break;
        
      case 'actions':
        result.actionReference = ACTION_REFERENCE;
        break;
        
      case 'scenarios':
        result.scenarios = SCENARIOS;
        break;
        
      case 'all':
      default:
        result = {
          help: 'Actual Budget Rules Help & Reference',
          quickStart: {
            summary: 'Rules automatically categorize, tag, or modify transactions based on conditions.',
            workflow: [
              '1. List accounts/categories/payees to get UUIDs',
              '2. Define conditions (what to match)',
              '3. Define actions (what to do when matched)',
              '4. Create rule with actual_rules_create',
              '5. Test and refine',
            ],
          },
          fieldReference: FIELD_REFERENCE,
          operatorReference: OPERATOR_REFERENCE,
          actionReference: ACTION_REFERENCE,
          examples: EXAMPLES,
          scenarios: SCENARIOS,
          tips: TIPS,
        };
        break;
    }
    
    return result;
  },
};

export default tool;
