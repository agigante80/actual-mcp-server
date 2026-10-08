import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { RuleItemSchema, validateRuleInput } from '../lib/schemas/rules.js';

const tool: ToolDefinition = {
  name: 'actual_rules_create',
  description: `Create a new budget rule with conditions and actions.

IMPORTANT Field Types:
- "imported_payee" (string) - for text matching payee names. Supports: contains, matches, doesNotContain, is, isNot
- "payee" (ID) - for exact payee ID matching. Supports: is, isNot, oneOf, notOneOf
- "account", "category" (ID) - for account/category IDs. Supports: is, isNot, oneOf, notOneOf
- "notes", "description" (string) - for text matching. Supports: contains, matches, doesNotContain, is, isNot
- "amount", "date" (number/date) - supports: is, gte, lte, gt, lt

Stage: omit it (the normal stage, recommended), or 'pre' to run before the user's own rules, or 'post' to run after.
Do NOT pass "default" as a string; this tool rejects it. The normal stage is null, which is what omitting gives you.
Category, payee and account ids named in conditions or actions must exist in the budget; a rule pointing at a missing one is refused with a not-found error and nothing is created. (Ids in link-schedule actions are not checked.)
Action operators: 'set', 'set-split-amount', 'link-schedule', 'append-notes'.

Example (no stage, so the rule lands in the normal stage alongside the user's own rules): {conditionsOp: "and", conditions: [{field: "imported_payee", op: "contains", value: "Amazon"}], actions: [{op: "set", field: "category", value: "category-uuid"}]}`,
  inputSchema: RuleItemSchema,
  call: async (args: unknown, _meta?: unknown) => {
    // Zod validation errors are formatted centrally by actualToolsManager (#206).
    const input = RuleItemSchema.parse(args || {});
    
    validateRuleInput(input);

    // No automatic translation - require explicit field names
    const ruleData = JSON.parse(JSON.stringify(input)); // deep clone
    
    const ruleId = await adapter.createRule(ruleData);
    return { id: ruleId, success: true };
  },
};

export default tool;
