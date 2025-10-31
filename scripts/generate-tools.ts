#!/usr/bin/env ts-node
import fs from 'fs';
import path from 'path';
import { parse } from 'yaml';

const openapiPath = path.resolve('scripts/openapi/actual-openapi.yaml');
const toolsDir = path.resolve('src/tools');

if (!fs.existsSync(toolsDir)) fs.mkdirSync(toolsDir, { recursive: true });

const openapi = parse(fs.readFileSync(openapiPath, 'utf8'));

function toZodType(schema: any): string {
  if (!schema) return 'z.any()';
  if (schema.type === 'string') return 'z.string()';
  if (schema.type === 'number' || schema.type === 'integer') return 'z.number()';
  if (schema.type === 'boolean') return 'z.boolean()';
  if (schema.type === 'array') return `z.array(${toZodType(schema.items)})`;
  if (schema.type === 'object') {
    const props = schema.properties || {};
    const entries = Object.entries(props).map(
      ([k, v]) => `${k}: ${toZodType(v)}`
    );
    return `z.object({${entries.join(', ')}})`;
  }
  return 'z.any()';
}

for (const [route, methods] of Object.entries(openapi.paths || {})) {
  const methodEntries = methods && typeof methods === 'object' ? Object.entries(methods as Record<string, unknown>) : [];
  for (const [method, opRaw] of methodEntries) {
    const op = opRaw as Record<string, any>;
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

type Output = unknown; // TODO: refine using paths['${route}']['${method}']['responses']['200']

const tool: ToolDefinition = {
  name: 'actual.${opId.replace('_', '.')}',
  description: ${JSON.stringify(op.summary)},
  inputSchema: InputSchema,
  call: async (args: unknown, _meta?: unknown) => {
    // TODO: implement call to actual API
    return { result: null as unknown };
  },
};

export default tool;
`;
    fs.writeFileSync(toolFile, code);
    console.log(`Generated ${toolFile}`);
  }
}
