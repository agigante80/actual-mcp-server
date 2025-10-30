import { z } from 'zod';
import type { paths, components } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({ "month": z.string().optional() });

// RESPONSE_TYPE: object
type Output = any; // no detailed schema in OpenAPI fragment

const tool: ToolDefinition = {
  name: 'actual.budgets.getMonth',
  description: "Get budget month",
  inputSchema: InputSchema,
  call: async (args: any, _meta?: any) => {
  const input = InputSchema.parse(args || {});
  const res = await adapter.getBudgetMonth((input as any).month as any);
  return { result: res };

  },
};

export default tool;
