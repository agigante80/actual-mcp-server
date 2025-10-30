#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { parse } from 'yaml';

const openapiPath = path.resolve('scripts/openapi/actual-openapi.yaml');
const toolsDir = path.resolve('src/tools');

function toZodType(schema, requiredProps = []) {
  if (!schema) return 'z.any()';
  if (schema.enum) {
    // map enums to z.union of literals
    const lits = schema.enum.map(v => JSON.stringify(v)).join(', ');
    return `z.union([${schema.enum.map(v => `z.literal(${JSON.stringify(v)})`).join(', ')}])`;
  }
  if (schema.type === 'string') return 'z.string()';
  if (schema.type === 'number' || schema.type === 'integer') return 'z.number()';
  if (schema.type === 'boolean') return 'z.boolean()';
  if (schema.type === 'array') {
    const items = schema.items ? toZodType(schema.items, schema.items.required || []) : 'z.any()';
    return `z.array(${items})`;
  }
  if (schema.type === 'object' || schema.properties) {
    const props = schema.properties || {};
    const req = schema.required || requiredProps || [];
    const entries = Object.entries(props).map(([k, v]) => {
      const isReq = req.includes(k);
      const inner = toZodType(v, v.required || []);
      return `${JSON.stringify(k)}: ${inner}${isReq ? '' : '.optional()'}`;
    });
    return `z.object({ ${entries.join(', ')} })`;
  }
  return 'z.any()';
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function generateToolFile(opId, op, route, method) {
  const safeName = opId.replace(/[^a-zA-Z0-9_]/g, '_');
  const filename = path.join(toolsDir, `${safeName}.ts`);

  // Build InputSchema
  let inputSchemaCode = 'z.object({})';
  if (op.requestBody && op.requestBody.content && op.requestBody.content['application/json']) {
    const schema = op.requestBody.content['application/json'].schema;
    inputSchemaCode = toZodType(schema);
  } else if (op.parameters && op.parameters.length) {
    const props = {};
    for (const p of op.parameters) props[p.name] = p.schema || { type: 'string' };
    const paramSchema = { type: 'object', properties: props };
    inputSchemaCode = toZodType(paramSchema);
  }

  const summary = op.summary || op.description || op.operationId || '';

  // Derive a brief response type comment from OpenAPI responses if possible
  let responseTypeComment = 'any';
  try {
    const resp200 = op.responses && (op.responses['200'] || op.responses[200]);
    if (resp200 && resp200.content && resp200.content['application/json'] && resp200.content['application/json'].schema) {
      const schema = resp200.content['application/json'].schema;
      // crude mapping: if schema.$ref points to components.schemas.X, use that
      if (schema.$ref) {
        const parts = String(schema.$ref).split('/');
        responseTypeComment = parts[parts.length - 1] || 'any';
      } else if (schema.type === 'array' && schema.items && schema.items.$ref) {
        const parts = String(schema.items.$ref).split('/');
        responseTypeComment = parts[parts.length - 1] + '[]';
      } else if (schema.type) {
        responseTypeComment = schema.type;
      }
    }
  } catch (e) {
    // ignore
  }

  // Determine adapter call if known
  const adapterMap = {
    accounts_list: 'getAccounts',
    transactions_create: 'addTransactions',
  };
  const adapterFn = adapterMap[opId];

  const adapterImport = adapterFn ? "import adapter from '../lib/actual-adapter.js';\n" : '';
  const callImplementation = adapterFn
    ? `    // validate input\n    const input = InputSchema.parse(args || {});\n    // call adapter.${adapterFn} (wrap args as appropriate)\n    const result = await adapter.${adapterFn}(${adapterFn === 'addTransactions' ? '[input]' : 'input'});\n    return { result };\n`
    : `    InputSchema.parse(args || {});\n    // TODO: implement call to Actual API using generated client/adapters\n    return { result: null };\n`;

  const code = `import { z } from 'zod';
import type { paths } from '../../generated/actual-client/types.js';
import type { ToolDefinition } from '../../types/tool.d.js';
${adapterImport}
const InputSchema = ${inputSchemaCode};

// RESPONSE_TYPE: ${responseTypeComment}
type Output = any; // refine using generated types (paths['${route}']['${method}'])

const tool: ToolDefinition = {
  name: 'actual.${opId.replace(/_/g, '.')}',
  description: ${JSON.stringify(summary)},
  inputSchema: InputSchema,
  call: async (args: any, _meta?: any) => {
${callImplementation}
  },
};

export default tool;
`;

  fs.writeFileSync(filename, code);
  return path.basename(filename);
}

function main() {
  if (!fs.existsSync(openapiPath)) {
    console.error('OpenAPI file not found:', openapiPath);
    process.exit(1);
  }
  ensureDir(toolsDir);
  const raw = fs.readFileSync(openapiPath, 'utf8');
  const openapi = parse(raw);

  const generatedFiles = [];
  for (const [route, pathItem] of Object.entries(openapi.paths || {})) {
    for (const [method, op] of Object.entries(pathItem)) {
      if (!op.operationId) continue;
      const safeName = op.operationId.replace(/[^a-zA-Z0-9_]/g, '_');
      const filename = path.join(toolsDir, `${safeName}.ts`);
      if (fs.existsSync(filename)) {
        console.log('Skipping existing file', filename);
        generatedFiles.push(path.basename(filename));
        continue;
      }
      const fname = generateToolFile(op.operationId, op, route, method);
      generatedFiles.push(fname);
      console.log('Generated', fname);
    }
  }

  // Compose index from all .ts files under src/tools (preserve existing manual files)
  const allFiles = fs.readdirSync(toolsDir).filter(f => f.endsWith('.ts') && f !== 'index.ts');
  const exports = allFiles.map(f => {
    const name = path.basename(f, '.ts');
    return `export { default as ${name} } from './${name}.js';`;
  }).join('\n');
  fs.writeFileSync(path.join(toolsDir, 'index.ts'), `// Auto-generated index for all tool modules\n${exports}\n`);
  console.log('Wrote src/tools/index.ts with', allFiles.length, 'entries');
}

main();
