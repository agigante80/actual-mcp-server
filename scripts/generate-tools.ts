#!/usr/bin/env ts-node
import fs from 'fs';
import path from 'path';
import { parse } from 'yaml';

const openapiPath = path.resolve('scripts/openapi/actual-openapi.yaml');
const toolsDir = path.resolve('src/tools');

if (!fs.existsSync(toolsDir)) fs.mkdirSync(toolsDir, { recursive: true });

const openapi = parse(fs.readFileSync(openapiPath, 'utf8'));

function toZodType(schema: unknown): string {
  if (!schema) return 'z.any()';
  const s = schema as any;
  if (s.type === 'string') return 'z.string()';
  if (s.type === 'number' || s.type === 'integer') return 'z.number()';
  if (s.type === 'boolean') return 'z.boolean()';
  if (s.type === 'array') return `z.array(${toZodType(s.items)})`;
  if (s.type === 'object') {
    const props = s.properties || {};
    const entries = Object.entries(props).map(
      ([k, v]) => `${k}: ${toZodType(v)}`
    );
    return `z.object({${entries.join(', ')}})`;
  }
  return 'z.any()';
}
for (const [route, methods] of Object.entries(openapi.paths)) {
  for (const [method, op] of Object.entries(methods as Record<string, unknown>)) {
    const opId = op.operationId;
    const inputSchema =
      op.requestBody?.content?.['application/json']?.schema ||
      (op.parameters && op.parameters.length > 0
        ? {
            type: 'object',
            properties: Object.fromEntries(
              op.parameters.map((p: any) => [p.name, p.schema])
            ),
          }
        : { type: 'object' });
    const outputSchema = op.responses?.['200']?.content?.['application/json']?.schema;
    const toolFile = path.join(toolsDir, `${opId}.ts`);
    const code = `import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types';
import { ToolDefinition } from '../../types/tool';

const InputSchema = ${toZodType(inputSchema)};

type Output = any; // TODO: refine using paths['${route}']['${method}']['responses']['200']

const tool: ToolDefinition = {
  name: 'actual.${opId.replace('_', '.')}',
  description: ${JSON.stringify(op.summary)},
  inputSchema: InputSchema,
  call: async (args: any, _meta?: any) => {
    // TODO: implement call to actual API
    return { result: null };
  },
};

export default tool;
`;
    fs.writeFileSync(toolFile, code);
    console.log(`Generated ${toolFile}`);
  }
}
