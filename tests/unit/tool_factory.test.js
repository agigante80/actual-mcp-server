// tests/unit/tool_factory.test.js
//
// createTool() (src/lib/toolFactory.ts) is the project's preferred factory for new tools
// (CLAUDE.md), wiring input validation, error handling, structured logging, and
// observability once so every tool behaves consistently. It had no direct unit test, so a
// regression in the shared wrapper (e.g. dropping the { result } envelope, swallowing a
// handler error, or skipping the observability increment) would go uncaught until it broke
// many tools at once. This pins the wrapper's contract.
//
// Spying: toolFactory calls `observability.incrementToolCall` on the shared default-export
// singleton at call time, so replacing that method on the imported singleton is observed by
// the factory (same object reference).
//
// Run: node tests/unit/tool_factory.test.js

import assert from 'node:assert';
import { z } from 'zod';
import { createTool } from '../../dist/src/lib/toolFactory.js';
import observability from '../../dist/src/observability.js';

// Spy on the shared observability singleton.
let incCalls = [];
const originalInc = observability.incrementToolCall;
observability.incrementToolCall = async (name) => { incCalls.push(name); };
const resetSpy = () => { incCalls = []; };

let passed = 0, failed = 0;
async function check(label, fn) {
  resetSpy();
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label}: ${err.message}`); failed++; }
}

console.log('\n[tool-factory] createTool() wrapper contract');

// Shape.
await check('returns a ToolDefinition with name, the schema as inputSchema, and a call fn', async () => {
  const schema = z.object({ x: z.number() });
  const tool = createTool({ name: 'actual_test_do', description: 'Do a thing', schema, handler: async () => 1 });
  assert.strictEqual(tool.name, 'actual_test_do');
  assert.strictEqual(tool.inputSchema, schema, 'inputSchema is the provided zod schema');
  assert.strictEqual(typeof tool.call, 'function');
});

// Description formatting.
await check('description is the plain text when no examples are given', async () => {
  const tool = createTool({ name: 'actual_test_do', description: 'Plain desc', schema: z.object({}), handler: async () => 1 });
  assert.strictEqual(tool.description, 'Plain desc');
});
await check('description appends a formatted Examples block when examples are given', async () => {
  const tool = createTool({
    name: 'actual_test_do', description: 'Base', schema: z.object({ x: z.number() }), handler: async () => 1,
    examples: [{ description: 'First case', input: { x: 5 } }],
  });
  assert.ok(tool.description.startsWith('Base'), 'keeps the base description');
  assert.ok(tool.description.includes('Examples:'), 'has an Examples header');
  assert.ok(tool.description.includes('1. First case'), 'lists the example description');
  assert.ok(tool.description.includes('"x": 5'), 'renders the example input as JSON');
});

// Success path.
await check('call() validates input, invokes the handler, and wraps the return in { result }', async () => {
  let seen;
  const tool = createTool({
    name: 'actual_test_sum', description: 'sum', schema: z.object({ a: z.number(), b: z.number() }),
    handler: async (input) => { seen = input; return input.a + input.b; },
  });
  const out = await tool.call({ a: 2, b: 3 });
  assert.deepStrictEqual(out, { result: 5 }, 'return is wrapped in { result }');
  assert.deepStrictEqual(seen, { a: 2, b: 3 }, 'handler received the validated input');
  assert.deepStrictEqual(incCalls, ['actual_test_sum'], 'observability incremented once on success');
});

// meta is threaded to the handler.
await check('call() passes meta through to the handler', async () => {
  let seenMeta;
  const tool = createTool({ name: 'actual_test_meta', description: 'm', schema: z.object({}), handler: async (_i, meta) => { seenMeta = meta; return 1; } });
  await tool.call({}, { sessionId: 'abc' });
  assert.deepStrictEqual(seenMeta, { sessionId: 'abc' });
});

// undefined args -> parsed as {} (so an all-optional schema still succeeds).
await check('call() treats undefined args as {} for schema validation', async () => {
  let seen;
  const tool = createTool({ name: 'actual_test_opt', description: 'o', schema: z.object({ x: z.number().optional() }), handler: async (input) => { seen = input; return 1; } });
  const out = await tool.call(undefined);
  assert.deepStrictEqual(out, { result: 1 });
  assert.deepStrictEqual(seen, {}, 'undefined became {}');
});

// Schema-invalid path: throws, handler NOT called, observability still incremented.
await check('call() throws on invalid input, does not call the handler, still increments observability', async () => {
  let handlerCalled = false;
  const tool = createTool({ name: 'actual_test_bad', description: 'b', schema: z.object({ x: z.number() }), handler: async () => { handlerCalled = true; return 1; } });
  await assert.rejects(() => tool.call({ x: 'not-a-number' }), (e) => e instanceof z.ZodError);
  assert.strictEqual(handlerCalled, false, 'handler is not reached when validation fails');
  assert.deepStrictEqual(incCalls, ['actual_test_bad'], 'observability incremented on the error path too');
});

// Handler-error path: the SAME error is re-thrown (not swallowed), observability incremented.
await check('call() re-throws the handler error unchanged and still increments observability', async () => {
  const boom = new Error('handler boom');
  const tool = createTool({ name: 'actual_test_throw', description: 't', schema: z.object({}), handler: async () => { throw boom; } });
  await assert.rejects(() => tool.call({}), (e) => e === boom, 'the exact handler error propagates');
  assert.deepStrictEqual(incCalls, ['actual_test_throw'], 'observability incremented on the failure path');
});

observability.incrementToolCall = originalInc;
console.log(`\n[tool-factory] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
