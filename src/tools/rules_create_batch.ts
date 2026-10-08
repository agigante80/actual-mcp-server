import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import { RuleItemSchema, validateRuleInput } from '../lib/schemas/rules.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  rules: z.array(RuleItemSchema).min(1).max(50)
    .describe('1 to 50 rules, each exactly the input of actual_rules_create'),
});

type BatchResult = {
  succeeded: { index: number; id: string }[];
  failed: { index: number; error: string }[];
  total: number;
  successCount: number;
  failureCount: number;
};

// createTool() wraps the return value as { result }. The whole array is shape-validated
// before anything is written (a Zod error refuses the call). The per-rule checks of
// actual_rules_create (validateRuleInput) are per item: a failing rule goes to `failed` and
// the rest continue. Only passing items reach the adapter, with their ORIGINAL indices.
export default createTool<z.infer<typeof InputSchema>, BatchResult>({
  name: 'actual_rules_create_batch',
  description: `Create 1 to 50 budget rules in one call, each exactly the input of actual_rules_create.

NOT atomic and no rollback: each rule is created independently, and rules created before a failure stay created. A rule that fails its own checks, names a category, payee or account id that does not exist, or is rejected by Actual is reported in "failed" with its index, and the rest are still attempted. Ids in link-schedule actions are not checked. A create is never retried automatically.

If the call itself fails (timeout, lost connection), or an item says "not attempted", read the rules back with actual_rules_get BEFORE retrying ANY item: items marked "not attempted" were never sent, but others may have been created.

Returns: { succeeded: [{index, id}], failed: [{index, error}], total, successCount, failureCount }. Every rule failing is a normal result (successCount 0), not a tool error.`,
  schema: InputSchema,
  handler: async (input) => {
    const total = input.rules.length;
    const failed: { index: number; error: string }[] = [];
    const pass: { index: number; rule: unknown }[] = [];
    input.rules.forEach((rule, index) => {
      try {
        validateRuleInput(rule);
        pass.push({ index, rule: JSON.parse(JSON.stringify(rule)) });
      } catch (error) {
        failed.push({ index, error: error instanceof Error ? error.message : String(error) });
      }
    });

    // If no item passes, no queued op runs. A whole-call failure propagates as a tool error.
    let succeeded: { index: number; id: string }[] = [];
    if (pass.length > 0) {
      const res = await adapter.createRulesBatch(pass, total);
      succeeded = res.succeeded;
      failed.push(...res.failed);
    }
    failed.sort((a, b) => a.index - b.index);
    succeeded.sort((a, b) => a.index - b.index);
    return { succeeded, failed, total, successCount: succeeded.length, failureCount: failed.length };
  },
});
