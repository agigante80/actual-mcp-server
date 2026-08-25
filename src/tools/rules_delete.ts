import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';
import { notFoundMsg } from '../lib/errors.js';
import api from '@actual-app/api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { getRules: rawGetRules, deleteRule: rawDeleteRule } = api as any;

const InputSchema = z.object({
  // Bounded for the same reason as the payee ids in #356: this value is echoed into the
  // not-found message, into the schedule-owned refusal below, and into logger.error.
  id: z.string().min(1).max(64).describe('Rule ID to delete'),
});

const tool: ToolDefinition = {
  name: 'actual_rules_delete',
  description:
    'Delete a budget rule from Actual Budget. The rule will no longer be applied to new or ' +
    'existing transactions. This operation cannot be undone. A rule that belongs to a SCHEDULE ' +
    'cannot be deleted on its own: the call is refused and names the schedule tool to use instead.',
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    const input = InputSchema.parse(args || {});
    // Read+write inside one withWriteSession cycle (#142).
    return await adapter.withWriteSession(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allRules: any[] = await rawGetRules();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ruleExists = allRules.some((r: any) => r.id === input.id);
      if (!ruleExists) {
        // Throw (not return {success:false}) so a non-existent id surfaces as an MCP
        // error, consistent with every other delete tool's not-found behavior.
        throw new Error(notFoundMsg('Rule', input.id, 'actual_rules_get'));
      }
      // #355: the raw call RETURNS a verdict and it used to be discarded.
      // Upstream `deleteRule` returns `false`, without throwing, when a schedule owns
      // this rule: Actual keeps a schedule and its generated rule in step and refuses
      // to remove the rule on its own. The existence pre-check above cannot catch that
      // case, because the rule genuinely exists. Reporting success there was a lie
      // (CWE-252, unchecked return value).
      //
      // Only an EXPLICIT `false` is a refusal. A build that returns `undefined` (the
      // published reference documents this method as `Promise<null>`) is treated as
      // success, so this stays correct against older and future versions.
      const deleted = await rawDeleteRule(input.id);
      if (deleted === false) {
        throw new Error(
          `Rule "${input.id}" belongs to a schedule and cannot be deleted on its own. ` +
            'Actual keeps a schedule and its generated rule in step. Delete the schedule ' +
            'instead with actual_schedules_delete (find it with actual_schedules_get), ' +
            'which removes this rule too.',
        );
      }
      return { success: true };
    });
  },
};

export default tool;
