import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { CONDITION_OPERATORS_HELP, RuleItemSchema, validateRuleInput } from '../lib/schemas/rules.js';

const tool: ToolDefinition = {
  name: 'actual_rules_create',
  description: `Create a budget rule.

${CONDITION_OPERATORS_HELP}
Stage: omit it for the normal stage (recommended), or 'pre' / 'post'. Do NOT pass "default"; it is rejected.
Category, payee and account ids in conditions or actions must exist, or the call is refused with a not-found error and nothing is created (ids in link-schedule actions are not checked).`,
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
